'use strict';

/**
 * The app's own pages are served from a privileged custom protocol,
 * lana-app://app/public_html/<page>, instead of file://.
 *
 * Why (docs/plans/harden-web.md): file:// is an opaque "null" origin, so with
 * webSecurity on, ES modules, import(), workers and fetch() of local files are
 * refused, and no CORS answer can name the app. A standard, secure scheme gives
 * the app one real origin (lana-app://app) that the CSP, CORS and every "is this
 * one of our pages" check can name exactly.
 *
 * The path keeps "/public_html/" on purpose: lex-nav.js, lex-router.js,
 * lex-app.js, navigation-helpers.js, menu.js and lex-chat.js find the app root
 * by that marker, as they do under file://.
 *
 * No Electron imports: electron-main.js passes net.fetch and the policy builder,
 * so everything here is unit tested.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

const APP_SCHEME = 'lana-app';
const APP_HOST = 'app';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const APP_ROOT_PATH = '/public_html/';
// An empty page on the app origin, for the one-time storage move
// (electron-origin-migration.js). No script runs on it.
const STORAGE_MIGRATION_PATH = '/__storage-migration';

// standard: real origin, relative URLs, storage. secure: like https (no mixed
// content warnings, secure-context APIs such as the microphone). No bypassCSP.
const SCHEME_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true,
  codeCache: true
});

function parseUrl(value) {
  try {
    return new URL(String(value));
  } catch (_) {
    return null;
  }
}

/** True only for lana-app://app/... (the app's own origin). */
function isAppUrl(value) {
  const parsed = parseUrl(value);
  return Boolean(parsed && parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST);
}

/**
 * App URL of a page under public_html. relativeUrl may carry ?query and #hash.
 * @param {string} relativeUrl - e.g. 'dashboard.html', 'admin/users.html?tab=x'
 */
function appPageUrl(relativeUrl) {
  const value = String(relativeUrl || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return `${APP_ORIGIN}${APP_ROOT_PATH}${value}`;
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch (_) {
    return null;
  }
}

/**
 * The file under appRoot an app URL points at, or null. Refuses other origins,
 * paths outside /public_html/, '..', encoded separators, NUL, and symlinks that
 * resolve outside appRoot.
 */
function resolveAppFile(value, appRoot) {
  const parsed = parseUrl(value);
  if (!parsed || !appRoot || !isAppUrl(parsed.href)) return null;
  if (!parsed.pathname.startsWith(APP_ROOT_PATH)) return null;
  const segments = parsed.pathname.slice(APP_ROOT_PATH.length).split('/');
  const decoded = [];
  for (const segment of segments) {
    let part;
    try {
      part = decodeURIComponent(segment);
    } catch (_) {
      return null;
    }
    if (part === '' || part === '.' || part === '..') return null;
    if (/[\\/\0:]/.test(part)) return null;
    decoded.push(part);
  }
  if (decoded.length === 0) return null;
  const root = path.resolve(appRoot);
  const filePath = path.join(root, ...decoded);
  if (!isInside(filePath, root)) return null;
  const real = realpathOrNull(filePath);
  if (real === null) return filePath;
  const realRoot = realpathOrNull(root) || root;
  return isInside(real, realRoot) ? filePath : null;
}

/** Page path relative to public_html ('admin/users.html'), or null. */
function pageOf(value) {
  const parsed = parseUrl(value);
  if (!parsed || !isAppUrl(parsed.href) || !parsed.pathname.startsWith(APP_ROOT_PATH)) return null;
  try {
    return decodeURIComponent(parsed.pathname.slice(APP_ROOT_PATH.length));
  } catch (_) {
    return null;
  }
}

/** The app URL for a file:// URL inside appRoot (old links), or null. */
function appUrlForFileUrl(value, appRoot) {
  const parsed = parseUrl(value);
  if (!parsed || parsed.protocol !== 'file:' || !appRoot) return null;
  let filePath;
  try {
    filePath = fileURLToPath(parsed);
  } catch (_) {
    return null;
  }
  const root = path.resolve(appRoot);
  if (!isInside(path.resolve(filePath), root)) return null;
  const rel = path.relative(root, path.resolve(filePath)).split(path.sep).map(encodeURIComponent).join('/');
  return appPageUrl(rel) + parsed.search + parsed.hash;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML attribute value as the parser sees it (character references decoded). */
function decodeAttribute(value) {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = ENTITIES[ref.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function sha256Source(text) {
  return `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

const HANDLER_ATTRIBUTE = /\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Prepare one of the app's HTML files for serving:
 *  - the per-response nonce goes on every <script> start tag the file itself
 *    contains (script bodies are skipped, so markup inside script strings is
 *    left untouched);
 *  - every inline handler attribute in the markup (outside script bodies) is
 *    hashed for 'unsafe-hashes'.
 * @returns {{ html: string, handlerHashes: string[] }}
 */
function prepareHtml(html, nonce) {
  const source = String(html);
  const hashes = new Set();
  let out = '';
  let index = 0;
  const lower = source.toLowerCase();

  function collectHandlers(markup) {
    HANDLER_ATTRIBUTE.lastIndex = 0;
    let m;
    while ((m = HANDLER_ATTRIBUTE.exec(markup)) !== null) {
      hashes.add(sha256Source(decodeAttribute(m[1] !== undefined ? m[1] : m[2])));
    }
  }

  while (index < source.length) {
    const start = lower.indexOf('<script', index);
    if (start === -1 || !/[\s>/]/.test(lower[start + 7] || '')) {
      if (start === -1) {
        collectHandlers(source.slice(index));
        out += source.slice(index);
        break;
      }
      // "<scripts" or similar: not a script tag.
      collectHandlers(source.slice(index, start + 7));
      out += source.slice(index, start + 7);
      index = start + 7;
      continue;
    }
    collectHandlers(source.slice(index, start));
    out += source.slice(index, start);
    const tagEnd = source.indexOf('>', start);
    if (tagEnd === -1) {
      out += source.slice(start);
      break;
    }
    let tag = source.slice(start, tagEnd + 1);
    if (nonce && !/\snonce\s*=/i.test(tag)) {
      tag = `<script nonce="${nonce}"${tag.slice(7)}`;
    }
    out += tag;
    const close = lower.indexOf('</script', tagEnd + 1);
    const bodyEnd = close === -1 ? source.length : close;
    out += source.slice(tagEnd + 1, bodyEnd);
    index = bodyEnd;
    if (close !== -1) {
      out += source.slice(close, close + 8);
      index = close + 8;
    }
  }
  return { html: out, handlerHashes: Array.from(hashes) };
}

/** Every .html file under root (relative paths), for the SPA shell's hash set. */
function listHtmlFiles(root, dir = root, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listHtmlFiles(root, full, out);
    else if (/\.html?$/i.test(entry.name)) out.push(full);
  }
  return out;
}

// The SPA shell (app.html, js/lex/lex-router.js) swaps other pages' markup in
// with innerHTML, so their inline handler attributes run under the shell's
// policy: the shell's hash set is every page's.
const SPA_SHELL_PAGES = Object.freeze(['app.html']);

function createNonce() {
  return crypto.randomBytes(18).toString('base64');
}

/**
 * The protocol.handle callback.
 * @param {Object} deps
 * @param {string} deps.appRoot - absolute path of public_html
 * @param {Function} deps.fetchFile - net.fetch, for non-HTML files (MIME types, ranges)
 * @param {Function} deps.buildPolicy - ({ page, nonce, handlerHashes }) => CSP string
 * @param {Function} [deps.readFile] - async (path) => string
 * @param {Function} [deps.makeNonce]
 */
function createAppProtocolHandler({ appRoot, fetchFile, buildPolicy, readFile, makeNonce = createNonce, spaShellPages = SPA_SHELL_PAGES }) {
  const read = readFile || ((p) => fs.promises.readFile(p, 'utf8'));
  let allPageHashes = null;
  async function everyPageHash() {
    if (allPageHashes) return allPageHashes;
    const hashes = new Set();
    for (const file of listHtmlFiles(path.resolve(appRoot))) {
      try {
        prepareHtml(await read(file), '').handlerHashes.forEach((h) => hashes.add(h));
      } catch (_) { /* unreadable page: nothing to add */ }
    }
    allPageHashes = Array.from(hashes);
    return allPageHashes;
  }
  return async function handleAppRequest(request) {
    const requested = parseUrl(request.url);
    if (requested && isAppUrl(requested.href) && requested.pathname === STORAGE_MIGRATION_PATH) {
      return new Response('<!doctype html><title></title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'" }
      });
    }
    const filePath = resolveAppFile(request.url, appRoot);
    if (!filePath) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

    if (/\.html?$/i.test(filePath)) {
      let text;
      try {
        text = await read(filePath);
      } catch (_) {
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      const nonce = makeNonce();
      const prepared = prepareHtml(text, nonce);
      const page = pageOf(request.url);
      const handlerHashes = spaShellPages.includes(page)
        ? Array.from(new Set([...prepared.handlerHashes, ...(await everyPageHash())]))
        : prepared.handlerHashes;
      const policy = buildPolicy({ page, nonce, handlerHashes });
      return new Response(prepared.html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': policy,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store'
        }
      });
    }

    const headers = {};
    const range = request.headers && typeof request.headers.get === 'function' ? request.headers.get('range') : null;
    if (range) headers.Range = range;
    const response = await fetchFile(pathToFileURL(filePath).href, { headers });
    return withFilePolicy(response, filePath);
  };
}

// Non-HTML files get a CSP too, for when one is opened as a document or a worker:
// an SVG never runs script; a script runs as a worker on the app origin only; any
// other file (JSON, text, CSS, fonts, images) is an inert, sandboxed document.
const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox";
const SCRIPT_POLICY = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' blob: data:; img-src 'self' blob: data:";
const FILE_POLICY = "default-src 'none'; sandbox";

function filePolicyFor(filePath) {
  if (/\.svgz?$/i.test(filePath)) return SVG_POLICY;
  if (/\.(m?js|cjs)$/i.test(filePath)) return SCRIPT_POLICY;
  return FILE_POLICY;
}

function withFilePolicy(response, filePath) {
  if (!response || !response.headers) return response;
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', filePolicyFor(filePath));
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

module.exports = {
  APP_SCHEME,
  APP_HOST,
  APP_ORIGIN,
  APP_ROOT_PATH,
  STORAGE_MIGRATION_PATH,
  SCHEME_PRIVILEGES,
  isAppUrl,
  appPageUrl,
  pageOf,
  resolveAppFile,
  appUrlForFileUrl,
  prepareHtml,
  decodeAttribute,
  SPA_SHELL_PAGES,
  createAppProtocolHandler
};
