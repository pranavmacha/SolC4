/** Event binding module — connects DOM controls to the scenario, AI, and auth flows. */
(function initEvents(global) {
  const app = global.StadiumPulse;

  app.bindEvents = function bindEvents() {
    app.dom.scenarioSelect.addEventListener("change", event => {
      app.state.scenarioId = event.target.value;
      app.state.selectedZoneId = app.currentScenario().zones[0].id;
      app.render();
      if (app.canUseProtectedFeatures()) {
        app.requestBriefing();
      }
    });

    ["personaSelect", "languageSelect", "stepFree", "lowSensory", "audioDescription"]
      .forEach(id => app.dom[id].addEventListener("change", app.render));

    app.dom.briefingButton.addEventListener("click", app.requestBriefing);

    document.querySelectorAll("[data-prompt]").forEach(button => {
      button.addEventListener("click", () => {
        app.dom.assistantInput.value = button.dataset.prompt;
        app.dom.assistantInput.focus();
      });
    });

    app.dom.assistantForm.addEventListener("submit", event => {
      event.preventDefault();
      app.askAssistant();
    });

    app.dom.accessForm.addEventListener("submit", event => {
      event.preventDefault();
      app.unlockConsole();
    });

    app.dom.scenarioForm.addEventListener("submit", event => {
      event.preventDefault();
      app.createCustomScenario();
    });

    app.dom.addZoneBtn.addEventListener("click", () => app.addZoneCard());
    app.dom.addIncidentBtn.addEventListener("click", () => app.addIncidentCard());

    app.seedCustomScenarioBuilder();
  };
})(window);
