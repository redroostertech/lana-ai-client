# LanaAgents app

## Overview

LanaAgents is the Electron client surface for browsing, running, and
auditing Lana's agent platform. Users pick an agent from the catalog,
configure and launch a run, and review past runs ("activity"). It is a
sibling of LanaWorks in the top-level app dropdown switcher: the host
shell hands the user off to the agents pages here, and `sidebar-config.js`
owns the per-app left-nav while inside the LanaAgents experience.

## Pages

| Page | File | Purpose | Entry point |
|------|------|---------|-------------|
| Catalog | `src/agents.html` | Browse and search available agents. Default landing page. | App dropdown -> "LanaAgents", or sidebar "Catalog" |
| Agent detail | `src/agent-detail.html` | View an agent's description, tools, and inputs; start a run. | Click an agent in the catalog |
| Agent run | `src/agent-run.html` | Live view of a run: streamed steps, tool calls, output. | "Run" action from agent detail, or click an in-progress run from activity |
| Activity (runs list) | `src/agentic-tasks.html` | History of all agent runs across agents. | Sidebar "Activity" |
| Activity detail | `src/agentic-task-detail.html` | Full record of a single completed run: inputs, transcript, artifacts. | Click a row in activity |

## Sidebar nav

`sidebar-config.js` is the single source of truth for the LanaAgents
app's sidebar. Each page, once `<lex-app>` is ready, calls:

```js
const sections = window.LanaAgentsApp.getAgentsAppSections({ activeId: 'catalog' });
els.shell.setSections(sections);
```

The shared host footer (user chip, settings, etc.) is hydrated by the
existing `LanaSidebarFooter` helper, same as LanaAutomations — no
duplication here.

## Pattern alignment

LanaAgents follows the **multi-page-with-shared-sidebar-config** pattern
(similar to LanaWorks' top-level pages) rather than the
**single-page-app** pattern used by `src/automation/` and `src/voice/`.

Rationale: the existing agents pages were built as separate HTML files
routed via `lex-router`. Preserving that structure keeps the migration
to a first-class app scoped to (a) a per-app sidebar config, (b) a
dropdown entry, and (c) light page wiring — without rewriting page
flow into a SPA.

## How to add a new page

1. Create `src/<new-page>.html`, `src/js/pages/<new-page>.js`, and
   `src/css/<new-page>.css` (HTML/JS/CSS triplet — see
   `lana-ai-client/CLAUDE.md` page hygiene rule).
2. After `<lex-app>` is ready in the page's JS, call
   `window.LanaAgentsApp.getAgentsAppSections({ activeId: '<id>' })`
   and pass the result to `els.shell.setSections(sections)`. If the
   page should appear in the sidebar, add an entry to
   `SIDEBAR_NAV_ITEMS` in `sidebar-config.js`.
3. If the page is reachable directly (deep link), register it with the
   Lex router in `src/js/lex/lex-router.pages.js`.
