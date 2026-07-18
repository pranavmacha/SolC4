/** Custom scenario builder — renders operator inputs and submits sanitized scenario payloads. */
(function initScenarioBuilder(global) {
  const app = global.StadiumPulse;
  let zoneCounter = 0;
  let incidentCounter = 0;

  app.seedCustomScenarioBuilder = function seedCustomScenarioBuilder() {
    app.addZoneCard({
      name: "North Entry",
      type: "Entry",
      density: 84,
      wait: 16,
      status: "rising",
      accessible: "North lift lane"
    });
    app.addZoneCard({
      name: "Relief Route",
      type: "Concourse",
      density: 38,
      wait: 4,
      status: "stable",
      accessible: "Ramp R2"
    });
    app.addIncidentCard({
      title: "Queue building near north entry",
      zone: "North Entry",
      severity: "high",
      owner: "Gate lead",
      eta: "5 min"
    });
  };

  app.addZoneCard = function addZoneCard(defaults = {}) {
    zoneCounter += 1;
    const card = document.createElement("div");
    card.className = "builder-card";
    card.dataset.builderType = "zone";

    const densityValue = defaults.density != null ? defaults.density : 50;
    card.innerHTML = `
      <div class="builder-card-header">
        <span>Zone ${zoneCounter}</span>
        <button type="button" class="builder-remove-btn" aria-label="Remove zone">Remove</button>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label>Name</label>
          <input type="text" data-field="name" maxlength="80" placeholder="e.g. North Gate" value="${app.escapeAttr(defaults.name || "")}">
        </div>
        <div class="form-field">
          <label>Type</label>
          <select data-field="type">
            ${zoneTypeOptions(defaults.type)}
          </select>
        </div>
      </div>
      <label>Crowd density</label>
      <div class="builder-slider-row">
        <input type="range" data-field="density" min="0" max="100" value="${densityValue}">
        <output>${densityValue}%</output>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label>Wait (min)</label>
          <input type="text" data-field="wait" maxlength="6" placeholder="0" value="${defaults.wait != null ? defaults.wait : ""}">
        </div>
        <div class="form-field">
          <label>Status</label>
          <select data-field="status">
            ${statusOptions(defaults.status)}
          </select>
        </div>
      </div>
      <label>Accessible route</label>
      <input type="text" data-field="accessible" maxlength="120" placeholder="e.g. Gate N3 elevator lane" value="${app.escapeAttr(defaults.accessible || "")}">
    `;

    const slider = card.querySelector("input[type=range]");
    const output = card.querySelector("output");
    slider.addEventListener("input", () => {
      output.textContent = `${slider.value}%`;
    });

    card.querySelector(".builder-remove-btn").addEventListener("click", () => {
      card.remove();
      updateBuilderEmpty(app.dom.zoneBuilder, "zone");
    });

    app.dom.zoneBuilder.append(card);
    updateBuilderEmpty(app.dom.zoneBuilder, "zone");
  };

  app.addIncidentCard = function addIncidentCard(defaults = {}) {
    incidentCounter += 1;
    const severity = defaults.severity || "medium";
    const card = document.createElement("div");
    card.className = `builder-card severity-${severity}`;
    card.dataset.builderType = "incident";

    card.innerHTML = `
      <div class="builder-card-header">
        <span>Incident ${incidentCounter}</span>
        <button type="button" class="builder-remove-btn" aria-label="Remove incident">Remove</button>
      </div>
      <label>Title</label>
      <input type="text" data-field="title" maxlength="120" placeholder="e.g. Queue building near north entry" value="${app.escapeAttr(defaults.title || "")}">
      <div class="form-row">
        <div class="form-field">
          <label>Zone</label>
          <input type="text" data-field="zone" maxlength="80" placeholder="e.g. North Gate" value="${app.escapeAttr(defaults.zone || "")}">
        </div>
        <div class="form-field">
          <label>Severity</label>
          <select data-field="severity">
            ${severityOptions(severity)}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label>Owner</label>
          <input type="text" data-field="owner" maxlength="80" placeholder="e.g. Gate lead" value="${app.escapeAttr(defaults.owner || "")}">
        </div>
        <div class="form-field">
          <label>ETA</label>
          <input type="text" data-field="eta" maxlength="40" placeholder="e.g. 5 min" value="${app.escapeAttr(defaults.eta || "")}">
        </div>
      </div>
    `;

    const severitySelect = card.querySelector("select[data-field=severity]");
    severitySelect.addEventListener("change", () => {
      card.className = `builder-card severity-${severitySelect.value}`;
    });

    card.querySelector(".builder-remove-btn").addEventListener("click", () => {
      card.remove();
      updateBuilderEmpty(app.dom.incidentBuilder, "incident");
    });

    app.dom.incidentBuilder.append(card);
    updateBuilderEmpty(app.dom.incidentBuilder, "incident");
  };

  app.createCustomScenario = async function createCustomScenario() {
    const submitButton = app.dom.scenarioForm.querySelector("button[type=submit]");
    app.setScenarioMessage("Creating scenario...", "");
    submitButton.disabled = true;

    try {
      const zones = collectZonesFromBuilder();
      const incidents = collectIncidentsFromBuilder();

      if (!app.dom.customLabel.value.trim()) throw new Error("Scenario name is required.");
      if (zones.length === 0) throw new Error("Add at least one zone.");
      if (zones.find(zone => !zone.name)) throw new Error("Every zone needs a name.");

      const data = await app.postJson("/api/scenarios", {
        label: app.dom.customLabel.value.trim(),
        matchClock: app.dom.customClock.value.trim() || "Live",
        weather: app.dom.customWeather.value.trim() || "No weather signal provided",
        transit: app.dom.customTransit.value.trim() || "No transit signal provided",
        transport: {
          transitLoad: "Custom",
          shuttleBays: "Custom",
          bikeValet: "Custom"
        },
        sustainability: {
          diversion: "Custom",
          refillDemand: "Custom",
          energyMode: "Custom"
        },
        zones,
        incidents
      });

      const scenario = data.scenario;
      app.scenarios[scenario.id] = scenario;
      app.state.scenarioId = scenario.id;
      app.state.selectedZoneId = scenario.zones[0]?.id || "";
      app.populateScenarios();
      app.render();
      app.requestBriefing();
      app.setScenarioMessage(`Created "${scenario.label}".`, "success");
    } catch (error) {
      app.setScenarioMessage(error.message, "error");
    } finally {
      submitButton.disabled = !app.canUseProtectedFeatures();
    }
  };

  app.setScenarioMessage = function setScenarioMessage(message, type) {
    app.dom.scenarioMessage.textContent = message;
    app.dom.scenarioMessage.className = `form-message${type ? ` ${type}` : ""}`;
  };

  function collectZonesFromBuilder() {
    return Array.from(app.dom.zoneBuilder.querySelectorAll(".builder-card")).map(card => ({
      name: readCardField(card, "name"),
      type: readCardField(card, "type"),
      density: Number(readCardField(card, "density")) || 0,
      wait: Number(readCardField(card, "wait")) || 0,
      status: readCardField(card, "status"),
      accessible: readCardField(card, "accessible")
    }));
  }

  function collectIncidentsFromBuilder() {
    return Array.from(app.dom.incidentBuilder.querySelectorAll(".builder-card")).map(card => ({
      title: readCardField(card, "title"),
      zone: readCardField(card, "zone"),
      severity: readCardField(card, "severity"),
      owner: readCardField(card, "owner"),
      eta: readCardField(card, "eta")
    }));
  }

  function updateBuilderEmpty(container, type) {
    container.querySelector(".builder-empty")?.remove();

    if (container.querySelectorAll(".builder-card").length === 0) {
      const empty = document.createElement("div");
      empty.className = "builder-empty";
      empty.textContent = type === "zone"
        ? "No zones added yet. Click \"+ Add zone\" to create one."
        : "No incidents. Click \"+ Add incident\" to add one (optional).";
      container.append(empty);
    }
  }

  function readCardField(card, name) {
    return (card.querySelector(`[data-field="${name}"]`) || {}).value || "";
  }

  function zoneTypeOptions(selected) {
    return options(["Entry", "Transit", "Concourse", "Ramp", "Seating", "Support", "Staff"], selected);
  }

  function statusOptions(selected) {
    return options(["stable", "rising", "falling"], selected);
  }

  function severityOptions(selected) {
    return options(["low", "medium", "high", "critical"], selected);
  }

  function options(values, selected) {
    return values.map(value => `<option${value === selected ? " selected" : ""}>${value}</option>`).join("");
  }
})(window);
