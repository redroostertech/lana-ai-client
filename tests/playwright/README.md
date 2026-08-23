# Agent Studio Playwright checks

These checks use the real Chef APIs. They do not mock agent definitions,
runtime execution, artifacts, or approval state.

## Read-only UI inventory

```bash
LANA_E2E_EMAIL='user@example.com' \
LANA_E2E_PASSWORD='...' \
npm run test:agents:ui
```

Use `LANA_E2E_TOKEN` instead of email/password when a short-lived test token is
already available. Override the defaults with `LANA_E2E_API_URL` and
`LANA_E2E_CLIENT_URL`.

## Real catalog runs

```bash
LANA_E2E_LIVE_AGENTS=1 \
LANA_E2E_EMAIL='user@example.com' \
LANA_E2E_PASSWORD='...' \
LANA_E2E_MATTER_ID='MATT-123' \
LANA_E2E_RECORDING_ID='recording-uuid' \
npm run test:agents:live
```

The live suite runs serially, verifies scope, polls the canonical run endpoint,
checks required artifact kinds, attaches the run envelope, and captures the
outcome screen. Set `LANA_E2E_AGENT=insights-reporter` to run one agent.

Approvals are deliberately not applied by default. Set
`LANA_E2E_ALLOW_APPLY=1` only in a disposable test organization; approved
artifacts can create real plans, tasks, widgets, generated documents, contacts,
email drafts, and disabled automation rules.
