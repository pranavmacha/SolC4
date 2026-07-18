# StadiumPulse 26

StadiumPulse 26 is a GenAI-enabled stadium operations and fan experience dashboard for FIFA World Cup 2026 match days. It combines a live venue snapshot, crowd heat map, incident queue, accessibility preferences, transport signals, sustainability metrics, and a multilingual AI copilot.

## What It Solves

- Navigation: suggests lower-density routes and gate alternatives.
- Crowd management: identifies pressure zones and drafts mitigation actions.
- Accessibility: respects step-free, low-sensory, and audio-description needs.
- Transportation: ties venue egress advice to transit and shuttle load.
- Sustainability: nudges transit, refill points, reusable cups, and energy staging.
- Multilingual assistance: passes the selected language and persona into the AI prompt.
- Operational intelligence: generates command-center briefings from current conditions.

## Run Locally

```bash
npm start
```

Open [http://localhost:4173](http://localhost:4173).

## Enable A Real GenAI Provider

The app works immediately with a transparent `Demo AI` fallback. To use a real model, configure an OpenAI-compatible chat-completions provider:

```bash
cp .env.example .env
# Edit .env and set AI_API_KEY, AI_MODEL, and optionally AI_BASE_URL.
npm start
```

The server will return `Configured AI` responses when both `AI_API_KEY` and `AI_MODEL` are set.

### Groq

For Groq, put your key in `.env`:

```bash
GROQ_API_KEY="your-groq-key"
GROQ_MODEL="openai/gpt-oss-20b"
GROQ_BASE_URL="https://api.groq.com/openai/v1"
APP_ACCESS_TOKEN="generate-a-long-random-access-code"
APP_ALLOWED_ORIGINS="https://your-production-domain.example"
```

If `GROQ_API_KEY` is set, the server automatically uses Groq's OpenAI-compatible base URL and defaults to `openai/gpt-oss-20b` unless you set another `GROQ_MODEL`.

For public deployments, set `APP_ACCESS_TOKEN`; AI endpoints are protected by a signed HTTP-only session cookie, same-origin checks, and rate limits. Keep `.env` private and rotate provider keys if they are ever exposed.

## Production Resource Controls

These environment variables keep public traffic bounded:

```bash
AI_CONCURRENCY_MAX=4
AI_QUEUE_MAX=24
AI_QUEUE_TIMEOUT_MS=5000
AI_TIMEOUT_MS=20000
BRIEFING_CACHE_TTL_MS=30000
BRIEFING_CACHE_MAX_ENTRIES=32
RATE_LIMIT_MAX_BUCKETS=5000
CUSTOM_SCENARIO_FILE=./data/custom-scenarios.json
```

Use a CDN or reverse proxy for static assets in production, and use a shared external rate limiter such as Redis/Upstash when running multiple app instances.

## Custom Scenarios

Built-in scenarios live in `data/scenarios.json`. Operators can create custom scenarios from the dashboard after unlocking the console. Custom scenarios are validated server-side, persisted to `data/custom-scenarios.json` by default, and immediately become available to the AI briefing and copilot.

For production, point `CUSTOM_SCENARIO_FILE` at durable storage on your host, or replace `src/scenarioStore.js` with a database-backed implementation.

## Verify

```bash
npm run check
npm test
```

## Architecture

The codebase is organized into focused modules under `src/`:

- `server.js`: lightweight entry point — loads config, boots the HTTP server.
- `src/app.js`: application factory — assembles routing, auth, rate limiting, and static serving.
- `src/config.js`: environment loading and runtime/provider configuration.
- `src/errors.js`: centralized `HttpError` class and safe error-response formatting.
- `src/sanitize.js`: shared text-sanitization, choice-validation, and JSON cloning utilities.
- `src/scenarioStore.js`: built-in/custom scenario loading, validation, and persistence.
- `src/asyncLimiter.js`: bounded async work queue for AI concurrency control.

### HTTP Layer (`src/http/`)
- `json.js`: JSON request body parsing and response helpers.
- `request.js`: request URL construction and reverse-proxy base-URL detection.
- `staticFiles.js`: secure static file server with path-traversal protection.

### Routes (`src/routes/`)
- `api.js`: central API router with auth and rate-limit guards.
- `aiRoutes.js`: AI assistant and operations briefing endpoints.
- `healthRoutes.js`: service health-check endpoint.
- `scenarioRoutes.js`: scenario listing and creation endpoints.
- `sessionRoutes.js`: session login, status, and logout endpoints.

### Security (`src/security/`)
- `auth.js`: token validation, HMAC-signed session cookies, origin enforcement.
- `headers.js`: CSP, HSTS, and framing/CORS response headers.
- `rateLimit.js`: in-memory per-IP rate limiter.

### Services (`src/services/`)
- `aiService.js`: AI service facade — orchestrates provider, limiter, cache, and demo fallback.
- `aiProvider.js`: OpenAI-compatible chat-completions client with timeout and retry.
- `briefingCache.js`: TTL-bounded in-memory cache with pending-promise deduplication.
- `demoAi.js`: demo AI response generators for offline/credentialless operation.
- `snapshot.js`: scenario-to-snapshot conversion and zone/incident query helpers.

### Data and Frontend
- `data/scenarios.json`: built-in scenario templates.
- `public/index.html`: operational dashboard markup.
- `public/app.js`: browser bootstrap that starts the dashboard after feature modules load.
- `public/js/state.js`: shared browser state and constants.
- `public/js/dom.js`: DOM element cache.
- `public/js/api.js`: same-origin JSON API client and auth-lock response handling.
- `public/js/access.js`: access gate, session verification, and protected-control state.
- `public/js/scenarios.js`: trusted scenario loading and current-zone selection.
- `public/js/scenarioBuilder.js`: custom scenario form builder and submission flow.
- `public/js/render.js`: metrics, map, incidents, and selected-zone rendering.
- `public/js/aiPanel.js`: operations briefing, copilot requests, and chat rendering.
- `public/js/events.js`: browser event binding.
- `public/styles.css`: responsive dashboard styling.
- `tests/server.test.js`: integration tests for API, auth, caching, AI fallback, and static UI wiring.
