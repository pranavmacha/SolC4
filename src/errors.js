/**
 * Centralized HTTP error types and error-response formatting.
 * Provides HttpError for throwing typed API errors and toHttpErrorResponse
 * for converting any thrown error into a safe, structured JSON response.
 */
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

class HttpError extends Error {
  constructor(statusCode, message, expose = false) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

function toHttpErrorResponse(req, error) {
  const statusCode = Number(error && error.statusCode) || 500;
  const safeStatus = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
  const expose = Boolean(error && error.expose);

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

  return {
    statusCode: safeStatus,
    body: {
      error: ERROR_NAMES[safeStatus] || "server_error",
      message: clientErrorMessage(error, safeStatus, expose)
    }
  };
}

function clientErrorMessage(error, statusCode, expose) {
  if (expose) return error.message;
  return statusCode >= 500 ? "Internal server error" : "Request failed";
}

function sanitizeLogMessage(value) {
  return String(value || "")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "gsk_[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .slice(0, 1000);
}

module.exports = {
  HttpError,
  sanitizeLogMessage,
  toHttpErrorResponse
};
