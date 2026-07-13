/**
 * electron-cloud-auth.js
 *
 * "Log in with LANA" — individual-user cloud login for the LANA One edition.
 * Ported from lana-gpt-desktop/apps/desktop/src/electron/cloud-auth.ts (Phase 1
 * subset) to CommonJS for the lana-ai-client thin-client.
 *
 * Flow: PKCE (verifier/challenge/state) -> open the system browser at the cloud
 * authorize URL -> receive the code on a FIXED loopback listener (127.0.0.1:8791)
 * -> VERIFY state (CSRF) -> exchange the code for tokens at /api/v1/oauth/token ->
 * persist the tokens in the keychain. The renderer only ever receives a token-free
 * decoded view (email + entitlement); the tokens themselves live in main + the
 * keychain and are NEVER exposed over IPC.
 *
 * This module is ADDITIVE and EDITION-GATED: it is only wired up when the LANA One
 * edition flag is set. The existing org hosted-discovery login flow is untouched.
 *
 * DEFERRED (later phases, clean seams left below): ensureRelayToken() (Phase 4 —
 * the per-user relay credential for cloud inference) and the AuthInjector dual-token
 * loopback proxy (Phase 3). CLOUD_KEYS.relayToken is kept here so a future logout
 * sweeps it in one pass.
 *
 * Dependency-injected seams (keychain / crypto / fetch / openExternal / loopback /
 * clock / logger) are preserved from the source so this stays unit-testable without
 * a running Electron.
 */

const http = require('http');
const nodeCrypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Constants (kept in lockstep with the cloud OAuth allowlist)
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical LANA One account/platform plane. Overridable via env for staging. */
const DEFAULT_CLOUD_ORIGIN = 'https://one.lanaai.io';

/** The public OAuth client_id registered in the cloud allowlist. Reuses the
 *  already-allowlisted "lana-works" client so first-run works against live
 *  one.lanaai.io with zero backend change; flip to "lana-one" only once the
 *  cloud env (OAUTH_DESKTOP_CLIENT_ID / redirect allowlist) is updated in lockstep. */
const CLOUD_CLIENT_ID = 'lana-works';

/** FIXED loopback port for the OAuth callback listener (must match the allowlist). */
const OAUTH_LOOPBACK_PORT = 8791;
/** Exact redirect_uri registered in the API allowlist for the loopback flow. */
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_LOOPBACK_PORT}/oauth/callback`;
const OAUTH_LOOPBACK_BIND_HOSTS = ['127.0.0.1', '::1'];

/** Keychain keys, namespaced under `lana.cloud.*`. Tokens are main + keychain ONLY. */
const CLOUD_KEYS = {
  accessToken: 'lana.cloud.access_token',
  refreshToken: 'lana.cloud.refresh_token',
  userId: 'lana.cloud.user_id',
  entitlement: 'lana.cloud.entitlement',
  meSnapshot: 'lana.cloud.me_snapshot',
  // Phase 2b: the LOCAL backend session token minted by /local-session/adopt.
  // Distinct from the cloud tokens (different trust domain); kept here so logout
  // clears it in the same sweep.
  localSession: 'lana.local.session_token',
  // Seam for Phase 4 (relay token). Kept here so logout clears it in one sweep.
  relayToken: 'lana.relay.token',
};

/** Offline entitlement TTL (days). The relay always re-checks live; this is only
 *  for local-feature affordances. */
const ENTITLEMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

function msg(err) {
  return err instanceof Error ? err.message : String(err);
}

/** Default Node crypto seam (randomBytes + sha256). */
const defaultCrypto = {
  randomBytes: (n) => nodeCrypto.randomBytes(n),
  sha256: (data) => nodeCrypto.createHash('sha256').update(data).digest(),
};

// ─────────────────────────────────────────────────────────────────────────────
// PKCE (pure, injected crypto)
// ─────────────────────────────────────────────────────────────────────────────

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a PKCE (verifier/challenge) + a CSRF `state`, all via injected crypto. */
function makePkce(crypto) {
  const verifier = b64url(crypto.randomBytes(48)); // 64 chars, within 43..128
  const challenge = b64url(crypto.sha256(verifier));
  const state = b64url(crypto.randomBytes(24));
  return { verifier, challenge, state };
}

/** Build the cloud authorize URL for the desktop client. */
function buildAuthorizeUrl(origin, challenge, state) {
  const p = new URLSearchParams({
    client_id: CLOUD_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${origin}/oauth/authorize?${p.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT decode (payload ONLY, unverified; for display/cache). Never trusted for a
// security decision here — the local api verifies the signature.
// ─────────────────────────────────────────────────────────────────────────────

function decodeJwtPayload(token) {
  try {
    const seg = String(token || '').split('.')[1];
    if (!seg) return {};
    const json = Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const obj = JSON.parse(json);
    const out = {};
    if (typeof obj.sub === 'string') out.sub = obj.sub;
    if (typeof obj.org === 'string') out.org = obj.org;
    if (typeof obj.email === 'string') out.email = obj.email;
    if (typeof obj.name === 'string') out.name = obj.name;
    if (typeof obj.plan === 'string') out.plan = obj.plan;
    if (obj.entitlements && typeof obj.entitlements === 'object') out.entitlements = obj.entitlements;
    if (typeof obj.exp === 'number') out.exp = obj.exp;
    return out;
  } catch (_) {
    return {};
  }
}

function entitlementViewFromClaims(c) {
  const view = {};
  if (c.plan !== undefined) view.plan = c.plan;
  if (c.entitlements !== undefined) view.entitlements = c.entitlements;
  return view;
}

/** Persist a fresh token pair + derived caches to the keychain. */
async function persistTokens(kc, tokens, clockNow) {
  const claims = decodeJwtPayload(tokens.accessToken);
  await kc.set(CLOUD_KEYS.accessToken, tokens.accessToken);
  await kc.set(CLOUD_KEYS.refreshToken, tokens.refreshToken);
  if (claims.sub) await kc.set(CLOUD_KEYS.userId, claims.sub);
  const cached = { view: entitlementViewFromClaims(claims), storedAt: clockNow };
  await kc.set(CLOUD_KEYS.entitlement, JSON.stringify(cached));
  return claims;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loopback callback listener (login). Bound to loopback ONLY.
// ─────────────────────────────────────────────────────────────────────────────

const nodeLoopback = {
  create: (handler) => http.createServer(handler),
};

/**
 * Stand up the fixed loopback listener, wait for the OAuth redirect, and resolve
 * with {code,state} (or reject on error/timeout). Bound to loopback only.
 */
function awaitCallback(factory, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let listenFailures = 0;
    const servers = [];
    let timer;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      for (const server of servers) {
        try {
          server.close();
        } catch (_) {
          /* already closing */
        }
      }
    };
    const handler = (req, res) => {
      const u = new URL(req.url || '/', `http://127.0.0.1:${OAUTH_LOOPBACK_PORT}`);
      if (u.pathname !== '/oauth/callback') {
        res.writeHead(404).end('not found');
        return;
      }
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
        '<!doctype html><meta charset=utf-8><title>LANA One</title>' +
          '<body style="font-family:-apple-system,system-ui,sans-serif;background:#1a1a1a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
          '<div style=text-align:center><h2>Signed in to LANA</h2><p>You can close this tab and return to LANA One.</p></div>'
      );
      if (settled) return;
      settled = true;
      cleanup();
      if (code && state) resolve({ code, state });
      else reject(new Error('callback_missing_params'));
    };
    for (const host of OAUTH_LOOPBACK_BIND_HOSTS) {
      const server = factory.create(handler);
      servers.push(server);
      server.on('error', (err) => {
        listenFailures += 1;
        if (settled || listenFailures < OAUTH_LOOPBACK_BIND_HOSTS.length) return;
        settled = true;
        cleanup();
        reject(err);
      });
      // Loopback ONLY: never bind 0.0.0.0.
      server.listen(OAUTH_LOOPBACK_PORT, host);
    }
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('login_timeout'));
    }, timeoutMs);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CloudAuth: the login flow + entitlement/auth-state/logout
// ─────────────────────────────────────────────────────────────────────────────

class CloudAuth {
  #kc;
  #crypto;
  #fetch;
  #open;
  #origin;
  #loopback;
  #now;
  #log;
  #loginTimeoutMs;
  #desktopKey;
  #loginInFlight = null;

  constructor(deps) {
    if (!deps || !deps.keychain) throw new Error('CloudAuth: keychain is required');
    this.#kc = deps.keychain;
    this.#crypto = deps.crypto || defaultCrypto;
    this.#fetch = deps.fetch || ((...a) => fetch(...a));
    this.#open = deps.openExternal;
    if (typeof this.#open !== 'function') throw new Error('CloudAuth: openExternal is required');
    this.#origin = (deps.cloudOrigin || DEFAULT_CLOUD_ORIGIN).replace(/\/$/, '');
    this.#loopback = deps.loopback || nodeLoopback;
    this.#now = deps.clock || Date.now;
    this.#log = deps.logger || noopLog;
    this.#loginTimeoutMs = deps.loginTimeoutMs || 5 * 60000;
    // Desktop capability key (gate 3): attached to LOCAL-backend calls so only the
    // LANA One app can reach /adopt + /relay. Empty = inert (matches the backend,
    // which only enforces when LANA_DESKTOP_KEY is set).
    this.#desktopKey = deps.desktopKey || '';
  }

  /** Build headers for a LOCAL-backend call, adding the desktop capability key
   *  when configured (so the gated /adopt + /relay accept it). No-op when unset. */
  #localHeaders(headers) {
    if (this.#desktopKey) headers['x-lana-desktop-key'] = this.#desktopKey;
    return headers;
  }

  /**
   * Run the full PKCE login. Returns ONLY the safe decoded view; NEVER the token.
   * Single-flight: concurrent calls share one in-flight login.
   */
  async loginWithLana() {
    if (this.#loginInFlight) return this.#loginInFlight;
    this.#loginInFlight = this.#loginWithLanaOnce();
    try {
      return await this.#loginInFlight;
    } finally {
      this.#loginInFlight = null;
    }
  }

  async #loginWithLanaOnce() {
    const { verifier, challenge, state } = makePkce(this.#crypto);
    let received;
    try {
      this.#log.info('cloud_auth.login_start', { origin: this.#origin, redirectUri: OAUTH_REDIRECT_URI });
      // Start the listener BEFORE opening the browser so we never miss the redirect.
      const waiting = awaitCallback(this.#loopback, this.#loginTimeoutMs);
      await this.#open(buildAuthorizeUrl(this.#origin, challenge, state));
      received = await waiting;
    } catch (err) {
      this.#log.error('cloud_auth.login_listener_failed', { error: msg(err) });
      return { ok: false, error: msg(err) };
    }

    // CSRF: the state we received MUST equal the one we sent.
    if (received.state !== state) {
      this.#log.error('cloud_auth.state_mismatch', {});
      return { ok: false, error: 'state_mismatch' };
    }

    let tokens;
    try {
      tokens = await this.#exchangeCode(received.code, verifier);
    } catch (err) {
      this.#log.error('cloud_auth.token_exchange_failed', { error: msg(err) });
      return { ok: false, error: msg(err) };
    }

    const claims = decodeJwtPayload(tokens.accessToken);
    const newUserId = claims.sub;

    // Multi-account guard: if this machine already holds another cloud sub's
    // local data, do NOT silently re-key/merge. Surface an explicit state.
    const priorUserId = await this.#kc.get(CLOUD_KEYS.userId);
    if (priorUserId && newUserId && priorUserId !== newUserId) {
      this.#log.warn('cloud_auth.other_account', { prior: priorUserId, incoming: newUserId });
      return { ok: false, otherAccount: { existingUserId: priorUserId } };
    }

    await persistTokens(this.#kc, tokens, this.#now());
    // Best-effort me snapshot (offline reads render from it). Non-fatal.
    await this.#refreshMeSnapshot(tokens.accessToken);

    const result = { ok: true, entitlement: entitlementViewFromClaims(claims) };
    if (newUserId) result.userId = newUserId;
    if (claims.email) result.email = claims.email;
    return result;
  }

  /**
   * Password ("same credentials") login for LANA One: authenticate the individual
   * against the cloud account plane with email+password (their one.lanaai.io
   * account), persist tokens IDENTICALLY to the OAuth path, and return ONLY the
   * token-free view. The password is used once for the request and never stored
   * or returned; tokens live in the keychain + main and NEVER cross IPC.
   */
  async passwordLogin(email, password) {
    let resp;
    try {
      resp = await this.#fetch(`${this.#origin}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch (err) {
      this.#log.error('cloud_auth.password_login_unreachable', { error: msg(err) });
      return { ok: false, error: 'cloud_unreachable' };
    }

    if (resp.status === 403) {
      this.#log.warn('cloud_auth.password_login_unverified', {});
      return { ok: false, error: 'account_unverified' };
    }
    if (resp.status === 400 || resp.status === 401 || resp.status === 422) {
      this.#log.warn('cloud_auth.password_login_bad_credentials', { status: resp.status });
      return { ok: false, error: 'invalid_credentials' };
    }
    if (!resp.ok) {
      this.#log.warn('cloud_auth.password_login_rejected', { status: resp.status });
      return { ok: false, error: `login_${resp.status}` };
    }

    let data = {};
    try {
      data = await resp.json();
    } catch (_) {
      /* non-JSON: falls through to the token guard below */
    }
    if (!data || !data.access_token || !data.refresh_token) {
      return { ok: false, error: 'login_incomplete' };
    }
    const tokens = { accessToken: data.access_token, refreshToken: data.refresh_token };

    const claims = decodeJwtPayload(tokens.accessToken);
    const newUserId = claims.sub;

    // Same multi-account guard as the OAuth path: never silently re-key a machine
    // that already holds a different cloud sub's local data.
    const priorUserId = await this.#kc.get(CLOUD_KEYS.userId);
    if (priorUserId && newUserId && priorUserId !== newUserId) {
      this.#log.warn('cloud_auth.other_account', { prior: priorUserId, incoming: newUserId });
      return { ok: false, otherAccount: { existingUserId: priorUserId } };
    }

    await persistTokens(this.#kc, tokens, this.#now());
    await this.#refreshMeSnapshot(tokens.accessToken);

    this.#log.info('cloud_auth.password_login_ok', { userId: newUserId });
    const result = { ok: true, entitlement: entitlementViewFromClaims(claims) };
    if (newUserId) result.userId = newUserId;
    if (claims.email) result.email = claims.email;
    return result;
  }

  /** Exchange the auth code (PKCE) for tokens at the cloud token endpoint. */
  async #exchangeCode(code, verifier) {
    this.#log.info('cloud_auth.token_exchange_start', { origin: this.#origin, redirectUri: OAUTH_REDIRECT_URI });
    const resp = await this.#fetch(`${this.#origin}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLOUD_CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: OAUTH_REDIRECT_URI,
      }),
    });
    if (!resp.ok) {
      this.#log.warn('cloud_auth.token_exchange_rejected', { status: resp.status });
      throw new Error(`token_exchange_${resp.status}`);
    }
    const data = await resp.json();
    if (!data.access_token || !data.refresh_token) throw new Error('token_exchange_incomplete');
    return { accessToken: data.access_token, refreshToken: data.refresh_token };
  }

  /** Fetch /me and cache it for offline reads. Best-effort (never throws). */
  async #refreshMeSnapshot(accessToken) {
    try {
      const resp = await this.#fetch(`${this.#origin}/api/v1/me`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) return;
      const body = await resp.text();
      await this.#kc.set(CLOUD_KEYS.meSnapshot, body);
    } catch (_) {
      /* offline / transient: keep any prior snapshot */
    }
  }

  /**
   * Entitlement for local-feature affordances. Served from the keychain cache
   * within the TTL; stale:true past it. This is NEVER the relay gate.
   */
  async getEntitlement() {
    const raw = await this.#kc.get(CLOUD_KEYS.entitlement);
    if (!raw) return { stale: true };
    try {
      const cached = JSON.parse(raw);
      const fresh = this.#now() - cached.storedAt < ENTITLEMENT_TTL_MS;
      return { ...cached.view, stale: !fresh };
    } catch (_) {
      return { stale: true };
    }
  }

  /** Token-free auth-state snapshot for the renderer. */
  async getAuthState() {
    const access = await this.#kc.get(CLOUD_KEYS.accessToken);
    if (!access) return { authenticated: false };
    const claims = decodeJwtPayload(access);
    const entitlement = await this.getEntitlement();
    const state = { authenticated: true, entitlement };
    // Surface expiry so the UI never shows a stale "Signed in" state or offers a
    // dead "Enter LANA One" for an already-expired token.
    if (claims.exp) state.expired = claims.exp * 1000 <= this.#now();
    const userId = claims.sub || (await this.#kc.get(CLOUD_KEYS.userId)) || undefined;
    if (userId) state.userId = userId;
    if (claims.email) state.email = claims.email;
    return state;
  }

  /**
   * Phase 2b: exchange the cloud session for a LOCAL backend session.
   * Runs in MAIN so the cloud access token NEVER leaves the main process — it is
   * read from the keychain, sent only to the local backend's adopt endpoint, and
   * only the resulting LOCAL session (safe for the renderer) is returned.
   * Returns { ok:true, token, user, session } or { ok:false, error, status }.
   */
  async adopt(localBackendUrl) {
    const cloudToken = await this.#kc.get(CLOUD_KEYS.accessToken);
    if (!cloudToken) return { ok: false, error: 'not_signed_in', status: 401 };
    const base = String(localBackendUrl || '').replace(/\/$/, '');
    if (!base) return { ok: false, error: 'no_local_backend', status: 0 };

    let resp;
    try {
      resp = await this.#fetch(`${base}/api/v1/local-session/adopt`, {
        method: 'POST',
        headers: this.#localHeaders({ authorization: `Bearer ${cloudToken}`, 'content-type': 'application/json' }),
        body: '{}',
      });
    } catch (err) {
      this.#log.error('cloud_auth.adopt_unreachable', { error: msg(err) });
      return { ok: false, error: 'local_backend_unreachable', status: 0 };
    }

    let data = {};
    try {
      data = await resp.json();
    } catch (_) {
      /* non-JSON body: fall through to the !ok/!token guard below */
    }
    if (!resp.ok || !data || !data.token) {
      const error = (data && data.error) || `adopt_${resp.status}`;
      this.#log.warn('cloud_auth.adopt_rejected', { status: resp.status, error });
      return { ok: false, error, status: resp.status };
    }

    // Persist the LOCAL session so a future startup can re-enter without re-login.
    await this.#kc.set(CLOUD_KEYS.localSession, data.token);
    this.#log.info('cloud_auth.adopt_ok', { userId: data.user && data.user.id });
    return { ok: true, token: data.token, user: data.user, session: data.session };
  }

  /**
   * Phase 4: mint (or reuse) the per-user Forge relay credential (lana_rt_...).
   * Runs in MAIN; the relay token NEVER crosses to the renderer. Returns the raw
   * token to the main-process caller only, or null when not signed in / mint
   * fails. Cached in the keychain so re-launch reuses it without a re-mint.
   */
  async ensureRelayToken() {
    const cached = await this.#kc.get(CLOUD_KEYS.relayToken);
    if (cached) return cached;
    const cloudToken = await this.#kc.get(CLOUD_KEYS.accessToken);
    if (!cloudToken) return null;
    let resp;
    try {
      resp = await this.#fetch(`${this.#origin}/api/v1/relay-tokens`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cloudToken}`, 'content-type': 'application/json' },
        body: '{}',
      });
    } catch (err) {
      this.#log.error('cloud_auth.relay_mint_unreachable', { error: msg(err) });
      return null;
    }
    if (!resp.ok) {
      this.#log.warn('cloud_auth.relay_mint_rejected', { status: resp.status });
      return null;
    }
    let data = {};
    try {
      data = await resp.json();
    } catch (_) {
      /* fall through to the guard below */
    }
    const token = data && typeof data.token === 'string' ? data.token : null;
    if (!token) {
      this.#log.warn('cloud_auth.relay_mint_incomplete', {});
      return null;
    }
    await this.#kc.set(CLOUD_KEYS.relayToken, token);
    this.#log.info('cloud_auth.relay_token_ready', {});
    return token;
  }

  /**
   * Phase 3/4 transport: ensure a relay token, then hand it to the LOCAL backend
   * so its hybrid router can reach the cloud relay. Authed to the local backend
   * with the LOCAL session token (Phase 2b). The relay credential flows
   * main -> local backend ONLY; the renderer only ever sees { ok }.
   */
  async deliverRelayToken(localBackendUrl) {
    const base = String(localBackendUrl || '').replace(/\/$/, '');
    if (!base) return { ok: false, error: 'no_local_backend' };
    const localSession = await this.#kc.get(CLOUD_KEYS.localSession);
    if (!localSession) return { ok: false, error: 'no_local_session' };
    const relayToken = await this.ensureRelayToken();
    if (!relayToken) return { ok: false, error: 'relay_unavailable' };
    let resp;
    try {
      resp = await this.#fetch(`${base}/api/v1/local-session/relay`, {
        method: 'PUT',
        headers: this.#localHeaders({ authorization: `Bearer ${localSession}`, 'content-type': 'application/json' }),
        body: JSON.stringify({ relayToken }),
      });
    } catch (err) {
      this.#log.error('cloud_auth.relay_deliver_unreachable', { error: msg(err) });
      return { ok: false, error: 'local_backend_unreachable' };
    }
    if (!resp.ok) {
      this.#log.warn('cloud_auth.relay_deliver_rejected', { status: resp.status });
      return { ok: false, error: `relay_deliver_${resp.status}`, status: resp.status };
    }
    this.#log.info('cloud_auth.relay_delivered', {});
    return { ok: true };
  }

  /**
   * Phase 5 support: refresh the cached entitlement from the cloud /me. Re-caches
   * the SAME shape getEntitlement reads and returns the TOKEN-FREE entitlement
   * view. Best-effort: returns the current cached/stale view on any failure.
   */
  async refreshEntitlement() {
    const cloudToken = await this.#kc.get(CLOUD_KEYS.accessToken);
    if (!cloudToken) return { stale: true };
    let resp;
    try {
      resp = await this.#fetch(`${this.#origin}/api/v1/me`, {
        headers: { authorization: `Bearer ${cloudToken}`, accept: 'application/json' },
      });
    } catch (_) {
      return this.getEntitlement();
    }
    if (!resp.ok) return this.getEntitlement();
    let body = {};
    try {
      body = await resp.json();
    } catch (_) {
      return this.getEntitlement();
    }
    const org = (body && body.org) || {};
    const plan = org.effective_tier || org.plan_tier || org.plan || undefined;
    const view = {};
    if (plan !== undefined) view.plan = plan;
    await this.#kc.set(CLOUD_KEYS.entitlement, JSON.stringify({ view, storedAt: this.#now() }));
    this.#log.info('cloud_auth.entitlement_refreshed', { plan });
    return { ...view, stale: false };
  }

  /** Clear ALL cloud auth material from the keychain. */
  async logout() {
    for (const key of Object.values(CLOUD_KEYS)) {
      try {
        await this.#kc.delete(key);
      } catch (_) {
        /* best-effort */
      }
    }
    this.#log.info('cloud_auth.logout', {});
    return { ok: true };
  }
}

module.exports = {
  CloudAuth,
  // constants + pure helpers (exported for wiring + future tests)
  DEFAULT_CLOUD_ORIGIN,
  CLOUD_CLIENT_ID,
  OAUTH_LOOPBACK_PORT,
  OAUTH_REDIRECT_URI,
  CLOUD_KEYS,
  ENTITLEMENT_TTL_MS,
  defaultCrypto,
  makePkce,
  buildAuthorizeUrl,
  decodeJwtPayload,
  persistTokens,
  awaitCallback,
};
