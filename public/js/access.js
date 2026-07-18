/** Access-gate module — verifies sessions, unlocks protected controls, and maintains lock state. */
(function initAccess(global) {
  const app = global.StadiumPulse;

  app.initializeAccess = async function initializeAccess() {
    try {
      const response = await fetch("/api/session", {
        credentials: "same-origin"
      });
      const data = await response.json();
      app.state.authRequired = Boolean(data.authRequired);
      app.state.authenticated = Boolean(data.authenticated);
    } catch (error) {
      app.state.authRequired = true;
      app.state.authenticated = false;
      app.dom.accessError.textContent = "Unable to verify access. Check the server connection.";
    }

    app.updateAccessGate();
  };

  app.unlockConsole = async function unlockConsole() {
    const accessToken = app.dom.accessToken.value.trim();
    if (!accessToken) {
      app.dom.accessError.textContent = "Enter an access code.";
      app.dom.accessToken.focus();
      return;
    }

    app.dom.accessError.textContent = "";
    const submitButton = app.dom.accessForm.querySelector("button");
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

      app.state.authenticated = true;
      app.dom.accessToken.value = "";
      app.updateAccessGate();
      await app.loadScenarios();
      app.render();
      app.requestBriefing();
    } catch (error) {
      app.state.authenticated = false;
      app.dom.accessError.textContent = error.message;
      app.updateAccessGate();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Unlock StadiumPulse";
    }
  };

  app.updateAccessGate = function updateAccessGate() {
    const locked = app.state.authRequired && !app.state.authenticated;
    app.dom.accessGate.classList.toggle("hidden", !locked);
    app.setProtectedControlsDisabled(locked);
    if (locked) app.dom.accessToken.focus();
  };

  app.canUseProtectedFeatures = function canUseProtectedFeatures() {
    return !app.state.authRequired || app.state.authenticated;
  };

  app.setProtectedControlsDisabled = function setProtectedControlsDisabled(disabled) {
    app.dom.briefingButton.disabled = disabled;
    app.dom.assistantForm.querySelector("button").disabled = disabled;
    app.dom.scenarioForm.querySelector("button").disabled = disabled;
  };
})(window);
