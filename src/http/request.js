/** Request URL construction and base-URL detection for reverse-proxy setups. */
const { URL } = require("node:url");
const { HttpError } = require("../errors");

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

module.exports = {
  getRequestBaseUrl,
  makeRequestUrl
};
