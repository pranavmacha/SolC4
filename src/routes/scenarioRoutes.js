/** Route handlers for listing and creating scenarios. */
const { sendJson } = require("../http/json");

function handleListScenarios(req, res, context) {
  sendJson(res, 200, {
    scenarios: context.scenarioStore.listScenarios()
  });
}

async function handleCreateScenario(req, res, context) {
  const payload = await context.readJson(req);
  const scenario = await context.scenarioStore.createScenario(payload);
  context.aiService.clearBriefingCacheForScenario(scenario.id);
  sendJson(res, 201, {
    scenario
  });
}

module.exports = {
  handleCreateScenario,
  handleListScenarios
};
