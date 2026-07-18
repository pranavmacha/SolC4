/** TTL-bounded in-memory cache for operations briefings with pending-promise deduplication. */
const { cloneJson } = require("../sanitize");

function createBriefingCache({ maxEntries, ttlMs }) {
  const entries = new Map();

  return {
    clearForScenario,
    getPending: cacheKey => read(cacheKey, "pending"),
    getValue: cacheKey => read(cacheKey, "value"),
    setPending,
    setValue
  };

  function read(cacheKey, field) {
    const entry = entries.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      entries.delete(cacheKey);
      return null;
    }
    return entry[field] || null;
  }

  function setPending(cacheKey, pending, expiresAt) {
    entries.set(cacheKey, { pending, expiresAt });
  }

  function setValue(cacheKey, value) {
    entries.set(cacheKey, {
      value: cloneJson(value),
      expiresAt: Date.now() + ttlMs
    });
    trim();
  }

  function clearForScenario(scenarioId) {
    const suffix = `:${scenarioId}`;
    for (const key of entries.keys()) {
      if (key.endsWith(suffix)) entries.delete(key);
    }
  }

  function trim() {
    const now = Date.now();
    for (const [key, entry] of entries.entries()) {
      if (entry.expiresAt <= now) entries.delete(key);
    }

    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
  }
}

module.exports = {
  createBriefingCache
};
