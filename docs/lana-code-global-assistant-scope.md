# LANA Code Global Assistant Scope

> TODO(deprecation): This scope predates the dock-first chat cleanup. References
> to `chat-v2.html`, `conversation-threads`, and legacy chat/session routing are
> stale and should be reconciled with the canonical `/api/v1/conversations`
> topology before this is used for implementation.

## Summary

LANA Code is a global assistant surface inside the LANA desktop/web shell. It opens from the top navigation using the approved LANA app icon and provides a persistent assistant panel with a transcript area and composer footer.

The surface is intended for global command and control: navigation, creation workflows, operational questions, page-aware help, and agentic work that is not already scoped to a specific matter or workspace. It should not replace matter/workspace chat. When the user asks about a specific matter or workspace, LANA Code should hand the user off to the scoped chat for that entity.

This scope covers the client shell, chat/session behavior, page-context model, embedded-app context model, backend contracts, tool/entity manifest, role-type scoping, security boundaries, and implementation phases.

## Product Goals

- Add a global LANA Code icon to the app topbar.
- Open a Claude Code-style right-side assistant panel with conversation history and a composer.
- Support global assistant conversations that are not attached to matters.
- Allow the assistant to use the current page as context when the user includes it.
- Allow global commands such as "create a matter", "create a workspace", "create a task", "open Legal NSights", or "show me recent updates".
- Show a handoff card when the conversation belongs in a specific matter/workspace chat.
- Expose a role-aware catalog of assistant-visible entities, tools, connectors, capabilities, and context providers.
- Keep embedded partner apps safe by exposing only approved context/capabilities through strict contracts.

## Non-Goals

- Do not show the global assistant on `chat-v2.html`.
- Do not let LANA Code silently become a matter/workspace chat.
- Do not introspect cross-origin embedded app iframes directly.
- Do not expose arbitrary MCP endpoints, partner APIs, local IPC, tokens, cookies, localStorage, or raw DOM to the model.
- Do not let the client decide authorization. The backend must authorize every tool call.
- Do not make a generic "run any API endpoint" assistant.

## UX Scope

### Topbar Entry Point

Add the approved black rounded LANA app icon with white corner marks to the Lex topbar, near Refresh, Notifications, and Settings.

Recommended client contract:

- `lex-topbar` renders an icon-only assistant button when enabled.
- The button emits `topbar-assistant-click`.
- `lex-app` listens for that event and opens/closes the singleton global assistant panel.
- `chat-v2.html` disables this button explicitly.

Topbar acceptance rules:

- The button has an accessible name and tooltip, for example `LANA Code`.
- The button exposes active/open state to assistive tech.
- The button is keyboard reachable in the normal topbar tab order.
- The button must not shift the Refresh, Notifications, or Settings controls.
- The button must not render when the server manifest or kill switch disables LANA Code.

### Panel

The panel should be shell-owned and persistent across app navigation where the shell persists.

Recommended behavior:

- Right-side panel on desktop.
- Full-screen or near-full-width sheet on small screens.
- Header with `LANA Code`, close button, and current context chip.
- Thread/conversation area.
- Composer in the footer.
- Include-current-page toggle or chip.
- Action proposal cards for writes.
- Matter/workspace handoff cards.

Panel acceptance rules:

- Focus moves into the panel on open and returns to the topbar button on close.
- `Escape` closes the panel when no nested modal/action confirmation owns focus.
- On mobile, the panel controls body scroll and behaves as the primary foreground surface.
- The panel defines z-index behavior relative to notifications, settings menus, modals, drawers, and page-specific Ask LANA surfaces.
- A fast double-click or concurrent open event creates only one panel.
- Panel open state should not persist across full app reloads unless explicitly approved later.

### Matter/Workspace Handoff

If the user asks about a specific matter or workspace, LANA Code should avoid continuing deeply in the global thread.

Expected response:

- Detect or resolve the target matter/workspace.
- Show a card explaining that the conversation belongs in the scoped chat.
- Include a primary button:
  - `Open Matter Chat`
  - `Open Workspace Chat`
- The button navigates to the scoped chat with the correct entity id.
- The global thread may keep a lightweight note that a handoff occurred, but the substantive conversation belongs to the scoped chat.

Policy:

- General questions can remain global.
- Specific privileged entity discussion moves to scoped chat.
- If the user lacks access to the entity, the assistant must not reveal entity details.
- Candidate resolution must be backend-authorized.
- Multiple authorized matches require a disambiguation card.
- Unauthorized and not-found cases should be indistinguishable unless the user already has authorized visibility into that entity.
- Partial names must not leak unauthorized matter/workspace names.
- Stale page context pointing at a matter/workspace may only be used as a handoff hint.
- Scoped chat must reauthorize the entity when opened.
- Prefer short-lived `handoff_id` values over raw entity ids in client-generated navigation.

Recommended endpoint:

```http
POST /api/v1/lana-code/handoffs/resolve
```

This endpoint returns only authorized candidates, or a generic no-result response that does not confirm unauthorized entity existence.

## Existing Client Surface

Relevant existing pieces:

- `src/js/lex/components/layout/lex-topbar.js`
  - Owns right-side topbar actions.
  - Should expose the assistant button/event.
- `src/js/lex/components/layout/lex-app.js`
  - Owns app shell lifecycle.
  - Should own the singleton global assistant panel.
- `src/js/lex/components/chat/lex-lana-panel.js`
  - Existing page-scoped assistant panel.
  - Useful as a reference and reusable component source, but not sufficient as the final global assistant contract.
- `src/js/lex/chat/lex-chat.source.js`
  - Existing SSE chat source.
  - Supports streaming and chat events.
- `src/js/lex/chat/lex-chat.composer.js`
  - Composer UI and tool selector behavior.
- `src/js/lex/chat/lex-chat.threads.js`
  - Existing page-scoped thread registry UI.
- `src/js/embed-host.js`
  - Secure embedded app iframe host.
  - Should register only safe embedded app context unless a formal bridge exists.
- `src/js/app-catalog.js`
  - Catalog of local app surfaces and embedded app normalization.
- `electron-preload.js`
  - Exposes desktop APIs and capabilities.
  - Must not become a generic LANA Code tool runner.

## Frontend Architecture

### Shell Ownership

LANA Code should be owned by the Lex shell, not individual page templates.

Recommended components:

- `lex-topbar`
  - Adds assistant button.
  - Emits open/toggle event.
- `lex-app`
  - Owns lifecycle.
  - Lazy-loads dependencies if needed.
  - Creates one global assistant panel.
  - Tracks open/closed state.
  - Suppresses assistant on `chat-v2.html`.
- `lex-global-lana-panel`
  - New wrapper component for this surface.
  - Reuses chat primitives internally.
  - Controls global scope, context capture, thread filtering, and action cards.
- `LanaPageContext`
  - New client registry for current-page context providers.

Ownership boundary:

- `lex-global-lana-panel` owns global scope, thread source, page-context capture, action card handling, suppression behavior, and current manifest state.
- Existing page-scoped assistant components may be used as references, but the global panel must not inherit their `matter_id`, `workspace_id`, page-scoped registry behavior, or page-owned `lex-lana-before-send` mutations.
- Shared pieces should be stateless rendering/composer/SSE primitives behind explicit props or adapters.
- Page scripts cannot directly mutate the global assistant request payload.

### Dependency Loading

Some pages currently load chat components explicitly while shell pages do not. The global assistant should avoid requiring every page to add a long script stack.

Preferred approach:

- Add a shell-owned lazy loader for global assistant dependencies.
- Load once on first open.
- Avoid duplicate custom element registration.
- Keep page-specific assistant drawers and the global assistant from colliding.

Loader contract:

- `lex-app` exposes an idempotent `ensureGlobalAssistantLoaded()` path.
- The loader owns script/CSS order and waits on `customElements.whenDefined()` for required components.
- The loader checks `customElements.get()` before registering/loading duplicate elements.
- Concurrent open requests share the same pending load promise.
- Load failure renders a small recoverable error state and does not leave a half-open panel.
- If page-specific chat scripts are already loaded, the loader no-ops for those dependencies.

### Suppression Rule

Do not show LANA Code on `chat-v2.html`.

Implementation options:

- Preferred: page config flag, for example `assistant="false"` or route metadata.
- Acceptable first pass: explicit route denylist for `chat-v2.html`.

Hard invariant:

- Suppression is enforced in both `lex-topbar` and `lex-app`.
- Entering `chat-v2.html` closes/unmounts the global panel.
- Entering `chat-v2.html` cancels active global LANA Code streams or asks the user to stop them before navigation, depending on the streaming policy.
- `topbar-assistant-click`, hotkeys, retained shell state, lazy-loader completion, and browser back/forward must not reopen the panel on `chat-v2.html`.
- Direct panel creation attempts are ignored while the active route suppresses LANA Code.

## Conversation Model

LANA Code conversations are global assistant threads.

Recommended backend-backed fields:

- `thread_scope: "global"`
- `page_scope: "lana_code"`
- `context_type: "lana_code"`
- `matter_id: null`
- `workspace_id: null`

Important distinction:

- `matter_id: null` is not a permission model.
- The backend must explicitly recognize and authorize the global LANA Code scope.
- Global threads must satisfy `thread_scope: "global"`, `page_scope: "lana_code"`, `context_type: "lana_code"`, `matter_id: null`, and `workspace_id: null`.
- Global threads must not appear in matter/workspace chat menus unless explicitly requested by a dedicated global conversation picker.
- Matter/workspace scoped threads must never be returned by LANA Code list/load/update/delete operations.

Thread operations needed:

- List LANA Code conversations.
- Create a global LANA Code conversation.
- Load a LANA Code transcript.
- Rename thread.
- Pin/unpin thread.
- Archive/delete thread.
- Stop active generation using the correct generation/thread identifier.

## Page Context Model

LANA Code can include the current page as context, but the context must be explicit, bounded, redacted, and untrusted.

### Client Registry

Add a client-side context provider registry:

```js
window.LanaPageContext.register({
  pageId: 'dashboard',
  getContext: async function () {
    return {
      title: document.title,
      route: location.pathname,
      selectedText: window.getSelection().toString(),
      resourceRefs: []
    };
  }
});
```

The global panel asks the registry for context when the user sends a message with current-page context enabled.

Registry contract:

- `register(provider)` returns an unregister function.
- Providers include `provider_id`, `source`, `schema_version`, and a route predicate.
- The shell validates provider identity and allowlists providers per route/surface.
- Only one active provider is used per route unless the shell explicitly merges approved providers.
- Duplicate provider ids replace only the same source and route; otherwise they are rejected.
- Providers are invalidated on navigation, iframe navigation, logout, org/server switch, and shell teardown.
- Context capture has a timeout and fail-closed fallback.
- Provider output is schema-validated and sanitized by the shell before it reaches streaming.
- Selected text and summaries have maximum lengths.
- Embedded host metadata should be a distinct provider class from first-party page providers.
- Provider output may not include executable instructions, secrets, unauthorized entity fields, raw HTML, or arbitrary tool definitions.

### Context Snapshot

Recommended request shape:

```json
{
  "context_type": "lana_code",
  "thread_scope": "global",
  "conversation_id": "conversation_id",
  "client_request_id": "uuid",
  "message": "Create a workspace for the Acme onboarding project",
  "context_snapshot": {
    "protocol_version": "lana-code-context.v1",
    "context_snapshot_id": "uuid",
    "captured_at": "2026-07-26T00:00:00.000Z",
    "untrusted": true,
    "page": {
      "route": "dashboard.html",
      "title": "Dashboard",
      "page_scope": "dashboard",
      "matter_id": null,
      "workspace_id": null
    },
    "embedded_app": null,
    "visible_state": {
      "summary": "",
      "selected_text": "",
      "resource_refs": []
    },
    "redactions": []
  }
}
```

### Context Rules

- Capture fresh context per send.
- Do not reuse stale context after navigation.
- Do not send raw DOM.
- Do not send full HTML.
- Do not send localStorage.
- Do not send cookies.
- Do not send bearer tokens.
- Do not send partner session JWTs.
- Do not send iframe URLs with session tokens.
- Mark current-page context as `untrusted: true`.
- Use size limits and schema validation.
- Treat `matter_id`, `workspace_id`, `resource_refs`, and `app_context_refs` as hints only, never authority.
- Resource refs must be opaque, backend-minted or backend-resolved, tenant-scoped, type-scoped, TTL-scoped, and re-authorized before model or tool use.
- On matter/workspace pages, global context is limited to route metadata and authorized handoff refs; it must not include substantive matter/workspace content, document excerpts, comments, tasks, or private fields.
- The backend should reject global snapshots that contain matter/workspace content beyond handoff metadata.
- Store only redacted snapshots, ids, or digests where possible.

## Embedded App Scope

Embedded app support should be phased.

### Phase 1: Host Metadata Only

For embedded apps, LANA Code can know:

- app id
- app label
- approved origin
- shell route
- generic page title
- resource refs provided by Lana, if any

It cannot inspect the iframe DOM directly.

### Phase 2: Partner Context Bridge

Add an optional postMessage bridge only for approved partner apps.

Requirements:

- Exact `targetOrigin`.
- Exact `event.origin`.
- `event.source === iframe.contentWindow`.
- Shell-initiated request/response message types.
- Request ids tied to the active iframe and route.
- Nonce/session binding.
- Nonce expiry and replay rejection.
- Iframe navigation invalidates outstanding requests.
- Approved origin is revalidated after iframe navigation.
- Capability-specific user/org consent.
- Context minimization.
- Schema validation.
- Size limits.
- Timeout.
- Iframe sandbox/CSP constraints remain enforced.
- No tokens.
- No cookies.
- No arbitrary URLs.
- No partner-provided system instructions.
- Partner context is always untrusted model input.

### Phase 3: Partner Tools / MCP

Partner tools and MCP should be brokered by the backend.

Rules:

- The iframe cannot provide arbitrary endpoints directly to the model.
- The backend discovers/validates partner capabilities.
- The backend checks user, org, app, origin, entitlement, and role permissions.
- Tool execution is audited.
- High-risk actions require approval.
- Partner/MCP servers come from an allowlisted registry.
- Tool schemas are static or reviewed before being exposed to the model.
- Partner-defined dynamic tools are not exposed directly to the model.
- OAuth and partner tokens remain in a backend vault.
- Backend egress is allowlisted and rate-limited.
- Partner tool results are tainted as untrusted data and cannot become instructions.
- Partner tool results are redacted before streaming, logging, auditing, or model reuse.

Possible backend endpoints:

- `GET /api/v1/partner-apps/:id/tools`
- `POST /api/v1/partner-apps/:id/tools/:tool/call`
- Or a backend MCP proxy with equivalent authorization and auditing.

## Capability Manifest

LANA Code needs a backend-generated capability manifest. This manifest is the source of truth for what the assistant can see, suggest, and execute for the current user.

Recommended endpoint:

```http
GET /api/v1/lana-code/capability-manifest
```

Recommended response:

```json
{
  "schema_version": "lana-code-capability-manifest.v1",
  "manifest_version": "manifest_version",
  "generated_at": "2026-07-26T00:00:00.000Z",
  "expires_at": "2026-07-26T00:05:00.000Z",
  "etag": "opaque_etag",
  "policy_version": "policy_version",
  "org_entitlement_version": "entitlement_version",
  "user": {
    "id": "user_id",
    "organization_id": "org_id",
    "role_ids": [],
    "role_types": [],
    "permissions": []
  },
  "scopes": {
    "global": true,
    "matter": true,
    "workspace": true,
    "admin": false,
    "embedded_app": true,
    "local_device": true
  },
  "entities": [],
  "tools": [],
  "connectors": [],
  "context_providers": [],
  "approval_policy": {},
  "handoff_rules": {
    "matter_specific_discussion": "open_scoped_chat",
    "workspace_specific_discussion": "open_scoped_chat"
  }
}
```

### Visibility vs Execution

Visibility is not execution permission.

The manifest can describe a tool as visible, unavailable, available with approval, or hidden. The backend must still authorize every action at execution time.

Authorization layers:

1. Catalog visibility.
2. Assistant proposal permission.
3. User approval requirement.
4. Backend execution permission.
5. Audit and idempotency enforcement.

Manifest minimization:

- Separate UI manifest fields from model tool manifest fields.
- Do not reveal hidden tools, hidden admin capabilities, or raw internal permission names unless needed for UI explanation.
- Include `unavailable_reason` only when the user is allowed to know why a tool is unavailable.
- Manifest cache is informational only and never authorizes execution.
- Refresh the manifest on role, org, entitlement, server, session, or device-capability changes.

Tool entries should include versioned input/output schemas and explicit semantics for:

- `visible`
- `hidden`
- `proposable`
- `executable`
- `requires_approval`
- `unavailable_reason`
- `risk`
- `sensitivity`
- `approval_policy_id`

## Role-Type Scoping

LANA Code must be role-type aware.

Role type examples:

- `owner`
- `admin`
- `attorney`
- `paralegal`
- `staff`
- `finance`
- `external`
- `viewer`

The final values should come from the backend RBAC model, not the client.

### Role Scoping Rules

- The backend derives role types from authenticated user state.
- The client can display role-derived availability, but cannot assert roles.
- The assistant may only propose tools allowed for the user's role type.
- The backend must re-check permissions when executing.
- A role may see a tool but not execute it.
- A role may execute a tool only with approval.
- A low-sensitivity read-only tool may execute without approval; sensitive reads can require approval or stronger policy.
- Admin/system tools should be hidden unless explicitly allowed.
- Matter/workspace tools must also check entity access.
- Org role, matter role, workspace role, group-derived permissions, deny rules, external/viewer constraints, and field-level permissions all participate in authorization.
- Deny rules take precedence over broad role-type allows.
- `allowed_role_types` is never sufficient without resource authorization.

Risk/sensitivity taxonomy:

- `public_metadata`
- `tenant_internal`
- `privileged_entity`
- `secret_bearing`
- `external_egress`
- `admin_audit`

Sensitive reads include audit logs, traces, connector records, documents, comments, privileged matter/workspace metadata, cross-entity search, exports, and external transfers.

### Tool Manifest Example

```json
{
  "id": "create_matter",
  "label": "Create Matter",
  "description": "Create a new client matter.",
  "entity": "matter",
  "operation": "create",
  "scope": "global",
  "risk": "write",
  "visible": true,
  "proposable": true,
  "executable": true,
  "requires_approval": true,
  "allowed_role_types": ["owner", "admin", "attorney"],
  "required_permissions": ["matters:create"],
  "handoff_required": false
}
```

### Entity Access Example

```json
{
  "id": "open_matter_chat",
  "label": "Open Matter Chat",
  "entity": "matter",
  "operation": "open_scoped_chat",
  "scope": "matter",
  "risk": "navigation",
  "requires_approval": false,
  "required_permissions": ["matters:read"],
  "resource_authorization": "required"
}
```

## Entities To Catalog

Initial entity catalog:

- User
- Role
- Permission
- Group
- Organization
- Matter
- Workspace
- Task
- Contact
- Comment
- Document
- File
- Storage object
- Chat session
- Conversation thread
- Notification
- Audit log
- Trace
- Dashboard widget
- Metric
- Metric catalog entry
- Metric goal
- BI dashboard
- Resource share
- Mention
- Plugin
- System update
- Health service
- Partner embedded app
- Desktop capability
- Brainchild note
- VPN/device session
- Connector data record
- Pending connector match

Each entity definition should include:

- `entity_type`
- canonical id
- label
- description
- readable fields
- writable fields
- searchable fields
- field sensitivity
- field-level permissions
- supported operations
- resource ref schema
- relationship constraints
- disclosure rules for search/list results
- required permissions
- role-type visibility
- retention/audit behavior
- whether entity-specific chat handoff is required

## Tools To Catalog

### Navigation Tools

- Open dashboard.
- Open settings.
- Open matter.
- Open workspace.
- Open matter chat.
- Open workspace chat.
- Open embedded app.
- Open reporting page.

### Conversation Tools

- Create LANA Code conversation.
- List LANA Code conversations.
- Rename conversation.
- Pin/unpin conversation.
- Archive conversation.
- Stop active generation.

### Matter/Workspace Tools

- Search matters.
- Create matter.
- Update matter.
- Archive/unarchive matter.
- Pin/unpin matter.
- Share matter.
- Create workspace.
- Link workspace and matter.
- Open scoped chat.

### Task Tools

- List tasks.
- Create task.
- Update task.
- Complete task.
- Delete task.

### Contact Tools

- Search contacts.
- Create contact.
- Link contact to matter.
- Unlink contact from matter.

### Document/File Tools

- Search documents.
- Upload document.
- Attach file to chat.
- Detach file from chat.
- Trigger document processing.
- View processing status.
- Delete document.

### Comment/Collaboration Tools

- Read comments.
- Create comment.
- Reply to comment.
- Update comment.
- Delete comment.
- Pin/unpin comment.
- Mention user.

### Reporting/Analytics Tools

- Read dashboard widgets.
- Create/update/delete dashboard widget.
- Read metric catalog.
- Read metric details.
- Read metric usage.
- Upsert metric goal.
- List BI dashboards.
- Create/update/delete BI dashboard.
- Pin/unpin BI dashboard.

### Admin Tools

Admin tools should be role-restricted and approval-gated.

- Manage users.
- Activate/deactivate users.
- Reset user password.
- Manage roles.
- Manage permissions.
- Manage groups.
- Read audit logs.
- Query audit logs.
- Export audit logs.
- Read traces.
- Read health summary/services/metrics.
- Apply system update.
- Manage plugins.
- Manage resource shares.

### Connector / Partner Tools

- List enabled apps.
- Open embedded app.
- Get app context metadata.
- Request partner context.
- List partner tools.
- Call partner tool through backend broker.
- Read connector data for a matter.
- Search connector data for linking.
- Link connector data to matter.
- Approve/decline pending connector match.

### Desktop Capability Tools

These must stay narrow and main-process mediated.

- List enabled desktop capabilities.
- Toggle optional capability.
- Get voice settings.
- Set voice settings.
- Get voice permissions.
- Request voice permission.
- Brainchild discover/link/status.
- Brainchild list/search/read notes.
- Session tracking status.
- VPN/device status where allowed.

The generic `electronAPI.invoke(channel, ...)` must not be exposed to LANA Code as a tool.

Each tool definition should include:

- `operation_id`
- `entity_type`
- `input_schema`
- `output_schema`
- `resource_ref_schema`
- `field_permissions`
- `sensitivity`
- `side_effects`
- `approval_policy_id`
- `audit_event_type`
- tool version
- owner service
- whether tool output is trusted or tainted

## Backend Contracts

### Capability Manifest

```http
GET /api/v1/lana-code/capability-manifest
```

Backend responsibilities:

- Derive user/org/role from auth token.
- Include role types and permissions.
- Include only org-enabled tools/connectors/capabilities.
- Include tool risk and approval requirements.
- Include entity definitions relevant to the user.
- Include embedded app capabilities only if authorized.
- Include `schema_version`, `manifest_version`, `generated_at`, `expires_at`, `etag`, `policy_version`, and `org_entitlement_version`.
- Include per-tool input/output schemas and tool versions.
- Minimize policy details exposed to the client/model.
- Treat client-cached manifests as display state only.

### Global Threads

```http
GET /api/v1/conversation-threads?page_scope=lana_code&thread_scope=global
POST /api/v1/conversation-threads
GET /api/v1/conversation-threads/:id
PUT /api/v1/conversation-threads/:id
DELETE /api/v1/conversation-threads/:id
POST /api/v1/conversation-threads/:id/pin
POST /api/v1/conversation-threads/:id/unpin
```

Backend must add `lana_code` to the valid page scopes and context types.

Backend must enforce the global-thread invariant on create, list, load, update, delete, pin, unpin, and stop-generation:

- `thread_scope: "global"`
- `page_scope: "lana_code"`
- `context_type: "lana_code"`
- `matter_id: null`
- `workspace_id: null`

Operations against matter/workspace threads through the LANA Code path should return `404` or a generic authorization failure. They must not reveal the existence of scoped threads.

### Streaming

Either add:

```http
POST /api/v1/lana-code/stream
```

Or use a strict mode on:

```http
POST /api/v1/streaming/chat/stream
```

Required additions:

- `context_type: "lana_code"`
- `thread_scope: "global"`
- `context_snapshot` or `context_snapshot_id`
- `allowed_actions`
- `app_context_refs`
- `client_request_id`

Streaming authorization rules:

- `allowed_actions` is a user/UI narrowing hint only.
- The backend intersects `allowed_actions` with the authenticated capability manifest.
- The backend returns accepted/rejected action state without treating the client list as authority.
- `app_context_refs`, `resource_refs`, `matter_id`, and `workspace_id` are hints only until backend-resolved and authorized.
- The backend rejects stale, unauthorized, malformed, cross-tenant, or wrong-type refs before model/tool use.
- The backend redacts request, context, and tool data before model input, SSE events, logs, telemetry, traces, audit records, crash reports, and error responses.
- Streamed reasoning/status must be user-safe status text, not hidden chain-of-thought, raw policy internals, or sensitive denial details.

### Page Context Snapshot

Optional but recommended:

```http
POST /api/v1/page-context/snapshots
```

Snapshot rules:

- TTL-scoped.
- Bounded size.
- Explicitly untrusted.
- Non-memory by default.
- Redacted before model use.
- Audited by id, not raw content where possible.
- Must not persist into memory, summarization, or long-term conversation state unless the user explicitly attaches/saves it.
- Excluded from scoped chat memory unless handed off and reauthorized there.
- Removed or invalidated after navigation, thread archive/delete, logout, org/server switch, or expiry.
- Stores only digest/redacted content where possible.

### Handoff Resolution

```http
POST /api/v1/lana-code/handoffs/resolve
```

Resolution requirements:

- Accepts natural-language target text and optional context hints.
- Resolves only entities the authenticated user may see.
- Returns authorized candidates or a generic no-result response.
- Does not confirm unauthorized entity existence.
- May return a short-lived `handoff_id` instead of raw entity ids.
- Scoped chat reauthorizes when opened.
- Repeated probing or denied resolution attempts are audited.

### Action Proposal / Execution

Recommended pattern:

```http
POST /api/v1/lana-code/actions/propose
POST /api/v1/lana-code/actions/:proposal_id/approve
POST /api/v1/lana-code/actions/:proposal_id/execute
```

Action requirements:

- Backend owns conflict checks.
- Backend owns entity permission checks.
- Backend owns idempotency.
- Backend owns audit logging.
- User approves writes before execution.
- Proposal payloads are immutable once created.
- Approval binds to the exact canonical server-side action payload.
- Execution uses only the stored approved payload; it must reject mutated client/model args.
- Backend reauthorizes immediately before execution.
- Denied proposals and denied executions are audited.

Required proposal state machine:

- `proposed`
- `approved`
- `executing`
- `succeeded`
- `failed`
- `expired`
- `cancelled`
- `declined`

Proposal records include:

- `proposal_id`
- `proposal_version`
- immutable normalized payload hash
- action/tool id and version
- risk/sensitivity label
- affected resource refs
- user-visible summary and diff
- `thread_id`
- `context_snapshot_id`
- `manifest_version`
- `created_by`
- `approved_by`
- `executed_by`
- `expires_at`
- nonce
- idempotency key
- current status

Idempotency contract:

- Propose and execute use an `Idempotency-Key` header or `client_request_id`.
- Key scope is user, org, tool/action id, and normalized payload.
- Replays within TTL return the original proposal/execution result.
- Concurrent execution of the same approved proposal is serialized.
- Reusing the same key with a different normalized payload returns `409`.

Action card fields:

- proposal id and version
- action type
- risk/sensitivity level
- human-readable summary and diff
- target entity refs
- required approval label
- expiry/stale state
- cancel/decline path
- execution idempotency key
- success/error rendering contract
- behavior when permissions change after proposal

## SSE Event Scope

Existing supported events are enough for much of the first pass:

- `connected`
- `thinking`
- `status`
- `reasoning`
- `progress`
- `tool_start`
- `tool_progress`
- `tool_end`
- `content`
- `message`
- `citations`
- `context_usage`
- `agentic_progress`
- `plan_ready`
- `agentic_followup`
- `agentic_complete`
- `agentic_error`
- `agentic_blocked`
- `agentic_artifacts`
- `title`
- `done`
- `error`

Recommended additions:

- `context_snapshot_accepted`
- `context_snapshot_rejected`
- `action_proposed`
- `action_progress`
- `action_result`
- `navigation_suggested`
- `handoff_required`
- `app_context_progress`

SSE payload rules:

- Event schemas must be explicit and versioned.
- No event may stream bearer tokens, partner JWTs, cookies, signed URLs, raw iframe URLs, raw tool args containing secrets, partner payloads, full sensitive document excerpts, or sensitive denial rationale.
- `reasoning` means user-safe progress/status text only.
- Tool and artifact events must carry redacted summaries or authorized resource refs, not raw secret-bearing payloads.

## Security Requirements

### General

- Server derives identity from auth only.
- Server ignores client-supplied user/org/role identity.
- Server authorizes every resource ref.
- Server authorizes every tool call.
- Server audits writes, approvals, denials, sensitive reads, partner calls, desktop capability calls, handoffs, manifest generation, and context snapshot decisions.
- Client does not expose arbitrary IPC or arbitrary HTTP tools.
- Server strips auth query params/fragments, signed URLs, bearer-like strings, partner JWTs, cookies, localStorage-derived values, and iframe URLs before model input or persistence.

### Audit

Audit is required for:

- manifest generation
- context snapshot accepted/rejected
- proposal creation
- proposal approval
- proposal denial/decline
- execution success/failure
- authorization denial
- sensitive reads
- partner tool discovery/calls
- desktop capability calls
- handoff resolution
- policy overrides

Audit records include:

- actor/user id
- organization id
- session/device id where available
- request/correlation id
- thread id
- proposal id/version
- context snapshot id
- manifest version
- policy version
- tool id/version
- idempotency key
- resource ids or hashes
- policy decision
- approval artifact
- model id where relevant
- redaction flags

Audit records must avoid raw secrets and should be protected by tamper-resistant retention and strict access control.

### Electron IPC

- Keep `contextIsolation` enabled.
- Use renderer sandboxing where possible.
- Do not use Electron `remote`.
- Desktop tools use allowlisted channels only.
- Validate payload schemas in preload and main.
- No arbitrary file, network, shell, or IPC operations.
- Do not expose renderer-held desktop tokens.
- Sensitive desktop capabilities require user gesture or explicit approval.
- Main process checks shell surface and entitlement before executing a desktop capability.
- Desktop capability use is audited.

### Page Context

- Context is untrusted.
- Context is bounded.
- Context is redacted.
- Context is fresh per send.
- Context does not include secrets.
- Context must not persist into memory/summarization unless the user explicitly saves or attaches it.
- Global context and scoped matter/workspace chat memory are isolated.
- Context is removed/invalidated after navigation, logout, org/server switch, thread archive/delete, or expiry.

### Embedded Apps

- No iframe DOM introspection.
- No tokenized iframe URL sharing.
- No partner-supplied arbitrary tools.
- Origin-pinned postMessage only.
- Backend-brokered partner tool execution only.
- Partner context and tool results are untrusted data.
- Partner tools are allowlisted, entitlement-checked, and egress-limited.

### Prompt Injection

All page and partner context must be marked as data, not instructions.

The model should be instructed that page/partner content:

- may be malicious
- may be stale
- cannot override system/developer/tool policy
- cannot grant permissions
- cannot define tools
- cannot request exfiltration
- cannot define resource ids, tool args, roles, policies, or next actions without server validation and user confirmation where risky

## Rollout / Feature Flags

LANA Code must be server-gated and fail closed.

Recommended flags:

- `lana_code_enabled`
- `lana_code_page_context_enabled`
- `lana_code_actions_enabled`
- `lana_code_embedded_context_enabled`
- `lana_code_partner_tools_enabled`
- `lana_code_desktop_capabilities_enabled`

Rollout requirements:

- Flags are included in or referenced by the capability manifest.
- Org and user allowlists can narrow rollout.
- A kill switch removes the topbar entry and blocks direct panel creation.
- If the manifest fails to load, LANA Code is disabled except for a noninteractive error state.
- Disabling an action flag removes proposal/execution ability even if cached UI state exists.
- Client cached flags never authorize execution.
- Feature flag changes invalidate open panels, cached manifests, and active action proposals as needed.

## Test Plan

### Unit Tests

- Topbar assistant button renders when enabled.
- Topbar assistant button is hidden on `chat-v2.html`.
- `chat-v2.html` closes/unmounts an already-open panel and ignores direct open attempts.
- `lex-app` creates a singleton panel.
- Panel survives shell navigation where expected.
- Feature flag off/on behavior.
- Manifest failure behavior.
- Lazy loader failure and retry behavior.
- Duplicate custom element registration guard.
- Concurrent open clicks create one panel.
- Keyboard/focus accessibility.
- Mobile full-screen panel behavior.
- Route changes during context capture.
- Page context registry captures fresh context per send.
- Context redaction strips tokens, auth params, localStorage-derived values, and unsafe URLs.
- Context provider allowlisting rejects unknown providers.
- Matter/workspace intent produces a handoff card.
- Handoff button navigates to scoped chat.
- Global panel does not inherit matter id silently.
- Tool manifest filters by role type.
- Tool execution still calls backend authorization.

### Embedded App Tests

- Wrong origin postMessage is rejected.
- Wrong iframe source is rejected.
- Missing/stale nonce is rejected.
- Oversized context is rejected.
- Tokenized URLs are rejected.
- Partner-provided arbitrary tool endpoint is rejected.
- Replayed partner context response is rejected.
- Iframe navigation invalidates outstanding context requests.

### Backend Contract Tests

- `lana_code` page scope can create/list/load/rename/delete threads.
- Generic conversation-thread endpoints enforce `thread_scope: "global"` and `page_scope: "lana_code"` for LANA Code operations.
- Global threads are separated from matter/workspace threads.
- User without matter access cannot handoff/open that matter.
- Unauthorized/not-found handoff responses are indistinguishable.
- Role without permission cannot propose restricted action.
- Role without permission cannot execute restricted action even if client submits it.
- Write actions require approval and idempotency key.
- Approved execution rejects mutated payloads.
- Proposal lifecycle follows the required state machine.
- Reusing an idempotency key with a different payload returns `409`.
- Sensitive reads and denied attempts are audited.
- Context snapshots with unauthorized refs are rejected before model/tool use.
- Audit records include action/user/org/context/proposal ids but not secrets.

### E2E Tests

- Open global assistant from dashboard.
- Send a general question.
- Include current page as context.
- Ask to create a workspace and approve proposal.
- Ask about a specific matter and receive handoff.
- Open scoped matter chat from handoff card.
- Confirm assistant icon is not present on `chat-v2.html`.
- Navigate into `chat-v2.html` with the panel already open and confirm it closes.
- Open embedded app and confirm only safe metadata is available in phase 1.
- Stop/cancel active SSE stream from the global panel.
- Change feature flags/manifests and confirm stale panel state is invalidated.

## Implementation Phases

### Phase 0: Backend Alignment

- Confirm role type vocabulary.
- Confirm `lana_code` scope/context naming.
- Confirm global thread behavior.
- Confirm action proposal/approval API.
- Confirm capability manifest schema.
- Confirm rollout flags and kill-switch behavior.
- Confirm audit event taxonomy.

### Phase 1: Shell and UI

- Add topbar assistant button.
- Add `lex-app` singleton panel lifecycle.
- Add `lex-global-lana-panel`.
- Suppress assistant on `chat-v2.html`.
- Reuse existing chat composer/thread components.
- Add basic global conversations.

### Phase 2: Capability Manifest

- Add backend manifest endpoint.
- Render visible tools/entities/connectors in panel.
- Filter by role type and permissions.
- Add tests for role-based visibility.

### Phase 3: Page Context

- Add `LanaPageContext` registry.
- Add current-page context chip/toggle.
- Add snapshot payload.
- Add redaction and size bounds.
- Add page providers for dashboard, settings, and embed host metadata.
- On matter/workspace pages, capture handoff metadata only unless the user is already in scoped chat.
- Reject substantive matter/workspace snapshots in the global assistant path.

### Phase 4: Handoff

- Detect matter/workspace-specific prompts.
- Resolve entity candidates through `POST /api/v1/lana-code/handoffs/resolve`.
- Show handoff card.
- Navigate to scoped chat with a backend-authorized handoff id or equivalent safe ref.
- Add access denial behavior.
- Audit denied/ambiguous probing attempts.

### Phase 5: Agentic Actions

- Add action proposal cards.
- Implement create matter.
- Implement create workspace.
- Implement create task.
- Add approval, execution, audit, and idempotency.

### Phase 6: Embedded Apps

- Phase 1 host metadata only.
- Add postMessage context bridge for approved partners.
- Add backend-brokered partner tools/MCP.
- Add origin/nonce/schema/security tests.

## Open Questions

- What are the canonical role type names in the backend?
- Should the public product name be `LANA Code`, `LANA Command`, or another label?
- Should global assistant conversations appear in the existing conversation menu or only inside the panel?
- Should current-page context be opt-in per message or sticky per conversation?
- Should users be able to explicitly attach page context to long-term conversation memory?
- What is the final scoped chat URL contract for matter/workspace handoff?
- Which action tools should ship first after create matter/workspace/task?
- Which embedded partner app should be the first bridge pilot?

## Recommended First Milestone

Ship the global shell panel first with:

- Topbar icon.
- Hidden on `chat-v2.html`.
- Global `lana_code` conversations.
- Capability manifest read/render.
- Page context chip with safe fallback context.
- Matter/workspace handoff card.

Then add create matter/workspace/task action cards with backend approval and audit.
