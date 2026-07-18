/** AI panel module — handles operations briefings, copilot requests, and chat rendering. */
(function initAiPanel(global) {
  const app = global.StadiumPulse;

  app.requestBriefing = async function requestBriefing() {
    if (!app.canUseProtectedFeatures()) return;

    const previousText = app.dom.briefingButton.textContent;
    app.dom.briefingButton.disabled = true;
    app.dom.briefingButton.textContent = "Generating...";
    app.dom.briefingSource.textContent = "AI working";

    try {
      const data = await app.postJson("/api/ai/briefing", {
        scenarioId: app.state.scenarioId
      });
      app.dom.briefingSource.textContent = app.sourceLabel(data.source);
      app.dom.briefingHeadline.textContent = data.headline;
      app.dom.briefingSummary.textContent = data.summary;
      app.dom.briefingPriorities.innerHTML = "";
      data.priorities.forEach(item => {
        const li = document.createElement("li");
        li.textContent = item;
        app.dom.briefingPriorities.append(li);
      });
    } catch (error) {
      app.dom.briefingSource.textContent = "Offline";
      app.dom.briefingHeadline.textContent = "Briefing unavailable";
      app.dom.briefingSummary.textContent = error.message;
      app.dom.briefingPriorities.innerHTML = "";
    } finally {
      app.dom.briefingButton.disabled = !app.canUseProtectedFeatures();
      app.dom.briefingButton.textContent = previousText;
    }
  };

  app.askAssistant = async function askAssistant() {
    const question = app.dom.assistantInput.value.trim();
    if (!question) {
      app.dom.assistantInput.focus();
      return;
    }

    appendChat({
      role: "user",
      text: question
    });
    app.renderChat(true);
    app.dom.assistantInput.value = "";
    app.dom.assistantSource.textContent = "AI working";

    try {
      const data = await app.postJson("/api/ai/assistant", {
        question,
        persona: app.dom.personaSelect.value,
        language: app.dom.languageSelect.value,
        accessibility: accessibilityPrefs(),
        selectedZoneId: app.selectedZone().id,
        scenarioId: app.state.scenarioId
      });
      app.dom.assistantSource.textContent = app.sourceLabel(data.source);
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
      app.dom.assistantSource.textContent = "Offline";
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

    app.renderChat(false);
  };

  app.renderChat = function renderChat(isLoading = false) {
    app.dom.chatLog.innerHTML = "";

    if (app.state.chat.length === 0 && !isLoading) {
      const empty = document.createElement("div");
      empty.className = "chat-message ai";
      empty.innerHTML = "<h4>Ready for matchday questions</h4><p>Ask for a route, a volunteer script, a crowd mitigation action, or a transport plan.</p>";
      app.dom.chatLog.append(empty);
      return;
    }

    app.state.chat.slice(-app.constants.CHAT_DISPLAY_MAX).forEach(message => {
      const node = document.createElement("article");
      node.className = `chat-message ${message.role}`;
      if (message.role === "user") {
        node.textContent = message.text;
      } else {
        const actions = (message.actions || []).map(item => `<li>${app.escapeHtml(item)}</li>`).join("");
        node.innerHTML = `
          <h4>${app.escapeHtml(message.headline)}</h4>
          <p>${app.escapeHtml(message.text)}</p>
          ${actions ? `<ul>${actions}</ul>` : ""}
          <span class="source-note">${app.sourceLabel(message.source)} / ${app.escapeHtml(message.riskLevel)} risk / ${app.escapeHtml(message.escalation)}</span>
        `;
      }
      app.dom.chatLog.append(node);
    });

    if (isLoading) {
      const loading = document.createElement("article");
      loading.className = "chat-message ai";
      loading.innerHTML = "<h4>Thinking with live venue context...</h4><p>Checking crowd density, accessibility paths, transport load, and incident ownership.</p>";
      app.dom.chatLog.append(loading);
    }

    app.dom.chatLog.scrollTop = app.dom.chatLog.scrollHeight;
  };

  function appendChat(message) {
    app.state.chat.push(message);
    if (app.state.chat.length > app.constants.CHAT_HISTORY_MAX) {
      app.state.chat.shift();
    }
  }

  function accessibilityPrefs() {
    return {
      stepFree: app.dom.stepFree.checked,
      lowSensory: app.dom.lowSensory.checked,
      audioDescription: app.dom.audioDescription.checked
    };
  }
})(window);
