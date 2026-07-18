/** DOM lookup module — caches dashboard elements once at startup. */
(function initDom(global) {
  const app = global.StadiumPulse;

  const DOM_IDS = [
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
  ];

  app.cacheDom = function cacheDom() {
    DOM_IDS.forEach(id => {
      app.dom[id] = document.getElementById(id);
    });
  };
})(window);
