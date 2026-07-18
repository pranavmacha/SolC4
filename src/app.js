/** Application factory — assembles the HTTP server with routing, auth, rate limiting, and static serving. */
const http = require("node:http");
const path = require("node:path");
const { getRuntimeConfig } = require("./config");
const { toHttpErrorResponse } = require("./errors");
const { readJson, sendJson } = require("./http/json");
const { makeRequestUrl } = require("./http/request");
const { serveStaticFile } = require("./http/staticFiles");
const { createApiHandler } = require("./routes/api");
const { createScenarioStore } = require("./scenarioStore");
const { applySecurityHeaders } = require("./security/headers");
const { createAuth } = require("./security/auth");
const { createRateLimiter } = require("./security/rateLimit");
const { createAiService } = require("./services/aiService");

const runtimeConfig = getRuntimeConfig();
const defaultScenarioStore = createScenarioStore({
  customFile: runtimeConfig.customScenarioFile
});
const defaultAiService = createAiService({ runtimeConfig });

function createAppServer(options = {}) {
  const publicDir = options.publicDir || path.join(__dirname, "..", "public");
  const scenarioStore = options.scenarioStore || (options.customScenarioFile
    ? createScenarioStore({ customFile: options.customScenarioFile })
    : defaultScenarioStore);
  const auth = createAuth({
    sessionTtlMs: runtimeConfig.sessionTtlMs
  });
  const authRequired = options.disableAuth ? false : auth.shouldRequireAuth();
  const handleApi = createApiHandler({
    aiService: options.aiService || defaultAiService,
    auth,
    authRequired,
    rateLimiter: createRateLimiter({
      maxBuckets: runtimeConfig.rateLimitMaxBuckets,
      windowMs: runtimeConfig.rateLimitWindowMs
    }),
    readJson: req => readJson(req, runtimeConfig.maxBodyBytes),
    runtimeConfig,
    scenarioStore
  });

  return http.createServer(async (req, res) => {
    applySecurityHeaders(req, res);

    try {
      const requestUrl = makeRequestUrl(req);
      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApi(req, res, requestUrl.pathname);
        return;
      }

      await serveStaticFile(req, res, publicDir, requestUrl.pathname);
    } catch (error) {
      const response = toHttpErrorResponse(req, error);
      sendJson(res, response.statusCode, response.body);
    }
  });
}

module.exports = {
  createAppServer
};
