/**
 * API Base URL — thin shim over the canonical lana-ai-client ApiClient.
 *
 * The automation app shares the same Core server as the rest of lana-ai-client.
 * Base-URL resolution is owned by `src/js/api.js` (the canonical `ApiClient`
 * exposed as `window.api`); this module exists only so call sites that want a
 * fully-qualified URL for DISPLAY purposes (e.g. the webhook endpoint Copy
 * button in the connector viewer) can build one without reaching into
 * `window.api` directly.
 *
 * Network calls should continue to issue same-origin / canonical requests
 * through `window.api` or via `fetchJson` in app.js, which already pulls the
 * base URL from `window.api.baseUrl`.
 */

function canonicalBaseUrl() {
  if (typeof window === 'undefined') return '';
  if (window.api && window.api.baseUrl) return window.api.baseUrl;
  return '';
}

export function getApiUrl(path) {
  if (typeof path !== 'string' || !path) return path;
  if (/^https?:\/\//i.test(path)) return path;

  const base = canonicalBaseUrl();
  if (!base) return path;

  const prefixedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${prefixedPath}`;
}


/**
 * An artifact or document URL from the backend, made safe to frame, open or
 * link: absolute http(s) as is, a root path ('/api/...') joined to the API
 * base, anything else (javascript:, data:, blob:, file:) refused as ''.
 * The allowlist lives in js/shared/safe-url.js (window.LanaSafeUrl).
 */
export function safeArtifactUrl(url) {
  const safeUrl = typeof window !== 'undefined' ? window.LanaSafeUrl : null;
  if (!safeUrl) return '';
  return safeUrl.safeHttpUrl(url, canonicalBaseUrl());
}
