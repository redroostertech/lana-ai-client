# LANA Insights Chat: Thread Lifecycle

> TODO(deprecation): This document is stale. The client chat topology is now
> dock-first and should use canonical `/api/v1/conversations` resources for
> conversation/session behavior. Do not use this document as an authoritative
> implementation contract for new chat work until it is rewritten.

This document describes the legacy page-scoped LANA drawer lifecycle and the shared `conversation_threads` API. Ordinary pages now use the global `lex-lana-dock`, with page-level entry through `lex-banner lana`; do not add new page-specific Insights drawers for Dashboard, Reporting, Billable Hours, or Data Visualization.

## TL;DR

1. The drawer is one shared Lex component (`lex-lana-panel`) mounted per page.
2. Inside it, `lex-chat-threads` renders the **THREADS** section and `lex-chat` renders the message stream.
3. `conversation_threads` is the **platform thread registry API**. Non-primary chat surfaces (Insights drawer, PAC, optional apps) consume `/api/v1/conversation-threads`. The main "+ New Chat" sidebar stays on `/api/v1/chat/sessions`, which atomically inserts into both tables.
4. The user's first message in a fresh drawer creates a `page_general` thread (one per user / `page_scope` / matter) lazily, from the SSE-allocated `conversation_id`.
5. Clicking **+ New** is eager: the panel `POST`s a fresh `ad_hoc` thread, adds it to the list, and rebinds the chat to the new `conversation_id` returned by the backend. The user's next message goes to that new thread.
6. The backend auto-generates a title from the first turn (`generateAndSaveTitle`) and mirrors it into `conversation_threads.title`. The client receives the same title over SSE as `lex-chat-title-generated` and updates the visible row immediately.
7. **`page_scope` is per surface family.** The global dock currently uses `dashboard` for the app-wide page assistant. Specialized retained surfaces use their own whitelisted scope.

## Components (client)

| Layer | File | Responsibility |
|---|---|---|
| Panel (host) | `src/js/lex/components/chat/lex-lana-panel.js` | Mounts the drawer, owns thread/conversation orchestration, makes the API calls |
| Thread list UI | `src/js/lex/chat/lex-chat.threads.js` | Renders the THREADS header and items; emits UI events |
| Chat stream | `src/js/lex/chat/lex-chat.js` | Owns the active `conversationId`, opens the SSE stream, re-emits server events |
| Trigger button | `src/js/lex/components/foundation/lex-banner.js` | `lana` banner action that opens the global dock |

## Backend surface

All endpoints below live under `LANA-AI/src/services/processor/conversation-threads/`. Every route is gated by `authenticate` middleware (`Authorization: Bearer <jwt>`) and `apiRateLimiter`.

### `GET /api/v1/conversation-threads`

List threads scoped to the caller's `user_id` + `organization_id`, optionally filtered.

| Query param | Type | Default | Notes |
|---|---|---|---|
| `page_scope` | string ≤100 | none | One of the values whitelisted in `createThreadSchema` (see "Valid `page_scope` values" below). Free-form on GET, validated on POST. |
| `thread_type` | string ≤50 | none | `page_general` / `ad_hoc` / `report_run` |
| `matter_id` | string ≤255 | none | When set, only threads scoped to that matter |
| `limit` | int 1-100 | `50` | |
| `offset` | int ≥0 | `0` | |
| `sort_by` | enum | `last_activity` | `created_at` / `updated_at` / `last_activity` / `title` |
| `sort_order` | enum | `desc` | `asc` / `desc` |

Response (HTTP 200):
```json
{
  "data": [
    {
      "id": "5c7…",                       // row PK; used for PUT/DELETE/pin
      "thread_id": "29be4efc-…",          // == conversation_id used by the chat stream
      "organization_id": "108b…",
      "created_by": "5d02…",
      "parent_thread_id": null,
      "title": "Q1 utilization summary",
      "thread_type": "ad_hoc",
      "context_type": "insights_chat",
      "page_scope": "dashboard",
      "matter_id": null,
      "is_pinned": false,
      "pinned_at": null,
      "is_archived": false,
      "metadata": {},
      "created_at": "2026-05-16T13:22:00Z",
      "updated_at": "2026-05-16T13:27:00Z",
      "last_activity": "2026-05-16T13:27:00Z"
    }
  ],
  "total": 1,
  "hasMore": false
}
```

### `POST /api/v1/conversation-threads`

Create a thread eagerly. Backend allocates `thread_id` (UUID) if not provided.

Request body:
```json
{
  "title": "New Thread",                    // optional, default null
  "thread_type": "ad_hoc",                  // REQUIRED — page_general | ad_hoc | report_run
  "context_type": "insights_chat",          // default insights_chat
  "page_scope": "dashboard",                // REQUIRED — must be whitelisted
  "matter_id": null,                        // optional
  "parent_thread_id": null,                 // optional; for child threads (e.g. report_run)
  "thread_id": "29be4efc-…",                // optional; pass only when binding to an existing conversation
  "metadata": {}                            // optional
}
```

Response (HTTP 201): single thread object, same shape as the array entries from GET.

Error modes:
- `400` if `thread_type` or `page_scope` isn't in its whitelist (`conversation-threads.validators.js:11-14`).
- `500` if you pass a `thread_id` that already has a `conversation_threads` row in the same org (unique index on `(thread_id, organization_id)`).

### `GET /api/v1/conversation-threads/:id`

Fetch a single thread by row PK. Returns the same object shape. 404 if not found.

### `PUT /api/v1/conversation-threads/:id`

Update one or more of `title`, `thread_id`, `is_archived`, `metadata`. At least one must be provided.

Used by:
- Rename: `{ "title": "Q1 utilization summary" }`
- First-message rebind for `page_general`: `{ "thread_id": "<new conv id>" }` (called from `lex-lana-panel.js` after `lex-chat-conversation-created`)

### `DELETE /api/v1/conversation-threads/:id`

Soft-archive (sets `is_archived = true`). Row stays in the table; GET filters it out by default.

### `DELETE /api/v1/conversation-threads/:id/permanent`

Hard-delete the row. Not currently called from the Insights drawer.

### `POST /api/v1/conversation-threads/:id/pin` and `POST /api/v1/conversation-threads/:id/unpin`

Toggle pinning. Pin state is read both by the Insights threads list and by the main sidebar's `GET /api/v1/chat/sessions` (which does scalar subqueries against `conversation_threads`).

### `GET /api/v1/conversation-threads/:id/children`

List children of a parent thread (e.g. report runs under a `page_general` thread). Pagination same as list endpoint.

### Adjacent endpoints used by the drawer

- `POST /api/v1/streaming/sessions/:thread_id/stop` — best-effort stop of any active LLM generation. Called before `DELETE` so we don't archive a thread mid-stream.
- The chat stream itself is owned by `lex-chat-source` and connects to the SSE chat endpoint (see `LANA-AI/src/services/streaming/`). The connect/send/title flow is documented below in "Auto-title flow."

### Valid `page_scope` values

Whitelist enforced on `POST` (`conversation-threads.validators.js`):

```
reporting, firm_reporting, billable_hours, matter, workspace,
workspace_data, dashboard, data_visualization, automations, skills,
meeting_recording
```

`reporting`, `firm_reporting`, `billable_hours`, and `data_visualization` are legacy Insights thread buckets retained for compatibility. New page work should use the global dock/banner path unless a specialized assistant surface is explicitly approved.

## Thread types

| `thread_type` | When created | UX role |
|---|---|---|
| `page_general` | Auto-created lazily on the first message in a page's drawer if none exists | One per user / page_scope / matter; rendered as bold (pinned) in the list |
| `ad_hoc` | Eager on **+ New** click | Side conversations that don't overwrite the pinned thread |
| `report_run` | Programmatic — bound to a specific report execution | Linked to a parent `page_general` via `parent_thread_id` |

## Flows

### Drawer open

1. User clicks the banner **LANA** action (`<lex-banner lana>`) → `lex-lana-dock.openWith(...)`.
2. On first open, `_buildChat()` injects `<lex-chat-threads>` and `<lex-chat>`.
3. `lex-chat-threads.connected()` calls:
   ```
   GET /api/v1/conversation-threads
     ?page_scope=dashboard
     &limit=50
     &sort_by=last_activity
     &sort_order=desc
   ```
4. On response, `lex-threads-loaded { threads }` fires. The panel auto-selects the first `page_general` thread by calling `chat.loadConversation(thread.thread_id)` (which opens an SSE connection bound to that conversation).

### First message in a brand-new drawer (no existing `page_general`)

No thread row exists yet for this `page_scope`. The chat is unbound.

1. User types and presses send → `lex-chat.send()` opens an SSE stream to the chat controller.
2. Server emits `connected { threadId: <new uuid> }`. `lex-chat` stores it and re-emits `lex-chat-conversation-created { conversationId }`.
3. `lex-lana-panel` catches that event:
   - If a `page_general` row already exists for this scope: `PUT /api/v1/conversation-threads/:id` with `{ "thread_id": "<new conv id>" }` to rebind.
   - Otherwise: `POST /api/v1/conversation-threads` with `{ title: panel.threadTitle, thread_type: "page_general", context_type: "insights_chat", page_scope, thread_id: "<conv id>" }`.
4. Returned thread is `addThread`-ed and marked active.
5. Server finishes the turn and fires the auto-title flow (next section).

### "+ New" thread (eager)

User wants a fresh thread without losing the `page_general` one.

1. **+ New** click → `lex-chat-threads` emits `lex-thread-create { threadType: 'ad_hoc' }`.
2. Panel handler calls `self.createThread({ title: 'New Thread', thread_type: 'ad_hoc', context_type, page_scope })` →
   ```
   POST /api/v1/conversation-threads
   {
     "title": "New Thread",
     "thread_type": "ad_hoc",
     "context_type": "insights_chat",
     "page_scope": "dashboard"
   }
   ```
3. On 201, the new row is `addThread`-ed and `setActiveThread`-ed.
4. `chat.clearConversation()` resets the chat UI; `chat.loadConversation(thread.thread_id)` re-points the SSE source at the new conversation. Without this re-point, the next `send()` would still stream into the previously selected conversation (which was the bug that caused 500s and message leakage).
5. User sends a message → SSE `connected` fires with the new `thread_id`. `lex-chat-conversation-created` may re-emit on the panel; the handler short-circuits because the thread is already in the list (`thread.thread_id === conversationId`).
6. Server runs the turn and fires the auto-title flow.

If the user clicks **+ New** without sending, the empty `ad_hoc` row stays in the list. They can delete it from the trash icon. We accepted this trade-off for instant visual feedback.

### Auto-title

Triggered once per thread, on the first finalized turn. Same flow for main-sidebar chats and Insights drawer threads.

1. `finalizeChatSession` in `LANA-AI/src/services/streaming/controllers/chat.controller.js:1165` always passes `generateTitle: true`. No client opt-in needed.
2. The gate (`chat.controller.js:551`) checks `conversationService.getConversationTitle({ threadId, userId })`, which reads `conversations.metadata.title`. If a title is already there, generation is skipped.
3. `generateAndSaveTitle` (in `conversation.details.service.js`) produces a title (LLM with deterministic truncation fallback) and calls `conversationService.updateConversationTitle`, which now runs two updates inside one transaction-free sequence:
   ```sql
   UPDATE conversations
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{title}', $1::jsonb)
     WHERE thread_id = $2 AND user_id = $3;

   UPDATE conversation_threads
     SET title = $1, updated_at = NOW()
     WHERE thread_id = $2 AND is_archived = false;
   ```
4. Server pushes the title to the open SSE stream as an event of type `title` with payload `{ generated_title: "..." }` (`chat.controller.js:569`).
5. `lex-chat` re-emits it on the panel as `lex-chat-title-generated { title, conversationId }` (`lex-chat.js:850`).
6. `lex-lana-panel` finds the matching row in `_threadsEl._threads` by `thread_id`, mutates `title`, and calls `_scheduleUpdate()`. The THREADS row goes from "New Thread" to the generated label without a refetch.

User renames are safe — they hit `PUT /api/v1/conversation-threads/:id` and only change `conversation_threads.title`, leaving `conversations.metadata.title` untouched. Subsequent generation passes see the existing-title gate and skip.

### Thread selection

1. User clicks a row → `lex-chat-threads` emits `lex-thread-select { thread }`.
2. Panel calls `chat.clearConversation()` then `chat.loadConversation(thread.thread_id)`.
3. `lex-chat` issues `GET /api/v1/chat/sessions/:thread_id/messages?page=1&limit=50&order=desc` to load history, then opens an SSE connection bound to that `thread_id`.

### Thread deletion

1. User clicks the trash icon → `lex-chat-threads._deleteThread(id)`.
2. Best-effort stop: `POST /api/v1/streaming/sessions/:thread_id/stop` (fire-and-forget; safe to fail if no active stream).
3. `DELETE /api/v1/conversation-threads/:id` (soft-archive).
4. Row is removed from the local list. If it was the active thread, `lex-thread-delete { threadId }` fires so the panel can reset the chat to an empty state.

## Events

Emitted by `lex-chat-threads` (DOM events bubbling up to the panel):
- `lex-thread-select { thread }`
- `lex-thread-create { threadType }`
- `lex-thread-delete { threadId }` (only when the active thread is deleted)
- `lex-threads-loaded { threads }`

Emitted by `lex-chat`:
- `lex-chat-conversation-created { conversationId }` — fired when SSE `connected` returns a new `thread_id`
- `lex-chat-title-generated { title, conversationId }` — fired when SSE `title` event arrives
- `lex-chat-send { content, conversationId }`
- `lex-chat-response-start { conversationId }`

Emitted by `lex-lana-panel`:
- `lex-lana-opened` / `lex-lana-closed`
- `lex-lana-thread-selected { thread }`
- `lex-lana-thread-created { thread }`
- `lex-lana-thread-renamed { thread }` — fired when an auto-title or rename updates a row

## SSE event surface (chat stream)

The chat SSE stream emits typed events; these are the ones that drive the thread lifecycle. Full list lives in `lex-chat.js::_handleEvent`.

| Event type | When | Drives |
|---|---|---|
| `connected` | Server has accepted the stream and bound it to a `thread_id` | `lex-chat-conversation-created` → panel registers the thread row if it's new |
| `title` | First-turn finalize, after `generateAndSaveTitle` runs | `lex-chat-title-generated` → panel updates the visible row's title |
| `done` | Stream finalized | History flush, response-end emit |

## Adding LANA to a New Page

1. Mount the global `<lex-lana-dock>` once on the page.
2. Add `lana lana-context-type="full_chat"` to the page-level `<lex-banner>`.
3. Use `lana-matter-id`, `lana-matter-name`, `lana-document-id`, or `lana-document-name` only for bounded scope already owned by that page.
4. Do not add a new page-specific `<lex-lana-panel>` unless the page has a specialized retained assistant workflow.

Current active scopes in use: `dashboard`, `workspace`, `workspace_data`, `skills`. Legacy compatible scopes: `reporting`, `firm_reporting`, `billable_hours`, `data_visualization`.

## Deferred Specialized Provider Migrations

The remaining page-owned assistant surfaces should migrate as consumers of the future page context provider layer, not as hardwired behavior in `lex-banner` or `lex-lana-dock`.

- `file-viewer` becomes a provider for active document context.
- `workspace-data` becomes a provider for active dataset/table/query context.
- `skills` becomes a provider for skills-designer context and tool defaults.

Until that provider layer exists, keep those surfaces on their existing specialized assistant panels so their per-send context injection and tool behavior remain explicit.

## Consuming `conversation_threads` from other apps

`conversation_threads` is the **platform thread registry**. Any chat surface that isn't the primary `/chat/sessions`-backed sidebar should consume it directly:

- Insights drawer (in-tree, this doc)
- PAC / `pac/` (separate Electron client, formerly `lana-companion`) — POST with `page_scope: 'meeting_recording'` (or similar) once the scope is whitelisted server-side
- Future optional apps under `LANA-AI/@<app>/` (e.g. `@meet`, `@agents`)

These surfaces inherit title generation, pinning, archiving, rename, and delete by virtue of using the same `thread_id` UUID space — the chat pipeline does the work, and the registry stays in sync.

## Where to make changes

- **Thread list UX** (look, copy, item template, collapse): `src/js/lex/chat/lex-chat.threads.js`.
- **What "+ New" persists** (thread type, default title, payload): the `lex-thread-create` and `lex-chat-conversation-created` handlers in `src/js/lex/components/chat/lex-lana-panel.js`.
- **Backend rules** (allowed fields, scopes, archival semantics, title generation): `LANA-AI/src/services/processor/conversation-threads/` for the registry, `LANA-AI/src/services/chat/conversation.service.js` + `conversation.details.service.js` for the title pipeline. Per the workspace CLAUDE.md, authorization and validation always live server-side.
