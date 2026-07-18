/** Browser API client — wraps same-origin JSON requests and auth lock handling. */
(function initApi(global) {
  const app = global.StadiumPulse;

  app.postJson = async function postJson(url, body, options = {}) {
    const fetchOptions = {
      method: options.method || "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      }
    };

    if (body !== null && body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401 || response.status === 503) {
        app.state.authRequired = true;
        app.state.authenticated = false;
        app.updateAccessGate();
      }
      throw new Error(data.message || `Request failed: ${response.status}`);
    }

    return data;
  };
})(window);
