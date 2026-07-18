/** In-memory per-IP rate limiter with configurable windows and bucket limits. */
const { sendJson } = require("../http/json");

function createRateLimiter({ maxBuckets, windowMs }) {
  const buckets = new Map();
  let lastSweep = 0;

  return {
    enforce: (req, res, bucket, maxRequests) => {
      const now = Date.now();
      const key = `${bucket}:${clientAddress(req)}`;
      if (buckets.size >= maxBuckets || now - lastSweep > windowMs) {
        cleanup(now);
      }

      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        if (!current && buckets.size >= maxBuckets) {
          res.setHeader("Retry-After", "60");
          sendJson(res, 429, {
            error: "rate_limited",
            message: "Traffic is too high. Please try again shortly."
          });
          return false;
        }

        buckets.set(key, {
          count: 1,
          resetAt: now + windowMs
        });
        return true;
      }

      current.count += 1;
      if (current.count <= maxRequests) return true;

      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      sendJson(res, 429, {
        error: "rate_limited",
        message: "Too many requests. Please try again shortly."
      });
      return false;
    }
  };

  function cleanup(now) {
    for (const [key, value] of buckets.entries()) {
      if (value.resetAt <= now) buckets.delete(key);
    }
    lastSweep = now;
  }
}

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

module.exports = {
  createRateLimiter
};
