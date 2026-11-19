# Desktop app hardening, part B: IPC allowlist

Branch `feat/harden-ipc` (from `origin/development-new`). Part A (CSP and
webSecurity in window creation and session setup) is on `feat/harden-web`; this
branch keeps its `electron-main.js` edits to IPC handlers and their
registration.

Context read: `../../Claude.md` (workspace), `Claude.md` (client).

## Problem

`electron-preload.js` exposed `electronAPI.invoke(channel, ...args)` and
`electronAPI.send(channel, ...args)`, which forwarded any channel name. Script
injected into any app page could reach every `ipcMain` handler: VPN keys,
pointing the app at another server, PAC bridge consent, the token store,
Briefs, the updater and more. Handlers did not check who called them (only the
token store and the screen voice overlay did).

## Design

1. **Preload: named functions only.** `electronAPI` has no `invoke`, `send` or
   `on`. Each function names its channel as a string literal; nothing a page
   passes becomes a channel name. An unknown function is simply not there
   (`electronAPI.invoke(...)` throws `TypeError`).
2. **One sender check.** `electron-ipc-guard.js` wraps `ipcMain`. A call is
   answered only from the **top frame** (`event.senderFrame.parent === null`)
   of an **app page**: since part A, exactly `lana-app://app/public_html/...`
   (`isAppUrl` / `pageOf` in `electron-app-protocol.js`, the one app-page
   check the token store, window-open policy, location and Briefs use too).
   Remote pages, `file:` pages, other `lana-app` hosts or paths and frames
   inside a page are refused. A refused invoke rejects; a refused sync call returns `null`.
3. **One policy table.** `electron-ipc-policy.js` lists every channel:
   kind (`invoke`, `sync`, `send`), one validator per argument (types and
   sizes; extra arguments are refused), and for sensitive channels a page list
   and/or a gesture requirement. Registering a channel without a policy throws,
   so a new handler cannot skip the check.
4. **Gestures.** `createGestureTracker` listens to every webContents'
   `input-event` (registered on `app.on('web-contents-created')`) and keeps the
   last mouse down/up, key press or tap per window. A gesture channel needs one
   in that window within the last 30 seconds (long enough for a click followed
   by a network call, such as OAuth). A native folder dialog the person
   answered counts as a gesture (Brainchild install, then vault).
5. **Page limits only where the URL means something.** Pages inside the app
   shell keep `app.html` as their URL (lex-router never changes it), so a page
   limit is used only for standalone pages: the sign-in and app-link pages
   (server repoint) and the update window.

Every module that registers handlers gets the guarded `ipc` from
`electron-main.js` in place of `ipcMain` (token store, app links, system info,
AI topology, location, appearance, first launch, local engine, Briefs'
`briefs:running`, session tracker). Two places register on raw `ipcMain` and
call the shared helper directly: the update window's `update-dialog-response`
(`refusalFor` plus "is this the update window") and the screen voice overlay
(`isAppSender` plus "is this the overlay window"). The Briefs host (its own
typed bridge, `briefs/packages/host`) already refused other senders by URL; it
is given the guard's app-page check (`deps.isAppUrl`) and refuses frames
inside a page (`trustedTopFrame`).

## Channel inventory

Callers are files under `src/` (served as `public_html/`). "Page" means the
document URL main sees. Gesture = needs a recent click or key press.

### Client preload (`electron-preload.js`, `window.electronAPI` / `window.lanaAuthToken`)

| Channel | Registered in | Called from | What it can do | Now |
|---|---|---|---|---|
| `auth-token:get` (sync) | electron-token-store.js | preload, every page | returns the login token | kept; app page only. The only path that hands the token to a page |
| `auth-token:set` (sync) | electron-token-store.js | login, token refresh (api.js, any page) | replaces the login token | gated: string up to 16 KB or null. No page or gesture limit: every page's token refresh writes it |
| `auth-token:clear` (sync) | electron-token-store.js | sign-out (any page) | signs out | gated: no arguments |
| `auth-token:migrate` (sync) | electron-token-store.js | preload, once | moves an old localStorage token to the keychain | gated: string up to 16 KB |
| `get-config` | electron-main.js | lex-app, dashboard, settings-v2-nav, login, workspaces, ... | app version, platform, flavor | kept |
| `get-version` | electron-main.js | login, version.js, many standalone pages | app version | kept |
| `renderer-log-error` | electron-main.js | error-reporter.js, companion-bridge-consent.js | writes the app log | gated: message string up to 16 KB (preload trims to 8000), details up to 64 KB |
| `renderer-log-info` | electron-main.js | error-reporter.js | writes the app log | gated: string |
| `save-settings` | electron-main.js | login.html, app-link-page-kit.js (accept-invite, activate, mfa-setup, shared-link) | **repoints the app at a server**, restarts the engine | gated harder: those five pages only; object up to 256 KB |
| `chef-pin:prepare` | electron-main.js | login.html, app-link-page-kit.js | pins a box Chef certificate | gated harder: same five pages; object |
| `chef-pin:refusal` | electron-main.js | login.html, app-link-page-kit.js | why a certificate was refused | gated: optional string |
| `discovery:resolve` (round 3) | electron-main.js, electron-discovery.js | login.html, activate.js | main asks hosted discovery, keeps the firm keys, returns the answer without them | new; `login.html` and `activate.html` only; object, handler checks org id (1 to 128 characters) and domain (up to 253) |
| `get-saved-server` | electron-main.js | api.js, login, index, lex-sidebar, url-utils, app-link-page-kit | the saved firm (no token, no firm service keys) | kept; strips `burstApiKey` and `forgeApiKey` (round 2) |
| `app-links:login-context` | electron-app-links.js | login.html, mfa-setup.js | is an app link waiting | kept |
| `app-links:take-pending` | electron-app-links.js | login.html, mfa-setup.js | which page to continue to | gated: object |
| `engine:api-base-sync` (sync) | electron-local-engine.js | api.js | API base | kept |
| `editor-service:base-url-sync` (sync) | electron-main.js | document-review-api.service.js | editor loopback address (never its token) | kept |
| `engine:status`, `engine:restart`, `engine:background-jobs` | electron-local-engine.js | settings-local-engine, settings-offline-copy, lex-app banner, engine-background-jobs | local engine status and restart | kept |
| `engine:set-enabled`, `engine:set-background-jobs` | electron-local-engine.js | Settings > Local AI | engine preferences | gated: object |
| `appearance:get` / `appearance:set` | electron-appearance.js | lex.theme.js (every page), Settings | Light / Dark / System | kept / gated: string up to 32 |
| `first-launch:plan`, `find-existing`, `pause`, `resume`, `status`, `capabilities`, `servers` | electron-first-launch-ipc.js | first-launch.html, Settings > Capabilities | setup state and downloads | kept |
| `first-launch:choose`, `continue`, `switch-chat` | electron-first-launch-ipc.js | same | pick the chat model, start downloads | gated: object |
| `capabilities:list`, `get-voice-settings`, `get-voice-permissions` | electron-main.js | settings-screen-diction.js | screen diction state | kept |
| `capabilities:set-active`, `set-open-at-login`, `set-voice-settings`, `request-voice-permission` | electron-main.js | settings-screen-diction.js | screen diction settings, OS permission prompts | gated: object (voice settings up to 64 KB) |
| `location:get-choice`, `location:system` | electron-location.js | preload, settings-location.js | location setting | kept |
| `location:set-choice` | electron-location.js | settings-location.js | turns location on or off | gated: object |
| `location:open-system-settings` | electron-location.js | settings-location.js | **shell**: opens the OS settings page | gated harder: gesture |
| `check-updates` | electron-main.js | admin-updates.js | update check | gated harder: the argument must be null (a page can no longer name the update server) |
| `install-update` | electron-main.js | admin-updates.js | **updater**: downloads, quits, installs | gated harder: argument must be null; gesture |
| `settings:system-info`, `settings:ai-topology`, `settings:update-status`, `settings:check-for-updates` | electron-system-info.js, electron-ai-topology.js | settings-general.js, settings-ai-models.js | read only, update check | kept (no arguments) |
| `settings:install-update` | electron-system-info.js | settings-general.js | **updater**: shows the update window | gated harder: gesture |
| `update-dialog-response` (send) | electron-updater-custom.js | update-dialog.html | **updater**: install now, retry, later, skip | gated harder: only the update window, page `update-dialog.html`, one of four values. Was reached through generic `send`; now `electronAPI.updateDialog.respond` |
| `session-tracker:initialize` | electron-main.js | api.js | starts heartbeats | gated harder: takes no arguments. Main uses its own API base and token store; before, the page passed a URL and the token, so a page could send the token to any address |
| `session-tracker:start` | js/session/session-tracker.js | api.js | starts a session | kept. Was reached through generic `invoke`; now `electronAPI.sessionTracking.start` |
| `open-external-url` | electron-main.js | openExternal (settings, calendar, seat limit, MCP and connect wizards, connectors, OAuth, update window), brainchild.openNote | **shell**: opens a URL in the system browser (schemes limited by src/electron-external-url.js) | gated harder: string up to 8 KB; gesture. Seven callers used generic `invoke`; now `openExternal` |
| `brainchild:discover`, `status` | electron-main.js | brainchild/app.js | vault status | kept |
| `brainchild:link`, `listNotes`, `search`, `getNote` | electron-main.js | brainchild/app.js, drive.js | **file system**: links and reads the vault | gated: object (link stays limited to picked or default roots) |
| `brainchild:pickInstall`, `pickVault` | electron-main.js | brainchild/app.js | **file system**: native folder picker that trusts a root | gated harder: gesture (answering the install dialog counts for the vault dialog) |
| `brainchild:unlink` | electron-main.js | brainchild/app.js | forgets the link | gated harder: gesture |
| `brainchild:revealNote` | electron-main.js | brainchild/app.js | **shell**: shows a file in Finder | gated harder: object; gesture |
| `generate-oauth-state` | electron-main.js | connector-crm.html, connector-communications.html | random state | kept |
| `companion-bridge:respond-consent` | electron-main.js | companion-bridge-consent.js | **bridge consent**: lets a sibling app get a token | gated harder: object; only the window that was asked; allowing needs a gesture (deny does not, so closing a page still answers). A refused allow leaves the request pending |
| `settings:list-bridge-consents` | electron-main.js | settings-v2.js | lists consents | kept |
| `settings:revoke-bridge-consent` | electron-main.js | settings-v2.js | **bridge consent**: revokes | gated harder: object; gesture |
| `briefs:running` | electron-briefs.js | Briefs bridge (briefs-preload.cjs) | is Briefs running | kept |

Main-to-page events the preload listens on (literal channels, listed in
`EVENT_CHANNELS`): `engine:state`, `appearance:changed`,
`first-launch:status-changed`, `update-available`, `update-downloaded`,
`update-progress`, `update-error`, `oauth-callback`,
`companion-bridge:request-consent`.

### Removed (nothing called them; grepped `src/`, `js/`, `briefs/packages/`)

| Channel | Registered in | Preload function removed |
|---|---|---|
| `load-settings` | electron-main.js | `loadSettings` |
| `connect-to-server` | electron-main.js | `connectToServer` |
| `verify-server` | electron-main.js | `verifyServer` (main's own startup check still calls `verifyServer()` directly) |
| `clear-saved-server` | electron-main.js | `clearSavedServer` (main's sign-out paths still call it directly) |
| `vpn-generate-keypair`, `vpn-save-keys`, `vpn-load-keys`, `vpn-clear-keys`, `vpn-get-device-id` | electron-main.js (and its `vpn-keys` store with a hard-coded key) | `vpn.*` |
| `session-tracker:getStatus`, `session-tracker:updateMatter`, `session-tracker:end` | js/session/session-tracker.js | `sessionTracking.getStatus`, `updateMatter`, `end` |
| `create-oauth-state`, `exchange-oauth-code` (round 2) | electron-main.js | `createOAuthState`, `exchangeOAuthCode` |
| generic `invoke` / `send` | electron-preload.js | `invoke`, `send` |

Settings > VPN in `src/js/settings-v2.js` read a `vpnManager` global that no
script defines, so it already did nothing. Round 2 deleted it: the section's
code, `#sv2-section-vpn` in `settings-v2.html` and the `.sv2-vpn-*` rules in
`css/settings-v2.css`. Discovery's `vpn` block (the "only reachable over the
VPN" message in `js/shared/server-reachability.js`) stays: it is live.

### Screen voice overlay (`screen-voice-preload.js`, `window.screenVoice`)

All 23 `screen-voice:*` invoke channels are literals in the overlay preload and
registered in `src/screen-voice/electron-screen-voice.js`. Each already
checked "is the overlay window"; it now also passes the shared
`isAppSender` (top frame of the overlay page). The overlay window is already
`sandbox: true`. `screen-voice:realtime-context` / `realtime-reconnect` return
a short-lived voice token in the websocket URL; that is the overlay's own
scoped credential, not the login token.

### Briefs (`window.lanaBriefs`)

The Briefs bridge (`briefs/packages/host/src/preload/bridge.ts`) builds its
channels from the fixed `ALL_API_METHODS` list, never from page data, and its
host refuses senders that are not trusted URLs. That URL check is now the
guard's app-page check (`deps.isAppUrl` in `electron-briefs.js`), and since
round 2 the host also refuses frames inside a page (`trustedTopFrame`).

## The login token

`window.lanaAuthToken.get()` stays: pages send the bearer token to the API.
Other paths that used to hand it out or take it from a page:

- `session-tracker:initialize` took the token and an address from the page;
  main now reads both itself.
- No other handler returns the login token. `get-saved-server` returns the
  saved firm (no token), `engine:status` returns status, Briefs and screen
  voice read the token in main.

## sandbox: true (done after part A landed)

All five windows are sandboxed: main, login, Briefs capture, update dialog
(electron-preload.js) and the screen voice overlay (screen-voice-preload.js,
already was).

A sandboxed preload can `require` only `electron` and a few built-ins, and
electron-preload.js requires `./src/js/brand/lana-brand`,
`./src/js/location-permission.model` and `./briefs/dist/briefs-preload.cjs`.
So those windows always load it as one bundled file
(`electron-preload-path.js` `clientPreloadPath`):

- packaged: `electron-preload.js` at the app root, which is already the
  esbuild bundle (`scripts/bundle-electron.js`);
- unpackaged: main bundles it with esbuild once per launch into
  `electron-dist/dev-preload/electron-preload.js` (gitignored, not shipped),
  so `npm run electron`, `electron:dev` and the dev watcher need no extra
  step and a restart picks up edits. When `briefs/dist` is not built, the
  bundle leaves the Briefs require unresolved and the client runs without
  Briefs, as before.

The source file and its three modules are unchanged, so behavior is the same.
`tests/unit/electron-preload-sandbox.test.js` runs the bundle with a
sandbox-like `require` (only `electron` and built-ins) and checks the API,
the flavor from `--lana-flavor` and the location model.

## Tests

- `tests/unit/electron-ipc-guard.test.js`: app pages vs remote pages, other
  files, traversal, frames and missing frames; the gesture tracker; the guard
  refuses unregistered channels, foreign frames, bad and extra arguments,
  missing gestures, wrong pages; sync calls return null; the sensitive channels
  (server repoint, updater, token writes, shell and file system, bridge
  consent, session tracking) refuse bad arguments.
- `tests/unit/ipc-allowlist.test.js` (static scan): every `ipcRenderer` call in
  the preload names a literal channel that is in the policy with the same
  kind; the loaded preload has no `invoke`/`send`/`on`/`vpn`; every exposed
  function reaches only allowed channels; no renderer file calls
  `electronAPI.invoke`/`send`; every `electronAPI.x` / `electronAPI.x.y` used
  in `src/`, `js/` and `briefs/packages/` exists; `electron-main.js` registers
  only through the guard and only policy channels; the modules main passes the
  guard register only policy channels; every policy channel is used by a
  preload (no dead channels); the overlay preload's channels are all
  registered.
- Updated: `session-gate.test.js`, `api-framed-session.test.js`,
  `screen-voice-manager.test.js`.
- Round 2: `briefs/packages/host/test/trustedTopFrame.test.ts` (new, vitest)
  and `hostStartup.test.ts` (a framed or frameless levels sender is ignored);
  `electron-api-base.test.js` (firm keys never reach a page, a page cannot set
  them); `org-discovery.test.js` (keys not kept); `ipc-allowlist.test.js`
  (no renderer code names the keys); `preview-frame-policy.test.js` (the
  deleted OAuth `window.open` dropped from its list).

## Round 2 (leftovers closed)

1. **OAuth state and exchange: deleted.** `initiateOAuthFlow` in
   `src/js/connector-config-renderer.js` was the only caller of
   `create-oauth-state` and `exchange-oauth-code`, and no page or script
   loads `connector-config-renderer.js` (only two Jest tests read its source).
   No connector flow reached it; the live connector OAuth runs through the
   connector pages (`generate-oauth-state`, `openExternal`, `onOAuthCallback`,
   `js/shared/connector-oauth-exchange.js`). Deleted the two channels, their
   handlers, the preload functions, `initiateOAuthFlow` and the OAuth connect
   button handler in that file. The rest of that file is also loaded by no
   page; it is left for whoever owns the connector config form.
2. **Briefs host top-frame check.** `trustedTopFrame(isTrustedURL)` in
   `briefs/packages/host/src/main/ipc.ts` refuses a sender with no frame or a
   frame inside a page, then asks the URL check, which in the client is the
   shared guard's app-page check (`deps.isAppUrl` from `electron-ipc-guard.js`).
   `host.ts` uses it for the bridge channels and the recording, levels and
   Talk frame channels. Rebuilt with `node scripts/build-briefs.js`
   (`briefs/dist` is not committed).
3. **Firm service keys.** No page uses `burstApiKey` or `forgeApiKey`, and
   nothing in the client uses them at all: the pages only copied them from the
   discovery answer into `saveSettings` and `localStorage`. Now:
   - `get-saved-server` strips them (`withoutFirmSecrets`, electron-api-base.js),
     so they leave `localStorage` too (api.js rewrites `lana_saved_server` from it).
   - `save-settings` ignores keys from a page and keeps the stored ones for the
     same firm (`keepStoredFirmSecrets`); a new firm gets them from main's own
     discovery refresh at the next start (electron-discovery.js), as before.
   - `org-discovery.js`, `login.html` and `app-link-page-kit.js` no longer read
     or forward them; a static test fails if renderer code names them again.
   - Round 3 closed the last gap: the discovery request moved into main, so
     the answer's keys never reach a page at all.
4. **VPN UI deleted** (above).

## Round 3: discovery in the main process

The control plane keeps sending the firm keys (main's own discovery refresh
needs them), so the pages' discovery request moved into main:

- `discovery:resolve` (electron-main.js) calls `discoveryForPage` in
  electron-discovery.js: `requestDiscovery` checks the org id (a string of 1 to
  128 characters after trimming) and domain (up to 253), posts them to main's
  `HOSTED_DISCOVERY_URL`, and returns `{ invalid }`, `{ reached: false }` or
  `{ reached: true, status, body }` for every status. The keys in the answer go
  to main (`firmSecretsFromDiscovery`, kept for that org until `save-settings`
  saves the firm); the page gets `withoutFirmSecrets(body)`.
- Policy: `login.html` and `activate.html` only (the two pages that look a firm
  up), one object argument.
- `js/shared/org-discovery.js` no longer has the discovery address or makes the
  request: `resolveOrganization(orgId, serverUrl, { discover })` takes main's
  answer (`electronDiscover`, `window.electronAPI.discovery.resolve`) and keeps
  the same errors and messages (`invalid`, `offline`, `service`, `not_found`,
  `unavailable`). The answer's `discovery.vpn` block is untouched, so the
  VPN-only reachability message is the same.
- `login.html` (Connect and the background refresh of a saved firm) and
  `pages/activate.js` use it. The background refresh now waits up to main's
  15 seconds instead of 5; it runs in the background either way.
- `save-settings` takes the keys main got from that discovery answer for the
  same org, else the stored ones for the same org.
- Tests: `electron-discovery-for-page.test.js` (request checks, every outcome,
  keys stripped and remembered, VPN block kept, page limit);
  `ipc-allowlist.test.js` (no renderer code holds the discovery address);
  `org-discovery.test.js`, `login-signin-flow.test.js` (the page through
  main's answer; same messages); `electron-api-base.test.js`.

## Round 4: rebased on part A (feat/harden-web 9f1b3d69)

- Rebase conflicts: `electron-main.js` (imports: part A's new requires and
  `CONTROL_PLANE_URLS` beside `discoveryForPage`) and `electron-discovery.js`
  (exports). Everything else merged cleanly; part A added no IPC channels.
- The guard's app-page check is part A's (`lana-app://app/public_html/`); the
  file: logic and app-root folders are gone from `electron-ipc-guard.js`.
  The window-open policy already uses the same module (`resolveAppFile`), so
  there is one app-page helper.
- sandbox: true on the four windows (above).
- The page CSP no longer allows the discovery origin (`CONTROL_PLANE_URLS` in
  electron-discovery.js keeps only the help center): no page fetches
  discovery since round 3.

## Round 5: 9c's review

- **HIGH (hotfix, landed as 7e69119a on development-new):** `handleConnectLink`
  spliced the `lana-ai://connect/<org-id>` path into `executeJavaScript`. The
  org id now must match the org id pattern (`connectLinkOrgId`) and reaches
  login.html as data (`connect-link:org` event). Carried here with the event
  listed in `EVENT_CHANNELS`. When no window or another page is showing, the
  id waits (`createConnectOrgQueue`, newest only, 30 minutes) until login.html
  takes it (`connect-link:take`, login.html only).
- **Script sinks:** `tests/unit/helpers/script-sink-scan.js` fails on any
  `executeJavaScript` / `insertCSS` whose first argument is not one fixed
  literal (variables, `${}`, `'a' + x`, spaced and bracket calls), across root
  and `src/` main-process modules, screen voice, `js/session` and the Briefs
  host. The storage migration (part A) now carries old localStorage values
  as base64 only, with its own test.
- **Gestures (MEDIUM 1):** only mouse up, keys and taps whose focused frame is
  one of the app's own (input in a third-party frame inside a page does not
  count), on a window showing an app page, for 2 seconds. install-update,
  always-allow companion consent and revealNote ask in a main-process dialog
  (`electron-confirm.js`, Cancel by default).
- **Browser opens (MEDIUM 2):** every open (the channel, window.open from any
  frame, page navigation) goes through `electron-external-open.js`: allowed
  schemes, the app's top frame (and its focused frame for window.open), 3
  opens per window per 10 seconds, and a recent click or a yes in the app's
  dialog. The channel itself no longer needs a gesture, so OAuth after a
  network wait asks instead of failing.
- **CSP hosts (LOW 3):** `originOf` accepts only `[a-z0-9.-]` hosts.
- **Firm keys (LOW 4):** a key is kept only for the same org and the same
  burst or Forge address it came with.
- **Non-HTML CSP (LOW 5):** SVG never runs script; scripts run as workers on
  the app origin only; any other file is an inert sandboxed document.
- **OAuth (LOW 6):** a callback without a state is refused
  (`electron-oauth-state.js`).
- **Permissions (LOW 7):** the Briefs host's media check accepts the app
  origin (the check handler gets `lana-app://app`, not a page URL); every
  other permission follows the app's one policy (`electron-location.js`):
  the app's own pages keep their permissions, geolocation needs Allow, any
  other origin gets none, with or without Briefs. Briefs puts the app's
  handlers back when it stops.
- **Raw channel limits (LOW 8):** `RAW_IPC_LIMITS` in electron-ipc-policy.js
  with `payloadBytes` from the guard, for the screen voice channels and the
  Briefs bridge, recording, levels and Talk frames.
- Other repos: LANA-AI `feat/cors-lana-app-origin` stray blank lines removed;
  lana-editor `feat/cors-lana-app-origin` CORS `describe()` names
  `lana-app://app`.

## Round 6: 9c's re-review

- **openExternal (MEDIUM):** the permission policy denies `openExternal`
  everywhere (Chromium asks for it when a frame goes to a custom scheme). A
  `will-frame-navigate` handler on every webContents keeps app and web content
  in frames (`decideFrameNavigation`), blocks any other scheme in the frame,
  and sends mail and vault links through the opener as the frame that started
  the navigation.
- **Opener checks (LOW 1):** window.open is judged by its opener: the
  referrer's origin, and only without a referrer (rel=noreferrer) the focused
  frame. Electron 44's window-open details carry no opener frame.
- **Dialogs (LOW 2):** the rate budget is spent only when a link opens; one
  question per window at a time; no new question for 10 seconds after Cancel.
- **Connect link (LOW 3):** the queued org id belongs to the sign-in window the
  link opened; a take from any other window drops it, and sign-out clears it.
  With a window open on another page, the link is not used (as before).
- **Install question (LOW 4):** names the version from the update check.
- **Mail links (LOW 5):** `attach`, `attachment`, `cc` and `bcc` are dropped
  (`sanitizeExternalUrl`); nothing in the app uses them.

## Round 7

- A window.open with no referrer always asks (a frame can hide its origin
  with noreferrer); the app's own links (33 places in 19 files under src/)
  dropped noreferrer and keep noopener, so their referrer is the app origin
  and a click opens them. http:// targets get no referrer from a secure origin
  and ask.
- will-frame-navigate refuses a navigation with no initiator.
- mailto links lose CR and LF, raw or percent-encoded.

## Left over

- The main checkout's `node_modules` lacks `vitest` and `@hpke/core` (both in
  package-lock.json); `npm run test:briefs` and `npm run build:briefs` need an
  `npm install` there. Round 2 ran them with those two packages installed in
  a scratch folder.
