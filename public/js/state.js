/** Browser state container — initializes the shared StadiumPulse namespace. */
(function initState(global) {
  global.StadiumPulse = {
    constants: {
      CHAT_DISPLAY_MAX: 6,
      CHAT_HISTORY_MAX: 20,
      SOURCE_LABELS: {
        "configured-ai": "Configured AI",
        "demo-ai": "Demo AI"
      }
    },
    dom: {},
    scenarios: {},
    state: {
      scenarioId: "arrival",
      selectedZoneId: "north",
      chat: [],
      authRequired: false,
      authenticated: true
    }
  };
})(window);
