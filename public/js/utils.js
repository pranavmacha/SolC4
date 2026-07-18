/** Browser utility helpers for labels, risk classes, and safe HTML escaping. */
(function initUtilities(global) {
  const app = global.StadiumPulse;

  app.densityClass = function densityClass(density) {
    if (density >= 92) return "critical";
    if (density >= 82) return "high";
    if (density >= 65) return "medium";
    return "low";
  };

  app.riskLabel = function riskLabel(density) {
    const risk = app.densityClass(density);
    return risk.charAt(0).toUpperCase() + risk.slice(1);
  };

  app.sourceLabel = function sourceLabel(source) {
    return app.constants.SOURCE_LABELS[source] || "Local";
  };

  app.escapeHtml = function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  app.escapeAttr = app.escapeHtml;
})(window);
