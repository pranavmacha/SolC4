/** Scenario state module — loads trusted scenarios and tracks the current zone selection. */
(function initScenarios(global) {
  const app = global.StadiumPulse;

  app.populateScenarios = function populateScenarios() {
    app.dom.scenarioSelect.replaceChildren();
    Object.entries(app.scenarios).forEach(([id, scenario]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = scenario.label;
      app.dom.scenarioSelect.append(option);
    });
    app.dom.scenarioSelect.value = app.state.scenarioId;
  };

  app.loadScenarios = async function loadScenarios() {
    const data = await app.postJson("/api/scenarios", null, {
      method: "GET"
    });

    for (const id in app.scenarios) delete app.scenarios[id];
    Object.assign(app.scenarios, data.scenarios || {});

    const scenarioIds = Object.keys(app.scenarios);
    if (scenarioIds.length === 0) {
      throw new Error("No scenarios are available.");
    }

    if (!app.scenarios[app.state.scenarioId]) {
      app.state.scenarioId = scenarioIds[0];
    }
    app.state.selectedZoneId = app.currentScenario().zones[0]?.id || "";
    app.populateScenarios();
  };

  app.currentScenario = function currentScenario() {
    return app.scenarios[app.state.scenarioId];
  };

  app.selectedZone = function selectedZone() {
    return app.currentScenario().zones.find(item => item.id === app.state.selectedZoneId)
      || app.currentScenario().zones[0];
  };
})(window);
