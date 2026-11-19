'use strict';

/**
 * CORS for the app's own requests, answered in the main process
 * (docs/plans/harden-web.md).
 *
 * The app's pages are on lana-app://app (electron-app-protocol.js) and call
 * Chef, the local AI engine, the local editor service, Forge and the control
 * plane directly. Chef's own CORS lists web origins only (CORS_ORIGINS,
 * credentials off), so with webSecurity on those calls would fail. Rather than
 * relax the backend, the main process answers for the app, and only:
 *  - for responses from the configured origins (allowedOrigins), and
 *  - with the exact app origin (never '*').
 * A response from any other site is left exactly as the site sent it, so an
 * embedded partner page or a remote document gets ordinary browser CORS.
 *
 * Header names are compared case-insensitively: a second spelling beside an
 * existing one would combine into an invalid value (the `*, *` that once broke
 * Google Fonts in embedded partner pages).
 */

const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
// '*' covers every request header except Authorization, which must be named.
const ALLOW_HEADERS = '*, Authorization';
const MANAGED = new Set([
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
  'access-control-expose-headers',
  'access-control-max-age'
]);

function originOf(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch (_) {
    return null;
  }
}

/**
 * The onHeadersReceived answer for one response.
 * @param {{ url: string, method?: string, statusCode?: number, responseHeaders?: Object }} details
 * @param {{ appOrigin: string, allowedOrigins: string[] }} options
 * @returns {Object} the callback argument: {} (unchanged) or { responseHeaders, statusLine? }
 */
function corsResponseFor(details, { appOrigin, allowedOrigins }) {
  const origin = originOf(details && details.url);
  if (!origin || !appOrigin || !Array.isArray(allowedOrigins) || !allowedOrigins.includes(origin)) return {};

  const headers = {};
  for (const [name, value] of Object.entries(details.responseHeaders || {})) {
    if (!MANAGED.has(name.toLowerCase())) headers[name] = value;
  }
  headers['Access-Control-Allow-Origin'] = [appOrigin];
  headers['Access-Control-Allow-Methods'] = [ALLOW_METHODS];
  headers['Access-Control-Allow-Headers'] = [ALLOW_HEADERS];
  headers['Access-Control-Expose-Headers'] = ['*'];
  headers['Access-Control-Max-Age'] = ['600'];

  const out = { responseHeaders: headers };
  const status = Number(details.statusCode);
  if (String(details.method || '').toUpperCase() === 'OPTIONS' && !(status >= 200 && status < 300)) {
    // A preflight the server did not answer itself (Chef has no CORS for the app).
    out.statusLine = 'HTTP/1.1 204 No Content';
  }
  return out;
}

module.exports = { corsResponseFor, ALLOW_METHODS, ALLOW_HEADERS };
