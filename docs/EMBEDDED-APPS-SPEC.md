# Embedded Apps — `route` Object Support in the App Catalog

**Status:** Implemented
**Version:** 2.1
**Last Updated:** 2026-07-15
**Applies to:** Frontend (lana-client) plus a control-plane schema capable of preserving route objects
**Driving use case:** Legal NSights analytics (partner surface, single-customer rollout via `enabled_apps`)

---

## 1. Summary

Today every app in the switcher routes to a **bundle-relative HTML file**, and the
client-side catalog (`src/js/app-catalog.js`) is the only source of truth for
routes. A control-plane `enabled_apps` payload can toggle and re-skin known
apps, but it cannot introduce a new surface — `normalizeApp()` drops unknown
ids (fail-closed) and always overrides a payload-supplied `route` with the
catalog's own.

This spec extends the `enabled_apps` entry so `route` may be **either**:

- a `string` — existing behavior, byte-for-byte unchanged, or
- an **object** — `{ "type": "embedded", "url": "https://…", "meta": { … } }` —
  rendered by a single generic embed host page shipped once with the client.

The result: a partner surface (e.g. Legal NSights) becomes **pure control-plane
data**, gated per-customer by the org's provisioning manifest. No partner HTML
ships in the client. The discovery endpoint already carries app objects, but
the control-plane Organization schema must preserve an object route (rather
than casting it as a string) before the client can receive it.

The generic host does not frame the discovery URL directly. It first asks
Lana's authenticated backend for a short-lived partner session. That backend
proxies the request with its existing deployment identity to the control-plane
broker. The broker verifies the app is assigned in the same discovery record,
mints centrally, and returns the partner URL. Legal NSights is the first
registered partner, not a hardcoded client or installation-backend case.

## 2. Non-goals

- No reusable AI API keys in JWT claims, query strings, localStorage, or
  postMessage. Legal's Lovable AI fallback remains active until a scoped,
  short-lived public Lana AI gateway credential exists.
- No general-purpose renderer-selected partner URL or tenant id.
- No offline/caching behavior for embedded surfaces.
- No change to backend-only app ids (`@voice`, `@automation`, …) — they continue
  to fail closed.

## 3. Schema

### 3.1 `enabled_apps[]` entry with an embedded route

```json
{
  "id": "legal-nsights",
  "label": "Legal NSights",
  "description": "Analyze performance, trends and business intelligence",
  "route": {
    "type": "embedded",
    "url": "https://legal.nsites.tech",
    "meta": {}
  },
  "colors": ["#9debd0", "#10b981", "#0f766e", "#111827"]
}
```

### 3.2 Field rules

| Field | Rule |
|---|---|
| `id` | Required. Canonicalized through `canonicalId()` as today (aliases, `@`-strip). For embedded entries the id does **not** need a `CATALOG` entry — that is the point — but it must be a non-empty string and is used for dedupe. |
| `label` | Required. Payload-supplied (no catalog fallback exists for unknown ids). |
| `description` | Optional. |
| `route.type` | Required. v2 recognizes exactly `"embedded"`. Any other value → entry dropped (fail closed, same philosophy as today). |
| `route.url` | Required. Must parse as a URL with protocol exactly `https:`. Anything else (http:, javascript:, file:, protocol-relative, unparseable) → entry dropped. |
| `route.meta` | Optional object. `dashboard` selects the requested partner resource; the backend validates it against the organization/app registry allowlist. Other keys remain opaque. |
| `colors` | Optional array, same handling as today (non-array → `[]`). |

### 3.3 Normalized output

`normalizeApp()` returns, for a valid embedded entry:

```js
{
  id: 'legal-nsights',
  label: 'Legal NSights',
  description: '…',
  colors: [ … ],
  route: 'embed.html?app=legal-nsights',  // bundle-relative, so existing
                                          // href/active-tab logic (lex-sidebar.js
                                          // `href: prefix + item.route`) works unchanged
  embed: {
    type: 'embedded',
    url: 'https://legal.nsites.tech',
    meta: { }
  }
}
```

`route` stays a **string** in normalized output. Nothing downstream of
`normalizeApp()` needs to learn about objects; the sidebar builds hrefs and
detects the active tab exactly as today.

Login persists this normalized representation. `normalizeApp()` therefore also
accepts an already-normalized embedded entry when its route is exactly the
generic host route derived from its id and its `embed` descriptor passes the
same validation. This makes normalization idempotent without admitting an
arbitrary string route.

## 4. Changes by file

### 4.1 `src/js/app-catalog.js` (mirrored to `public_html/js/app-catalog.js`)

`normalizeApp(item)` gains one branch, **before** the `if (!base) return null;`
fail-closed guard:

```
if item is an object AND item.route is an object:
    if item.route.type !== 'embedded'        → return null
    if !isHttpsUrl(item.route.url)           → return null
    if !item.id (after canonicalId) or !item.label → return null
    return {
      id, label, description, colors (default []),
      route: 'embed.html?app=' + encodeURIComponent(id),
      embed: { type: 'embedded', url: item.route.url, meta: item.route.meta || {} }
    }
```

Rationale for ordering: unknown ids are only acceptable when the payload fully
describes a renderable embedded surface. String-route payloads keep the
existing rule — the local catalog remains the only source of truth for
**file** routes, so a payload can never steer a tile to an arbitrary bundle
path. The security posture of the existing guard is preserved: object routes
can reach exactly one page (`embed.html`), and that page re-validates (§4.3).

`isHttpsUrl(value)`: `new URL(value)` in a try/catch; require
`protocol === 'https:'` and a non-empty `hostname`. No regex parsing.

`resolveList` / `normalizeAppList` / `defaultApps`: **unchanged.** Embedded
entries count as resolved, so the everything-failed fallback to default apps
behaves correctly.

### 4.2 `src/js/lex/components/layout/lex-sidebar.js`

The sidebar prefers `window.LanaClientApps` when present and only uses its
inline fallback copy when the module is absent. The fallback mirrors embedded
normalization so shell pages cannot silently lose partner tiles.

- The click guard accepts only hrefs emitted by `_getAppItems()`. That resolved
  list is already fail-closed, and includes the validated generic embed route.
- On `embed.html`, the `?app=` id determines the current switcher item so the
  partner label, palette, and active state remain visible.
- The tile renderer (`href: prefix + (item.route || '')`) remains unchanged
  because normalized `route` is a string (§3.3).

### 4.3 `public_html/embed.html` + `public_html/js/embed-host.js` (new, generic)

One host page shipped with the bundle, serving **all** embedded apps:

1. Read `app` from the query string.
2. Resolve the entry: run the same discovery payload the sidebar used
   (`enabled_apps` from the cached server connection in electron-storage /
   the discovery API response) through `LanaClientApps.normalizeAppList`, then
   find the entry whose `id` matches. **Do not** accept a URL from the query
   string — the query carries only the app id; the URL always comes from the
   re-validated payload. (This is what keeps `embed.html` from being an open
   redirect/framing primitive.)
3. Call authenticated Lana API
   `POST /api/v1/partner-embeds/<app-id>/session` with the dashboard/resource.
   The backend derives organization and user claims from authenticated server
   context and calls the control-plane broker with its deployment token. The
   broker validates the app against discovery and mints with its encrypted,
   centrally managed credential.
4. Validate that the returned URL is HTTPS, remains on the exact
   discovery-approved origin, begins with `/embed/`, and contains a token.
5. Render standard shell chrome (collapsed sidebar, so the user can leave) and mount:

```html
<iframe
  src="<backend-minted embed_url>"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  allow="clipboard-write; microphone"
  referrerpolicy="no-referrer"
  style="border:0; width:100%; height:100%;">
</iframe>
```

6. Re-mint and replace the iframe URL at the backend-provided `refresh_after`
   time (currently one minute before expiration). The JWT is held only in the
   iframe DOM property and is never persisted.
7. Failure states:
   - No/unknown `app` param, or entry not found/not embedded → redirect to
     `dashboard.html` (mirrors the catalog's fail-closed philosophy).
   - Frame refuses to load (partner sends `X-Frame-Options` /
     `frame-ancestors`, network failure): after a load timeout (~10s without a
     `load` event), show an inline message with the app label and an
     "Open in browser" link (`shell.openExternal` via existing bridge, or
     `target=_blank` anchor). Never show an infinite spinner.

Set the document title and shared top bar to the app label, start the sidebar
collapsed, and load the normal conversation-menu dependencies so expanding it
shows the same authenticated Lana chats as other shell pages.

### 4.4 Electron main process

No changes. `webPreferences` stay as they are (`contextIsolation`, no
`nodeIntegration` in renderers). The iframe approach requires no `webviewTag`.
Navigation guards in `electron-main.js` already allow bundle-relative page
loads; `embed.html` is one. Framed content stays inside the iframe and is not
top-level navigation, so the existing navigation allowlist is unaffected.

## 5. Security constraints (normative)

1. `https:` only, validated in `normalizeApp`, re-validated in the embed host,
   and origin-pinned again on the backend-minted session URL.
2. The iframe carries the sandbox attributes in §4.3. Note
   `allow-same-origin` + `allow-scripts` together is required for a real SPA
   login inside the frame and is acceptable because the framed content is a
   **remote https origin**, not local content.
3. `embed.html` is the **only** consumer of `embed.*`. No other page may read
   a URL from a discovery payload and load it.
4. The embed URL must never be string-concatenated into HTML. Set `iframe.src`
   via DOM property assignment.
5. Partner credentials live only in the control plane's encrypted deployment
   secrets vault. A credential is enrolled once for an app (with an optional
   per-organization override); it is neither copied to each Lana installation
   nor represented by per-app environment variables. Missing, corrupt, weak,
   or scope-mismatched credentials fail closed; unsigned JWTs are never minted.
6. The renderer supplies neither `firm_id` nor user claims. The backend derives
   them from authenticated Lana context and may apply a deployment-owned firm
   mapping.
7. The control plane's first provider adapter uses algorithm-pinned HS256,
   configurable claim names, optional issuer/audience, jti, iat, nbf, and a
   maximum 15-minute expiry. API responses use `Cache-Control: no-store` and
   never log the token.
8. No long-lived AI credential is included in the signed claims.

## 6. Compatibility

- **Old client + new payload:** `normalizeApp` (old) sees `route` as a
  non-string, `base` is undefined → entry dropped. Old clients simply don't
  show the tile. No blank pages, no errors. This is the designed degradation.
- **New client + old payloads:** string routes hit the unchanged branch;
  behavior identical, including the legacy `@`-prefix upgrade path and the
  everything-failed fallback to `defaultApps()`.
- **Dedupe:** unchanged (`seen[normalized.id]`) — an embedded id colliding with
  a catalog id resolves in payload order; first wins, as today.

## 7. Test coverage (`tests/app-catalog.test.js`, `tests/embed-host.test.js`, `tests/sidebar-app-switcher.test.js`)

The pinned contract "every catalog id resolves to a route that EXISTS on disk"
stays for `CATALOG` entries, plus: assert `public_html/embed.html` exists on
disk (the embedded route target must be as real as any other route).

New cases:

1. Embedded entry with unknown id + valid https url → resolves; normalized
   `route === 'embed.html?app=<id>'`; `embed.url` preserved; `meta` carried.
2. `route.type` ≠ `embedded` → null.
3. `route.url` http:, `javascript:…`, protocol-relative `//host`, empty,
   unparseable → null for each.
4. Embedded entry missing `label` → null.
5. String-route payload with a bogus route still gets the catalog route
   (existing behavior pinned — regression guard that the new branch didn't
   loosen the old one).
6. `normalizeAppList` with only invalid embedded entries falls back to defaults
   (existing everything-failed contract extended).
7. Colors non-array on an embedded entry → `[]`.
8. The login-persisted normalized representation survives a second pass
   unchanged and resolves in the embed host.
9. The switcher click gate accepts the emitted generic host href, and the embed
   page selects the partner app as current.

Embed-host tests (same harness style — load `embed-host.js` into a stub
`window`): id-only query resolution, refusal to read a URL from the query,
fail-closed redirect on unknown app.

## 8. Future hardening

- **Asymmetric partner SSO:** migrate HS256 to ES256/EdDSA so Lana retains a
  private signing key and Legal holds only a public verification key.
- **One-time exchange code:** replace the JWT query parameter if Legal adds a
  server-side code exchange, eliminating bearer material from iframe URLs.
- **Bridge contract:** `meta.bridge = { contextPush, askLana }` — origin-gated
  postMessage through the existing loopback bridge (`electron-bridge.js`),
  enabling "Ask LANA about this view" from inside the partner surface.
- **Per-app session controls:** partition iframe storage per app id
  (`partition` requires migrating iframe → `<webview>`; decide only if a real
  need appears).

## 9. Acceptance (demo)

1. An org whose `enabled_apps` contains the §3.1 entry shows a "Legal NSights"
   tile with the partner colors in the app switcher.
2. Clicking it loads `embed.html?app=legal-nsights`; the authenticated backend
   mints `/embed/executive?token=<short-lived JWT>`, so no partner login screen
   appears inside the frame.
3. Sidebar starts collapsed, can be expanded to the same Lana chats, and lets
   the user switch back to LanaWorks.
4. Removing the entry from `enabled_apps` removes the tile after the next
   discovery refresh.
5. An entry with `"url": "http://legal.nsites.tech"` renders **no** tile.
6. On a client build predating this spec, the same payload renders no tile and
   no errors.

## 10. Pre-implementation check (do first)

Verify `https://legal.nsites.tech` does not send `X-Frame-Options` /
`Content-Security-Policy: frame-ancestors` headers that block framing —
`curl -sI https://legal.nsites.tech | grep -iE 'x-frame|frame-ancestors'`.
If it does, the fix is a header change on the partner's side (Lovable app
config), and it gates everything else in this spec.
