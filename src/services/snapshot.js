/** Scenario-to-snapshot conversion and zone/incident query helpers for AI prompts. */
const { HttpError } = require("../errors");
const { sanitizeText } = require("../sanitize");

function makeSnapshot(payload, store) {
  const scenarioId = sanitizeScenarioId(payload.scenarioId || payload.scenario || "arrival");
  const snapshot = store.getScenario(scenarioId);
  if (!snapshot) throw new HttpError(400, "Unknown scenario", true);

  return {
    scenarioId,
    scenario: snapshot.label,
    matchClock: snapshot.matchClock,
    weather: snapshot.weather,
    transit: snapshot.transit,
    sustainability: { ...snapshot.sustainability },
    zones: snapshot.zones.map(zone => ({ ...zone })),
    incidents: snapshot.incidents.map(incident => ({ ...incident })),
    generatedAt: new Date().toISOString()
  };
}

function sanitizeScenarioId(value) {
  return sanitizeText(value, 32).toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function selectedZoneFromPayload(payload, snapshot) {
  const requestedId = sanitizeText(payload.selectedZoneId || (payload.selectedZone && payload.selectedZone.id), 64);
  return snapshot.zones.find(zone => zone.id === requestedId) || mostCrowdedZone(snapshot.zones);
}

function mostCrowdedZone(zones) {
  return zones.reduce((a, b) => b.density > a.density ? b : a, unknownZone());
}

function leastCrowdedZone(zones) {
  return zones.reduce((a, b) => b.density < a.density ? b : a, {
    ...unknownZone(),
    density: Infinity
  });
}

function highestSeverityIncident(incidents) {
  const rank = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1
  };
  return incidents.reduce((best, item) => {
    return (rank[item.severity] || 0) > (rank[best?.severity] || 0) ? item : best;
  }, null);
}

function unknownZone() {
  return {
    id: "unknown",
    name: "Unknown zone",
    density: 0,
    wait: 0,
    accessible: "Ask nearest volunteer"
  };
}

module.exports = {
  highestSeverityIncident,
  leastCrowdedZone,
  makeSnapshot,
  mostCrowdedZone,
  selectedZoneFromPayload
};
