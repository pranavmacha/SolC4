# AGENTS.md

Guidance for AI coding agents working on StadiumPulse 26.

## Project Shape

StadiumPulse 26 is a dependency-free Node.js web app for FIFA World Cup 2026 stadium operations. It serves a static dashboard and protected API endpoints for:

- AI operations briefings
- Multilingual copilot responses
- Built-in and custom stadium scenarios
- Session-based access control

Key files:

- `server.js` - HTTP server, API routing, auth/session checks, static serving, AI orchestration.
- `src/config.js` - environment loading and runtime/provider config.
- `src/asyncLimiter.js` - bounded async queue for AI concurrency control.
- `src/scenarioStore.js` - scenario validation, loading, persistence.
- `data/scenarios.json` - built-in scenario templates.
- `data/custom-scenarios.json` - runtime-created scenarios, ignored by git.
- `public/app.js` - dashboard UI behavior and API calls.
- `public/index.html` - dashboard markup.
- `public/styles.css` - dashboard styling.
- `tests/server.test.js` - Node test suite.

## Security Rules

- Never print or commit `.env`, `GROQ_API_KEY`, `APP_ACCESS_TOKEN`, or session cookies.
- Keep `.env` ignored by git.
- Keep `data/custom-scenarios.json` ignored by git unless the user explicitly asks to version sample data.
- AI endpoints must remain authenticated when provider credentials exist.
- Do not let browser-provided snapshots become AI truth. AI prompts must use server-side scenarios from `scenarioStore`.
- Preserve generic client-facing provider errors. Detailed provider errors should only be logged server-side after sanitization.
- Preserve security headers in `applySecurityHeaders`.

## Resource Rules

- Keep global AI concurrency bounded through `src/asyncLimiter.js`.
- Keep briefing cache and in-flight dedupe for repeated scenario briefings.
- Do not reintroduce synchronous filesystem checks on hot request paths.
- Keep request body limits small unless there is a clear product reason.
- Keep frontend chat history bounded.

## Scenario Rules

- Built-in scenario data belongs in `data/scenarios.json`.
- Runtime custom scenarios are created through `POST /api/scenarios`.
- All custom scenario data must pass `src/scenarioStore.js` validation/sanitization.
- Custom scenarios must work for both map rendering and AI briefing/copilot flows.
- If changing scenario shape, update server validation, frontend rendering, and tests together.

## Testing

Use the bundled Node binary if `node`/`npm` are unavailable:

```bash
/Users/pranavmacha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check server.js
/Users/pranavmacha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check public/app.js
/Users/pranavmacha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test
```

Expected suite currently covers:

- Health endpoint and security headers
- Demo fallback without AI credentials
- Auth-required AI access
- Session cookie unlock
- Scenario listing
- Custom scenario creation
- Trusted scenario rejection
- Briefing cache behavior
- Risk helper
- Groq config precedence

Add tests for any changed API behavior.

## Running Locally

```bash
/Users/pranavmacha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

Then open:

```text
http://localhost:4173
```

Stop the server with `Ctrl-C`.

## Production Notes

Required production env:

- `APP_ACCESS_TOKEN`
- `APP_ALLOWED_ORIGINS`
- `GROQ_API_KEY`
- `GROQ_MODEL`
- `GROQ_BASE_URL`

Important resource env:

- `AI_CONCURRENCY_MAX`
- `AI_QUEUE_MAX`
- `AI_QUEUE_TIMEOUT_MS`
- `AI_TIMEOUT_MS`
- `BRIEFING_CACHE_TTL_MS`
- `BRIEFING_CACHE_MAX_ENTRIES`
- `RATE_LIMIT_MAX_BUCKETS`
- `CUSTOM_SCENARIO_FILE`

For multi-instance production, replace in-memory rate limiting with shared Redis/Upstash-style rate limiting and put static assets behind a CDN or reverse proxy.

