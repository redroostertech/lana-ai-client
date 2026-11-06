# LANA Briefs inside the LANA client (plan)

Status: direction approved by Michael Westbrooks on 2026-11-05. Open decisions are listed at the end. No code has moved yet.

## Why

The team's feedback was that LANA Briefs and the LANA client feel like two products, even though Briefs depends on LANA. We are moving to one combined, integrated LANA client.

- Briefs becomes one more app in it, shown or hidden by discovery like every other app.
- It uses LANA's sign-in, models, runtime, inbox, notifications and Settings rather than its own.

## Decisions made

1. **One desktop app.** The standalone Briefs desktop app (`lana-notes/desktop`) is retired once the client version works. No parallel app is kept.
2. **Discovery governs visibility.**
   - Briefs is the `lana-notes` entry in `src/js/app-catalog.js`, shown when the organization's `enabled_apps` has `lana-notes`.
   - This is the same entitlement Briefs uses today, so billing and the add-on stay as planned.
   - Per-user seats come later, through the firm's LANA server.
3. **Screens are rebuilt in Lex.** They follow `src/js/lex/LEX-COMPONENT-RULES.md`, with one `.html`, `.js` and `.css` per page and no inline styles. The React screens are not embedded.
4. **The move comes first, and entity extraction comes after**, built in the client on top of matter pages.
5. **One Inbox, both ways.**
   - Briefs actions join the client's action queue and approvals.
   - Briefs events show in the bell's notifications and activity panel (`src/js/notifications.js`, `lex-notification-panel.js`):
     - a draft is ready;
     - a meeting arrived from the phone;
     - a sync needs review;
     - an action ran or failed on LANA.
6. **LANA manages the models.**
   - Briefs uses the model LANA ships. Its own 4B and 1.7B models and `node-llama-cpp` are removed from the desktop.
   - Briefs' speech models join the client's pinned local model catalog (`electron-local-models.js`) under the same R2, size and sha256 rules. These are transcription, diarization, listening and LANA voice.
   - The Briefs model mirror code and its signed manifest are retired on the desktop. The phone keeps its own on-device models.
   - A computer that cannot run the 9B model uses Forge's zero data retention API, as part of LANA's coverage. Briefs has no fallback model of its own.
7. **One runtime path to every model.**
   - The runtime is the only thing that talks to a language model, whether that model is served by Pip, llama.cpp, Forge, OpenAI or anything else.
   - Chat, Briefs, agents, automations and every other caller send one kind of request to it, chat turn or not.
   - The runtime picks the route, applies the matter's AI policy, and records usage. Callers never know where the model is. See "Workstream R".
8. **LANA governs where data goes, so Briefs says nothing about it.**
   - Briefs drops its own privacy and "stays on this computer" wording.
   - LANA's coverage and the matter's AI policy speak for it.
9. **One Settings flow.** Briefs settings fold into the client's settings-v2. Briefs keeps no Settings screen of its own. See "Settings consolidation".
10. **One sign-in.** Briefs uses the client's sign-in, token store and discovery. The Briefs account stack is removed.
11. **Briefs engine source moves into the client repo** and stays TypeScript with its vitest suite, in its own folder.
12. **Target branches.**
    - Client: `development-new`, the local AI engine client.
    - Backend: `lana-local-ai-engine`, running on this machine. Its origin was at `56c18ab54`.

## What exists today

- **The client (`development-new`)**
  - Plain JS, using Lex, esbuild (`scripts/bundle-electron.js`) and electron-builder, on Electron 44.7.0.
  - A local AI engine supervisor (`electron-engine-supervisor.js`, `electron-local-engine.js`).
  - A pinned model catalog (`electron-local-models.js`: Qwen3.5 9B, Qwen3.5 0.8B and Nomic embed). It has no IPC and no screen yet. Only the main process uses it, for the embedding model.
  - An action queue, approvals, settings-v2 and a TipTap editor.
- **Briefs desktop**
  - TypeScript on Electron 44.9.1, with a React 19 UI.
  - `packages/core` holds the logic: recording, transcription and diarization, notes, Ask, Talk, the encrypted store, phone pairing and sync, LANA actions, and the model mirror.
  - Native modules: `sherpa-onnx-node`, `node-llama-cpp` and `bonjour-service`.
  - `app/src/shared/api.ts` is the contract between the renderer and the main process.
  - It has a full second sign-in stack, which is redundant inside the client:
    - `packages/core/src/account/*`
    - the `lana.session` KeyVault entry
    - `app/src/renderer/account/*`
- **The phone app** stays its own App Store app. It pairs with "the computer", which from now on is the LANA client.

## Workstream R: one runtime request path (backend, LANA-AI)

This sits in `lana-local-ai-engine` and is a prerequisite for Briefs' model calls in Phase 1. The findings come from reading the code, with paths relative to the backend root.

### Working alongside the engine agent

Another Claude Code agent is working in `lana-local-ai-engine` right now on runtime understanding and chat verification. Its latest commit at the time of writing was v34, `326dc6a4a`.

- **Its runs on the engine, as of 2026-11-05:**
  - chat-core phases 1 and 17 on the bench;
  - the documents set on 8080;
  - chat-verify on the bench, which takes hours.
- **Its code overlaps ours.** In the last 7 days, `llamacpp.service.js` changed in 11 commits and `chat.controller.js` in 7. Those are the files Workstream R changes most.

Rules for this workstream:

1. **Never stop, restart or borrow** the 8080 server, the bench or the model engine while its runs are going. No E2E run of ours starts until it says the engine is free.
2. **Work in our own worktree and branch**, cut from the latest `origin/lana-local-ai-engine`. Rebase often and keep each commit small.
3. **Don't edit its files:** its prompts, understanding versions and chat-verify work. Where Workstream R has to touch a shared file, change as little as possible and say so in the commit.
4. **Go in order, smallest overlap first:**
   - the Chef pass policy fix (one service and its tests);
   - the request-keyed Forge pass and the relay correlation id;
   - the runtime entry and its engine route;
   - the routing in `llamacpp.service.js`, last, timed with the engine agent between its runs.
5. **Share the spec before the shared-file changes.** Send the engine agent this section and the target shape, so that its prompt and routing work and ours agree.
6. **Use its chat results as our baseline.** Before merging, compare our chat-core and chat-agentic `results.json` with its latest v34 results on the same scenarios. A difference counts as a regression until it's explained.

### Findings

- **There is no single entry point today.**
  - Every model call goes through `src/shared/services/llamacpp.service.js`, as plain OpenAI-style HTTP. No provider SDKs are used.
  - Only two of its functions apply the local vs Forge decision: `generateChatCompletion` and `generateChatWithTools`, through `_maybeRouteChatToRelay` (:3551).
  - These always go straight to the local URL, with no routing:
    - `generateText`
    - `generateJSON`
    - `generateTextStream`
    - `generateNativeChatCompletion`
    - vision (`extractTextFromImage`)
    - verification
    - prewarm
- **Six production files skip the hub and call a model themselves:**
  - `monitoring/analysis/ai-analyzer.js`
  - `services/chat/prompt-prewarm.service.js`
  - `services/llm-warmup.service.js`
  - `shared/grounding/validators/base.validator.js`
  - `services/embed-service/embed-service.client.js`
  - `sandbox-runner/kinds/document-embedding.js`
- **The nearest thing to a runtime** is `src/shared/llm/native-runtime-lanes.js` plus `llm-request-queue.js`.
  - The lanes are foreground response, review, classifier, automation, post-turn and batch.
  - About 82 files use the lanes, and 53 call the hub directly.
- **The route decision** is `decideRoute` in `src/shared/routing/hybrid-router.js`.
  - It is pure and already the right shape.
  - It weighs local availability, Forge entitlement, the matter policy, tools, model name and context size.
- **Forge is tied to chat turns in three places:**
  - `src/engine/forge-pass/engine-forge-pass.js`: no pass outside `currentTurn()` (`FORGE_PASS_NO_TURN`).
  - `src/shared/relay/relay-client.js:176`: refuses without a `turnId` (`STRICT_TURN_REQUIRED`).
  - Passes are cached per turn.
- **A pattern for work that isn't a chat turn already exists:** `src/sandbox-runner/job-model-access.js` `withJobModelAccess`.
  - Agents and automations use it to set the AI policy and a job pass for a run.
  - Chef already mints job passes (`mintJobPass` in `src/services/forge-pass/forge-pass.service.js`).
- **Policy gap found (security).** The Chef route that mints a Forge pass for a person's session checks the matter AI policy only when a `turn_id` is sent (`src/services/data-api/data-api-forge-pass.service.js:41`). A pass asked for without a turn skips the `local_only` and `never_leave_firm` check. This should be fixed first, whether or not Briefs ships.
- **Usage accounting expects chat.**
  - `llm_call_spans` requires a chat trace.
  - `llm_inference_events` already supports runs that are not chat (`agent_run_id`, `source_span_key`), so it is the table to build on.

### Target shape

1. **One entry:** `runtime.request({ purpose, lane, messages | prompt, schema?, stream?, matterRef?, requestId, caller })`.
   - It lives with `native-runtime-lanes.js` and becomes what that module exposes.
   - It runs every call inside the matter's inference policy scope.
   - It asks `decideRoute` for local, Forge or another provider.
   - It records usage once.
2. **Every hub function routes**, not just the two chat ones. That means text, JSON, stream, vision and verification. Embeddings stay local or go to the embed service.
3. **The Forge pass keys on the request**, turn or not.
   - `engine-forge-pass.js` reads a request context (request id, caller, matter, AI policy) instead of `currentTurn()`.
   - It reuses the `withJobModelAccess` provider shape.
4. **Chef checks policy on every pass.**
   - The engine pass route accepts a request scope (request id, purpose, matter).
   - It always checks the matter's AI policy, mirroring `mintJobPass`.
5. **The relay client needs a correlation id**, not a turn id. Chat still sends its turn id as that value.
6. **Usage goes to `llm_inference_events`** with a generic request or run id. Chat keeps its spans.
7. **The six bypasses move behind `runtime.request`.**
8. **One engine HTTP route** serves callers outside the engine process, such as Briefs: for example `POST /api/v1/runtime/requests` in `src/engine/chat/engine-chat.app.js`.
   - It has no `beginTurn`, and it streams when asked.
   - Briefs calls only this route and never names a model or a host.

### Verification

- Unit tests for the entry and the route decision:
  - local;
  - Forge;
  - a restricted matter refused for Forge;
  - no model available.
- Chef pass tests:
  - with and without a turn;
  - a restricted matter always refused.
- Because this changes how chat reaches the model, run the chat-core and chat-agentic E2E suites and review their `results.json`, per `LANA-AI/CLAUDE.md`.

## Settings consolidation

The client has one live user Settings page, `src/settings-v2.html`. Briefs settings fold into it as follows.

| Briefs setting | Goes to | Why |
|---|---|---|
| Account (identity, sign out) | Removed. The client's Profile and account menu cover it | One sign-in |
| Walkthrough | The client's help and onboarding | One place for help |
| Devices (pair a phone, revoke) | New **Phone** section | Per computer, Briefs only |
| Receiving, proximity check, background updates | The same **Phone** section | Per computer, Briefs only |
| Audio retention (days) | A per-computer setting in the client, under the Briefs rows of Data controls | Decided: a client boundary for now, not a firm policy |
| Ask model card | Removed | LANA manages models |
| Ask history (saved conversations, clear) | **Data controls**, which today is hidden and empty | One place for stored data |
| Voice choice, end talk in background | New **Voice** section (the client has none) | Shared with the client's voice features later |
| Transcription, listening and LANA voice model cards | New **Local models** card under Capabilities, next to the Local AI service card. Needs IPC added to `electron-local-models.js` | One place for every download, including the engine's models |
| Connections (Clio, Microsoft; already hidden) | Removed | LANA's connectors carry actions out |
| Audit log (local, hash-chained) | Removed as a screen. Entries go to the firm's audit log | Decided: one audit log. See "Audit" below |
| Appearance (System, Light, Dark) | General | The client has no theme row today |
| About, Licenses | The client's About and open-source page | One About |
| Privacy wording | Removed | LANA governs where data goes |

- **Gating.**
  - Voice and the speech model rows show only when discovery enables `lana-notes`.
  - The **Phone** section is for every LANA phone app, not just Briefs. A person may have one or both: the LANA Briefs phone app and, once it is released, the LANA mobile app.
  - It shows when at least one phone app is available to that person's firm: Briefs is enabled, or the LANA mobile app is released and enabled through discovery.
  - It lists each paired phone with the app or apps it runs, and pairing, receiving and revoke are shared. Briefs-only rows (receiving meetings, proximity check, background updates) show only when Briefs is enabled.
  - Until then, Briefs on the computer works on its own: recording, import, notes, Ask and actions.
- **Dead items seen in settings-v2** (left for a separate cleanup, not this plan):
  - the hidden Plugins tab, which overlaps `data-connectors.html`;
  - the empty Data controls tab, which this plan fills.

## Audit

- Briefs events go to the firm's audit log through the existing governed activity route, `POST /api/v1/activity/events` (`src/services/processor/routes/activity.routes.js:330`).
  - That route checks authentication and matter access, and Chef owns validation and storage.
  - Briefs adds its own event types there: recorded, imported, sent from phone, accepted, synced, action drafted, action run or undone, deleted or restored, phone paired or revoked, and settings changed.
- **Entries carry ids, types and times only.** They never include titles, transcript text, names or quotes.
- **When the computer is offline,** entries queue locally in the encrypted store and are sent in order once it's back online.
- **The local hash chain** stays only as that queue. The firm's audit log is where people read the history.
- **Checks:**
  - confirm the new event types show in the firm's audit view;
  - add the event type list to the route's validation, which is a backend change and goes in Workstream R's coordination.

## Guardrails

- **Meetings stay with the person.**
  - Audio, transcripts, notes and the meeting store stay on the computer and the phone. They are never moved to the server.
  - Model work goes through the runtime, which follows LANA's coverage and the matter's AI policy.
  - Only confirmed actions are written to the firm's LANA.
- **Nothing for people without Briefs.** If `lana-notes` is not enabled:
  - the Briefs module does not start;
  - no microphone, screen audio or Bluetooth prompt appears;
  - no speech model is downloaded;
  - no Bonjour service is advertised.
- **Downloads live in Settings.** Feature screens only point there.
- **Copy:** say "phone" and "computer", with no model brand names, no emojis and no em or en dashes.
- **Logging:** nothing containing transcript text, names, tokens or keys is ever logged.
- **Bell items from Briefs are local.**
  - They are produced on the computer and never posted to the server's notifications.
  - They name a meeting by its title only.
- **Licenses:** Briefs notices and SBOM entries merge into the client's open-source page.

## Phases

### Phase 0: line up the client

- Upgrade the client to Electron 44.9.1.
- Add `sherpa-onnx-node` and `bonjour-service` to the electron-builder config with `asarUnpack`.
- Add the macOS usage strings for the microphone, screen audio and Bluetooth.
- **Verify:** the client builds and starts, and the existing suites pass.

### Workstream R (in parallel with Phase 0, backend)

- First, fix the Chef pass policy gap.
- Then build the runtime entry, routing for every hub function, the request-keyed Forge pass, and the engine route.
- See "Workstream R" for the full target shape and checks.

### Phase 1: move the engine

- **Move the core.** Move `packages/core` source into the client repo, in its own TypeScript folder with its vitest suite, bundled by esbuild as a main-process module.
  - The phone protocol fixtures stay in `lana-notes`, with a check that the copies match.
- **Swap in LANA's services:**
  - Replace Briefs' LLM runtime with calls to the runtime route from Workstream R. When no model is available, notes, Ask and actions say so and point to Settings.
  - Replace the Briefs sign-in, session store and entitlement with the client's token store and `electron-discovery.js`.
    - The KeyVault stays, for the phone pairing keys only.
    - The Clio and Microsoft executors and their tokens are removed.
  - Move the speech models into `electron-local-models.js` and remove the Briefs mirror and manifest code.
- **Wire it in:**
  - Load the module only when discovery enables `lana-notes`.
  - Expose `window.lanaBriefs` from the preload, keeping the `api.ts` contract.
- **One-time import from the standalone app.**
  - Move the meeting store and pairing keys, so meetings carry over and phones stay paired.
  - Audit the import with ids only.
  - Test it on a copy of the data first.
- **Keep unchanged:** the phone protocol (up to v5) and the Bonjour service (`_lananotes._tcp`).
- **Verify:**
  - the core suite passes inside the client;
  - a paired phone syncs;
  - a test recording transcribes and writes notes through the runtime, on the 9B model and on Forge;
  - a restricted matter is refused for Forge.

### Phase 2: rebuild the screens in Lex, and consolidate Settings

- **App entry:** `lana-notes` in `app-catalog.js`, with the label "LANA Briefs" and a route under `src/briefs/`.
- **Pages:**
  - the meetings list and Start new meeting;
  - the meeting page (clips, title and speaker edit, notes on the client's TipTap);
  - Ask;
  - Talk;
  - Import a recording.
- **Settings:** apply the consolidation table above.
- **Verify:** light and dark screenshots of every page and Settings section.

### Phase 3: one Inbox, both ways

- Briefs actions join the action queue and approvals, with soft delete, undo and history.
- Briefs events show in the bell panel, merged locally. Their unread count joins the bell's badge.
- **Verify:**
  - each event opens the right meeting or action;
  - the badge counts only unread items;
  - an action runs on LANA after confirmation;
  - undo and restore work.

### Phase 4: retire the standalone app

- Remove `lana-notes/desktop`.
- Point the website download links and the phone app's copy to the LANA client.
- Remove the phone's own privacy wording about where data goes. LANA governs that now.
- The phone app, the protocol fixtures and the model mirror for the phone stay.

### Phase 5: entity extraction (the tabled plan)

- Read meetings for people with roles, businesses, assets with values, client instructions and open questions, guided by the matter's makeup.
- The model work goes through the runtime.
- Match each item against the matter's contacts and parties on LANA.
- Draft actions that people confirm before anything is sent.
- A meeting gets a matter once, and its suggestions show on that matter's page.

## Deployment process: open questions

- **Engine model downloads cannot resume.** `electron-local-models.js` `downloadModel` starts a cut-off download over, and the 9B model is 5.6 GB. Briefs' speech store resumes each file from its `.part` with a range request. To investigate as part of how the LANA client deploys its models (first run, updates, a slow or interrupted connection): one resuming download routine for every entry in the catalog.

## Risks

- **Workstream R touches how chat reaches the model.** Chat E2E runs, with a review of `results.json`, are required before it is called done.
- **Install size.** The speech runtime adds tens of MB per platform for everyone. The models stay on-demand.
- **The Electron upgrade** touches every client feature, so it gets a full test pass first.
- **Prompt changes.** Briefs prompts were tuned on Qwen3 4B. They are re-checked on the runtime's model, and on Forge, with a real meeting.
- **Data import.** Meetings and pairing keys must carry over. Test on a copy, never on live data.

## Open decisions

1. **Who builds Workstream R:**
   - Recommended: we build the pieces with little overlap, and the engine agent builds the routing change in `llamacpp.service.js`, because it owns that file this week.
   - Alternative: we build all of it under the rules above.
2. **How the LANA mobile app's release is signaled:** its own entry in discovery's `enabled_apps`, or a separate release flag in the control plane?

Decided 2026-11-05:
- Workstream R is approved, on the coordination terms above.
- All six bypasses move behind the runtime.
- Audio retention is a per-computer client setting for now.
- Briefs entries go to the firm's audit log.

## Progress

- **Workstream R (backend, branch `lae-runtime-request`, not merged):**
  - every Forge pass names its scope;
  - R0, the runtime request begin;
  - R0u, usage counted in `llm_inference_events`;
  - the engine route `POST /api/v1/runtime/requests`, with streaming.

  The routing change for the other model functions is the engine agent's.
- **Phase 0 (`e61541e` on `briefs-phase0`):**
  - Electron 44.9.1;
  - the speech runtime and phone discovery packaged;
  - the microphone and Bluetooth usage strings;
  - the microphone entitlement.
- **Phase 1a (`d77d2f5`):**
  - The Briefs engine is in `briefs/` and uses `LanaRuntimeTextModel` (LANA's runtime) behind its `TextModel` seam. The local language model code is removed.
  - The shared fixtures are copied, and `check:briefs-fixtures` keeps them matched.
  - 557 tests pass.

### Phase 1, remaining steps

1. **1b: the main process.**
   - Bundle the Briefs main process with esbuild beside `electron-main.js`. It comes from `lana-notes/desktop/app/src/main` (about 11k lines) and `app/src/shared/api.ts`.
   - Load it only when discovery enables `lana-notes`.
   - Expose `window.lanaBriefs` from the preload, keeping the `api.ts` contract.
   - Port its permission handlers, merged with the client's own: microphone audio only for the app's own pages, and meeting audio through display media loopback while a recording starts.
   - Port the Bluetooth wake helper (`native/macos/ble-wake-helper`).
2. **1c: one session.**
   - **Done:** there is one session, the client's. Briefs' sign-in, saved session, sign-out and entitlement checker are removed. Briefs reads the client's session through `ClientSession`, which provides the token, the API base and who is signed in.
   - **On a change:** a sign-in or a refreshed token means Briefs reads the session again. Signing out, or another person signing in, ends that person's session, which revokes the phones' background access, before Briefs stops. Turning Briefs off for the firm only stops it.
   - **Done:** the Clio and Microsoft executors, OAuth, the Clio mirror sync, the Connections section and the old action cards are removed. Actions run only on LANA, and LANA's connectors carry them on. The vault now holds only this computer's identity and the store key.
3. **1d: one model catalog.** Done.
   - `electron-local-models.js` is the one list of every model the client downloads. `CATALOG` holds the engine's models. `SPEECH_CATALOG` holds Briefs' five speech packages: the same files on models.lanaai.io, pinned by size and sha256, with their license and notice files.
   - Briefs' speech store takes its packages from that list (`speechPackages()`) and still downloads them itself, because they are multi-file packages it can resume.
   - Retired: Briefs' signed model list (`briefsManifest`, `briefsMirror`), the GitHub fallback (it was off) and its archive unpacking.
   - Moved to the LANA client's deployment process (see "Deployment process: open questions"): the engine's `downloadModel` cannot resume a cut-off download, while Briefs' speech store can.
4. **1e: the one-time import.** Built.
   - **When it runs:** before Briefs first starts for a person (their folder does not exist yet). It finds the standalone app's data (packaged `LANA Briefs`, or `@lana/app` from source).
   - **What it moves:** this computer's identity (the phone's pairing is with it), the store key, the store (database, audio and recordings) and the speech models. The speech models are hard-linked, so they take no extra disk.
   - **What it leaves behind:** the old sign-in, entitlement and token. There is one session, the client's.
   - **Re-sealing:** the two key files are sealed with the old app's keychain entry. macOS asks the person to let LANA open that entry. The files are then sealed again with the client's own entry.
   - **Safety:**
     - It refuses while the old app is running.
     - It imports only the person the old app was signed in as (user id or email).
     - It never overwrites, and never changes the old folder.
     - It stages, then moves into place in one step.
     - It writes an audit entry (`store.imported`, no ids) on the next start.
   - **Not verified yet:** opening a file sealed by the real old app. The tests seal with Chromium's macOS scheme themselves. Verification is the first step of 1f: Michael allows the keychain prompt, and it runs on a copy of his standalone data first.
   - **Phase 2:** a screen that explains the keychain prompt before it appears, and a way to import later for someone who declined it.
5. **1f: verification.**
   - A paired phone syncs with the client.
   - A test recording is transcribed and its notes are written through the runtime, on the 9B model and, once its routing lands, on Forge.
   - Prompts are re-checked on the runtime's model with a real meeting.
