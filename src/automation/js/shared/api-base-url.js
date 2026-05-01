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

// Compatibility alias retained for the connector-iframe loader
// (custom-ui-loader.js), which builds blob HTML for legacy connector UIs.
// Prefer `getApiUrl` or `window.api.baseUrl` directly in new code.
export function resolveAutomationApiBaseUrl(preferred = '') {
  if (typeof preferred === 'string' && /^https?:\/\//i.test(preferred.trim())) {
    return preferred.trim();
  }
  return canonicalBaseUrl();
}
