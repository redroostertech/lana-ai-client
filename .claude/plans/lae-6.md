# Phase 6 (client): local AI engine in the desktop client

Branch `lana-local-ai-engine-client` from `origin/development` 386e9b1. Context consulted: `Claude.md` (workspace root), `lana-ai-client/Claude.md`, `src/js/lex/LEX-COMPONENT-RULES.md`, backend plan `.claude/plans/local-ai-engine.md` (adjustment 2, gateway), engine code `src/engine/{index,gateway,chef-link}.js`, `src/shared/contracts/data-api-version.contract.js`.

## Shape

The engine is a gateway: it serves `/api/engine/v1/*` (health today, chat later) and forwards every other request to Chef unchanged (SSE, uploads and WebSocket upgrades included). So the client changes one thing: the API base.

## Pieces

1. `electron-engine-supervisor.js` (plain CommonJS, no Electron imports, all I/O injected).
   - Modes: `off` (no engine root and no attach URL, or the setting is off), `spawn` (engine root configured), `attach` (`LANA_ENGINE_URL`).
   - Spawn: `node <root>/src/engine/index.js` with an allowlisted environment (OS basics and proxy/CA variables only) plus `LANA_RUNTIME_ROLE=engine`, `LANA_CHEF_URL`, `LANA_ENGINE_HOST=127.0.0.1`, `LANA_ENGINE_PORT`. No database variables can reach it, because nothing outside the allowlist is inherited. The working directory is a dedicated folder under the app's user data so the engine's `dotenv.config()` cannot pick up a checkout `.env` with database settings.
   - Port: last used port if still free, else a free loopback port; persisted so the API base is stable across launches.
   - Health: polls `GET /api/engine/v1/health` (fast while starting, slower when running). Not healthy within the start timeout, or three failed polls in a row after being healthy: restart.
   - Crash: restart with capped exponential backoff (1 s doubling to 30 s); the counter resets after a minute of health.
   - Stop: SIGTERM, SIGKILL after a grace period; on quit, logout and when the setting is turned off.
   - Packaged builds: `LANA_ENGINE_NODE` or, when packaged, Electron's own binary with `ELECTRON_RUN_AS_NODE=1`. Shipping the engine inside the installer is out of scope here.
2. `electron-api-base.js` (pure): engine configuration from env and settings, API base resolution, the server object the renderer sees (`url` is the API base, `chefUrl` is Chef), and the inverse used before anything is saved (the engine address is never persisted as Chef's).
3. Main process wiring (`electron-main.js`): one supervisor; `get-saved-server` returns the presented server; `save-settings` / `connect-to-server` store Chef's address and hand it to the engine; `clear-saved-server` stops the engine; quit stops it; screen voice uses the same base. The PAC bridge keeps getting Chef's address (PAC is out of scope and behaves as before).
4. Preload: `electronAPI.getApiBaseSync()` (sync, so the first request of a page already goes to the engine) and `electronAPI.engine` (`getStatus`, `restart`, `setEnabled`, `onState`).
5. Renderer:
   - `api.js` takes the base from `getApiBaseSync()` first and keeps `localStorage.lana_saved_server` in step; listens for engine state pushes and follows base changes in place.
   - `src/js/engine-status.js` (pure functions plus a small banner controller): engine state and 426/503 problems to a person-readable state. `src/css/engine-status.css` (Lex tokens, light and dark).
   - `lex-app.js` loads the banner assets once in Electron and stops showing its generic offline banner while the engine banner explains the state.
   - Chat stream errors (`lex-chat.source.js`) read problem+json `detail` and mark 426 not retryable.
6. Settings v2 capabilities: "Local AI service" card (status, port, Chef reachable, data API range), "Use local AI engine" toggle, Restart. Persisted in electron-store (`localEngine` preferences); default on when an engine root is configured.

## API base rule

- Engine not configured, or the setting is off: Chef's URL (exactly as today).
- Engine configured and on: the engine's loopback URL, always, healthy or not. The client never silently falls back to Chef while the engine is on; the banner shows the state instead (restarting, can't reach Chef, version refused). Reason: falling back would route chat around the engine and hide a broken engine; with the gateway every non-chat call goes through the engine anyway, so there is no partial mode to fall back to. The person can turn the engine off in Settings, which switches the base to Chef.
- Login and discovery: still direct to Chef (discovery gives Chef's address; the engine needs it before it can start).

## UX states

| State | Source | Message | Retry |
|---|---|---|---|
| restarting | engine process down, starting or health failing | "Restarting LANA's AI service" | supervisor restarts |
| chef_unavailable | health `chef.status` connecting/unreachable, or 503 `CHEF_UNAVAILABLE` | "Can't reach your organization's server, retrying" | engine retries; non-blocking |
| version_refused | health `version.status: unsupported`, or 426 `DATA_API_VERSION_UNSUPPORTED` | problem `detail` (client too old / server being updated) | none |

## Tests (targeted files only)

- `tests/unit/electron-engine-supervisor.test.js`: spawn command, args, env (no database variables), cwd, port; health polling; restart backoff and cap; restart on unhealthy; stop and quit; attach mode; off mode.
- `tests/unit/electron-api-base.test.js`: base when engine healthy, off, unhealthy (still the engine), not configured; presented server; never persisting the engine address; settings default.
- `tests/unit/engine-status.test.js`: 426 and 503 problem handling, health to state, no retry on 426.
- `tests/unit/electron-storage-local-engine.test.js`: settings persistence.

Red checks: break each rule, see the test fail, restore.
