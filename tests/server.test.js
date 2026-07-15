const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAppServer, getAiConfig, riskFromDensity } = require("../server");

const DEFAULT_PUBLIC_DIR = path.join(__dirname, "..", "public");

// ---------------------------------------------------------------------------
// Env helpers — wraps the repetitive capture/clear/restore pattern
// ---------------------------------------------------------------------------

function aiEnvNames() {
  return [
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "GROQ_BASE_URL",
    "AI_API_KEY",
    "AI_MODEL",
    "AI_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_BASE_URL"
  ];
}

function appEnvNames() {
  return [
    ...aiEnvNames(),
    "APP_ACCESS_TOKEN",
    "APP_ALLOWED_ORIGINS",
    "DISABLE_AUTH",
    "NODE_ENV",
    "CUSTOM_SCENARIO_FILE"
  ];
}

function captureEnv(names) {
  return Object.fromEntries(names.map(name => [name, process.env[name]]));
}

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

/**
 * Runs `fn` with a clean env (all app env vars removed), then restores.
 * Pass `overrides` to set specific vars for the test.
 */
async function withCleanEnv(overrides, fn) {
  const previous = captureEnv(appEnvNames());
  for (const name of appEnvNames()) delete process.env[name];
  Object.assign(process.env, overrides);
  try {
    await fn();
  } finally {
    restoreEnv(previous);
  }
}

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

function startTestServer(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stadiumpulse-test-"));
  const server = createAppServer({
    publicDir: DEFAULT_PUBLIC_DIR,
    customScenarioFile: path.join(tempDir, "custom-scenarios.json"),
    ...options
  });

  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise(done => {
          server.close(() => {
            fs.rmSync(tempDir, { recursive: true, force: true });
            done();
          });
        })
      });
    });
  });
}

function startProviderServer(makeResponse) {
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(makeResponse(req)));
  });

  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("health endpoint reports service status", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.url}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "StadiumPulse 26");
    assert.equal(body.ok, true);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  } finally {
    await server.close();
  }
});

test("assistant endpoint returns demo guidance without AI credentials", () =>
  withCleanEnv({}, async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.url}/api/ai/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "Find an accessible route",
          persona: "Fan",
          language: "English",
          accessibility: { stepFree: true },
          scenarioId: "arrival",
          selectedZoneId: "north"
        })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.source, "demo-ai");
      assert.match(body.response, /North Gate|South Gate|West Transit/);
      assert.ok(body.actions.length > 0);
    } finally {
      await server.close();
    }
  })
);

test("AI endpoints require authentication when access token is configured", () =>
  withCleanEnv({ APP_ACCESS_TOKEN: "test-access-token" }, async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.url}/api/ai/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: "arrival" })
      });
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.equal(body.error, "unauthorized");
    } finally {
      await server.close();
    }
  })
);

test("session login unlocks protected AI endpoint", () =>
  withCleanEnv({ APP_ACCESS_TOKEN: "test-access-token" }, async () => {
    const server = await startTestServer();
    try {
      const login = await fetch(`${server.url}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: "test-access-token" })
      });
      const cookie = login.headers.get("set-cookie");

      assert.equal(login.status, 200);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Strict/);

      const response = await fetch(`${server.url}/api/ai/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cookie": cookie },
        body: JSON.stringify({ scenarioId: "arrival" })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.source, "demo-ai");
    } finally {
      await server.close();
    }
  })
);

test("scenario list is served from the scenario store", () =>
  withCleanEnv({}, async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.url}/api/scenarios`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.ok(body.scenarios.arrival);
      assert.equal(body.scenarios.arrival.label, "Pregame arrival");
      assert.ok(Array.isArray(body.scenarios.arrival.zones));
    } finally {
      await server.close();
    }
  })
);

test("authenticated operators can create custom scenarios for AI briefings", () =>
  withCleanEnv({ APP_ACCESS_TOKEN: "test-access-token" }, async () => {
    const server = await startTestServer();
    try {
      const login = await fetch(`${server.url}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: "test-access-token" })
      });
      const cookie = login.headers.get("set-cookie");

      const createResponse = await fetch(`${server.url}/api/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cookie": cookie },
        body: JSON.stringify({
          id: `test-custom-${Date.now()}`,
          label: "Test Custom Surge",
          matchClock: "T-00:30",
          weather: "Hot and windy",
          transit: "Metro at 80% load",
          zones: [
            { id: "test-north", name: "Test North", type: "Entry", density: 89, wait: 17, status: "rising", accessible: "Test lift" }
          ],
          incidents: [
            { id: "INC-T1", title: "Test queue", zone: "Test North", severity: "high", owner: "Test lead", eta: "4 min" }
          ]
        })
      });
      const createBody = await createResponse.json();
      const createdId = createBody.scenario && createBody.scenario.id;

      assert.equal(createResponse.status, 201);
      assert.match(createdId, /^test-custom-/);

      const briefing = await fetch(`${server.url}/api/ai/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cookie": cookie },
        body: JSON.stringify({ scenarioId: createdId })
      });
      const briefingBody = await briefing.json();

      assert.equal(briefing.status, 200);
      assert.equal(briefingBody.source, "demo-ai");
      assert.match(briefingBody.summary, /Test North/);
    } finally {
      await server.close();
    }
  })
);

test("unknown scenarios are rejected instead of trusting client snapshots", () =>
  withCleanEnv({}, async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.url}/api/ai/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: "fake",
          snapshot: { scenario: "Forged scenario", zones: [] }
        })
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.error, "bad_request");
    } finally {
      await server.close();
    }
  })
);

test("briefings are cached briefly per trusted scenario", () =>
  withCleanEnv({}, async () => {
    const server = await startTestServer();
    try {
      const first = await fetch(`${server.url}/api/ai/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: "weather" })
      });
      const firstBody = await first.json();

      const second = await fetch(`${server.url}/api/ai/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: "weather" })
      });
      const secondBody = await second.json();

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(firstBody.generatedAt, secondBody.generatedAt);
      assert.equal(firstBody.headline, secondBody.headline);
    } finally {
      await server.close();
    }
  })
);

test("invalid provider JSON returns a generic AI provider error", () =>
  withCleanEnv({
    AI_API_KEY: "test-provider-key",
    AI_MODEL: "test-model"
  }, async () => {
    const restoreConsoleError = muteConsoleError();
    const provider = await startProviderServer(() => ({
      choices: [
        {
          message: {
            content: "```json\n{\"headline\":\n```"
          }
        }
      ]
    }));
    process.env.AI_BASE_URL = provider.url;

    const server = await startTestServer({ disableAuth: true });
    try {
      const response = await fetch(`${server.url}/api/ai/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: "arrival" })
      });
      const body = await response.json();

      assert.equal(response.status, 502);
      assert.equal(body.error, "ai_provider_error");
      assert.equal(body.message, "AI provider request failed");
    } finally {
      restoreConsoleError();
      await server.close();
      await provider.close();
    }
  })
);

test("risk helper maps high density to critical posture", () => {
  assert.equal(riskFromDensity(93), "critical");
  assert.equal(riskFromDensity(84), "high");
  assert.equal(riskFromDensity(70), "medium");
  assert.equal(riskFromDensity(44), "low");
});

function muteConsoleError() {
  const original = console.error;
  console.error = () => {};
  return () => {
    console.error = original;
  };
}

test("Groq key activates Groq OpenAI-compatible defaults", async () => {
  const previous = captureEnv(aiEnvNames());
  try {
    for (const name of Object.keys(previous)) delete process.env[name];
    process.env.GROQ_API_KEY = "gsk_test_key";
    const config = getAiConfig();

    assert.equal(config.provider, "groq");
    assert.equal(config.apiKey, "gsk_test_key");
    assert.equal(config.model, "openai/gpt-oss-20b");
    assert.equal(config.baseUrl, "https://api.groq.com/openai/v1");
  } finally {
    restoreEnv(previous);
  }
});

test("Groq key wins over placeholder generic base URL when generic key is empty", async () => {
  const previous = captureEnv(aiEnvNames());
  try {
    for (const name of Object.keys(previous)) delete process.env[name];
    process.env.AI_API_KEY = "";
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    process.env.GROQ_API_KEY = "gsk_test_key";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    process.env.GROQ_BASE_URL = "https://api.groq.com/openai/v1";
    const config = getAiConfig();

    assert.equal(config.provider, "groq");
    assert.equal(config.apiKey, "gsk_test_key");
    assert.equal(config.model, "openai/gpt-oss-20b");
    assert.equal(config.baseUrl, "https://api.groq.com/openai/v1");
  } finally {
    restoreEnv(previous);
  }
});
