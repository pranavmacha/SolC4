/** Health-check endpoint — reports service status, AI configuration, and auth mode. */
const { getAiConfig } = require("../config");
const { sendJson } = require("../http/json");

function handleHealth(req, res, context) {
  const aiConfig = getAiConfig();
  sendJson(res, 200, {
    service: "StadiumPulse 26",
    ok: true,
    aiConfigured: Boolean(aiConfig.apiKey && aiConfig.model),
    authRequired: context.authRequired,
    time: new Date().toISOString()
  });
}

module.exports = {
  handleHealth
};
