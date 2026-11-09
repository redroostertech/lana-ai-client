'use strict';

/**
 * App links: the links Chef emails (password reset, invites, account
 * activation, signature requests, share links). The control plane's https
 * bounce page turns each email link into `lana-ai://<action>?<params>` and
 * this module decides what the app does with it.
 *
 * Contract (fixed with the backend and the bounce page):
 *   reset-password  token
 *   accept-invite   token
 *   activate        code
 *   sign            document, packet
 *   shared          token
 * Every link may also carry `domain`, the firm's domain, which is how the app
 * finds that firm's Chef through hosted discovery.
 *
 * Tokens and codes are bearer credentials. They are never logged, never
 * written to disk and never handed to the login page; a pending link lives in
 * this process's memory only and expires.
 *
 * No Electron imports: electron-main.js injects windows, dialogs, storage and
 * discovery, so every decision here is unit tested.
 */

const APP_LINK_ACTIONS = Object.freeze({
  'reset-password': Object.freeze({ params: ['token'], signIn: false }),
  'accept-invite': Object.freeze({ params: ['token'], signIn: false }),
  activate: Object.freeze({ params: ['code'], signIn: false }),
  sign: Object.freeze({ params: ['document', 'packet'], signIn: true }),
  shared: Object.freeze({ params: ['token'], signIn: true })
});

// Tokens and codes: URL-safe and base64 characters only.
const SECRET_PATTERN = /^[A-Za-z0-9._~+/=-]{4,1024}$/;
// Document and packet ids: the same shape the other deep links accept.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ORG_ID_PATTERN = /^[a-z0-9-]{1,100}$/;

const PARAM_PATTERNS = Object.freeze({
  token: SECRET_PATTERN,
  code: SECRET_PATTERN,
  document: ID_PATTERN,
  packet: ID_PATTERN
});

// A link waiting for sign-in or for the firm to be connected.
const PENDING_TTL_MS = 30 * 60 * 1000;

function isAppLinkAction(action) {
  return Object.prototype.hasOwnProperty.call(APP_LINK_ACTIONS, String(action || ''));
}

/** A firm domain, lowercased, or null when it is not a plain host name. */
function normalizeDomain(value) {
  const domain = String(value == null ? '' : value).trim().toLowerCase();
  if (!domain || domain.length > 253) {return null;}
  const labels = domain.split('.');
  if (labels.length < 2) {return null;}
  return labels.every((label) => DOMAIN_LABEL.test(label)) ? domain : null;
}

/**
 * Parse and validate one app link. Only the contract's keys are accepted for
 * each action; anything else (an unknown key, a repeated key, a path, a value
 * of the wrong shape) rejects the whole link.
 *
 * @param {string} rawUrl
 * @returns {{ ok: true, action: string, params: Object, domain: string|null }
 *   | { ok: false, reason: string, action?: string }}
 */
function parseAppLink(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch (_error) {
    return { ok: false, reason: 'not_a_url' };
  }
  if (url.protocol !== 'lana-ai:') {return { ok: false, reason: 'wrong_scheme' };}
  const action = url.hostname;
  if (!isAppLinkAction(action)) {return { ok: false, reason: 'unknown_action' };}
  if (url.username || url.password || url.port || (url.pathname && url.pathname !== '/') || url.hash) {
    return { ok: false, reason: 'unexpected_parts', action };
  }

  const spec = APP_LINK_ACTIONS[action];
  const params = {};
  let domain = null;
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) {return { ok: false, reason: 'repeated_param', action };}
    seen.add(key);
    if (key === 'domain') {
      domain = normalizeDomain(value);
      if (!domain) {return { ok: false, reason: 'invalid_domain', action };}
      continue;
    }
    if (!spec.params.includes(key)) {return { ok: false, reason: 'unexpected_param', action };}
    if (!PARAM_PATTERNS[key].test(value)) {return { ok: false, reason: 'invalid_param', action };}
    params[key] = value;
  }
  for (const key of spec.params) {
    if (!params[key]) {return { ok: false, reason: 'missing_param', action };}
  }
  return { ok: true, action, params, domain };
}

/** What may be logged about a link: the action, its keys and the domain. Never a value. */
function describeForLog(link) {
  if (!link || !link.action) {return 'app link';}
  const keys = Object.keys(link.params || {}).sort().join(',');
  return `app link action=${link.action} keys=${keys || 'none'} domain=${link.domain || 'none'}`;
}

function requiresSignIn(link) {
  return Boolean(link && APP_LINK_ACTIONS[link.action] && APP_LINK_ACTIONS[link.action].signIn);
}

/**
 * Which Chef a link runs against.
 *   use-saved:   the saved firm (no domain on the link, or the same domain)
 *   resolve:     no saved firm; find the link's firm through discovery
 *   needs-setup: no saved firm and no domain; the person connects on sign in
 *   mismatch:    the link names another firm; the person decides
 */
function decideServer(link, savedServer) {
  const saved = savedServer && savedServer.url ? savedServer : null;
  const domain = link && link.domain ? link.domain : null;
  if (!saved) {return domain ? 'resolve' : 'needs-setup';}
  if (!domain) {return 'use-saved';}
  const savedDomain = normalizeDomain(saved.domain);
  // A connection saved before domains were stored cannot be compared; it is
  // still the firm this person set up, so the link runs against it.
  if (!savedDomain || savedDomain === domain) {return 'use-saved';}
  return 'mismatch';
}

/**
 * Discovery needs an organization id beside the domain. Firms on the hosted
 * name are `<org-id>.lanaai.io`, so the first label is the best guess; when it
 * is wrong discovery answers not found and the person types the id on sign in.
 */
function orgIdHintFromDomain(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {return null;}
  const first = normalized.split('.')[0];
  return ORG_ID_PATTERN.test(first) ? first : null;
}

/** The page (relative to public_html) and query an accepted link opens. */
function targetFor(link) {
  const query = new URLSearchParams();
  let page;
  switch (link.action) {
    case 'reset-password':
      page = 'password-reset.html';
      query.set('token', link.params.token);
      break;
    case 'accept-invite':
      page = 'accept-invite.html';
      query.set('token', link.params.token);
      break;
    case 'activate':
      page = 'activate.html';
      query.set('code', link.params.code);
      break;
    case 'sign':
      // The same address Chef's in-app signature notification opens.
      page = 'file-editor.html';
      query.set('id', link.params.document);
      query.set('signature_packet', link.params.packet);
      break;
    case 'shared':
      page = 'shared-link.html';
      query.set('token', link.params.token);
      break;
    default:
      return null;
  }
  return `${page}?${query.toString()}`;
}

/** One link at a time waits for sign-in or setup; a newer link replaces it. */
function createPendingStore({ now = () => Date.now(), ttlMs = PENDING_TTL_MS } = {}) {
  let entry = null;
  function current() {
    if (entry && now() - entry.at > ttlMs) {entry = null;}
    return entry;
  }
  return {
    set(link, { needsFirm = false } = {}) { entry = { link, needsFirm, at: now() }; },
    peek() { return current(); },
    clear() { entry = null; },
    markFirmConnected() { if (current()) {entry.needsFirm = false;} }
  };
}

/**
 * The app link flow. deps (all injected by electron-main.js):
 *   getSavedServer()            -> saved firm or null
 *   isSignedIn()                -> a live session for the saved firm
 *   discover(domain, orgIdHint) -> a verified server for that firm, or null
 *   connect(server)             -> save it as this app's firm
 *   signOut()                   -> forget the session and the saved firm
 *   askSwitch({ domain, firmName })        -> 'switch' | 'stay'
 *   askNotFound({ domain, firmName })      -> 'sign-in' | 'stay'
 *   tellNotFound({ domain })              -> void (nothing saved to stay with)
 *   tellInvalid()               -> void
 *   openPage(relativeUrl)       -> load a page in the main window
 *   openSignIn()                -> load the sign-in page (or first launch)
 *   log(message)                -> never receives a token or code
 */
function createAppLinkRouter(deps) {
  const pending = deps.pending || createPendingStore({ now: deps.now });
  const log = deps.log || (() => {});

  function firmName(server) {
    return (server && (server.orgName || server.orgId || server.domain)) || 'your firm';
  }

  async function continueWith(link) {
    if (requiresSignIn(link) && !deps.isSignedIn()) {
      pending.set(link);
      log(`${describeForLog(link)}: sign in first`);
      await deps.openSignIn();
      return 'sign-in';
    }
    pending.clear();
    await deps.openPage(targetFor(link));
    return 'opened';
  }

  async function waitForFirm(link) {
    pending.set(link, { needsFirm: true });
    log(`${describeForLog(link)}: connect the firm first`);
    await deps.openSignIn();
    return 'connect-firm';
  }

  async function handleUrl(rawUrl) {
    const link = parseAppLink(rawUrl);
    if (!link.ok) {
      if (link.reason === 'unknown_action') {return 'ignored';}
      log(`app link rejected: action=${link.action || 'unknown'} reason=${link.reason}`);
      await deps.tellInvalid();
      return 'rejected';
    }
    log(`${describeForLog(link)}: received`);
    const saved = deps.getSavedServer();
    const decision = decideServer(link, saved);

    if (decision === 'use-saved') {return continueWith(link);}
    if (decision === 'needs-setup') {return waitForFirm(link);}

    if (decision === 'resolve') {
      const server = await deps.discover(link.domain, orgIdHintFromDomain(link.domain));
      if (!server) {return waitForFirm(link);}
      await deps.connect(server);
      return continueWith(link);
    }

    // mismatch: the link is for another firm. Never switch on its own.
    const choice = await deps.askSwitch({ domain: link.domain, firmName: firmName(saved) });
    if (choice !== 'switch') {
      log(`${describeForLog(link)}: stayed with the saved firm`);
      return 'stayed';
    }
    const server = await deps.discover(link.domain, orgIdHintFromDomain(link.domain));
    if (server) {
      await deps.signOut();
      await deps.connect(server);
      return continueWith(link);
    }
    const next = await deps.askNotFound({ domain: link.domain, firmName: firmName(saved) });
    if (next !== 'sign-in') {return 'stayed';}
    await deps.signOut();
    return waitForFirm(link);
  }

  /**
   * What the sign-in page needs to know about a waiting link. No token, no
   * code: the page only learns which firm to connect and that a link waits.
   */
  function loginContext() {
    const entry = pending.peek();
    if (!entry) {return { pending: false };}
    const domain = entry.link.domain || null;
    return {
      pending: true,
      action: entry.link.action,
      needsFirm: entry.needsFirm,
      domain,
      orgIdHint: domain ? orgIdHintFromDomain(domain) : null
    };
  }

  /**
   * Called by the sign-in page. stage 'connected' (the firm was just
   * connected): links that need no sign-in continue now. stage 'signed-in':
   * every waiting link continues. Returns the page to open, or null.
   */
  function takePending(stage) {
    const entry = pending.peek();
    if (!entry) {return null;}
    const link = entry.link;
    const saved = deps.getSavedServer();
    if (!saved || decideServer(link, saved) !== 'use-saved') {
      // The person connected a different firm than the link's: the link
      // cannot run there, so it is dropped rather than sent to the wrong firm.
      pending.clear();
      log(`${describeForLog(link)}: dropped, connected firm differs from the link`);
      return null;
    }
    if (stage === 'connected') {
      pending.markFirmConnected();
      if (requiresSignIn(link)) {return null;}
    } else if (stage !== 'signed-in') {
      return null;
    }
    pending.clear();
    return targetFor(link);
  }

  return { handleUrl, loginContext, takePending, pending };
}

const IPC_CHANNELS = Object.freeze({
  loginContext: 'app-links:login-context',
  takePending: 'app-links:take-pending'
});

function registerAppLinkIpc(ipcMain, router) {
  ipcMain.handle(IPC_CHANNELS.loginContext, () => router.loginContext());
  ipcMain.handle(IPC_CHANNELS.takePending, (_event, payload) => {
    const stage = payload && payload.stage;
    if (stage !== 'connected' && stage !== 'signed-in') {return { page: null };}
    return { page: router.takePending(stage) };
  });
}

/**
 * Deep links that arrive before the app can show them (the app was launched
 * by the link): kept until the first window has loaded, then delivered.
 */
function createColdStartQueue(deliver) {
  let ready = false;
  let queued = null;
  return {
    receive(url) {
      if (ready) {return deliver(url);}
      queued = url;
      return undefined;
    },
    markReady() {
      ready = true;
      const url = queued;
      queued = null;
      return url ? deliver(url) : undefined;
    },
    isReady: () => ready
  };
}

/** The lana-ai:// link in a command line (Windows and Linux launches), or null. */
function deepLinkFromArgv(argv) {
  if (!Array.isArray(argv)) {return null;}
  return argv.find((arg) => typeof arg === 'string' && arg.startsWith('lana-ai://')) || null;
}

module.exports = {
  APP_LINK_ACTIONS,
  PENDING_TTL_MS,
  IPC_CHANNELS,
  isAppLinkAction,
  normalizeDomain,
  parseAppLink,
  describeForLog,
  requiresSignIn,
  decideServer,
  orgIdHintFromDomain,
  targetFor,
  createPendingStore,
  createAppLinkRouter,
  registerAppLinkIpc,
  createColdStartQueue,
  deepLinkFromArgv
};
