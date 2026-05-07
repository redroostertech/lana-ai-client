# LanaAgents app

## Overview

LanaAgents is the Electron client surface for browsing, running, and
auditing Lana's agent platform. Users pick an agent from the catalog,
configure and launch a run, and review past runs ("activity"). It is a
sibling of LanaWorks in the top-level app dropdown switcher.

## Pattern alignment

LanaAgents is a **single-page application**, matching the pattern used
by `src/automation/` and `src/voice/`. There is one host (`index.html`),
one controller (`app.js`), and a set of view modules under `js/views/`
that each register a renderer on `window.LanaAgentsApp.Views.<name>`.

Internal navigation is **hash-based** via
`window.LanaAgentsApp.setView(view, params)` — NOT `Lex.Nav.go(...)`,
which would trigger a full page load and tear down SPA state. Only
navigation that crosses out of (or back into) the LanaAgents app uses
full-page navigation, e.g. `window.location.href = 'agents/index.html#catalog'`.

## Views

| View name | URL hash | Purpose |
|-----------|----------|---------|
| `catalog` | `#catalog` (default) | Browse and search available agents. |
| `agentDetail` | `#agent/:slug` | View an agent's description, tools, inputs; start a run. |
| `agentRun` | `#run/:id` | Live view of a running or completed run: streamed steps, tool calls, output. |
| `activity` | `#activity` | History of all agent runs across agents. |
| `activityDetail` | `#activity/:id` | Full record of a single run: inputs, transcript, artifacts. |

## Files

- `index.html` — SPA host shell. Loads Lex, view modules, then `app.js`.
- `app.js` — SPA controller. Owns state, hash routing, sidebar config,
  and dispatches view rendering via `setView()`.
- `js/views/*.js` — One module per view. Each registers a renderer on
  `window.LanaAgentsApp.Views.<viewName>`.
- `styles.css` — App-local styles. Page-specific styles live in
  `src/css/agents.css`, `src/css/agent-detail.css`, `src/css/agent-run.css`.

## How to add a new view

1. Create `js/views/<view-name>.js`. Inside, build the markup and
   wire-up logic, exporting a render function (and optional teardown).
2. At the end of the module, register it:
   `window.LanaAgentsApp.Views.<viewName> = { render, teardown };`
   Add the `<script src="./js/views/<view-name>.js">` tag to
   `index.html` BEFORE `app.js`.
3. In `app.js`, add a case to `setView()`'s switch and (if the view has
   its own URL) map between hash and `{ view, params }` in the
   hash-parse / hash-write helpers.

If the view should appear in the LanaAgents sidebar, also add an entry
to the sidebar items array inside `app.js` (subsumed from the former
`sidebar-config.js`).
