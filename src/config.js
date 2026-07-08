const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(filePath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      return;
    }

    const key = trimmed.slice(0, separator).trim().replace(/^export\s+/, "");
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

function numberEnv(name, fallback) {
  if (process.env[name] === undefined || process.env[name] === "") {
    return fallback;
  }

  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function getAiConfig() {
  const hasGenericKey = Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
  const hasGroqKey = Boolean(process.env.GROQ_API_KEY);
  const useGroq = hasGroqKey && !hasGenericKey;
  const explicitBaseUrl = useGroq
    ? process.env.GROQ_BASE_URL || process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || ""
    : process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || process.env.GROQ_BASE_URL || "";
  const isGroq = useGroq || explicitBaseUrl.includes("groq.com");
  const defaultBaseUrl = isGroq ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1";

  return {
    apiKey: useGroq ? process.env.GROQ_API_KEY : process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || "",
    model: useGroq ? process.env.GROQ_MODEL || "openai/gpt-oss-20b" : process.env.AI_MODEL || process.env.OPENAI_MODEL || process.env.GROQ_MODEL || (isGroq ? "openai/gpt-oss-20b" : ""),
    baseUrl: (explicitBaseUrl || defaultBaseUrl).replace(/\/+$/, ""),
    provider: isGroq ? "groq" : "openai-compatible"
  };
}

function getRuntimeConfig() {
  return {
    port: numberEnv("PORT", 4173),
    maxBodyBytes: numberEnv("MAX_BODY_BYTES", 100_000),
    sessionTtlMs: numberEnv("SESSION_TTL_MS", 12 * 60 * 60 * 1000),
    aiRateLimitMax: numberEnv("AI_RATE_LIMIT_MAX", 20),
    sessionRateLimitMax: numberEnv("SESSION_RATE_LIMIT_MAX", 10),
    rateLimitWindowMs: numberEnv("RATE_LIMIT_WINDOW_MS", 60_000),
    rateLimitMaxBuckets: numberEnv("RATE_LIMIT_MAX_BUCKETS", 5000),
    aiTimeoutMs: numberEnv("AI_TIMEOUT_MS", 20_000),
    aiConcurrencyMax: numberEnv("AI_CONCURRENCY_MAX", 4),
    aiQueueMax: numberEnv("AI_QUEUE_MAX", 24),
    aiQueueTimeoutMs: numberEnv("AI_QUEUE_TIMEOUT_MS", 5_000),
    briefingCacheTtlMs: numberEnv("BRIEFING_CACHE_TTL_MS", 30_000),
    briefingCacheMaxEntries: numberEnv("BRIEFING_CACHE_MAX_ENTRIES", 32),
    customScenarioFile: process.env.CUSTOM_SCENARIO_FILE || path.join(process.cwd(), "data", "custom-scenarios.json")
  };
}

module.exports = {
  getAiConfig,
  getRuntimeConfig,
  loadEnvFile,
  numberEnv
};
