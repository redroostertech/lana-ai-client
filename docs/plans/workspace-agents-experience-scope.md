# Workspace Agents Experience

**Status:** Scoped; implementation intentionally not started

**Product decision date:** 2026-08-23

**Primary surfaces:** Workspace Details, Agent Studio, Lana dock chat

**Backend authority:** LANA Chef `@agents` runtime

## 1. Decision Summary

Add an **Agents** tab to Workspace Details and a visible **Run agent** action to the workspace banner.

The workspace experience is an operational surface, not a second Agent Studio:

- Run an eligible agent with the current workspace already selected.
- See active runs, runs needing input or approval, recent outcomes, deliverables, and run activity for the current workspace.
- Open the canonical Agent Studio detail, live-run, and outcome views when deeper review is needed.
- Send **Build an agent** to the existing Agent Studio builder with the current workspace preselected.

Do not build or maintain a workspace-native agent builder. Agent Studio remains the only definition-management experience.

The Lana dock may become a conversational entry point for starting or teaching agents, but it is not the sole navigation or audit surface. That enhancement is a follow-on after the visible workspace experience is proven.

## 2. Product Outcome

A workspace member should be able to answer four questions without leaving the workspace:

1. Which agents can work here?
2. What can I ask one to do now?
3. What is currently running or waiting on a person?
4. What did previous runs produce, and how can I inspect their logs and deliverables?

The experience succeeds when a non-technical user can start a governed run in under a minute while the workspace boundary, expected outcome, approval policy, and next step remain obvious.

## 3. Product Principles

### Reuse one system

Workspace Details, Agent Studio, and the Lana dock must operate on the same agent definitions, runs, artifacts, approvals, and outcomes. There is no workspace-specific copy of an agent or run.

### Context should be automatic and visible

The workspace is preselected from the page. The user should not need to find it again, but the run confirmation must name it explicitly before launch.

### Fast path plus durable home

The banner action is the fastest way to begin. The Agents tab is where a user can browse, monitor, review, and return later.

### Governance stays visible

The UI must communicate access scope, expected outputs, connected context, approval requirements, and whether a run can make changes. It must never imply that a proposed artifact has already been applied.

### Agent Studio remains canonical

Creating, importing, editing, teaching, configuring, enabling, disabling, and changing agent access remain Agent Studio responsibilities.

## 4. Users And Core Jobs

### Workspace member

- Run a personal, workspace, organization, or system agent that is authorized and supports workspace scope.
- Review their private workspace-bound runs.
- Review shared workspace runs permitted by the live workspace ACL.
- Respond to input requests or approvals when directly authorized.

### Workspace owner or manager

- See the same operational view as other members.
- Create a new workspace agent by following the link to Agent Studio.
- Review workspace-level run activity without gaining access to another user's private run.

### Agent administrator

- Open the canonical Agent Studio surfaces to manage organization agents.
- Use the workspace experience to verify how an agent behaves in context, without creating a second configuration path.

## 5. Information Architecture

### 5.1 Workspace banner

Add a visible **Run agent** button to the existing `lex-banner` on Workspace Details.

Behavior:

1. Open the workspace agent picker.
2. Preserve the current workspace as fixed run context.
3. Keep existing Edit, Change Status, and Delete actions in the banner's overflow menu.
4. If the Agents app is unavailable or the user lacks `agents:run`, omit or disable the action with an understandable explanation.

The banner is a shortcut. It does not show run history.

### 5.2 Workspace Agents tab

Add an `agents` item to the existing Workspace Details tab bar.

Recommended layout:

1. **Header**
   - Title: `Agents`
   - Supporting copy: `Run repeatable work with this workspace's data and keep every outcome in context.`
   - Primary action: `Run an agent`
   - Secondary action: `Build in Agent Studio`

2. **Needs you**
   - Only render when at least one accessible run is awaiting input, approval, or artifact review.
   - Each item names the agent, requested action, age, and direct next action.

3. **Available agents**
   - Personal agents owned by the current user that support workspace runs.
   - Agents bound to this workspace.
   - Organization and system agents that support workspace runs.
   - Exclude workspace agents bound to a different workspace and all inaccessible definitions.
   - Each card shows name, purpose, access scope, relevant context/capabilities, approval summary, and `Run`.

4. **Workspace runs**
   - Default newest first.
   - Status filters: All, Working, Needs attention, Complete, Failed.
   - Each row shows agent, run title, starter when visible, status, start/update time, deliverable count, and next action.
   - `Run activity` opens the execution/log view.
   - `Review outcome` opens the finished outcome view.

5. **Empty state**
   - Heading: `Put an agent to work in this workspace.`
   - Primary action: `Choose an agent`
   - Secondary link: `Build in Agent Studio`
   - Do not imply that a new builder exists in Workspace Details.

### 5.3 Workspace agent picker

Use one picker for both the banner and Agents-tab actions.

The picker contains:

- Search.
- Sections or filters for Recommended, My agents, Workspace agents, and Organization agents.
- Only definitions that the current user can access and that support a workspace run.
- A final `Build an agent` link to Agent Studio.

Selecting an agent opens a launch confirmation rather than starting immediately.

### 5.4 Run confirmation

The confirmation view must show:

- Selected agent and purpose.
- Current workspace name.
- Plain-language task input.
- Context the agent can use: documents, tasks, contacts, analytics, tables, and connected data as declared by the agent.
- Expected outcome or deliverable categories where declared.
- Approval policy and a clear statement that sensitive changes pause before application.
- `Start run` and `Cancel`.

The user may change agents without closing the flow. They may not change the workspace from this contextual entry point.

### 5.5 Agent Studio builder handoff

`Build in Agent Studio` opens the existing builder with:

- Workspace access preselected.
- The current canonical `matter_id` preselected.
- A visible origin/return affordance naming the workspace.

Proposed internal route:

```text
agents/index.html#create?matter_id=<workspace-uuid>&source=workspace
```

The Agent Studio hash router will need to parse this contextual create route during implementation. `matter_id` must be canonicalized and reauthorized by the backend; it is never trusted merely because it came from the URL.

After deploy or cancel, the user can return to:

```text
workspace-details.html?id=<workspace-uuid>&tab=agents
```

No arbitrary `return_to` URL should be accepted.

### 5.6 Canonical detail views

Workspace cards and run rows should deep-link to the existing Agent Studio views:

- Agent detail: exact definition ID plus slug.
- Live run: run ID.
- Outcome: run/activity ID.
- Run activity: run ID with the execution tab selected.

The workspace tab may summarize these records but must not reimplement the full editor, teaching conversation, artifact review, verification, or execution-ledger UI.

## 6. Eligibility And Access Rules

### Agent eligibility

An agent appears only when all of the following are true:

1. The user can read and run the definition.
2. The definition is active.
3. The agent declares or supports `workspace` run scope.
4. A workspace-scoped definition is bound to the current `matter_id`.
5. Required workspace connectors/context are available, or the card clearly identifies what must be connected before launch.

### Definition scopes

- **Only me:** visible only to its creator and explicitly authorized administrators. A workspace run remains private unless the definition's policy says otherwise.
- **Workspace:** visible to authorized members of that workspace and bound to one canonical `matter_id`.
- **Organization:** visible to eligible organization members; publishing or promoting to this scope continues to require agent configuration authority.
- **System:** globally supplied starting point/runtime agent, subject to organization permissions and declared run scopes.

### Run access

- Every list, detail, event stream, step, artifact, validation, approval, response, retry, and cancellation path continues to require `agents:run` plus the run visibility policy.
- Workspace ACLs are checked when the record is opened, not only when it was created. Removing workspace access also removes access to historical workspace runs.
- Private runs do not become visible merely because they carry a `matter_id`.
- A directly assigned approver receives only the minimum private-run access required by the existing approval policy and permission checks.
- Only the run creator or `agents:run_admin` may cancel a shared/workspace run.
- Child-run logs never exceed the parent's access boundary.

### Agent definition integrity

All navigation, editing, and run launch requests carry the immutable `definition_id` in addition to the display slug so duplicate scoped copies never resolve to the wrong agent.

## 7. Data And API Scope

### Reuse

- `GET /api/v1/agents`
- `POST /api/v1/agents/:slug/runs`
- `GET /api/v1/agent-runs?matter_id=<id>`
- `GET /api/v1/agentic-tasks?matter_id=<id>` during compatibility
- Existing run detail, event stream, artifact, approval, retry, response, and cancellation routes

### Additive eligibility query

Prefer an additive server-filtered query rather than reproducing access and run-scope logic in Workspace Details:

```text
GET /api/v1/agents?matter_id=<workspace-uuid>&runnable_in=workspace&active_only=true
```

Expected behavior:

- Reauthorize workspace access.
- Return only definitions the user can access and run in that workspace.
- Include immutable `id`, `slug`, `visibility`, `matter_id`, `run_scopes`, `can_manage`, approval summary, context providers, required connectors, and readiness state.
- Fail closed on ACL or permission lookup errors.

If the existing list endpoint cannot accept contextual filtering cleanly, introduce a narrow read-only endpoint under the agents app. Do not move agent authorization into the client.

### Workspace run list

Use `matter_id` as the authoritative workspace filter. Do not force `run_view=mine` or `run_view=shared` in the default tab query; the access service should return the union of runs the current user is allowed to see. Optional UI filters may narrow to `Started by me` or `Shared with me` later.

### Outcomes and artifacts

- A workspace run is attached through `agent_runs.matter_id`.
- Outcomes remain Agent runtime records and are surfaced contextually; they are not copied into a second workspace table.
- Applied/promoted deliverables continue to use their canonical destination entities and appear in Documents, Tasks, Contacts, Emails, or other platform surfaces according to existing artifact-application behavior.
- Proposed deliverables remain reviewable artifacts until approval/application succeeds.

## 8. Frontend Implementation Surfaces

Expected files, subject to implementation audit:

- `src/workspace-details.html`
  - Add the Agents tab container and visible banner action.
- `src/js/workspace-details.js`
  - Register tab lifecycle, picker entry, deep links, and ACL-safe loading states.
- New focused module, recommended: `src/js/workspace-agents.js`
  - Own agent eligibility loading, run list rendering, picker, and launch confirmation.
  - Avoid adding another large feature block directly to `workspace-details.js`.
- New scoped stylesheet, recommended: `src/css/workspace-agents.css`
  - Reuse Lex tokens and the existing Agent Studio type system.
- `src/agents/app.js`
  - Parse the contextual create route.
- `src/agents/js/views/agent-create.js`
  - Preselect and display the originating workspace; preserve one canonical builder.
- `electron-main.js` and `docs/DEEPLINKS.md`
  - Add only the route parameters required for the contextual builder and `tab=agents` deep link.

Reusable Agent Studio presentation should be extracted into small shared view helpers only when that reduces drift. Do not couple Workspace Details directly to Agent Studio's page DOM.

## 9. Loading, Empty, And Error States

### Loading

- Skeleton cards for eligible agents.
- Skeleton rows for workspace runs.
- Keep header actions usable where safe.

### No eligible agents

Explain that no current agents support this workspace and link to Agent Studio. Do not describe this as a system failure.

### No runs

Show available agents and a clear first-run action.

### Workspace access revoked

Stop rendering agent/run data and use the workspace page's canonical access-denied behavior.

### Agents app unavailable

Show a compact unavailable state in the tab and remove/disable the banner shortcut. Do not leave a spinner indefinitely.

### Connector unavailable

Keep the agent visible when useful, label it `Needs connection`, and route the user to the canonical connector setup when they have authority. The backend remains the authority on launch readiness.

### Run launch failure

Keep the task input intact, explain the actionable cause, and allow retry. Never create duplicate runs on an ambiguous response.

## 10. Lana Dock Follow-On

After the banner and tab have proven the contextual contract, the Lana dock may support:

- `Run the weekly review agent for this workspace.`
- `Show me runs that need my approval.`
- `Teach this agent to put recommendations first.`
- `Build an agent for this workspace.`

The dock must present a confirmation card before launch containing the same agent, workspace, input, expected outcomes, and approval information as the visual picker. `Build an agent` still navigates to Agent Studio. Chat responses link back to the canonical live run or outcome view.

This conversational launch path is not required for the initial Workspace Agents release.

## 11. Non-Goals

- No embedded or duplicate agent builder inside Workspace Details.
- No workspace-specific copy of Agent Studio's agent editor.
- No new agent definition, prompt, tool, template, or runtime format.
- No automatic approval or application of consequential artifacts.
- No bypass of workspace ACLs, agent permissions, run visibility, or connector readiness.
- No separate workspace run-log or artifact database.
- No broad redesign of Workspace Summary, Documents, or Agent Studio.
- No requirement to ship the Lana dock launch flow in the first phase.
- No mobile-native redesign beyond making the responsive web experience usable.

## 12. Delivery Phases

### Phase 0: Contract and test fixtures

- Confirm the contextual agent eligibility response.
- Confirm exact builder deep-link shape.
- Identify safe system- and workspace-scope test agents.
- Add fixture coverage for private, workspace, organization, unavailable connector, needs-input, needs-approval, complete, and failed states.

### Phase 1: Workspace operational surface

- Add banner `Run agent` action.
- Add Agents tab.
- Add server-filtered eligible agent list.
- Add picker and run confirmation.
- Add workspace-filtered run list and attention states.
- Link to canonical Agent Studio run/outcome/detail views.

### Phase 2: Builder handoff

- Add contextual Agent Studio route parsing.
- Preselect workspace scope and canonical `matter_id`.
- Add return-to-workspace affordance.
- Verify cancel, deploy-only, and deploy-plus-first-run paths.

### Phase 3: Conversational entry

- Add Lana dock intents and confirmation cards.
- Reuse the same eligibility and launch contracts.
- Link conversational launches to the same live-run and outcome views.

## 13. Acceptance Criteria

### Banner and navigation

- An authorized user can open the picker from the workspace banner.
- The Agents tab is directly addressable with `?tab=agents` and survives refresh/back navigation.
- Existing banner actions and workspace tabs continue to work.

### Eligibility

- The picker never exposes an inaccessible private agent or an agent bound to another workspace.
- Personal, current-workspace, organization, and system agents appear only when they support workspace runs.
- Duplicate slugs always target the selected immutable definition ID.

### Run launch

- The workspace is already selected and cannot silently change.
- The confirmation clearly states context, expected output, and approvals.
- The request carries canonical `matter_id`, `scope=workspace`, and `definition_id`.
- A successful launch opens or links to the exact run ID.
- Double submission does not create duplicate runs.

### Runs, logs, and outcomes

- The tab displays every workspace-bound run the current user may access and no run they may not access.
- Working, awaiting input, awaiting approval, complete, failed, rejected, and cancelled states render correctly.
- Run activity exposes only authorized steps/events/logs.
- Outcome verification distinguishes runtime completion, deliverable presence, validation evidence, and human approval.
- Artifact and deliverable links open their canonical destinations.

### Access revocation

- Revoking workspace access prevents the user from reloading historical workspace runs, logs, outcomes, and artifacts.
- A private workspace-bound run remains private to its creator/authorized approver/admin.

### Builder reuse

- `Build in Agent Studio` opens the existing builder with the workspace preselected.
- No workspace-native builder is rendered.
- Cancel and successful deployment offer a deterministic return to the originating workspace.

### Responsive and accessibility

- Desktop and narrow layouts keep the primary action and run status understandable.
- Picker, filters, cards, dialog, and tabs are keyboard operable.
- Focus returns to the initiating button when the picker closes.
- Status is communicated with text, not color alone.
- Loading and live-run changes use appropriate accessible announcements without excessive interruption.

## 14. Required QA Evidence

The implementation is not considered complete without:

- Playwright coverage for every acceptance-criteria group.
- A real-backend pass using the designated test user.
- Screenshots of banner, empty tab, populated tab, picker, confirmation, live run, needs-input, needs-approval, completed outcome, failed run, and narrow layout.
- Video or trace evidence for banner-to-run, tab-to-run, builder handoff/return, approval review, and run-log navigation.
- Agent-by-agent behavior results for every existing runnable definition, including run ID, terminal status, output/artifact summary, and any blocker.
- Verification that no agent definition, prompt, tools, templates, visibility, or activation state changed during QA.

Evidence should be retained in a stable repo-local results directory or attached to the release artifact; it should not exist only in transient Playwright output.

## 15. Telemetry

Recommended events:

- `workspace_agents_tab_opened`
- `workspace_agent_picker_opened` with `source=banner|tab`
- `workspace_agent_selected`
- `workspace_agent_run_started`
- `workspace_agent_run_start_failed` with non-sensitive reason code
- `workspace_agent_outcome_opened`
- `workspace_agent_activity_opened`
- `workspace_agent_builder_handoff`

Never include task input, prompts, artifact contents, credentials, or raw connector data in analytics.

## 16. Release Gate

Release only when:

1. Server-side workspace eligibility and run access fail closed.
2. Real-backend browser QA passes for representative personal, workspace, organization, and system definitions.
3. All existing runnable agents have a recorded behavior result or an explicit environment/dependency blocker.
4. Screenshots and recordings confirm the expected UI states and navigation.
5. No existing agent definitions were mutated by the implementation or QA pass.
6. Agent Studio's current catalog, builder, editor, teaching, activity, outcomes, approvals, and artifact flows remain green.

## 17. Open Decisions Before Implementation

1. Whether `Run agent` should be the only visible banner action or share space with another primary workspace action.
2. Whether the first Agents-tab run list includes a `Started by me` filter or waits for observed demand.
3. Whether connector-blocked agents remain in the main list with a readiness badge or move to a separate `Needs setup` section.
4. Whether builder handoff returns automatically after deployment or presents explicit `Open agent` and `Return to workspace` choices. Recommended: explicit choices.
5. Whether the Agents tab initially ships for both `workspace` and legal `matter` records or only records the product labels as workspaces. Recommended: use the existing canonical `matter_id` boundary for both and keep user-facing copy workspace-neutral where necessary.
