/**
 * Add the CORS response headers the file:// renderer needs, but preserve any
 * header already supplied by the upstream server. Chromium treats response
 * header names case-insensitively; adding `Access-Control-Allow-Origin` beside
 * an existing lowercase `access-control-allow-origin` combines the values into
 * the invalid `*, *` form and breaks otherwise valid resources (Google Fonts
 * exposed this through embedded partner pages).
 */

const CORS_DEFAULTS = {
  'Access-Control-Allow-Origin': ['*'],
  'Access-Control-Allow-Methods': ['GET, POST, PUT, DELETE, OPTIONS'],
  'Access-Control-Allow-Headers': ['Content-Type, Authorization']
};

function addMissingCorsHeaders(responseHeaders) {
  const headers = { ...(responseHeaders || {}) };
  const existing = new Set(Object.keys(headers).map((name) => name.toLowerCase()));

  for (const [name, value] of Object.entries(CORS_DEFAULTS)) {
    if (!existing.has(name.toLowerCase())) headers[name] = value.slice();
  }
  return headers;
}

module.exports = { addMissingCorsHeaders };
