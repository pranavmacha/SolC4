/** Browser bootstrap — starts StadiumPulse after all feature modules are loaded. */
(function initStadiumPulse(global) {
  const app = global.StadiumPulse;

  document.addEventListener("DOMContentLoaded", async () => {
    app.cacheDom();
    app.bindEvents();
    await app.initializeAccess();

    if (app.canUseProtectedFeatures()) {
      await app.loadScenarios();
      app.render();
      app.requestBriefing();
    }
  });
})(window);
