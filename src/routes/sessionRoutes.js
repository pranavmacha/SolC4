/** Route handlers for session login, status check, and logout. */
const { assertValidAccessToken } = require("../security/auth");
const { sendJson } = require("../http/json");

function handleGetSession(req, res, context) {
  sendJson(res, 200, {
    authRequired: context.authRequired,
    authenticated: !context.authRequired || context.auth.isRequestAuthenticated(req)
  });
}

async function handleCreateSession(req, res, context) {
  const payload = await context.readJson(req);
  assertValidAccessToken(payload);
  context.auth.setSessionCookie(req, res);
  sendJson(res, 200, {
    ok: true,
    authenticated: true
  });
}

function handleLogout(req, res, context) {
  context.auth.clearSessionCookie(res);
  sendJson(res, 200, {
    ok: true
  });
}

module.exports = {
  handleCreateSession,
  handleGetSession,
  handleLogout
};
