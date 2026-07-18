/**
 * Authentication and session management — token validation, HMAC-signed
 * session cookies, origin enforcement, and Bearer-token support.
 */
const crypto = require("node:crypto");
const { getAiConfig } = require("../config");
const { HttpError } = require("../errors");
const { sendJson } = require("../http/json");
const { getRequestBaseUrl } = require("../http/request");
const { sanitizeText } = require("../sanitize");
const { isHttpsRequest } = require("./headers");

function createAuth({ sessionTtlMs }) {
  return {
    clearSessionCookie,
    isRequestAuthenticated,
    requireApiAuth,
    setSessionCookie: (req, res) => setSessionCookie(req, res, sessionTtlMs),
    shouldRequireAuth,
    validateOrigin
  };
}

function shouldRequireAuth() {
  if (process.env.DISABLE_AUTH === "true") {
    return false;
  }
  return Boolean(process.env.APP_ACCESS_TOKEN || getAiConfig().apiKey || process.env.NODE_ENV === "production");
}

function requireApiAuth(req, res, authRequired) {
  if (!authRequired) return true;

  if (!process.env.APP_ACCESS_TOKEN) {
    sendJson(res, 503, {
      error: "auth_not_configured",
      message: "Access control is required but APP_ACCESS_TOKEN is not configured."
    });
    return false;
  }

  if (isRequestAuthenticated(req)) return true;

  sendJson(res, 401, {
    error: "unauthorized",
    message: "Authentication is required."
  });
  return false;
}

function validateOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;

  const allowedOrigins = new Set(
    String(process.env.APP_ALLOWED_ORIGINS || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
  );
  allowedOrigins.add(getRequestBaseUrl(req));

  if (allowedOrigins.has(origin)) return true;

  sendJson(res, 403, {
    error: "forbidden",
    message: "Origin is not allowed."
  });
  return false;
}

function isRequestAuthenticated(req) {
  const bearer = readBearerToken(req);
  if (bearer && isValidAccessToken(bearer)) return true;

  const cookie = parseCookies(req).sp_session;
  return Boolean(cookie && verifySessionCookie(cookie));
}

function readBearerToken(req) {
  const authorization = String(req.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isValidAccessToken(value) {
  const expected = process.env.APP_ACCESS_TOKEN || "";
  return Boolean(expected && value && timingSafeStringEqual(value, expected));
}

function setSessionCookie(req, res, sessionTtlMs) {
  const issuedAt = Date.now();
  const payload = base64UrlEncode(JSON.stringify({
    iat: issuedAt,
    exp: issuedAt + sessionTtlMs
  }));
  const signature = signSessionPayload(payload);
  const cookie = [
    `sp_session=${payload}.${signature}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.floor(sessionTtlMs / 1000)}`
  ];

  if (isHttpsRequest(req)) cookie.push("Secure");
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "sp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
}

function verifySessionCookie(value) {
  const [payload, signature] = String(value || "").split(".");
  if (!payload || !signature || !timingSafeStringEqual(signature, signSessionPayload(payload))) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(parsed.exp) > Date.now();
  } catch (error) {
    return false;
  }
}

function signSessionPayload(payload) {
  return crypto
    .createHmac("sha256", process.env.APP_ACCESS_TOKEN || "missing-session-secret")
    .update(payload)
    .digest("base64url");
}

function timingSafeStringEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function parseCookies(req) {
  const pairs = String(req.headers.cookie || "")
    .split(";")
    .map(item => item.trim())
    .filter(Boolean);

  return Object.fromEntries(
    pairs.map(item => {
      const sep = item.indexOf("=");
      if (sep <= 0) return [item, ""];
      try {
        return [item.slice(0, sep), decodeURIComponent(item.slice(sep + 1))];
      } catch (error) {
        return [item.slice(0, sep), ""];
      }
    })
  );
}

function readSessionAccessToken(payload) {
  return sanitizeText(payload.accessToken, 500);
}

function assertValidAccessToken(payload) {
  if (!isValidAccessToken(readSessionAccessToken(payload))) {
    throw new HttpError(401, "Invalid access token", true);
  }
}

module.exports = {
  createAuth,
  assertValidAccessToken
};
