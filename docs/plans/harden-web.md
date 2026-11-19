# Desktop app hardening, part A: CSP and webSecurity

Branch `feat/harden-web` (from `origin/development-new`). Part B (IPC allowlist in
`electron-preload.js` and the `ipcMain` handlers) runs on `feat/harden-ipc`; this
branch only touches window creation, session and protocol setup in
`electron-main.js`, plus the modules those call.

Context read: `../../Claude.md` (workspace), `Claude.md` (client),
`src/js/lex/LEX-COMPONENT-RULES.md` for the handler conversions.

## Why webSecurity was off

`webSecurity: false` has been on both app windows since the initial commit
(`0f3ec33c`, "Disable for file:// protocol to work with absolute paths"). Checking
each suspected cause against the code:

| Cause | Found | What breaks with webSecurity on under file:// |
|---|---|---|
| file:// absolute paths | Yes. 9 root-relative links (`/workspaces.html`), and `will-navigate` rewrites them into `public_html`. | Navigation itself still works (the rewrite does not need webSecurity off). |
| file:// as a unique opaque origin | Yes, the real blocker. 5 pages load ES modules (`automation/`, `voice/`, `insights/module-execution.html`, `admin/reporting.html`), the file viewer and editor `import()` the LANA editor from its loopback service through an import map, and `help.js` / `faq.js` / `article.js` `fetch()` local JSON. | file:// module scripts, `fetch()` of file:// and cross-origin module imports are refused when the origin is `null`. |
| CORS to the backend and services | Yes. Every API call carries `Authorization`, so it is preflighted. Chef's CORS is `CORS_ORIGINS` or nothing (`credentials: false`), and nothing lists the app's origin. The local engine, the editor service, Forge and the control plane (discovery, help) are fetched straight from the renderer. `electron-cors.js` adds `Access-Control-Allow-Origin: *` to every response from every site. | Every API call fails the CORS check once it is enforced. |
| iframes / framed apps | Partly. Previews, the PDF viewer (blob), embed partner apps (`embed-host.js`), the editor service. | These do not need webSecurity off; with it off, every same-process frame reads the app's globals (see `preview-frame-policy.js`), which is the risk. |
| Third-party embeds | CDN assets: Font Awesome CSS (10 pages, cdnjs), Drawflow (workspaces, workspace-details, workflows/builder), Chart.js (2 admin pages), the Tailwind play CDN (a test page). | Nothing; they are just remote code and styles the CSP should not allow. |

Update and model downloads run in the main process (`electron-updater-custom.js`,
`electron-model-download.js`), not in the renderer, so they never depended on
webSecurity.

## Fix for each cause

1. **Serve the app from a privileged custom protocol.** `lana-app://app/public_html/<page>`,
   registered with `protocol.registerSchemesAsPrivileged` (standard, secure,
   supportFetchAPI, corsEnabled, stream, codeCache; no bypassCSP) and served by
   `protocol.handle` from the same `public_html` folder (asar in a packaged build).
   - A real origin, so modules, `import()`, workers and local `fetch()` work.
   - The URL keeps `/public_html/` in its path on purpose: `lex-nav.js`,
     `lex-router.js`, `lex-app.js`, `navigation-helpers.js`, `menu.js` and
     `lex-chat.js` find the app root by that marker, as they do under file://
     today. No renderer path logic has to change.
   - Root-relative navigations (`/workspaces.html`) are rewritten into
     `/public_html/` by the navigation guard, replacing the file:// rewrite.
   - Path resolution refuses `..`, encoded separators and symlinks that leave
     `public_html`.
   - Every check that trusted "any file:// page" now trusts exactly the app
     origin through one helper (`electron-app-protocol.js isAppUrl`): token
     store, Briefs, location permission, editor token injection, window-open
     policy. That is stricter than before (a stray local file is no longer
     trusted).
   - The renderer checks that meant "running in the desktop app" by
     `location.protocol === 'file:'` also accept `lana-app:` (api.js iframe
     fallback, brainchild, connect wizard, MCP connect).
   - **Storage moves with the origin.** localStorage and sessionStorage are per
     origin, so the first start of this build copies the file:// origin's
     localStorage into the app origin once (`electron-origin-migration.js`), then
     marks it done. The login token is not in localStorage (main-process token
     store), so sign-in survives regardless.
2. **CORS in the main process, scoped, instead of in the backend.** No backend
   change. `electron-cors.js` now answers only for responses from the configured
   origins (Chef, local engine, editor service, Forge, burst, control plane) and
   only with the exact app origin (`Access-Control-Allow-Origin: lana-app://app`,
   never `*`), allows the methods and headers the app sends, exposes response
   headers, and turns a non-2xx preflight from those origins into 204. Responses
   from any other site keep their own headers, so an embedded partner page or a
   remote document gets ordinary browser CORS. The old global `*` is gone.
   - Round 2: Chef and the local engine now answer for `lana-app://app`
     themselves (see "CORS without the preflight assumption"); this
     main-process answer stays as the fallback.
3. **CSP** (below) replaces the CDN assets with vendored copies.

## CSP

Built per page load by the protocol handler (`electron-csp.js`), from live config:
the saved server (`url`, `chefUrl`, `forgeUrl`, `burstUrl`), the local engine URL,
the editor service URL and the control plane origins (from
`electron-discovery.js`). Nothing is hardcoded in the policy builder; the
builder refuses anything that is not a plain http(s) origin (no `*`, no paths, no
scheme sources).

```
default-src 'self';
script-src 'self' 'nonce-<per response>' 'unsafe-hashes' <sha256 of each inline handler in the page> <editor service origin>;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: <api origins>;
font-src 'self' data:;
connect-src 'self' <api origins>;
frame-src 'self' blob: <api origins> <embed app origins>;
worker-src 'self' blob:;
media-src 'self' blob: data: <api origins>;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'self'
```

- **No `unsafe-eval`.**
- **Inline `<script>` blocks** (68 in 56 pages) run by nonce: the handler adds the
  per-response nonce to the page's own `<script>` tags. Script inserted later by
  page code (innerHTML) never carries it. The one script the app creates on
  purpose, the editor import map (file viewer, file editor), copies the nonce
  from `document.currentScript`.
- **Inline handler attributes in the HTML files** (`onclick="..."`, 831 in 36
  files, 354 of them in `lex-test.html`) are allowed by their exact SHA-256
  (`'unsafe-hashes'`), computed by the protocol handler from the page it serves.
  An injected `<img onerror=...>` matches none of them and is blocked.
- **Inline handlers built by JavaScript** cannot be hashed (their text has
  ids in it). All of them are gone (round 2): about 380 sites in 40 files and
  15 pages' inline scripts, including the matters pages. Markup built by script
  names an action through one shared helper, `src/js/shared/dom-actions.js`
  (`window.LanaDomActions`):
  - `LanaDomActions.on('click', 'viewMatter', [id], { stop: true })` writes
    `data-on-click="viewMatter" data-args-click="[...]" data-stop-click`; the
    arguments are JSON data, so an id or name is never code. Special arguments
    stand for the event, the element, its value and its checked state.
  - Only registered names run: each script registers the functions its markup
    names (`register` for local functions, `registerGlobals` for page
    globals), so injected markup cannot call an arbitrary global.
  - Each element gets its own listener the first time an event passes the
    document (capture phase), so `stop` stops at the element as the inline
    attribute did, and programmatic `.click()` right after render works.
  - Values that the old handlers HTML- or JS-escaped into the attribute
    (`escapeHtml`, `escapeJsForHtmlAttr`, `jsArg`, `connectorJsArg`,
    `escapeJs`) are passed raw now; the browser used to decode them, so the
    functions receive the same values as before.
  - A few handlers that were small scripts became named actions or CSS-free
    listeners: field options split, cascade checkbox, assign-dialog name,
    connector logo fallback, chart help open/close, "Go to My Boards",
    picker item hover, and the three "Submit Support Ticket" buttons became
    links.
- **`INLINE_HANDLER_DEBT_PAGES` is empty.** `tests/unit/electron-csp-debt.test.js`
  fails, naming the page and script, if any page's script builds an on*=
  attribute again, if a page would get `'unsafe-inline'` for script, or if a
  page whose script names actions does not load `dom-actions.js` first.
- **The SPA shell** (`app.html` with `js/lex/lex-router.js`) swaps other pages'
  markup in with innerHTML, so its hash set is every page's handler hashes
  (computed once by the protocol handler).
- **`style-src 'unsafe-inline'`** stays: 3,544 `style=""` attributes and the
  Lex components' `<style>` blocks. Debt, lower risk than script.
- `connect-src` on the sign-in pages (`login.html`, `first-launch.html`) also
  allows `https:` and `http:`: the person types or discovers the firm's server on
  that page, so its origin is not known when the page loads. These pages render
  no firm data. Every other page gets only the configured origins.
- Violations: in development (`NODE_ENV=development`) the main process logs each
  renderer `Content Security Policy` console message with the page.

## Window options

- `webSecurity: true` on every window (main, login, Briefs capture, update
  dialog). The PDF viewer keeps `plugins: true` on the two app windows.
- `sandbox: true` where the preload allows: the update dialog and capture
  windows use `electron-preload.js`, which `require`s local modules
  (`src/js/brand/lana-brand.js`, `src/js/location-permission.model.js`,
  `briefs/dist/briefs-preload.cjs`), which a sandboxed preload cannot do. So all
  four windows that use `electron-preload.js` stay `sandbox: false` **for part B**
  (bundle the preload or inline those modules, then flip it). The screen voice
  overlay and popups were already sandboxed.

## Navigation guards

- `will-navigate` (and `will-redirect`) on every webContents: app origin pages
  allowed; root-relative app paths rewritten into `/public_html/`; a file://
  URL inside `public_html` is rewritten to its app URL; http(s) and mailto open in
  the system browser through `src/electron-external-url.js`; everything else
  denied.
- `setWindowOpenHandler` on every webContents with the existing
  `electron-window-open-policy.js` (now app-origin aware).
- `will-attach-webview` denied (no webviews are used).

## Verification

Results (2026-11-19, round 2, after the debt was cleared):

- Headless Chromium sweep of all 128 `src/**/*.html` pages through the app's
  own protocol handler code (HTML rewrite, hashes, SPA shell set) and this
  build's CSP, API mocked on a second origin: **0 violations on 128 of 128
  pages** besides the injected probe. Signed out (10 sign-in and link pages):
  0. With `?id=` (workspace-details, file-viewer, file-editor,
  recording-detail, approval-detail): 0.
- Negative control on every page: after load, inject `<img onerror>`, an
  `onclick` button that is clicked, and an inline `<script>`. All three are
  blocked and reported on all 128 pages, workspaces.html and
  workspace-details.html included.
- Matters pages with hostile data: the mock API returns a matter whose name,
  client and description carry quotes, tags and an `<img onerror>`; on
  workspaces.html and workspace-details.html?id=m-1 nothing runs and there are
  no violations besides the injected probe.
- The editor import map path (runtime `<script type="importmap">` with the
  copied nonce, then `import()` from the editor's origin) loads under the CSP.
- Jest: the new modules, the dom-actions helper, the debt guard, and every
  existing test that loads a converted script (escape guard, pinned matters,
  connectors, management boards, skills, builders, overlays).
- `tests/playwright/matters-escaping.spec.js` now also fails on a script-built
  inline handler in the DOM, on an unregistered action and on a CSP violation.
  It needs a scratch Chef backend and was not run here.

## Remote images and storage links

- **Chat answers never load remote images.** The hardened markdown renderer
  (`src/js/shared/safe-html.js`) renders a markdown image as its alt text and
  the chat profile has no `<img>`; `tests/unit/lex-utils-safe-markdown.test.js`
  and `model-text-rendering.test.js` pin it ("never a remote fetch"). Nothing
  changes for chat, so no relay or link is needed. Doc Studio images arrive as
  `data:` URIs (gpt-image returns base64), which `img-src` allows.
- **Presigned storage links** (automation artifacts, redline downloads) point
  at Chef's MinIO (`MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`). Chef serves
  that origin only to signed-in callers: `GET /api/v1/system/client-config`,
  `config.storage_origin` (LANA-AI `feat/cors-lana-app-origin`; the
  unauthenticated `/api/health/discovery` does not carry it). The main process
  asks with the session token from its token store once someone is signed in,
  again when the firm or the session changes, and every 15 minutes
  (`electron-chef-storage.js`; a failed ask is retried after 5 minutes). Pages
  loaded after the answer add exactly that origin to `connect-src`, `img-src`,
  `frame-src`, `media-src` and the CORS answer. Before sign-in there is none.
  Links opened in the browser were never affected.

## CORS without the preflight assumption

- Chef (LANA-AI `feat/cors-lana-app-origin`): `lana-app://app` is always an
  allowed origin beside `CORS_ORIGINS` (exact origin, credentials off). Unknown
  origins now get no CORS headers instead of a 500, so older desktop builds
  that send `Origin: null` keep working. The voice WebSocket allows the app
  origin when `CORS_ORIGINS` is set.
- Local engine (LANA-AI, `src/engine/app-cors.js`): answers app-origin
  preflights itself and adds the origin to its own answers. Takes effect when
  the client's pinned engine is rebuilt from that commit.
- The editor service lives in the lana-editor repo; it still relies on the
  main-process answer.
- The main-process answer (`electron-cors.js`) stays as the fallback.

## Engine and editor ports

Random, not a fixed range: the engine takes an OS-assigned loopback port once
and then reuses it (persisted preferred port) unless it is taken; the editor
service takes a new OS-assigned port on every launch. So no port list is
allowed. A page opened before an engine or editor restart on a new port needs a
reload to reach it (logged; the CORS answer follows the live port at once).

## Also changed

- Font Awesome Free 6.4.0 (CSS + woff2) and Drawflow 0.0.60 are vendored
  (`src/css/vendor/`, `src/js/vendor/drawflow.min.js`); the two Chart.js CDN
  pages use the vendored `js/vendor/chart.js`; the Tailwind play CDN on
  `js/components/period-selector-test.html` is replaced by the built CSS. The
  license inventory is regenerated (`scripts/licenses`).
- `electron-discovery.js` exports `CONTROL_PLANE_URLS` (discovery and help),
  the one place the CSP takes the control plane origins from.
- The screen voice overlay and the update dialog load from the app protocol
  too, so they get the CSP.

## Left for part B

- `sandbox: true` for the four windows on `electron-preload.js`.
- IPC sender checks must trust the app origin, not file://: use `isAppUrl`
  from `electron-app-protocol.js` (the token store, Briefs, location and the
  editor token already do on this branch). An allowlist keyed on `file:` will
  refuse every page after this branch merges.
