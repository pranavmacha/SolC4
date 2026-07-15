const fs = require("node:fs");
const path = require("node:path");
const { sanitizeText, sanitizeChoice, cloneJson } = require("./sanitize");

const BASE_SCENARIO_FILE = path.join(__dirname, "..", "data", "scenarios.json");
const DEFAULT_CUSTOM_SCENARIO_FILE = path.join(__dirname, "..", "data", "custom-scenarios.json");
const MAX_SCENARIOS = 100;
const MAX_ZONES = 24;
const MAX_INCIDENTS = 32;

/** Default map positions for zones, hoisted to module scope to avoid re-creation per call. */
const DEFAULT_ZONE_POSITIONS = [
  { x: 42, y: 6 },
  { x: 9, y: 38 },
  { x: 42, y: 82 },
  { x: 75, y: 38 },
  { x: 31, y: 26 },
  { x: 59, y: 26 },
  { x: 39, y: 53 },
  { x: 62, y: 68 }
];

function createScenarioStore(options = {}) {
  const baseFile = options.baseFile || BASE_SCENARIO_FILE;
  const customFile = options.customFile || process.env.CUSTOM_SCENARIO_FILE || DEFAULT_CUSTOM_SCENARIO_FILE;
  const baseScenarios = loadScenarioMap(baseFile);

  return {
    listScenarios: () => {
      const customScenarios = loadCustomScenarios(customFile);
      return cloneJson({ ...baseScenarios, ...customScenarios });
    },
    getScenario: scenarioId => {
      const scenarios = { ...baseScenarios, ...loadCustomScenarios(customFile) };
      return cloneJson(scenarios[sanitizeId(scenarioId)]);
    },
    createScenario: async input => {
      const customScenarios = loadCustomScenarios(customFile);
      const allScenarios = { ...baseScenarios, ...customScenarios };
      if (Object.keys(allScenarios).length >= MAX_SCENARIOS) {
        throw validationError("Scenario limit reached.");
      }

      const scenario = normalizeScenario(input, allScenarios);
      customScenarios[scenario.id] = scenario;
      await persistCustomScenarios(customFile, customScenarios);
      return cloneJson(scenario);
    }
  };
}

/** Shared parser for both base and custom scenario files. */
function parseScenarioEntries(raw) {
  return Object.fromEntries(
    Object.entries(raw).map(([id, scenario]) => {
      const normalized = normalizeScenario({ ...scenario, id }, {});
      return [normalized.id, normalized];
    })
  );
}

function loadScenarioMap(filePath) {
  return parseScenarioEntries(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function loadCustomScenarios(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    return parseScenarioEntries(raw);
  } catch (error) {
    console.error(JSON.stringify({
      level: "warn",
      message: "Unable to load custom scenarios",
      details: error.message
    }));
    return {};
  }
}

async function persistCustomScenarios(filePath, scenarios) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, `${JSON.stringify(scenarios, null, 2)}\n`, { mode: 0o600 });
  await fs.promises.rename(tempPath, filePath);
}

function normalizeScenario(input, existingScenarios) {
  const label = sanitizeText(input.label || input.scenario || input.name, 80);
  if (!label) {
    throw validationError("Scenario label is required.");
  }

  const preferredId = sanitizeId(input.id || label);
  const id = preferredId || `custom-${Date.now()}`;
  if (existingScenarios[id]) {
    throw validationError("Scenario id already exists.");
  }

  const zones = normalizeZones(input.zones);
  if (zones.length === 0) {
    throw validationError("At least one zone is required.");
  }

  return {
    id,
    label,
    matchClock: sanitizeText(input.matchClock || "Live", 40),
    weather: sanitizeText(input.weather || "No weather signal provided", 180),
    transit: sanitizeText(input.transit || "No transit signal provided", 180),
    transport: normalizeTransport(input.transport),
    sustainability: normalizeSustainability(input.sustainability),
    zones,
    incidents: normalizeIncidents(input.incidents)
  };
}

function normalizeZones(value) {
  const zones = Array.isArray(value) ? value : [];
  return zones.slice(0, MAX_ZONES).map((zone, index) => ({
    id: sanitizeId(zone.id || zone.name || `zone-${index + 1}`) || `zone-${index + 1}`,
    name: sanitizeText(zone.name || `Zone ${index + 1}`, 80),
    type: sanitizeText(zone.type || "Zone", 40),
    x: clampNumber(zone.x, 0, 94, DEFAULT_ZONE_POSITIONS[index % DEFAULT_ZONE_POSITIONS.length].x),
    y: clampNumber(zone.y, 0, 94, DEFAULT_ZONE_POSITIONS[index % DEFAULT_ZONE_POSITIONS.length].y),
    w: clampNumber(zone.w, 8, 32, 18),
    h: clampNumber(zone.h, 8, 24, 12),
    density: clampNumber(zone.density, 0, 100, 0),
    wait: clampNumber(zone.wait, 0, 180, 0),
    status: sanitizeChoiceLower(zone.status, ["stable", "rising", "falling"], "stable"),
    accessible: sanitizeText(zone.accessible || "Ask nearest volunteer", 120)
  })).filter(zone => zone.name);
}

function normalizeIncidents(value) {
  const incidents = Array.isArray(value) ? value : [];
  return incidents.slice(0, MAX_INCIDENTS).map((incident, index) => ({
    id: sanitizeText(incident.id || `INC-CUSTOM-${index + 1}`, 40),
    title: sanitizeText(incident.title || "Operational note", 120),
    zone: sanitizeText(incident.zone || "Unassigned", 80),
    severity: sanitizeChoiceLower(incident.severity, ["low", "medium", "high", "critical"], "medium"),
    owner: sanitizeText(incident.owner || "Operations", 80),
    eta: sanitizeText(incident.eta || "TBD", 40)
  })).filter(incident => incident.title);
}

function normalizeTransport(value) {
  const transport = value && typeof value === "object" ? value : {};
  return {
    transitLoad: sanitizeText(transport.transitLoad || "Not reported", 40),
    shuttleBays: sanitizeText(transport.shuttleBays || "Not reported", 40),
    bikeValet: sanitizeText(transport.bikeValet || "Not reported", 40)
  };
}

function normalizeSustainability(value) {
  const sustainability = value && typeof value === "object" ? value : {};
  return {
    diversion: sanitizeText(sustainability.diversion || "Not reported", 40),
    refillDemand: sanitizeText(sustainability.refillDemand || "Not reported", 80),
    energyMode: sanitizeText(sustainability.energyMode || "Not reported", 100)
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function sanitizeId(value) {
  return sanitizeText(value, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Like sanitizeChoice but lowercases the input before matching.
 * Used for scenario-store fields (status, severity) where case normalization is needed.
 * Distinct from the shared sanitizeChoice which preserves case (used by server.js for persona/language).
 */
function sanitizeChoiceLower(value, allowed, fallback) {
  const text = sanitizeText(value, 40).toLowerCase();
  return allowed.includes(text) ? text : fallback;
}

/** Parallel to HttpError in server.js — kept separate to avoid circular deps. */
function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.expose = true;
  return error;
}

module.exports = {
  createScenarioStore,
  normalizeScenario,
  sanitizeId
};
