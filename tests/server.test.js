const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createAppServer, getAiConfig, riskFromDensity } = require("../server");

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

test("assistant endpoint returns demo guidance without AI credentials", async () => {
  const previous = captureEnv(appEnvNames());
  clearEnv(appEnvNames());
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.url}/api/ai/assistant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question: "Find an accessible route",
        persona: "Fan",
        language: "English",
        accessibility: {
          stepFree: true
        },
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
    restoreEnv(previous);
  }
});

test("AI endpoints require authentication when access token is configured", async () => {
  const previous = captureEnv(appEnvNames());
  clearEnv(appEnvNames());
  process.env.APP_ACCESS_TOKEN = "test-access-token";

  const server = await startTestServer();
  try {
    const response = await fetch(`${server.url}/api/ai/briefing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        scenarioId: "arrival"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, "unauthorized");
  } finally {
    await server.close();
    restoreEnv(previous);
  }
});

test("session login unlocks protected AI endpoint", async () => {
  const previous = captureEnv(appEnvNames());
  clearEnv(appEnvNames());
  process.env.APP_ACCESS_TOKEN = "test-access-token";

  const server = await startTestServer();
  try {
    const login = await fetch(`${server.url}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        accessToken: "test-access-token"
      })
    });
    const cookie = login.headers.get("set-cookie");

    assert.equal(login.status, 200);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    const response = await fetch(`${server.url}/api/ai/briefing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        scenarioId: "arrival"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.source, "demo-ai");
  } finally {
    await server.close();
    restoreEnv(previous);
  }
});

test("scenario list is served from the scenario store", async () => {
  const previous = captureEnv(appEnvNames());
  clearEnv(appEnvNames());

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
    restoreEnv(previous);
  }
});

test("authenticated operators can create custom scenarios for AI briefings", async () => {
  const previous = captureEnv(appEnvNames());
  clearEnv(appEnvNames());
  process.env.APP_ACCESS_TOKEN = "test-access-token";

  const server = await startTestServer();
  let createdId = "";
  try {
    const login = await fetch(`${server.url}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        accessToken: "test-access-token"
      })
    });
    const cookie = login.headers.get("set-cookie");

    const createResponse = await fetch(`${server.url}/api/scenarios`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        id: `test-custom-${Date.now()}`,
        label: "Test Custom Surge",
        matchClock: "T-00:30",
        weather: "Hot and windy",
        transit: "Metro at 80% load",
        zones: [
          {
            id: "test-north",
            name: "Test North",
            type: "Entry",
            density: 89,
            wait: 17,
            status: "rising",
            accessible: "Test lift"
          }
        ],
        incidents: [
          {
            id: "INC-T1",
            title: "Test queue",
            zone: "Test North",
            severity: "high",
            owner: "Test lead",
            eta: "4 min"
          }
        ]
      })
    });
    const createBody = await createResponse.json();
    createdId = createBody.scenario && createBody.scenario.id;

    assert.equal(createResponse.status, 201);
    assert.match(createdId, /^test-custom-/);

    const briefing = await fetch(`${server.url}/api/ai/briefing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        scenarioId: createdId
      })
    });
    const briefingBody = await briefing.json();

    assert.equal(briefing.status, 200);
    assert.equal(briefingBody.source, "demo-ai");
    assert.match(briefingBody.summary, /Test North/);
  } finally {
    await server.close();
    removeCustomScenario(createdId);
    restoreEnv(previous);
  }
});

test("unknown scenarios are rejected instead of trusting client snapshots", async () => {
  const previous = captureEnv(appEnvNames());
  clearEnv(appEnvNames());

  const server = await startTestServer();
  try {
    const response = await fetch(`${server.url}/api/ai/briefing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        scenarioId: "fake",
        snapshot: {
          scenario: "Forged scenario",
          zones: []
        }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "bad_request");
  } finally {
    await server.close();
    restoreEnv(previous);
  }
});

test("briefings are cached briefly per trusted scenario", async () => {
  const previous = captureEnv(appEnvNames());
  clearEnv(appEnvNames());

  const server = await startTestServer();
  try {
    const first = await fetch(`${server.url}/api/ai/briefing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        scenarioId: "weather"
      })
    });
    const firstBody = await first.json();

    const second = await fetch(`${server.url}/api/ai/briefing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        scenarioId: "weather"
      })
    });
    const secondBody = await second.json();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(firstBody.generatedAt, secondBody.generatedAt);
    assert.equal(firstBody.headline, secondBody.headline);
  } finally {
    await server.close();
    restoreEnv(previous);
  }
});

test("risk helper maps high density to critical posture", () => {
  assert.equal(riskFromDensity(93), "critical");
  assert.equal(riskFromDensity(84), "high");
  assert.equal(riskFromDensity(70), "medium");
  assert.equal(riskFromDensity(44), "low");
});

test("Groq key activates Groq OpenAI-compatible defaults", () => {
  const previous = captureEnv(aiEnvNames());

  try {
    clearEnv(Object.keys(previous));
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

test("Groq key wins over placeholder generic base URL when generic key is empty", () => {
  const previous = captureEnv(aiEnvNames());

  try {
    clearEnv(Object.keys(previous));
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

function startTestServer(options = {}) {
  const server = createAppServer({
    publicDir: path.join(__dirname, "..", "public"),
    ...options
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

function clearEnv(names) {
  names.forEach(name => {
    delete process.env[name];
  });
}

function restoreEnv(previous) {
  Object.entries(previous).forEach(([name, value]) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  });
}

function removeCustomScenario(id) {
  if (!id) {
    return;
  }

  const fs = require("node:fs");
  const filePath = path.join(__dirname, "..", "data", "custom-scenarios.json");
  if (!fs.existsSync(filePath)) {
    return;
  }

  const scenarios = JSON.parse(fs.readFileSync(filePath, "utf8"));
  delete scenarios[id];
  if (Object.keys(scenarios).length === 0) {
    fs.rmSync(filePath);
  } else {
    fs.writeFileSync(filePath, `${JSON.stringify(scenarios, null, 2)}\n`);
  }
}
