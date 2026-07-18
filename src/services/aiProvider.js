/** OpenAI-compatible chat-completions client with timeout, retry, and JSON-mode fallback. */
const { HttpError, sanitizeLogMessage } = require("../errors");

function createAiProvider({ getConfig, timeoutMs }) {
  return {
    callConfiguredModel,
    hasConfiguredModel
  };

  async function callConfiguredModel(systemPrompt, userPayload) {
    const config = getConfig();
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

    let response = await sendProviderRequest(config, requestBody);
    if (!response.ok) {
      response = await retryWithoutJsonModeIfNeeded(config, requestBody, systemPrompt, response);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw makeProviderError(502, "Provider returned an invalid JSON envelope.");
    }

    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonObject(content);
    if (!parsed) throw makeProviderError(502, "Provider returned a non-JSON response.");
    return parsed;
  }

  async function retryWithoutJsonModeIfNeeded(config, requestBody, systemPrompt, response) {
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

    const fallbackResponse = await sendProviderRequest(config, fallbackBody);
    if (!fallbackResponse.ok) {
      throw makeProviderError(fallbackResponse.status, await fallbackResponse.text());
    }
    return fallbackResponse;
  }

  async function sendProviderRequest(config, body) {
    try {
      return await sendChatCompletionRequest(config, body);
    } catch (error) {
      throw makeProviderError(502, error.message);
    }
  }

  function sendChatCompletionRequest(config, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
      provider: getConfig().provider,
      status,
      details: sanitizeLogMessage(details)
    }));
    return new HttpError(502, "AI provider request failed", true);
  }

  function hasConfiguredModel() {
    const config = getConfig();
    return Boolean(config.apiKey && config.model);
  }
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

module.exports = {
  createAiProvider,
  parseJsonObject
};
