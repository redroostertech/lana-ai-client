# LANA Briefs in the LANA client: handoff (2026-11-07)

Written for an agent starting from scratch. Read this first, then `docs/plans/LANA_BRIEFS_INTEGRATION_PLAN.md`, which is the approved plan. This file says what was built, why, where it is, how to run it, and what to do next.

## 1. What LANA Briefs is, and why it is moving

LANA Briefs (formerly "Lana Notes") is a private meeting note taker for law firms.
- A phone app records meetings and sends the audio to the person's computer over the local network. The phone app lives in `lana-notes/` and stays a separate app.
- The computer transcribes the audio locally, writes notes, and proposes actions: tasks and notes for a LANA matter.
- Nothing reaches LANA until a person confirms it.

Until 2026-11-05 the computer side was a standalone Electron + React app (`/Users/mwestbrooks/Desktop/lana-app/lana-notes/desktop`). The team said Briefs and the LANA client felt like two products, so Michael Westbrooks decided to fold Briefs into the LANA client. One product means one install, one sign-in, one signing pipeline, and one model runtime in memory.

Decisions that constrain every change (details in the plan, "Decisions made"):
- **Screens are rebuilt in Lex**, the client's web component system (`src/js/lex/`, rules in `src/js/lex/LEX-COMPONENT-RULES.md`). Don't embed React.
- **The engine stays TypeScript with vitest**, in `briefs/`, bundled by esbuild into the main process.
- **LANA manages the models.** Briefs uses the local AI engine's model (Qwen3.5 9B), or the Forge zero-data-retention API when the computer can't run it. Briefs has no model fallback of its own. Missing models send the person to Settings; there are no inline download buttons.
- **One runtime path** ("Workstream R"): every model call goes through `POST /api/v1/runtime/requests` on the backend. The runtime picks the route and applies the matter's AI policy.
- **Gated by discovery.** Briefs appears only when discovery's `enabled_apps` contains `{ id: "lana-notes" }`. There is no license system.
- **Actions run only on LANA.** The Clio and Microsoft executors were removed; LANA's connectors carry actions on.
- **The backend is the brain, the client stays thin.** Business rules belong in LANA-AI or in the Briefs host (main process), not in renderer pages.

## 2. Where everything is

| What | Where | Branch | Pushed? |
|---|---|---|---|
| LANA client with Briefs | `/Users/mwestbrooks/Desktop/lana-app/.runtime/lae-client-devnew` (a git worktree of `lana-ai-client`) | `development-new`. The Briefs work was built on `briefs-phase0` (40 commits, `e61541e` to `d68d198`), merged in `d19e46f6`; that branch has been removed. | Yes, `origin/development-new` |
| Backend: runtime request route (Workstream R) | `.runtime/lae-runtime-request` | `lae-runtime-request`, tip `9c0db9dcb` | Not merged |
| Backend: Covo website intake receiver | `.runtime/lana-runtime-merge` | `covo-intake-receiver`, one commit `5beda16e6` on top of `lana-local-ai-engine` | Yes, `origin/covo-intake-receiver`, no PR yet |
| Covo (website intake agent) | `/Users/mwestbrooks/Desktop/lana-app/concierge` | `development`, no code changes | n/a |
| Demo law firm website | `/Users/mwestbrooks/Desktop/lana-app/demo-sites/whitfield-park/index.html` | not in git | n/a |
| Retired standalone app (reference only) | `/Users/mwestbrooks/Desktop/lana-app/lana-notes/desktop` | | Don't open it. It would advertise the same computer identity as the client. |

## 3. What was built, phase by phase

### Phases 0 and 1: the engine inside the client (done)

Each step is described in detail in the plan's "Progress" section.
- **Phase 0 (`e61541e`):** Electron 44.9.1, the speech runtime (`sherpa-onnx-node`) and phone discovery (`bonjour-service`) packaged, plus the microphone and Bluetooth usage strings.
- **1a:** the engine lives in `briefs/packages/core`, behind a `TextModel` seam, using `LanaRuntimeTextModel` (LANA's runtime). The phone protocol fixtures are copied from `lana-notes`, and `npm run check:briefs-fixtures` keeps the copies matched.
- **1b:** the Briefs main process (`briefs/packages/host`) runs inside the client. The preload exposes `window.lanaBriefs`, with records, devices, preferences, settings, account, actions, matters, inbox, meetings and recording.
- **1c:** there is one session, the client's (`ClientSession`). Briefs' own sign-in was removed.
- **1d:** one model catalog. `electron-local-models.js` holds `CATALOG` (engine models) and `SPEECH_CATALOG` (Briefs' five speech packages).
- **1e:** a one-time import from the standalone app (`npm run briefs:import-standalone`). It ran successfully on 2026-11-05 and isn't needed again.

### Phase 2: the screens in Lex (mostly done)

| Screen | Files | Notes |
|---|---|---|
| App entry and Briefs sidebar | `src/js/app-catalog.js`, `src/js/lex/components/layout/lex-app.js`, `lex-sidebar.js` | Sidebar: Dashboard (`layout-dashboard` icon), New meeting, the meetings list with dates and unread counts. Named "Dashboard", never "Home", at Michael's request. |
| Dashboard | `src/briefs/dashboard.{html,js,css}`, logic in `src/js/briefs/briefs-dashboard.js` | lex-banner with a "Take the tour" button; a live strip; four lex-metrics (this week's meetings, time recorded, open actions, phone); Needs your attention (opens the action review); Recent meetings; Your phone. |
| Meeting page | `src/briefs/index.html`, `src/briefs/app.js`, `src/briefs/styles.css`, `src/js/briefs/briefs-meeting.js`, `briefs-replay.js` | Transcript work area, notes like the standalone app, clip bar footer, playback. Pause redraws its icon only when the state changes (`b291939`); before that it ate clicks. |
| Share to phone and Needs review | `src/js/briefs/briefs-share.js` (+ test) | Share popover and Needs review. The phone's name is shown as the phone reports it, never re-capitalized ("IPhone" bug). |
| New meeting (record here or import) | `src/briefs/capture.html`, `src/js/briefs/briefs-recording.js` | `showNew()` goes to `briefs/index.html?new=1` from other pages. |
| Phone status in the top bar | `lex-topbar.js` status slot; `src/js/briefs/briefs-status.js` (+ test); `src/js/briefs/briefs-phones-ui.js` | An icon (wifi, or wifi-off with no phone paired) with a hover/focus card: status rows plus a "Pair a phone" or "Manage phones" button that opens the Phones modal (QR code, pairing, removal). |
| Listening only when needed | `briefs/packages/host/src/main/gateway/gatewayBridge.ts` (`applyGate`) | The computer listens for phones only while a phone is paired or a pairing is under way (pairing states: waiting, confirming, saving). Revoking the last phone closes the listener. Test: `test/gatewayRuntime.test.ts`. |
| Walkthrough and motion (client-wide) | `src/css/lex-motion.css`, `src/js/lex/brand/lex-brand-animations.js`, `lex-brand-mark.js`, `lex-walkthrough.js` (+ test), `src/js/briefs/briefs-walkthrough.js` (+ test), vendored `src/js/vendor/lottie_light.min.js` and `qrcode.min.js` | Built as reusable Lex pieces because Michael wants the same patterns across the whole client. Five Briefs pages: welcome, privacy, pairing, review, ready. Started from the Dashboard banner, no longer from the gear menu. |
| Review a proposed action | `src/js/briefs/briefs-action-ui.js`, styles `.briefs-act-*` in `src/briefs/styles.css` | Shows what was said (evidence quotes), editable title, details and due date, and a matter search (`matters.search`, debounced). Confirm runs `actions.save` then `actions.run`. Then a success mark, Open in LANA, and Undo. |

A fix that came out of the end-to-end check: `briefs/packages/core/src/lana/lanaClient.ts` read LANA's task responses wrongly. LANA answers `{ success, task }`, so the code now reads `data.id ?? task.id` and `data.tasks ?? tasks`. The fake server in `test/support/fakeLanaServer.ts` now answers the way LANA does.

### Covo website intake into LANA (built for the 2026-11-06 demo)

**Why:** a firm puts Covo (our website intake agent) on its site. When a prospect finishes the intake, LANA should already have the lead, a matter and the answers.

**Backend (`5beda16e6`):** `src/services/processor/intake/covo-intake.{schemas,service,controller,routes}.js`, mounted at `POST /api/v1/intake/covo` in `src/index.js` (raw body captured for the signature).
- It verifies Covo's HMAC SHA-256 over `${timestamp}.${body}` (headers `x-covo-timestamp`, `x-covo-signature`) and refuses deliveries more than 5 minutes old.
- On `intake.completed` it creates, in order:
  - a matter, "Estate planning intake: <name>", with owner access;
  - a contact (`contact:lead`);
  - a "Website intake" note with every answer;
  - a lead with `external_id covo:intake:<id>`.
- It is idempotent: a redelivery returns what was filed the first time (`leadsRepository.findByExternalId`). Other events are ignored.
- It is off unless `COVO_INTAKE_WEBHOOK_SECRET` is set. The organization and owner come from `COVO_INTAKE_ORGANIZATION_ID` and `COVO_INTAKE_OWNER_USER_ID`, never from the request.
- Tests: `tests/unit/intake/covo-intake.service.test.js` (9 tests).
- Machine-local env: `.runtime/lana-local/covo-intake-env.cjs`, required from `runtime-merge-env.cjs`.

**Local demo setup:**
- Covo tenant `whitfield-park` ("Whitfield & Park Estate Planning", id `ef7c5039-...`), agent `agt_a6c4b67ae26d`, integration `56fdba44-...`.
- Covo's `.env` has `SAFE_FETCH_ALLOW_PRIVATE=true` so it can post to localhost.
- The firm site is served at `http://localhost:5055`.
- Verified end to end: LEAD-000001 and MATT-00017 "Estate planning intake: Jordan Ellis", which Briefs' matter search finds.

**What it does not do:** the Covo conversation transcript stays in Covo, and nothing from Covo lands in Briefs. Briefs is for meetings recorded on the phone or computer.

## 4. How to run and verify

- **Backend:** pm2 process `lana-api-dev` on :8080, run from `.runtime/lana-runtime-merge` (check the pm2 cwd). Env comes from `.runtime/lana-local/runtime-merge-env.cjs`; the DB is `lana_chef` on 127.0.0.1:15432. Restart with the Lana CLI (`lana restart`), not raw pm2.
- **Client:** from the client worktree (`.runtime/lae-client-devnew`), `node scripts/build-briefs.js` (rebuilds the Briefs host after TypeScript changes), then, from the same folder, `NODE_ENV=development ./node_modules/.bin/electron electron-main.js --remote-debugging-port=9333`. Port 9333 lets Playwright `connectOverCDP` take screenshots.
- **Tests:**
  - Briefs engine: run `npx vitest run` in `briefs/packages/core`, `briefs/packages/host` and `briefs/packages/tools` (628 pass).
  - Client: targeted Jest files, e.g. `npx jest tests/unit/briefs tests/unit/lex-walkthrough.test.js tests/unit/electron-briefs.test.js`. Don't run the full suite unasked.
  - Backend: `npx jest tests/unit/intake`.
- **Screens:** send Michael light and dark screenshots of every UI change, after checking them yourself.

## 5. Known gaps (true today)

1. **AI drafting does not run.** Notes, worded tasks and Ask need the runtime route, which exists only on `lae-runtime-request` (not merged into the backend `lana-api-dev` runs). Today Briefs fails with `modelNotReady` and falls back to a starting point built from the clip. This is the biggest gap: in the demo, Briefs could record, transcribe and file items, but not write them.
2. **No PRs yet.** The client work is on `origin/development-new` and the backend Covo work on `origin/covo-intake-receiver`; neither has a pull request.
3. **Covo isn't private end to end.** Covo runs its chat on OpenAI (`INFERENCE_PROVIDER=openai`) and stores the conversation in its own database. On the 2026-11-06 demo call we said intake data is "saved securely in your instance", which isn't accurate for Covo today. A Florida attorney said even prospective-client information is confidential.
4. **Phase 1f verification is open:** a paired phone syncing with the client, and a real recording producing notes through the runtime, on the 9B model and on Forge.
5. **Phase 3 (one Inbox) is not started.** Briefs actions are reviewed in Briefs' own modal, not in the client's action queue and bell.
6. **Undecided: the Ask dock.** Should the meeting page use Briefs' own Ask or LANA's chat dock? The recommendation was LANA's dock.

## 6. What to do next

### Immediately (in this order)

1. **Open the PRs.** `covo-intake-receiver` into `lana-local-ai-engine` (backend). Ask Michael before opening them. Stage commits by explicit path, never `git add -A`; other work streams share these trees.
2. **Make AI drafting work.** Merge or rebase `lae-runtime-request` into the backend that `lana-api-dev` runs, then confirm `POST /api/v1/runtime/requests` answers. Run a real recording through Briefs and check that notes and worded tasks appear on the 9B model.
   - This touches how chat reaches the model, so chat E2E is required: `tests/e2e/chat-core/run-visual-test-report.js` and `tests/e2e/chat-agentic/...`, then read `results.json`.
   - The engine agent owns `llamacpp.service.js` this week. Coordinate before editing it (plan, "Working alongside the engine agent").
3. **Phase 1f checks:** phone sync, a real recording, and prompts re-checked on the 9B model. Briefs prompts were tuned on Qwen3 4B.
4. **For the next demo (Friday 2026-11-13, Brittanye Jacobs, a solo estate planning attorney in Orlando):**
   - Show intake to a preliminary document: a website intake opens a matter in LANA, and LANA drafts a first document from the answers.
   - Record the call with Briefs, not Fireflies, and use Fireflies' output (sections, timestamps, per-person action items) as the bar Briefs notes must meet.
   - Use estate examples ("fund the trust", "confirm beneficiary designations") on the Jordan Ellis matter.
   - Fix or accurately describe the Covo privacy gap (gap 3).
   - She will check everything against Florida Bar rules, so she needs a security and compliance one-pager.

### Offered to Michael, not yet confirmed (ask before building)

- Covo sends the conversation transcript in its webhook, and LANA files it as a second note on the matter.
- A "New website intakes" panel on the Briefs Dashboard.
- The intake note skips answers that repeat the contact's details.
- Remaining New meeting work.

### Long term (the plan's later phases)

- **Phase 3: one Inbox both ways.** Briefs actions join the client's action queue and approvals, with soft delete, undo and history. Briefs events show in the bell panel, merged locally and never posted to the server.
- **Phase 4: retire the standalone app.** Remove `lana-notes/desktop`, point the download links and the phone app's copy to the LANA client, and remove the phone's own privacy wording.
- **Phase 5: entity extraction.** Read meetings for people and their roles, businesses, assets, instructions and open questions. Match them against the matter's contacts and draft actions for confirmation, shown on matter pages. Do this after the move.
- **Deployment:** engine model downloads can't resume (the 9B model is 5.6 GB). Build one resuming download routine for the whole catalog.
- **Spread the motion and walkthrough patterns** (`lex-motion.css`, `lex-brand-mark`, `lex-walkthrough`) to other parts of the client. Michael will choose where.
- **Covo privacy:** point Covo's inference at Forge or the firm's own server before a law firm puts it on a live site.

## 7. Working rules from Michael (non-negotiable)

- Start every reply with "MAMA SAY MAMA SA MA MA KU SA!". When operating in the backend repo, also print the LANA banner from `LANA-AI/CLAUDE.md`.
- No emojis and no em or en dashes, anywhere: chat, code, copy, docs.
- Platform-neutral copy: say "phone" and "computer", never "iPhone" or "Mac", because Android and Windows are coming.
- Finish work across every surface and verify it end to end. Fix problems rather than listing them.
- Strict layering in the backend: route, controller, service, repository. SQL only in repositories.
- In the shared backend tree: never `git stash`, `checkout`, `reset` or `clean`.
- Don't smoke-test destructive code paths against live data. Tests that delete files must stub `os.homedir` and include a containment guard.
- Send light and dark screenshots of UI work.
