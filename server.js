const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createAsyncLimiter } = require("./src/asyncLimiter");
const { getAiConfig, getRuntimeConfig, loadEnvFile } = require("./src/config");
const { sanitizeText, sanitizeChoice, cloneJson } = require("./src/sanitize");
const { createScenarioStore } = require("./src/scenarioStore");

loadEnvFile(path.join(__dirname, ".env"));

const runtimeConfig = getRuntimeConfig();
const PORT = runtimeConfig.port;
const MAX_BODY_BYTES = runtimeConfig.maxBodyBytes;
const SESSION_TTL_MS = runtimeConfig.sessionTtlMs;
const AI_RATE_LIMIT_MAX = runtimeConfig.aiRateLimitMax;
const SESSION_RATE_LIMIT_MAX = runtimeConfig.sessionRateLimitMax;
const RATE_LIMIT_WINDOW_MS = runtimeConfig.rateLimitWindowMs;
const RATE_LIMIT_MAX_BUCKETS = runtimeConfig.rateLimitMaxBuckets;
const AI_TIMEOUT_MS = runtimeConfig.aiTimeoutMs;
const BRIEFING_CACHE_TTL_MS = runtimeConfig.briefingCacheTtlMs;
const BRIEFING_CACHE_MAX_ENTRIES = runtimeConfig.briefingCacheMaxEntries;
const rateLimitBuckets = new Map();
const briefingCache = new Map();
const aiLimiter = createAsyncLimiter(runtimeConfig.aiConcurrencyMax, runtimeConfig.aiQueueMax, runtimeConfig.aiQueueTimeoutMs);
const scenarioStore = createScenarioStore({
  customFile: runtimeConfig.customScenarioFile
});
let lastRateLimitSweep = 0;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const ERROR_NAMES = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  413: "payload_too_large",
  415: "unsupported_media_type",
  429: "rate_limited",
  502: "ai_provider_error",
  503: "service_unavailable"
};

const UNKNOWN_ZONE = {
  id: "unknown",
  name: "Unknown zone",
  density: 0,
  wait: 0,
  accessible: "Ask nearest volunteer"
};

// ---------------------------------------------------------------------------
// Server creation
// ---------------------------------------------------------------------------

function createAppServer(options = {}) {
  const publicDir = options.publicDir || path.join(__dirname, "public");
  const authRequired = options.disableAuth ? false : shouldRequireAuth();
  const appScenarioStore = options.scenarioStore || (options.customScenarioFile
    ? createScenarioStore({ customFile: options.customScenarioFile })
    : scenarioStore);

  return http.createServer(async (req, res) => {
    applySecurityHeaders(req, res);

    try {
      const requestUrl = makeRequestUrl(req);

      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApi(req, res, requestUrl.pathname, { authRequired, scenarioStore: appScenarioStore });
        return;
      }

      await serveStaticFile(req, res, publicDir, requestUrl.pathname);
    } catch (error) {
      handleServerError(req, res, error);
    }
  });
}

// ---------------------------------------------------------------------------
// API routing — route-table pattern for clarity
// ---------------------------------------------------------------------------

async function handleApi(req, res, pathname, options) {
  const key = `${req.method} ${pathname}`;
  const appScenarioStore = options.scenarioStore || scenarioStore;

  switch (key) {
    case "GET /api/health":
      return sendJson(res, 200, {
        service: "StadiumPulse 26",
        ok: true,
        aiConfigured: Boolean(getAiConfig().apiKey && getAiConfig().model),
        authRequired: options.authRequired,
        time: new Date().toISOString()
      });

    case "GET /api/session":
      return sendJson(res, 200, {
        authRequired: options.authRequired,
        authenticated: !options.authRequired || isRequestAuthenticated(req)
      });

    case "GET /api/scenarios":
      if (!requireApiAuth(req, res, options)) return;
      return sendJson(res, 200, { scenarios: appScenarioStore.listScenarios() });

    case "POST /api/scenarios":
      if (!validateOrigin(req, res) || !requireApiAuth(req, res, options) || !enforceRateLimit(req, res, "scenario", SESSION_RATE_LIMIT_MAX)) return;
      return await handleCreateScenario(req, res, appScenarioStore);

    case "POST /api/session":
      if (!validateOrigin(req, res) || !enforceRateLimit(req, res, "session", SESSION_RATE_LIMIT_MAX)) return;
      return await handlePostSession(req, res);

    case "POST /api/session/logout":
      if (!validateOrigin(req, res)) return;
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });

    case "POST /api/ai/assistant":
      if (!validateOrigin(req, res) || !requireApiAuth(req, res, options) || !enforceRateLimit(req, res, "ai", AI_RATE_LIMIT_MAX)) return;
      return await handleAssistant(req, res, appScenarioStore);

    case "POST /api/ai/briefing":
      if (!validateOrigin(req, res) || !requireApiAuth(req, res, options) || !enforceRateLimit(req, res, "ai", AI_RATE_LIMIT_MAX)) return;
      return await handleBriefing(req, res, appScenarioStore);

    default:
      return sendJson(res, 404, { error: "not_found" });
  }
}

async function handleCreateScenario(req, res, store = scenarioStore) {
  const payload = await readJson(req);
  const scenario = await store.createScenario(payload);
  clearBriefingCacheForScenario(scenario.id);
  sendJson(res, 201, { scenario });
}

async function handlePostSession(req, res) {
  const payload = await readJson(req);
  const token = sanitizeText(payload.accessToken, 500);
  if (!isValidAccessToken(token)) {
    throw new HttpError(401, "Invalid access token", true);
  }
  setSessionCookie(req, res);
  sendJson(res, 200, { ok: true, authenticated: true });
}

async function handleAssistant(req, res, store = scenarioStore) {
  const payload = await readJson(req);
  sendJson(res, 200, await generateAssistantResponse(payload, store));
}

async function handleBriefing(req, res, store = scenarioStore) {
  const payload = await readJson(req);
  sendJson(res, 200, await generateOperationsBriefing(payload, store));
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

async function serveStaticFile(req, res, publicDir, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    throw new HttpError(405, "Method not allowed", true);
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (error) {
    throw new HttpError(400, "Malformed URL path", true);
  }

  if (decodedPath.split("/").some(segment => segment.startsWith(".") && segment !== "." && segment !== "..")) {
    throw new HttpError(404, "Not found", true);
  }

  const safePath = decodedPath.replace(/^\/+/, "") || "index.html";
  const root = path.resolve(publicDir);
  const requestedPath = path.resolve(root, safePath);
  const relativePath = path.relative(root, requestedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new HttpError(403, "Forbidden", true);
  }

  const requestedStat = await statFile(requestedPath);

  const filePath = requestedStat.isDirectory()
    ? path.join(requestedPath, "index.html")
    : requestedPath;

  const fileStat = await statFile(filePath);

  if (!fileStat.isFile()) {
    throw new HttpError(404, "Not found", true);
  }

  const fileRelativePath = path.relative(root, path.resolve(filePath));
  if (fileRelativePath.startsWith("..") || path.isAbsolute(fileRelativePath)) {
    throw new HttpError(403, "Forbidden", true);
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

async function statFile(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch (error) {
    throw new HttpError(404, "Not found", true);
  }
}

// ---------------------------------------------------------------------------
// Request / response helpers
// ---------------------------------------------------------------------------

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers["content-type"] || "").toLowerCase().includes("application/json")) {
      reject(new HttpError(415, "Content-Type must be application/json", true));
      return;
    }

    let body = "";
    let settled = false;

    req.on("data", chunk => {
      if (settled) return;
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        settled = true;
        reject(new HttpError(413, "Request body is too large", true));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (settled) return;
      if (!body) { resolve({}); return; }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new HttpError(400, "Invalid JSON request body", true));
      }
    });

    req.on("error", error => {
      if (!settled) reject(error);
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

class HttpError extends Error {
  constructor(statusCode, message, expose = false) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

function makeRequestUrl(req) {
  try {
    return new URL(req.url, getRequestBaseUrl(req));
  } catch (error) {
    throw new HttpError(400, "Malformed request URL", true);
  }
}

function getRequestBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${String(proto).split(",")[0].trim()}://${String(host).split(",")[0].trim()}`;
}

// ---------------------------------------------------------------------------
// Security headers (preserve all — per AGENTS.md)
// ---------------------------------------------------------------------------

function applySecurityHeaders(req, res) {
  const csp = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");

  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (isHttpsRequest(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function isHttpsRequest(req) {
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

function handleServerError(req, res, error) {
  const statusCode = Number(error && error.statusCode) || 500;
  const safeStatus = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
  const expose = Boolean(error && error.expose);

  let message;
  if (expose) {
    message = error.message;
  } else if (safeStatus >= 500) {
    message = "Internal server error";
  } else {
    message = "Request failed";
  }

  if (!expose || safeStatus >= 500) {
    console.error(JSON.stringify({
      level: "error",
      method: req.method,
      url: req.url,
      statusCode: safeStatus,
      message: sanitizeLogMessage(error && error.message),
      stack: process.env.NODE_ENV === "production" ? undefined : sanitizeLogMessage(error && error.stack)
    }));
  }

  sendJson(res, safeStatus, {
    error: ERROR_NAMES[safeStatus] || "server_error",
    message
  });
}

function sanitizeLogMessage(value) {
  return String(value || "")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "gsk_[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .slice(0, 1000);
}

// ---------------------------------------------------------------------------
// Authentication & sessions
// ---------------------------------------------------------------------------

function shouldRequireAuth() {
  if (process.env.DISABLE_AUTH === "true") {
    return false;
  }
  return Boolean(process.env.APP_ACCESS_TOKEN || getAiConfig().apiKey || process.env.NODE_ENV === "production");
}

function requireApiAuth(req, res, options) {
  if (!options.authRequired) return true;

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

/**
 * Re-creates the allowed-origins set per request intentionally, since
 * APP_ALLOWED_ORIGINS could change at runtime and the set is tiny.
 */
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

  sendJson(res, 403, { error: "forbidden", message: "Origin is not allowed." });
  return false;
}

function enforceRateLimit(req, res, bucket, maxRequests) {
  const now = Date.now();
  const key = `${bucket}:${clientAddress(req)}`;
  if (rateLimitBuckets.size >= RATE_LIMIT_MAX_BUCKETS || now - lastRateLimitSweep > RATE_LIMIT_WINDOW_MS) {
    cleanupRateLimits(now);
  }

  const current = rateLimitBuckets.get(key);

  if (!current || current.resetAt <= now) {
    if (!current && rateLimitBuckets.size >= RATE_LIMIT_MAX_BUCKETS) {
      res.setHeader("Retry-After", "60");
      sendJson(res, 429, { error: "rate_limited", message: "Traffic is too high. Please try again shortly." });
      return false;
    }
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  current.count += 1;
  if (current.count <= maxRequests) return true;

  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  res.setHeader("Retry-After", String(retryAfterSeconds));
  sendJson(res, 429, { error: "rate_limited", message: "Too many requests. Please try again shortly." });
  return false;
}

function cleanupRateLimits(now) {
  for (const [key, value] of rateLimitBuckets.entries()) {
    if (value.resetAt <= now) rateLimitBuckets.delete(key);
  }
  lastRateLimitSweep = now;
}

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
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

function setSessionCookie(req, res) {
  const issuedAt = Date.now();
  const payload = base64UrlEncode(JSON.stringify({ iat: issuedAt, exp: issuedAt + SESSION_TTL_MS }));
  const signature = signSessionPayload(payload);
  const cookie = [
    `sp_session=${payload}.${signature}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
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

// ---------------------------------------------------------------------------
// AI generation — assistant & briefing
// ---------------------------------------------------------------------------

async function generateAssistantResponse(payload, store = scenarioStore) {
  const snapshot = makeSnapshot(payload, store);
  const selectedZone = selectedZoneFromPayload(payload, snapshot);
  const systemPrompt = [
    "You are StadiumPulse 26, a safety-first generative AI copilot for FIFA World Cup 2026 stadium operations and fan support.",
    "Use only the provided live venue snapshot. Do not invent real-world transport status, security directives, ticketing policy, or match facts.",
    "Adapt to the requested persona, language, and accessibility needs. Keep guidance concise, operational, and calm.",
    "Prioritize crowd safety, step-free access, low-sensory routes, multilingual clarity, staff escalation, sustainable transit, and real-time decision support.",
    "Return JSON with keys: headline, response, actions, riskLevel, escalation, confidence."
  ].join(" ");

  const userPrompt = {
    task: "Answer the venue user request using the live snapshot.",
    question: sanitizeText(payload.question, 600) || "What should I do next?",
    persona: sanitizeChoice(payload.persona, ["Fan", "Organizer", "Volunteer", "Venue staff"], "Fan"),
    language: sanitizeChoice(payload.language, ["English", "Spanish", "French", "Portuguese", "Arabic", "Hindi", "Plain-language captions"], "English"),
    accessibility: sanitizeAccessibility(payload.accessibility),
    selectedZone,
    liveSnapshot: snapshot
  };

  if (!hasConfiguredModel()) {
    return generateDemoAssistant({
      ...payload,
      question: userPrompt.question,
      persona: userPrompt.persona,
      language: userPrompt.language,
      accessibility: userPrompt.accessibility,
      selectedZone
    }, snapshot);
  }

  const modelResult = await aiLimiter.run(() => callConfiguredModel(systemPrompt, userPrompt));
  return normalizeAssistantResult(modelResult, "configured-ai");
}

async function generateOperationsBriefing(payload, store = scenarioStore) {
  const snapshot = makeSnapshot(payload, store);
  const cacheKey = briefingCacheKey(snapshot.scenarioId);
  const cached = getBriefingCacheEntry(cacheKey, "value");
  if (cached) return cloneJson(cached);

  const pending = getBriefingCacheEntry(cacheKey, "pending");
  if (pending) return cloneJson(await pending);

  const pendingBriefing = createOperationsBriefing(snapshot);
  briefingCache.set(cacheKey, {
    pending: pendingBriefing,
    expiresAt: Date.now() + Math.max(BRIEFING_CACHE_TTL_MS, AI_TIMEOUT_MS + runtimeConfig.aiQueueTimeoutMs + 1_000)
  });

  try {
    const generated = await pendingBriefing;
    briefingCache.set(cacheKey, {
      value: cloneJson(generated),
      expiresAt: Date.now() + BRIEFING_CACHE_TTL_MS
    });
    trimBriefingCache();
    return cloneJson(generated);
  } catch (error) {
    briefingCache.delete(cacheKey);
    throw error;
  }
}

async function createOperationsBriefing(snapshot) {
  const systemPrompt = [
    "You are StadiumPulse 26, a generative AI operations analyst for FIFA World Cup 2026 match days.",
    "Use the provided snapshot to produce a short command-center briefing for venue leadership.",
    "Surface crowd risk, accessibility impact, transport demand, sustainability opportunities, volunteer actions, and escalation triggers.",
    "Return JSON with keys: headline, riskLevel, summary, priorities, staffActions, fanComms, sustainabilityNudge, escalation."
  ].join(" ");

  const userPrompt = {
    task: "Generate a live stadium operations briefing.",
    liveSnapshot: snapshot
  };

  if (!hasConfiguredModel()) return generateDemoBriefing(snapshot);

  const modelResult = await aiLimiter.run(() => callConfiguredModel(systemPrompt, userPrompt));
  return normalizeBriefingResult(modelResult, "configured-ai");
}

// ---------------------------------------------------------------------------
// Briefing cache
// ---------------------------------------------------------------------------

function briefingCacheKey(scenarioId) {
  const config = getAiConfig();
  const source = hasConfiguredModel() ? `${config.provider}:${config.model}` : "demo";
  return `${source}:${scenarioId}`;
}

/** Unified cache-entry reader — replaces the near-duplicate getCachedBriefing/getPendingBriefing pair. */
function getBriefingCacheEntry(cacheKey, field) {
  const entry = briefingCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    briefingCache.delete(cacheKey);
    return null;
  }
  return entry[field] || null;
}

function trimBriefingCache() {
  const now = Date.now();
  for (const [key, entry] of briefingCache.entries()) {
    if (entry.expiresAt <= now) briefingCache.delete(key);
  }
  while (briefingCache.size > BRIEFING_CACHE_MAX_ENTRIES) {
    const oldestKey = briefingCache.keys().next().value;
    briefingCache.delete(oldestKey);
  }
}

function clearBriefingCacheForScenario(scenarioId) {
  const suffix = `:${scenarioId}`;
  for (const key of briefingCache.keys()) {
    if (key.endsWith(suffix)) briefingCache.delete(key);
  }
}

// ---------------------------------------------------------------------------
// AI provider integration
// ---------------------------------------------------------------------------

async function callConfiguredModel(systemPrompt, userPayload) {
  const config = getAiConfig();
  if (!config.apiKey || !config.model) return null;

  const requestBody = {
    model: config.model,
    temperature: 0.25,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPayload) }
    ]
  };

  let response;
  try {
    response = await sendChatCompletionRequest(config, requestBody);
  } catch (error) {
    throw makeProviderError(502, error.message);
  }

  if (!response.ok) {
    const details = await response.text();
    if (!shouldRetryWithoutJsonMode(response.status, details)) {
      throw makeProviderError(response.status, details);
    }

    const fallbackBody = {
      ...requestBody,
      messages: [
        { role: "system", content: `${systemPrompt} Return only a valid JSON object with no markdown.` },
        requestBody.messages[1]
      ]
    };
    delete fallbackBody.response_format;

    try {
      response = await sendChatCompletionRequest(config, fallbackBody);
    } catch (error) {
      throw makeProviderError(502, error.message);
    }
    if (!response.ok) {
      const fallbackDetails = await response.text();
      throw makeProviderError(response.status, fallbackDetails);
    }
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = parseJsonObject(content);
  if (!parsed) throw makeProviderError(502, "Provider returned a non-JSON response.");
  return parsed;
}

/**
 * Sends the chat-completion request with an AbortController-based timeout.
 * The controller is cleaned up in .finally(); the AbortController itself is
 * collected by GC after the promise settles.
 */
function sendChatCompletionRequest(config, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  return fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: controller.signal
  }).finally(() => {
    clearTimeout(timeout);
  });
}

function makeProviderError(status, details) {
  console.error(JSON.stringify({
    level: "warn",
    provider: getAiConfig().provider,
    status,
    details: sanitizeLogMessage(details)
  }));
  return new HttpError(502, "AI provider request failed", true);
}

function hasConfiguredModel() {
  const config = getAiConfig();
  return Boolean(config.apiKey && config.model);
}

function shouldRetryWithoutJsonMode(status, details) {
  const text = String(details || "").toLowerCase();
  return status >= 400
    && status < 500
    && text.includes("response_format")
    && (text.includes("unsupported") || text.includes("not supported") || text.includes("json"));
}

function parseJsonObject(content) {
  if (!content || typeof content !== "string") return null;
  try {
    return JSON.parse(content);
  } catch (error) {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch (fallbackError) {
        return null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Snapshot & sanitization
// ---------------------------------------------------------------------------

function makeSnapshot(payload, store = scenarioStore) {
  const scenarioId = sanitizeScenarioId(payload.scenarioId || payload.scenario || "arrival");
  const snapshot = store.getScenario(scenarioId);
  if (!snapshot) throw new HttpError(400, "Unknown scenario", true);

  return {
    scenarioId,
    scenario: snapshot.label,
    matchClock: snapshot.matchClock,
    weather: snapshot.weather,
    transit: snapshot.transit,
    sustainability: { ...snapshot.sustainability },
    // Defensive shallow copies to prevent mutation of stored data
    zones: snapshot.zones.map(zone => ({ ...zone })),
    incidents: snapshot.incidents.map(incident => ({ ...incident })),
    generatedAt: new Date().toISOString()
  };
}

function sanitizeScenarioId(value) {
  return sanitizeText(value, 32).toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function selectedZoneFromPayload(payload, snapshot) {
  const requestedId = sanitizeText(payload.selectedZoneId || (payload.selectedZone && payload.selectedZone.id), 64);
  return snapshot.zones.find(zone => zone.id === requestedId) || mostCrowdedZone(snapshot.zones);
}

function sanitizeAccessibility(value) {
  const accessibility = value && typeof value === "object" ? value : {};
  return {
    stepFree: Boolean(accessibility.stepFree),
    lowSensory: Boolean(accessibility.lowSensory),
    audioDescription: Boolean(accessibility.audioDescription)
  };
}

// ---------------------------------------------------------------------------
// Demo AI fallbacks
// ---------------------------------------------------------------------------

function generateDemoAssistant(payload, snapshot) {
  const persona = String(payload.persona || "Fan");
  const question = String(payload.question || "What should I do next?");
  const language = String(payload.language || "English");
  const zone = snapshot.zones.find(item => item.id === (payload.selectedZone && payload.selectedZone.id)) || mostCrowdedZone(snapshot.zones);
  const crowded = mostCrowdedZone(snapshot.zones);
  const calm = leastCrowdedZone(snapshot.zones);
  const riskLevel = riskFromDensity(crowded.density);
  const accessibility = payload.accessibility || {};

  const actions = [];
  if (accessibility.stepFree) {
    actions.push(`Use the step-free path via ${zone.accessible || calm.accessible || "the accessibility hub"}.`);
  }
  if (accessibility.lowSensory) {
    actions.push(`Avoid ${crowded.name}; route through ${calm.name} where crowd density is ${calm.density}%.`);
  }
  if (persona.toLowerCase().includes("volunteer")) {
    actions.push(`Stage two volunteers at ${crowded.name} for queue translation and reassurance.`);
  } else if (persona.toLowerCase().includes("staff") || persona.toLowerCase().includes("organizer")) {
    actions.push(`Open overflow signage toward ${calm.name} and monitor ${crowded.name} every 3 minutes.`);
  } else {
    actions.push(`Head toward ${calm.name}; current wait is about ${calm.wait} minutes.`);
  }
  if (accessibility.audioDescription) {
    actions.push("Enable audio-description announcements and repeat gate changes in short plain-language phrases.");
  }
  actions.push("Prefer public transit or shared shuttle after the match to reduce curbside congestion.");

  return normalizeAssistantResult({
    headline: `${persona} guidance for ${zone.name || crowded.name}`,
    response: [
      `Language target: ${language}. Demo AI is using the live snapshot to answer: "${question}".`,
      `${crowded.name} is the busiest area at ${crowded.density}% density with an estimated ${crowded.wait}-minute wait.`,
      `${calm.name} is the best relief route right now at ${calm.density}% density.`,
      `Current venue context: ${snapshot.weather}; transport signal: ${snapshot.transit}.`
    ].join(" "),
    actions,
    riskLevel,
    escalation: riskLevel === "high" || riskLevel === "critical"
      ? `Escalate to crowd control lead for ${crowded.name} if density remains above 85% for 5 minutes.`
      : "No command escalation required; keep monitoring the selected zone.",
    confidence: "demo-high"
  }, "demo-ai");
}

function generateDemoBriefing(snapshot) {
  const crowded = mostCrowdedZone(snapshot.zones);
  const calm = leastCrowdedZone(snapshot.zones);
  const incident = highestSeverityIncident(snapshot.incidents);
  const riskLevel = riskFromDensity(crowded.density);
  const diversion = snapshot.sustainability?.diversion || "not reported";

  return normalizeBriefingResult({
    headline: `${snapshot.scenario}: ${riskLevel.toUpperCase()} crowd posture`,
    riskLevel,
    summary: `${crowded.name} is the current pressure point at ${crowded.density}% density and ${crowded.wait} minutes wait. ${calm.name} can absorb rerouted fans. ${snapshot.weather}. ${snapshot.transit}.`,
    priorities: [
      `Reduce load at ${crowded.name} with dynamic signage and multilingual volunteer prompts.`,
      `Keep accessibility routes open through ${calm.name}; verify elevators and step-free lanes.`,
      incident ? `Resolve "${incident.title}" in ${incident.zone}; owner ${incident.owner}, ETA ${incident.eta}.` : "No active incident needs command escalation.",
      `Push transit and refill-station nudges; current waste diversion is ${diversion}.`
    ],
    staffActions: [
      `Dispatch wayfinding team to ${crowded.name}.`,
      `Ask transport liaison to prepare post-match shuttle messaging.`,
      "Have volunteers repeat guidance in short phrases and point to visual signage."
    ],
    fanComms: `For fastest movement, use ${calm.name}. Step-free guests should follow ${calm.accessible || "the marked accessible route"}.`,
    sustainabilityNudge: "Recommend public transit, reusable cups, and refill points in post-match messages.",
    escalation: riskLevel === "critical"
      ? "Trigger command-center crowd mitigation protocol now."
      : riskLevel === "high"
        ? `Escalate if ${crowded.name} does not fall below 80% density within 5 minutes.`
        : "Continue routine monitoring."
  }, "demo-ai");
}

// ---------------------------------------------------------------------------
// Result normalization
// ---------------------------------------------------------------------------

function normalizeAssistantResult(result, source) {
  return {
    source,
    headline: String(result?.headline || "AI matchday guidance"),
    response: String(result?.response || "No response generated."),
    actions: toArray(result?.actions),
    riskLevel: normalizeRisk(result?.riskLevel),
    escalation: String(result?.escalation || "No escalation recommended."),
    confidence: String(result?.confidence || (source === "configured-ai" ? "model-generated" : "demo")),
    generatedAt: new Date().toISOString()
  };
}

function normalizeBriefingResult(result, source) {
  return {
    source,
    headline: String(result?.headline || "Live operations briefing"),
    riskLevel: normalizeRisk(result?.riskLevel),
    summary: String(result?.summary || "No summary generated."),
    priorities: toArray(result?.priorities),
    staffActions: toArray(result?.staffActions),
    fanComms: String(result?.fanComms || "No fan communications drafted."),
    sustainabilityNudge: String(result?.sustainabilityNudge || "No sustainability nudge drafted."),
    escalation: String(result?.escalation || "No escalation recommended."),
    generatedAt: new Date().toISOString()
  };
}

function toArray(value) {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

// O(n) helpers — replaced the O(n log n) sort-based originals
function mostCrowdedZone(zones) {
  return zones.reduce((a, b) => b.density > a.density ? b : a, UNKNOWN_ZONE);
}

function leastCrowdedZone(zones) {
  return zones.reduce((a, b) => b.density < a.density ? b : a, { ...UNKNOWN_ZONE, density: Infinity });
}

function highestSeverityIncident(incidents) {
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  return incidents.reduce((best, item) => {
    return (rank[item.severity] || 0) > (rank[best?.severity] || 0) ? item : best;
  }, null);
}

// NOTE: keep in sync with densityClass in public/app.js
function riskFromDensity(density) {
  if (density >= 92) return "critical";
  if (density >= 82) return "high";
  if (density >= 65) return "medium";
  return "low";
}

function normalizeRisk(risk) {
  const value = String(risk || "").toLowerCase();
  return ["critical", "high", "medium", "low"].includes(value) ? value : "medium";
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

if (require.main === module) {
  const server = createAppServer();
  server.listen(PORT, () => {
    console.log(`StadiumPulse 26 running at http://localhost:${PORT}`);
  });
}

module.exports = {
  createAppServer,
  generateDemoAssistant,
  generateDemoBriefing,
  getAiConfig,
  riskFromDensity
};
