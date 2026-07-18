/** Central API router — maps method + pathname pairs to route handlers with auth and rate-limit guards. */
const { sendJson } = require("../http/json");
const { handleAssistant, handleBriefing } = require("./aiRoutes");
const { handleHealth } = require("./healthRoutes");
const { handleCreateScenario, handleListScenarios } = require("./scenarioRoutes");
const { handleCreateSession, handleGetSession, handleLogout } = require("./sessionRoutes");

function createApiHandler(context) {
  return async function handleApi(req, res, pathname) {
    switch (`${req.method} ${pathname}`) {
      case "GET /api/health":
        return handleHealth(req, res, context);

      case "GET /api/session":
        return handleGetSession(req, res, context);

      case "GET /api/scenarios":
        if (!context.auth.requireApiAuth(req, res, context.authRequired)) return;
        return handleListScenarios(req, res, context);

      case "POST /api/scenarios":
        if (!allowProtectedMutation(req, res, context, "scenario", context.runtimeConfig.sessionRateLimitMax)) return;
        return await handleCreateScenario(req, res, context);

      case "POST /api/session":
        if (!context.auth.validateOrigin(req, res) || !context.rateLimiter.enforce(req, res, "session", context.runtimeConfig.sessionRateLimitMax)) return;
        return await handleCreateSession(req, res, context);

      case "POST /api/session/logout":
        if (!context.auth.validateOrigin(req, res)) return;
        return handleLogout(req, res, context);

      case "POST /api/ai/assistant":
        if (!allowProtectedMutation(req, res, context, "ai", context.runtimeConfig.aiRateLimitMax)) return;
        return await handleAssistant(req, res, context);

      case "POST /api/ai/briefing":
        if (!allowProtectedMutation(req, res, context, "ai", context.runtimeConfig.aiRateLimitMax)) return;
        return await handleBriefing(req, res, context);

      default:
        return sendJson(res, 404, {
          error: "not_found",
          message: "The requested API endpoint does not exist."
        });
    }
  };
}

function allowProtectedMutation(req, res, context, rateLimitBucket, maxRequests) {
  return context.auth.validateOrigin(req, res)
    && context.auth.requireApiAuth(req, res, context.authRequired)
    && context.rateLimiter.enforce(req, res, rateLimitBucket, maxRequests);
}

module.exports = {
  createApiHandler
};
