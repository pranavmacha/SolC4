/**
 * AI service facade — orchestrates the provider, concurrency limiter, briefing
 * cache, and demo fallback into generateAssistantResponse / generateOperationsBriefing.
 */
const { createAsyncLimiter } = require("../asyncLimiter");
const { getAiConfig, getRuntimeConfig } = require("../config");
const { sanitizeChoice, sanitizeText, cloneJson } = require("../sanitize");
const { createAiProvider } = require("./aiProvider");
const { createBriefingCache } = require("./briefingCache");
const {
  generateDemoAssistant,
  generateDemoBriefing,
  normalizeAssistantResult,
  normalizeBriefingResult
} = require("./demoAi");
const { makeSnapshot, selectedZoneFromPayload } = require("./snapshot");

function createAiService({ runtimeConfig = getRuntimeConfig(), getConfig = getAiConfig } = {}) {
  const limiter = createAsyncLimiter(runtimeConfig.aiConcurrencyMax, runtimeConfig.aiQueueMax, runtimeConfig.aiQueueTimeoutMs);
  const provider = createAiProvider({
    getConfig,
    timeoutMs: runtimeConfig.aiTimeoutMs
  });
  const briefingCache = createBriefingCache({
    maxEntries: runtimeConfig.briefingCacheMaxEntries,
    ttlMs: runtimeConfig.briefingCacheTtlMs
  });

  return {
    clearBriefingCacheForScenario: briefingCache.clearForScenario,
    generateAssistantResponse,
    generateOperationsBriefing
  };

  async function generateAssistantResponse(payload, store) {
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

    if (!provider.hasConfiguredModel()) {
      return generateDemoAssistant({
        ...payload,
        question: userPrompt.question,
        persona: userPrompt.persona,
        language: userPrompt.language,
        accessibility: userPrompt.accessibility,
        selectedZone
      }, snapshot);
    }

    const modelResult = await limiter.run(() => provider.callConfiguredModel(systemPrompt, userPrompt));
    return normalizeAssistantResult(modelResult, "configured-ai");
  }

  async function generateOperationsBriefing(payload, store) {
    const snapshot = makeSnapshot(payload, store);
    const cacheKey = briefingCacheKey(snapshot.scenarioId);
    const cached = briefingCache.getValue(cacheKey);
    if (cached) return cloneJson(cached);

    const pending = briefingCache.getPending(cacheKey);
    if (pending) return cloneJson(await pending);

    const pendingBriefing = createOperationsBriefing(snapshot);
    briefingCache.setPending(cacheKey, pendingBriefing, Date.now() + pendingBriefingTtlMs(runtimeConfig));

    try {
      const generated = await pendingBriefing;
      briefingCache.setValue(cacheKey, generated);
      return cloneJson(generated);
    } catch (error) {
      briefingCache.clearForScenario(snapshot.scenarioId);
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

    if (!provider.hasConfiguredModel()) return generateDemoBriefing(snapshot);

    const modelResult = await limiter.run(() => provider.callConfiguredModel(systemPrompt, userPrompt));
    return normalizeBriefingResult(modelResult, "configured-ai");
  }

  function briefingCacheKey(scenarioId) {
    const config = getConfig();
    const source = provider.hasConfiguredModel() ? `${config.provider}:${config.model}` : "demo";
    return `${source}:${scenarioId}`;
  }
}

function sanitizeAccessibility(value) {
  const accessibility = value && typeof value === "object" ? value : {};
  return {
    stepFree: Boolean(accessibility.stepFree),
    lowSensory: Boolean(accessibility.lowSensory),
    audioDescription: Boolean(accessibility.audioDescription)
  };
}

function pendingBriefingTtlMs(runtimeConfig) {
  return Math.max(
    runtimeConfig.briefingCacheTtlMs,
    runtimeConfig.aiTimeoutMs + runtimeConfig.aiQueueTimeoutMs + 1_000
  );
}

module.exports = {
  createAiService
};
