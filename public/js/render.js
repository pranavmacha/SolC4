/** Dashboard rendering module — paints metrics, map zones, incidents, and selected-zone detail. */
(function initRendering(global) {
  const app = global.StadiumPulse;

  app.render = function render() {
    const scenario = app.currentScenario();
    if (!scenario) return;

    const selected = app.selectedZone();
    const peak = Math.max(...scenario.zones.map(item => item.density));
    const averageWait = Math.round(scenario.zones.reduce((sum, item) => sum + item.wait, 0) / scenario.zones.length);

    app.dom.matchClock.textContent = scenario.matchClock;
    app.dom.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    app.dom.transitLoad.textContent = scenario.transport.transitLoad;
    app.dom.transportSignal.textContent = scenario.transit;
    app.dom.shuttleBays.textContent = scenario.transport.shuttleBays;
    app.dom.bikeValet.textContent = scenario.transport.bikeValet;
    app.dom.peakDensity.textContent = `${peak}%`;
    app.dom.avgWait.textContent = `${averageWait} min`;
    app.dom.incidentCount.textContent = String(scenario.incidents.length);
    app.dom.wasteDiversion.textContent = scenario.sustainability.diversion;
    app.dom.weatherSignal.textContent = scenario.weather;

    renderMap(scenario);
    renderZoneDetail(selected);
    renderIncidents(scenario.incidents);
    app.renderChat();
  };

  function renderMap(scenario) {
    app.dom.stadiumMap.innerHTML = "";

    scenario.zones.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `zone-button ${app.densityClass(item.density)}${item.id === app.state.selectedZoneId ? " selected" : ""}`;
      button.style.left = `${item.x}%`;
      button.style.top = `${item.y}%`;
      button.style.width = `${item.w}%`;
      button.style.height = `${item.h}%`;
      button.setAttribute("aria-label", `${item.name}, ${item.density}% density, ${item.wait} minute wait`);
      button.innerHTML = `<span>${app.escapeHtml(item.name)}</span><small>${item.density}% / ${item.wait}m</small>`;
      button.addEventListener("click", () => {
        app.state.selectedZoneId = item.id;
        app.render();
      });
      app.dom.stadiumMap.append(button);
    });
  }

  function renderZoneDetail(zoneItem) {
    app.dom.selectedZoneName.textContent = zoneItem.name;
    app.dom.selectedZoneRisk.textContent = `${app.riskLabel(zoneItem.density)} risk`;
    app.dom.selectedZoneRisk.className = "pill";
    app.dom.selectedZoneDensity.textContent = `${zoneItem.density}%`;
    app.dom.selectedZoneWait.textContent = `${zoneItem.wait} min`;
    app.dom.selectedZoneAccess.textContent = zoneItem.accessible;
  }

  function renderIncidents(incidents) {
    app.dom.incidentRisk.textContent = `${incidents.length} open`;
    app.dom.incidentList.innerHTML = "";

    incidents.forEach(item => {
      const node = document.createElement("article");
      node.className = `incident-item ${item.severity}`;
      node.innerHTML = `
        <strong>${app.escapeHtml(item.title)}</strong>
        <span>${app.escapeHtml(item.zone)} / ${app.escapeHtml(item.severity)} / ${app.escapeHtml(item.owner)}</span>
        <span>ETA ${app.escapeHtml(item.eta)} / ${app.escapeHtml(item.id)}</span>
      `;
      app.dom.incidentList.append(node);
    });
  }
})(window);
