/** Route handlers for AI assistant and operations briefing endpoints. */
const { sendJson } = require("../http/json");

async function handleAssistant(req, res, context) {
  const payload = await context.readJson(req);
  const generated = await context.aiService.generateAssistantResponse(payload, context.scenarioStore);
  sendJson(res, 200, generated);
}

async function handleBriefing(req, res, context) {
  const payload = await context.readJson(req);
  const generated = await context.aiService.generateOperationsBriefing(payload, context.scenarioStore);
  sendJson(res, 200, generated);
}

module.exports = {
  handleAssistant,
  handleBriefing
};
