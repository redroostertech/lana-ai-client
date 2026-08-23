# LanaAgents app

## Overview

LanaAgents is the dedicated Agent Studio for building, deploying, running,
and reviewing Lana's persistent agents. The experience is outcome-first:
the workspace explains the build → run → review loop, the guided builder
keeps technical configuration behind plain-language decisions, and the
Outcomes view brings finished work and human decisions together. It is a
sibling of LanaWorks in the top-level app dropdown switcher.

Claude migration is handled in the guided builder. A user may choose a
`CLAUDE.md`, Markdown, or JSON agent config; the client reads it locally and
maps its name, purpose, and recognizable tool intent onto the closest governed
LANA template. Raw source instructions are not uploaded and the backend's
template-owned system prompt boundary remains intact.

The final deploy step supports on-demand or plain-language recurring schedules,
optional chat discoverability, and an optional first task. A successful quiet
deploy stays in context long enough to show a deployment receipt and clear
choices to give the agent work or return to the workspace.

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
| `catalog` | `#catalog` (default) | Workspace home, agent roster, starting points, and recent outcomes. |
| `agentDetail` | `#agent/:slug` | View an agent's description, tools, inputs; start a run. |
| `agentRun` | `#run/:id` | Live view of a running or completed run: streamed steps, tool calls, output. |
| `activity` | `#activity` | Outcome-first history of all agent work. |
| `activityDetail` | `#activity/:id` | Full outcome record: inputs, trace, approvals, and deliverables. |
| `create` | `#create` | Four-step guided agent builder. |
| `create` | `#create/import` | Guided builder opened on the local Claude import path. |
| `toolsBrowse` | `#tools/browse` | Full capability library used by the builder. |

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
