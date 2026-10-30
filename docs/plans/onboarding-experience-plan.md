# LANA Client Onboarding Experience: Plan

- **Status:** Phase 2 built: the tour runs in the client on the dashboard after login and each first step opens its real page. Onboarding status is saved on the device only (decision D6), so there is no backend change. See section 10.
- **Branch:** `feature/onboarding-experience` (from `development`)
- **Date:** 2026-10-30
- **Owner:** Michael Westbrooks
- **Repos touched:** `lana-ai-client` only
- **Sources:** *LANA AI Updated Strategy* (Oct 29, 2026), *LANA Business Plan* (Oct 28, 2026), *Implementation Assurance Product* (Oct 2026), root `Claude.md`, `lana-ai-client/Claude.md`, `src/js/lex/LEX-COMPONENT-RULES.md`

---

## 1. Goal

A new user opens LANA for the first time and, in under two minutes, understands three things:

1. **This is my firm's private workspace.** It is built for estate-planning work, and the firm owns the record.
2. **LANA shows its work.** Answers and facts come with sources, and anything that does not line up gets surfaced instead of quietly fixed.
3. **I stay in charge.** LANA prepares; a professional approves.

Then the user takes one real first step in the actual app. The experience should feel delightful and approachable. It is not a feature tour. Skipping is always one click away.

### Success criteria

| Measure | Target for the first pilot cohort |
|---|---|
| Users who finish or deliberately skip (no rage-quits mid-flow) | 95%+ |
| Median time to finish | Under 2 minutes |
| Users who complete their chosen first step within 24 hours | Baseline it, then improve |
| Skip rate by scene | Shows which scene is too long or unclear |
| Support questions about "what is this app for" from new pilot users | Trending to zero |

These map to the strategy's operating aspiration of "standardized onboarding" and declining support effort per account.

---

## 2. What onboarding should say

The documents are long and careful. Onboarding uses only their spine, in plain language, specific to the platform.

| Pillar | Plain-language line (draft copy) | Grounded in |
|---|---|---|
| Private by design | "Your firm's work lives in your firm's own space. Routine work happens on this computer. When LANA needs deeper reasoning, it borrows it and keeps nothing." | Business plan, operating model: local Pip, single-tenant record, stateless Forge |
| Shows its work | "Every answer points back to where it came from." | Strategy section 15: provenance and evidence status as first-class concepts |
| Surfaces what doesn't line up | "When something is missing or doesn't match, LANA flags it. It never quietly fixes it." | Business plan exception queue; Implementation Assurance: "The system should never silently fix that difference" |
| Submitted is not completed | "Sent is not the same as done. LANA waits for proof." | Implementation Assurance: activity evidence vs outcome evidence |
| You make the call | "LANA prepares the work. You approve it." | Strategy: keep legal decisions and approvals with qualified professionals |

### Claim discipline (non-negotiable)

The strategy and business plan both warn against over-claiming. Onboarding copy must follow the same rules:

- **Say:** no training on your firm's data, no retention by the reasoning service, firm-owned records.
- **Do not say:** "guarantees privilege," "other AI trains on your data," "air-gapped," or any time-savings number.
- **Do not show** a capability as working today unless it ships in the build the user is running (see section 3).

---

## 3. Content guardrail: only teach what ships

I checked the client and backend on 2026-10-30. Some of the strongest ideas in the Implementation Assurance document are not in the product yet.

| Concept the documents emphasize | In the product today? | How onboarding handles it |
|---|---|---|
| Matters, documents, connectors | Yes (`matters.html`, document library, `data-connectors.html`) | Teach directly |
| Answers with sources (grounded chat) | Yes (chat grounding and citations) | Teach directly |
| Approvals and review | Yes (`approvals.html`, `approval-detail.html`) | Teach directly |
| Exceptions to act on | Partly (`action-queue.html`, `alerts.html`) | Teach as "LANA flags what needs you" |
| Evidence states (client reported, document indicates, professional reviewed, externally confirmed) | **No.** Only appears as prompt wording | Teach as a principle with a sample estate, or hold until built (decision D2) |
| Intended vs observed state, reconciliation, Implementation Assurance Record | **No** | Same as above (decision D2) |

The scenes in section 4 are written so scenes 3 and 4 can swap between "principle with a sample estate" and "shipped feature" without redesigning the flow.

---

## 4. The experience

Three acts. Act 1 is the delightful part. Acts 2 and 3 turn it into a real first step.

```
Act 1: The story (full screen, 6 short scenes)  ->  Act 2: Make it yours  ->  Act 3: First step in the real app
        ~90 seconds, every scene has one small action      2 questions                2-3 spotlights, then a checklist card
```

### Act 1: The story

Each scene follows one rule: **the user does one small thing, and the motion shows what happened.** Motion explains cause and effect; it is never decoration. All scenes use one sample household, *the Smith family estate*, which is the example the Implementation Assurance document uses.

| # | Scene | What the user sees | The one action | Motion |
|---|---|---|---|---|
| 0 | **Hello** | The LANA mark draws itself in. "Hi {first name}. I'm LANA. Want a two-minute look around?" | "Show me" or "Skip, I'll explore" | Mark draws in along its stroke, greeting types in word by word |
| 1 | **Private by design** | Three stacked layers: *This computer*, *Your firm's space*, *Reasoning*. A document token moves between them. | Tap each layer to learn what it does | The token travels down, gets processed, and dissolves in the Reasoning layer to show "keeps nothing" |
| 2 | **Bring your work in** | An empty Smith matter card. Sample files (trust, brokerage statement, IRA statement) sit to the side. | Drag a file onto the matter (or click it) | The file drops in, and key facts peel off as small chips ("Brokerage 4421: owned by Jane Smith") |
| 3 | **Every answer shows its source** | One fact chip, expanded. | Tap "Where did this come from?" | A thread draws from the chip back to the highlighted line in the statement |
| 4 | **LANA flags what doesn't line up** | Two cards side by side: *The plan says* (IRA contingent: Smith Descendants Trust) and *The record shows* (IRA contingent: Michael Smith). | Try to mark it done | The mismatched field pulses and the card slides into a "Needs you" tray. Line: "Sent is not done. I'll wait for proof." |
| 5 | **You make the call** | The flagged item, with Approve and Modify. | Approve it | A soft stamp lands, and a line writes into a small history: "Reviewed by you, today." |

Scenes 3 to 5 stay high level and general (decision D2): they use the sample Smith estate to communicate the shared value proposition, are labelled "Sample estate for illustration," and do not depict specific product screens. The evidence model is being built in a separate worktree.

Each story scene carries a brand doctrine kicker from the LANA AI media kit: **Own** the intelligence (scenes 1 and 2), **Verify** the outcome (scenes 3 and 4), **Bound** the action (scene 5). Scene 5 closes on all three as the shared value proposition.

### Act 2: Make it yours

One path for everyone (decision D1), so there is no role question. One choice decides what Act 3 shows:

**"Where would you like to start?"** Four cards:
- Connect your files (connectors)
- Open a matter
- Ask me anything
- Invite your team

An "I'll explore on my own" link finishes the tour without coach marks.

### Act 3: First step in the real app

- The story fades away and the real app shell (`<lex-app>`) appears behind a soft spotlight.
- **2 to 3 coach marks** point at the real controls for the chosen first step (for example: sidebar "Connectors", then "Add connector").
- When it is done, a short, tasteful celebration plays (a small burst in brand colors, under one second), and a **Getting started** card stays on the home screen with the remaining first steps. It can be dismissed and never comes back.

### What "delightful" means here (design principles)

1. **Short.** No scene longer than about 15 seconds. The whole story is under 2 minutes.
2. **Hands-on.** Every scene asks for one small action. Nothing is a wall of text.
3. **Motion with meaning.** Animation shows cause and effect: files go in, facts come out, a mismatch gets flagged, a stamp lands.
4. **A warm voice.** LANA speaks in short, friendly first-person lines. No jargon and no legal claims.
5. **Calm.** Sound is off by default. No confetti storms. One small celebration at the end.
6. **Respectful.** Skip is always visible, and the flow never comes back uninvited.

---

## 5. Skipping and control flow

### Controls available on every scene

- **Skip** button in the top-right, plus the `Esc` key. Skipping is one click with no confirmation dialog, followed by a toast: "No problem. You can replay the tour anytime from Help."
- **Back** and **Next**, plus the left and right arrow keys.
- **Progress dots.** Scenes the user has already visited can be clicked to jump back.
- **Replay** from the Help menu, at any time.

### State machine

The flow is data plus a small pure module, so it can be unit tested without the DOM (per `lana-ai-client/Claude.md`).

```
not_started --open--> in_progress(scene) --finish--> completed
                          |    ^
                        skip  resume (once, on next launch)
                          v
                       skipped

completed | skipped --replay (from Help)--> in_progress(0)   (does not erase completed_at)
```

Stored as one record per user:

```json
{
  "status": "not_started | in_progress | completed | skipped",
  "version": 1,
  "scene": "verify",
  "visited": ["hello", "own", "bring", "verify"],
  "firstStep": "connect",
  "resumeOffered": false,
  "checklistDismissed": false,
  "completedAt": null,
  "skippedAt": null
}
```

Rules:

- Show automatically only when `status` is `not_started`. Quitting on the hello scene just greets again next time.
- If the user quit mid-flow (`in_progress`), offer "Pick up where you left off?" **once** on the next launch. Declining counts as skipped; ignoring it means it is not offered again.
- `version` lets a future content update offer an optional "What's new" card **without** forcing the tour again.
- Scenes, first steps and coach marks are defined as data in the flow module, so reordering or rewording scenes is configuration, not new code. Scene ids are persisted, so renaming one is a migration.

### Where the state lives

- **On the device only** (decision D6): one record per user in local storage, key `lana.onboarding.<user id>`, so people sharing a computer keep separate progress. Nothing is sent to the server.
- Tradeoff, accepted: on a new computer or after clearing app data the tour offers itself again. Skip is one click, so the cost is small.
- The client does not decide anything security- or business-critical here. This is UI state only.

---

## 6. Accessibility, motion and performance

- **Reduced motion:** when `prefers-reduced-motion` is set, every travel, draw and particle animation becomes a simple crossfade. Scenes stay fully understandable without motion.
- **Keyboard:** every action works from the keyboard. Drag-and-drop in scene 2 also has a click alternative. Focus is trapped inside the onboarding overlay (reuse `FocusTrap` and `ScrollLock` from Lex core).
- **Screen readers:** each scene change is announced through an `aria-live` region, and the illustrations have text equivalents.
- **Contrast and themes:** 4.5:1 minimum for text. The tour uses the LANA AI brand (decision D3), which is dark-first: charcoal `#161616`, warm white `#f2f0ec`, emerald `#3d9a75` (`#65b794` on dark), Montserrat plus Playfair Display Italic, and the corner-bracket mark. It stays dark even on a light OS. A light variant exists behind an explicit opt-in for review.
- **Performance:** animate only `transform` and `opacity`, targeting 60fps on CPU-only firm laptops. No animation library is needed: CSS keyframes plus the Web Animations API. Illustrations are inline SVG or CSS. The prototype's HTML, CSS and JS total about 96 KB. The brand fonts add about 1 MB as TTF; convert them to WOFF2 when porting, and share them with the rest of the app rather than loading them just for the tour. No network fetches, so it works in private and on-premise deployments.
- **Motion tokens:** use the existing `--lex-ease-out`, `--lex-ease-in`, `--lex-duration-*` and `--lex-transition-*` tokens, and add a small set of onboarding-specific durations to `lex-tokens.css` instead of hard-coding them.

---

## 7. Phases

### Phase 0: Plan and decisions (this branch, now)

- Approve this plan and answer the decisions in section 8.
- Write final copy for each scene.

### Phase 1: Chrome prototype (built)

Built standalone first, so the feel can be tuned quickly without Electron, auth or the backend. How to run it: `prototypes/onboarding/README.md`.

Verified on 2026-10-30 with a scripted run in Google Chrome (33 checks, 5 consecutive clean runs, no console errors or failed requests): full happy path, drag and click to add documents, skip by button and `Esc`, arrow keys, resume offered exactly once, resume lands on the saved scene, never reopens after finishing, replay from Help keeps the earlier completion, focus stays inside the tour, the tour container never scrolls, reduced motion, light variant, and a 720px narrow window. The pure flow module has 19 Jest unit tests in `tests/unit/onboarding-flow.test.js`.

Original Phase 1 scope:

- **Location:** `lana-ai-client/prototypes/onboarding/`
  - `index.html`: structure only
  - `onboarding.css`: presentation; imports the real `../../src/css/lex-tokens.css` so colors and motion match the app
  - `onboarding.js`: scene rendering and animation
  - `onboarding-flow.js`: the pure state machine and scene definitions (moves into the app unchanged in Phase 2)
  - `mock-shell.html` and `.css` and `.js`: a fake `<lex-app>`-style shell to try the Act 3 spotlights
  - `README.md`: how to run it
- **Run:** `npx serve prototypes/onboarding` (or any static server), then open in Chrome.
- **No backend:** state persists to `localStorage` in the prototype only.
- **Verify before calling it done:**
  - Full run-through in Chrome, recorded as a GIF for review
  - Skip works from every scene, and `Esc` works
  - Keyboard-only run-through
  - Reduced-motion run-through (Chrome DevTools: Rendering, emulate `prefers-reduced-motion`)
  - Light and dark mode
  - Holds 60fps in the DevTools performance panel with CPU throttling at 4x
- **Feedback round** with 3 to 5 people from the lawyer network before porting.

### Phase 2: Bring it into the client

- `src/js/onboarding/onboarding-flow.js`: the pure flow module, moved from the prototype.
- `src/js/onboarding/onboarding-state.js`: maps the backend preference to and from the flow state, with the local cache.
- A Lex component for the overlay (for example `src/js/lex/components/onboarding/lex-onboarding.js` plus its `.css`), mounted on `document.body` like `Lex.Modal` so it is not clipped by `<lex-content>`.
- Boot gating: after auth in the V2 shell (`app.html` / `<lex-app>`), read the preference and mount the overlay only when it is `not_started` (or offer to resume once).
- Help menu entry: "Replay the tour."
- Coach marks attach to real shell elements through stable `data-onboarding` attributes instead of fragile selectors.
- **Tests:**
  - Jest unit: every flow transition, the resume-once rule, versioning, and the state mapper (flow transitions already covered by the 19 prototype tests)
  - Jest integration: boot gating (shown, not shown, resume prompt)
  - Manual: a full run in the Electron build on macOS and Windows

### Phase 3: Backend (not needed)

- Onboarding status stays on the device (D6), so the preferences API is not used. A server-side `onboarding` category was built and then removed at the user's request.
- Optional later: record onboarding events (`started`, `scene_viewed`, `skipped_at`, `completed`, `first_step_done`) through the existing activity tracking, so section 1's success measures can be read.
- Contract smoke with `curl` and `scripts/dev/get-token.sh`, per `LANA-AI/CLAUDE.md`.

### Phase 4: Measure and tune

- Review skip-by-scene and time-to-first-step after the first pilot cohort.
- Cut or shorten any scene with a high skip rate.

---

## 8. Decisions

Decided by Michael Westbrooks on 2026-10-30.

| # | Decision | Outcome |
|---|---|---|
| D1 | Audience | **One path for everyone.** No role question; the same story and the same four first-step choices for every user |
| D2 | How to show ideas the product does not ship yet | **Sample estate examples, kept high level and general**, communicating a shared value proposition. The evidence model is being built in another worktree, so the tour does not depict specific product screens |
| D3 | Brand | **LANA AI brand** (dark, emerald, Montserrat and Playfair, corner brackets), from `brand-delivery/lana-ai-content` and `RedRoosterTech-Web/public/assets/img` |
| D4 | Voice | **First person** ("I'm LANA") |
| D5 | Firm-level admin toggle | Out of scope for now. `admin/onboarding_management.html` is a hardcoded mock |
| D6 | Where onboarding status is saved | **On the device only**, not the database (decided 2026-10-30) |
| D7 | Who sees "Invite your team" | **Org admins and system admins only**, the roles the server lets create users |

---

## 9. Out of scope

- Firm-level setup (organization creation, billing, connector credentials). This is a per-user, first-run experience.
- The device verification page `src/onboarding.html`. It keeps its name and job; the new work uses a different name to avoid confusion.
- Building the evidence-state model itself. That is product work in `LANA-AI`, tracked separately.

---

## 10. What was built (2026-10-30)

### Client (`lana-ai-client`)

| Piece | File |
|---|---|
| Tour component and launcher (`Lex.Onboarding.launch`) | `src/js/lex/components/foundation/lex-onboarding.js` |
| Styles, scoped under `lex-onboarding`, light by default (`theme="dark"` for the media-kit look) | `src/css/lex-onboarding.css` |
| Pure flow: scenes, launch rules, first-step destinations | `src/js/onboarding/onboarding-flow.js` |
| Persistence: server first, per-user local cache fallback | `src/js/onboarding/onboarding-state.js` |
| Brand fonts | `src/fonts/lana/` |
| Mounted on the dashboard right after the user profile loads | `src/dashboard.html`, `src/js/dashboard/dashboard.js` |
| "Replay the tour" in the profile menu (`dashboard.html?tour=replay`) | `src/js/lex/components/layout/lex-app.js` |
| Review harness hosting the real component | `prototypes/onboarding/` |

Where each first step goes (UI gating only; the server enforces access):

| Choice | Who sees it | Destination |
|---|---|---|
| Connect your files | Admins (the roles that see Data Connectors in the sidebar) | `data-connectors.html` |
| Explore your library | Everyone else | `drive.html` |
| Open a matter | Everyone | `workspaces.html?action=create&type=matter`: the create sheet opens with Matter preselected (new `type=matter` handling in `src/js/workspace.js`) |
| Ask me anything | Everyone | Stays on the dashboard and opens the Ask LANA dock with the cursor in the composer |
| Invite your team | Org admins and system admins only (`Lex.Auth.canAccessAdminPages()`), matching the server's `USER_ADMIN_ROLE_NAMES`; a plain `admin` cannot create users, so does not see it | `admin/users.html?action=create`: the Add User dialog opens (new handling in `src/js/admin/admin-users.js`) |

`lex-nav.js` deep-link registry gained `dashboard.html?tour`, `workspaces.html?type` and `admin/users.html?action`.

Changes from the prototype: the coach marks, Getting started card and mock shell were dropped because each choice now goes straight to its real page; the tour is light to match the client, which has no dark mode yet.

### Backend

None. An `onboarding` preference category was added to `LANA-AI` and then fully removed when the user decided status should live on the device (D6). `LANA-AI` has no diff from this work; notes in `LANA-AI/.claude/plans/onboarding-preference.md`.

### Verification

| Check | Result |
|---|---|
| Client unit suite (`npm run test:unit`) | 173 suites, 2,416 tests passed |
| New client tests | `onboarding-flow` (22, the Invite gating test seen failing with Invite on the broad admin check), `onboarding-state` (6), Add User deep link (1, seen failing with the deep link removed) |
| Harness walkthrough in Google Chrome | 38 checks: full story, brackets fully drawn, every destination, role gating (org admin, plain admin, member), explore, no network requests, skip, keys, resume once, replay, focus trap, no scroll, dark theme, narrow window |
| Real app against the local API | 11 checks: signed-in user lands on the dashboard, tour opens, choices match the user's real roles, "Open a matter" opens the create sheet with Matter preselected, no preferences API calls, tour stays closed on the next visit, replay link reopens it and clears the param |
