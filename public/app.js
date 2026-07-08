const scenarios = {};

const state = {
  scenarioId: "arrival",
  selectedZoneId: "north",
  chat: [],
  authRequired: false,
  authenticated: true
};
const CHAT_HISTORY_MAX = 20;

const dom = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheDom();
  bindEvents();
  await initializeAccess();
  if (!state.authRequired || state.authenticated) {
    await loadScenarios();
    render();
    requestBriefing();
  }
});

function cacheDom() {
  [
    "scenarioSelect",
    "personaSelect",
    "languageSelect",
    "stepFree",
    "lowSensory",
    "audioDescription",
    "matchClock",
    "lastUpdated",
    "transitLoad",
    "transportSignal",
    "shuttleBays",
    "bikeValet",
    "peakDensity",
    "avgWait",
    "incidentCount",
    "wasteDiversion",
    "weatherSignal",
    "stadiumMap",
    "selectedZoneName",
    "selectedZoneRisk",
    "selectedZoneDensity",
    "selectedZoneWait",
    "selectedZoneAccess",
    "incidentRisk",
    "incidentList",
    "briefingButton",
    "briefingSource",
    "briefingHeadline",
    "briefingSummary",
    "briefingPriorities",
    "assistantSource",
    "assistantForm",
    "assistantInput",
    "chatLog",
    "accessGate",
    "accessForm",
    "accessToken",
    "accessError",
    "scenarioForm",
    "customLabel",
    "customClock",
    "customWeather",
    "customTransit",
    "customZones",
    "customIncidents",
    "scenarioMessage"
  ].forEach(id => {
    dom[id] = document.getElementById(id);
  });
}

function populateScenarios() {
  dom.scenarioSelect.innerHTML = "";
  Object.entries(scenarios).forEach(([id, scenario]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = scenario.label;
    dom.scenarioSelect.append(option);
  });
  dom.scenarioSelect.value = state.scenarioId;
}

async function loadScenarios() {
  const data = await postJson("/api/scenarios", null, {
    method: "GET"
  });
  Object.keys(scenarios).forEach(id => {
    delete scenarios[id];
  });
  Object.assign(scenarios, data.scenarios || {});

  const scenarioIds = Object.keys(scenarios);
  if (scenarioIds.length === 0) {
    throw new Error("No scenarios are available.");
  }

  if (!scenarios[state.scenarioId]) {
    state.scenarioId = scenarioIds[0];
  }
  state.selectedZoneId = currentScenario().zones[0]?.id || "";
  populateScenarios();
}

function bindEvents() {
  dom.scenarioSelect.addEventListener("change", event => {
    state.scenarioId = event.target.value;
    state.selectedZoneId = currentScenario().zones[0].id;
    render();
    if (!state.authRequired || state.authenticated) {
      requestBriefing();
    }
  });

  dom.personaSelect.addEventListener("change", render);
  dom.languageSelect.addEventListener("change", render);
  dom.stepFree.addEventListener("change", render);
  dom.lowSensory.addEventListener("change", render);
  dom.audioDescription.addEventListener("change", render);
  dom.briefingButton.addEventListener("click", requestBriefing);

  document.querySelectorAll("[data-prompt]").forEach(button => {
    button.addEventListener("click", () => {
      dom.assistantInput.value = button.dataset.prompt;
      dom.assistantInput.focus();
    });
  });

  dom.assistantForm.addEventListener("submit", event => {
    event.preventDefault();
    askAssistant();
  });

  dom.accessForm.addEventListener("submit", event => {
    event.preventDefault();
    unlockConsole();
  });

  dom.scenarioForm.addEventListener("submit", event => {
    event.preventDefault();
    createCustomScenario();
  });

  seedCustomScenarioForm();
}

async function initializeAccess() {
  try {
    const response = await fetch("/api/session", {
      credentials: "same-origin"
    });
    const data = await response.json();
    state.authRequired = Boolean(data.authRequired);
    state.authenticated = Boolean(data.authenticated);
  } catch (error) {
    state.authRequired = true;
    state.authenticated = false;
    dom.accessError.textContent = "Unable to verify access. Check the server connection.";
  }

  updateAccessGate();
}

async function unlockConsole() {
  const accessToken = dom.accessToken.value.trim();
  if (!accessToken) {
    dom.accessError.textContent = "Enter an access code.";
    dom.accessToken.focus();
    return;
  }

  dom.accessError.textContent = "";
  const submitButton = dom.accessForm.querySelector("button");
  submitButton.disabled = true;
  submitButton.textContent = "Unlocking...";

  try {
    const response = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ accessToken })
    });
    const data = await response.json();
    if (!response.ok || !data.authenticated) {
      throw new Error(data.message || "Access code was rejected.");
    }

    state.authenticated = true;
    dom.accessToken.value = "";
    updateAccessGate();
    await loadScenarios();
    render();
    requestBriefing();
  } catch (error) {
    state.authenticated = false;
    dom.accessError.textContent = error.message;
    updateAccessGate();
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Unlock StadiumPulse";
  }
}

function updateAccessGate() {
  const locked = state.authRequired && !state.authenticated;
  dom.accessGate.classList.toggle("hidden", !locked);
  dom.briefingButton.disabled = locked;
  dom.assistantForm.querySelector("button").disabled = locked;
  dom.scenarioForm.querySelector("button").disabled = locked;
  if (locked) {
    dom.accessToken.focus();
  }
}

function seedCustomScenarioForm() {
  dom.customZones.value = JSON.stringify([
    {
      id: "north-entry",
      name: "North Entry",
      type: "Entry",
      x: 42,
      y: 5,
      w: 18,
      h: 12,
      density: 84,
      wait: 16,
      status: "rising",
      accessible: "North lift lane"
    },
    {
      id: "relief-route",
      name: "Relief Route",
      type: "Concourse",
      x: 62,
      y: 62,
      w: 18,
      h: 12,
      density: 38,
      wait: 4,
      status: "stable",
      accessible: "Ramp R2"
    }
  ], null, 2);

  dom.customIncidents.value = JSON.stringify([
    {
      id: "INC-CUSTOM-1",
      title: "Queue building near north entry",
      zone: "North Entry",
      severity: "high",
      owner: "Gate lead",
      eta: "5 min"
    }
  ], null, 2);
}

async function createCustomScenario() {
  const submitButton = dom.scenarioForm.querySelector("button");
  setScenarioMessage("Creating scenario...", "");
  submitButton.disabled = true;

  try {
    const payload = {
      label: dom.customLabel.value.trim(),
      matchClock: dom.customClock.value.trim() || "Live",
      weather: dom.customWeather.value.trim() || "No weather signal provided",
      transit: dom.customTransit.value.trim() || "No transit signal provided",
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
      zones: parseScenarioJson(dom.customZones.value, "Zones JSON"),
      incidents: parseScenarioJson(dom.customIncidents.value, "Incidents JSON")
    };

    if (!payload.label) {
      throw new Error("Scenario name is required.");
    }

    const data = await postJson("/api/scenarios", payload);
    const scenario = data.scenario;
    scenarios[scenario.id] = scenario;
    state.scenarioId = scenario.id;
    state.selectedZoneId = scenario.zones[0]?.id || "";
    populateScenarios();
    render();
    requestBriefing();
    setScenarioMessage(`Created "${scenario.label}".`, "success");
  } catch (error) {
    setScenarioMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
}

function parseScenarioJson(value, label) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array.`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function setScenarioMessage(message, type) {
  dom.scenarioMessage.textContent = message;
  dom.scenarioMessage.className = `form-message${type ? ` ${type}` : ""}`;
}

function render() {
  const scenario = currentScenario();
  if (!scenario) {
    return;
  }
  const selected = selectedZone();
  const peak = Math.max(...scenario.zones.map(item => item.density));
  const averageWait = Math.round(scenario.zones.reduce((sum, item) => sum + item.wait, 0) / scenario.zones.length);

  dom.matchClock.textContent = scenario.matchClock;
  dom.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  dom.transitLoad.textContent = scenario.transport.transitLoad;
  dom.transportSignal.textContent = scenario.transit;
  dom.shuttleBays.textContent = scenario.transport.shuttleBays;
  dom.bikeValet.textContent = scenario.transport.bikeValet;
  dom.peakDensity.textContent = `${peak}%`;
  dom.avgWait.textContent = `${averageWait} min`;
  dom.incidentCount.textContent = String(scenario.incidents.length);
  dom.wasteDiversion.textContent = scenario.sustainability.diversion;
  dom.weatherSignal.textContent = scenario.weather;

  renderMap(scenario);
  renderZoneDetail(selected);
  renderIncidents(scenario.incidents);
  renderChat();
}

function renderMap(scenario) {
  dom.stadiumMap.innerHTML = "";

  scenario.zones.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `zone-button ${densityClass(item.density)}${item.id === state.selectedZoneId ? " selected" : ""}`;
    button.style.left = `${item.x}%`;
    button.style.top = `${item.y}%`;
    button.style.width = `${item.w}%`;
    button.style.height = `${item.h}%`;
    button.setAttribute("aria-label", `${item.name}, ${item.density}% density, ${item.wait} minute wait`);
    button.innerHTML = `<span>${escapeHtml(item.name)}</span><small>${item.density}% / ${item.wait}m</small>`;
    button.addEventListener("click", () => {
      state.selectedZoneId = item.id;
      render();
    });
    dom.stadiumMap.append(button);
  });
}

function renderZoneDetail(zoneItem) {
  dom.selectedZoneName.textContent = zoneItem.name;
  dom.selectedZoneRisk.textContent = `${riskLabel(zoneItem.density)} risk`;
  dom.selectedZoneRisk.className = "pill";
  dom.selectedZoneDensity.textContent = `${zoneItem.density}%`;
  dom.selectedZoneWait.textContent = `${zoneItem.wait} min`;
  dom.selectedZoneAccess.textContent = zoneItem.accessible;
}

function renderIncidents(incidents) {
  dom.incidentRisk.textContent = `${incidents.length} open`;
  dom.incidentList.innerHTML = "";

  incidents.forEach(item => {
    const node = document.createElement("article");
    node.className = `incident-item ${item.severity}`;
    node.innerHTML = `
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.zone)} / ${escapeHtml(item.severity)} / ${escapeHtml(item.owner)}</span>
      <span>ETA ${escapeHtml(item.eta)} / ${escapeHtml(item.id)}</span>
    `;
    dom.incidentList.append(node);
  });
}

async function requestBriefing() {
  const previousText = dom.briefingButton.textContent;
  dom.briefingButton.disabled = true;
  dom.briefingButton.textContent = "Generating...";
  dom.briefingSource.textContent = "AI working";

  try {
    const data = await postJson("/api/ai/briefing", {
      scenarioId: state.scenarioId
    });
    dom.briefingSource.textContent = sourceLabel(data.source);
    dom.briefingHeadline.textContent = data.headline;
    dom.briefingSummary.textContent = data.summary;
    dom.briefingPriorities.innerHTML = "";
    data.priorities.forEach(item => {
      const li = document.createElement("li");
      li.textContent = item;
      dom.briefingPriorities.append(li);
    });
  } catch (error) {
    dom.briefingSource.textContent = "Offline";
    dom.briefingHeadline.textContent = "Briefing unavailable";
    dom.briefingSummary.textContent = error.message;
    dom.briefingPriorities.innerHTML = "";
  } finally {
    dom.briefingButton.disabled = false;
    dom.briefingButton.textContent = previousText;
  }
}

async function askAssistant() {
  const question = dom.assistantInput.value.trim();
  if (!question) {
    dom.assistantInput.focus();
    return;
  }

  appendChat({
    role: "user",
    text: question
  });
  renderChat(true);
  dom.assistantInput.value = "";
  dom.assistantSource.textContent = "AI working";

  try {
    const data = await postJson("/api/ai/assistant", {
      question,
      persona: dom.personaSelect.value,
      language: dom.languageSelect.value,
      accessibility: accessibilityPrefs(),
      selectedZoneId: selectedZone().id,
      scenarioId: state.scenarioId
    });
    dom.assistantSource.textContent = sourceLabel(data.source);
    appendChat({
      role: "ai",
      headline: data.headline,
      text: data.response,
      actions: data.actions,
      escalation: data.escalation,
      source: data.source,
      riskLevel: data.riskLevel
    });
  } catch (error) {
    dom.assistantSource.textContent = "Offline";
    appendChat({
      role: "ai",
      headline: "Assistant unavailable",
      text: error.message,
      actions: [],
      escalation: "Try again after the server is reachable.",
      source: "offline",
      riskLevel: "medium"
    });
  }

  renderChat(false);
}

function appendChat(message) {
  state.chat.push(message);
  if (state.chat.length > CHAT_HISTORY_MAX) {
    state.chat.splice(0, state.chat.length - CHAT_HISTORY_MAX);
  }
}

function renderChat(isLoading = false) {
  dom.chatLog.innerHTML = "";

  if (state.chat.length === 0 && !isLoading) {
    const empty = document.createElement("div");
    empty.className = "chat-message ai";
    empty.innerHTML = "<h4>Ready for matchday questions</h4><p>Ask for a route, a volunteer script, a crowd mitigation action, or a transport plan.</p>";
    dom.chatLog.append(empty);
    return;
  }

  state.chat.slice(-6).forEach(message => {
    const node = document.createElement("article");
    node.className = `chat-message ${message.role}`;
    if (message.role === "user") {
      node.textContent = message.text;
    } else {
      const actions = (message.actions || []).map(item => `<li>${escapeHtml(item)}</li>`).join("");
      node.innerHTML = `
        <h4>${escapeHtml(message.headline)}</h4>
        <p>${escapeHtml(message.text)}</p>
        ${actions ? `<ul>${actions}</ul>` : ""}
        <span class="source-note">${sourceLabel(message.source)} / ${escapeHtml(message.riskLevel)} risk / ${escapeHtml(message.escalation)}</span>
      `;
    }
    dom.chatLog.append(node);
  });

  if (isLoading) {
    const loading = document.createElement("article");
    loading.className = "chat-message ai";
    loading.innerHTML = "<h4>Thinking with live venue context...</h4><p>Checking crowd density, accessibility paths, transport load, and incident ownership.</p>";
    dom.chatLog.append(loading);
  }

  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
}

function accessibilityPrefs() {
  return {
    stepFree: dom.stepFree.checked,
    lowSensory: dom.lowSensory.checked,
    audioDescription: dom.audioDescription.checked
  };
}

async function postJson(url, body, options = {}) {
  const method = options.method || "POST";
  const fetchOptions = {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (body !== null && body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, {
    ...fetchOptions
  });
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 || response.status === 503) {
      state.authRequired = true;
      state.authenticated = false;
      updateAccessGate();
    }
    throw new Error(data.message || `Request failed: ${response.status}`);
  }

  return data;
}

function currentScenario() {
  return scenarios[state.scenarioId];
}

function selectedZone() {
  return currentScenario().zones.find(item => item.id === state.selectedZoneId) || currentScenario().zones[0];
}

function densityClass(density) {
  if (density >= 92) {
    return "critical";
  }
  if (density >= 82) {
    return "high";
  }
  if (density >= 65) {
    return "medium";
  }
  return "low";
}

function riskLabel(density) {
  const risk = densityClass(density);
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}

function sourceLabel(source) {
  if (source === "configured-ai") {
    return "Configured AI";
  }
  if (source === "demo-ai") {
    return "Demo AI";
  }
  return "Local";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
