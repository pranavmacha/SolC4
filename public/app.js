const scenarios = {};

const state = {
  scenarioId: "arrival",
  selectedZoneId: "north",
  chat: [],
  authRequired: false,
  authenticated: true
};
const CHAT_HISTORY_MAX = 20;
const CHAT_DISPLAY_MAX = 6;

const dom = {};

const SOURCE_LABELS = { "configured-ai": "Configured AI", "demo-ai": "Demo AI" };

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
    "zoneBuilder",
    "incidentBuilder",
    "addZoneBtn",
    "addIncidentBtn",
    "scenarioMessage"
  ].forEach(id => {
    dom[id] = document.getElementById(id);
  });
}

function populateScenarios() {
  dom.scenarioSelect.replaceChildren();
  Object.entries(scenarios).forEach(([id, scenario]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = scenario.label;
    dom.scenarioSelect.append(option);
  });
  dom.scenarioSelect.value = state.scenarioId;
}

async function loadScenarios() {
  const data = await postJson("/api/scenarios", null, { method: "GET" });

  for (const k in scenarios) delete scenarios[k];
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

  ["personaSelect", "languageSelect", "stepFree", "lowSensory", "audioDescription"]
    .forEach(id => dom[id].addEventListener("change", render));

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

  dom.addZoneBtn.addEventListener("click", () => addZoneCard());
  dom.addIncidentBtn.addEventListener("click", () => addIncidentCard());

  seedCustomScenarioBuilder();
}

// ---------------------------------------------------------------------------
// Access gate
// ---------------------------------------------------------------------------

async function initializeAccess() {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
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
      headers: { "Content-Type": "application/json" },
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
  setProtectedControlsDisabled(locked);
  if (locked) dom.accessToken.focus();
}

function canUseProtectedFeatures() {
  return !state.authRequired || state.authenticated;
}

function setProtectedControlsDisabled(disabled) {
  dom.briefingButton.disabled = disabled;
  dom.assistantForm.querySelector("button").disabled = disabled;
  dom.scenarioForm.querySelector("button").disabled = disabled;
}

// ---------------------------------------------------------------------------
// Custom scenario builder
// ---------------------------------------------------------------------------

let zoneCounter = 0;
let incidentCounter = 0;

function seedCustomScenarioBuilder() {
  addZoneCard({ name: "North Entry", type: "Entry", density: 84, wait: 16, status: "rising", accessible: "North lift lane" });
  addZoneCard({ name: "Relief Route", type: "Concourse", density: 38, wait: 4, status: "stable", accessible: "Ramp R2" });
  addIncidentCard({ title: "Queue building near north entry", zone: "North Entry", severity: "high", owner: "Gate lead", eta: "5 min" });
}

/** Tiny helper for generating `selected` attribute in option HTML. */
const sel = (val, match) => val === match ? " selected" : "";

function addZoneCard(d = {}) {
  zoneCounter += 1;
  const index = zoneCounter;
  const card = document.createElement("div");
  card.className = "builder-card";
  card.dataset.builderType = "zone";

  const densityVal = d.density != null ? d.density : 50;

  card.innerHTML = `
    <div class="builder-card-header">
      <span>Zone ${index}</span>
      <button type="button" class="builder-remove-btn" aria-label="Remove zone">Remove</button>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Name</label>
        <input type="text" data-field="name" maxlength="80" placeholder="e.g. North Gate" value="${escapeAttr(d.name || "")}">
      </div>
      <div class="form-field">
        <label>Type</label>
        <select data-field="type">
          <option${sel(d.type, "Entry")}>Entry</option>
          <option${sel(d.type, "Transit")}>Transit</option>
          <option${sel(d.type, "Concourse")}>Concourse</option>
          <option${sel(d.type, "Ramp")}>Ramp</option>
          <option${sel(d.type, "Seating")}>Seating</option>
          <option${sel(d.type, "Support")}>Support</option>
          <option${sel(d.type, "Staff")}>Staff</option>
        </select>
      </div>
    </div>
    <label>Crowd density</label>
    <div class="builder-slider-row">
      <input type="range" data-field="density" min="0" max="100" value="${densityVal}">
      <output>${densityVal}%</output>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Wait (min)</label>
        <input type="text" data-field="wait" maxlength="6" placeholder="0" value="${d.wait != null ? d.wait : ""}">
      </div>
      <div class="form-field">
        <label>Status</label>
        <select data-field="status">
          <option${sel(d.status, "stable")}>stable</option>
          <option${sel(d.status, "rising")}>rising</option>
          <option${sel(d.status, "falling")}>falling</option>
        </select>
      </div>
    </div>
    <label>Accessible route</label>
    <input type="text" data-field="accessible" maxlength="120" placeholder="e.g. Gate N3 elevator lane" value="${escapeAttr(d.accessible || "")}">
  `;

  const slider = card.querySelector("input[type=range]");
  const output = card.querySelector("output");
  slider.addEventListener("input", () => { output.textContent = `${slider.value}%`; });

  card.querySelector(".builder-remove-btn").addEventListener("click", () => {
    card.remove();
    updateBuilderEmpty(dom.zoneBuilder, "zone");
  });

  dom.zoneBuilder.append(card);
  updateBuilderEmpty(dom.zoneBuilder, "zone");
}

function addIncidentCard(d = {}) {
  incidentCounter += 1;
  const index = incidentCounter;
  const card = document.createElement("div");
  const severity = d.severity || "medium";
  card.className = `builder-card severity-${severity}`;
  card.dataset.builderType = "incident";

  card.innerHTML = `
    <div class="builder-card-header">
      <span>Incident ${index}</span>
      <button type="button" class="builder-remove-btn" aria-label="Remove incident">Remove</button>
    </div>
    <label>Title</label>
    <input type="text" data-field="title" maxlength="120" placeholder="e.g. Queue building near north entry" value="${escapeAttr(d.title || "")}">
    <div class="form-row">
      <div class="form-field">
        <label>Zone</label>
        <input type="text" data-field="zone" maxlength="80" placeholder="e.g. North Gate" value="${escapeAttr(d.zone || "")}">
      </div>
      <div class="form-field">
        <label>Severity</label>
        <select data-field="severity">
          <option${sel(severity, "low")}>low</option>
          <option${sel(severity, "medium")}>medium</option>
          <option${sel(severity, "high")}>high</option>
          <option${sel(severity, "critical")}>critical</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Owner</label>
        <input type="text" data-field="owner" maxlength="80" placeholder="e.g. Gate lead" value="${escapeAttr(d.owner || "")}">
      </div>
      <div class="form-field">
        <label>ETA</label>
        <input type="text" data-field="eta" maxlength="40" placeholder="e.g. 5 min" value="${escapeAttr(d.eta || "")}">
      </div>
    </div>
  `;

  const severitySelect = card.querySelector("select[data-field=severity]");
  severitySelect.addEventListener("change", () => {
    card.className = `builder-card severity-${severitySelect.value}`;
  });

  card.querySelector(".builder-remove-btn").addEventListener("click", () => {
    card.remove();
    updateBuilderEmpty(dom.incidentBuilder, "incident");
  });

  dom.incidentBuilder.append(card);
  updateBuilderEmpty(dom.incidentBuilder, "incident");
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

/** Reads a data-field value from a builder card. */
function readCardField(card, name) {
  return (card.querySelector(`[data-field="${name}"]`) || {}).value || "";
}

function collectZonesFromBuilder() {
  return Array.from(dom.zoneBuilder.querySelectorAll(".builder-card")).map(card => ({
    name: readCardField(card, "name"),
    type: readCardField(card, "type"),
    density: Number(readCardField(card, "density")) || 0,
    wait: Number(readCardField(card, "wait")) || 0,
    status: readCardField(card, "status"),
    accessible: readCardField(card, "accessible")
  }));
}

function collectIncidentsFromBuilder() {
  return Array.from(dom.incidentBuilder.querySelectorAll(".builder-card")).map(card => ({
    title: readCardField(card, "title"),
    zone: readCardField(card, "zone"),
    severity: readCardField(card, "severity"),
    owner: readCardField(card, "owner"),
    eta: readCardField(card, "eta")
  }));
}

// ---------------------------------------------------------------------------
// Custom scenario creation
// ---------------------------------------------------------------------------

async function createCustomScenario() {
  const submitButton = dom.scenarioForm.querySelector("button[type=submit]");
  setScenarioMessage("Creating scenario...", "");
  submitButton.disabled = true;

  try {
    const zones = collectZonesFromBuilder();
    const incidents = collectIncidentsFromBuilder();

    if (!dom.customLabel.value.trim()) throw new Error("Scenario name is required.");
    if (zones.length === 0) throw new Error("Add at least one zone.");
    if (zones.find(z => !z.name)) throw new Error("Every zone needs a name.");

    const payload = {
      label: dom.customLabel.value.trim(),
      matchClock: dom.customClock.value.trim() || "Live",
      weather: dom.customWeather.value.trim() || "No weather signal provided",
      transit: dom.customTransit.value.trim() || "No transit signal provided",
      transport: { transitLoad: "Custom", shuttleBays: "Custom", bikeValet: "Custom" },
      sustainability: { diversion: "Custom", refillDemand: "Custom", energyMode: "Custom" },
      zones,
      incidents
    };

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
    submitButton.disabled = !canUseProtectedFeatures();
  }
}

function setScenarioMessage(message, type) {
  dom.scenarioMessage.textContent = message;
  dom.scenarioMessage.className = `form-message${type ? ` ${type}` : ""}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const scenario = currentScenario();
  if (!scenario) return;

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

// ---------------------------------------------------------------------------
// AI briefing & assistant
// ---------------------------------------------------------------------------

async function requestBriefing() {
  if (!canUseProtectedFeatures()) {
    return;
  }

  const previousText = dom.briefingButton.textContent;
  dom.briefingButton.disabled = true;
  dom.briefingButton.textContent = "Generating...";
  dom.briefingSource.textContent = "AI working";

  try {
    const data = await postJson("/api/ai/briefing", { scenarioId: state.scenarioId });
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
    dom.briefingButton.disabled = !canUseProtectedFeatures();
    dom.briefingButton.textContent = previousText;
  }
}

async function askAssistant() {
  const question = dom.assistantInput.value.trim();
  if (!question) {
    dom.assistantInput.focus();
    return;
  }

  appendChat({ role: "user", text: question });
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
  // We push one at a time, so only one element ever needs trimming.
  if (state.chat.length > CHAT_HISTORY_MAX) state.chat.shift();
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

  state.chat.slice(-CHAT_DISPLAY_MAX).forEach(message => {
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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
    headers: { "Content-Type": "application/json" }
  };

  if (body !== null && body !== undefined) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);
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

// NOTE: keep in sync with riskFromDensity in server.js
function densityClass(density) {
  if (density >= 92) return "critical";
  if (density >= 82) return "high";
  if (density >= 65) return "medium";
  return "low";
}

function riskLabel(density) {
  const risk = densityClass(density);
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || "Local";
}

/** Single HTML/attribute escape function — covers &, <, >, ", and '. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// escapeAttr is now just escapeHtml — merged since escapeHtml is a superset.
const escapeAttr = escapeHtml;
