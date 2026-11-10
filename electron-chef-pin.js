/**
 * The box Chef's certificate pin (hardware boxes only).
 *
 * A hardware box serves Chef over HTTPS on the firm network with its own
 * self-signed certificate (LANA-AI env-generator _buildBoxChefTlsSection;
 * plain HTTP from another computer answers 403 HTTPS_REQUIRED). No CA vouches
 * for that certificate, so this app trusts it only by its SHA-256: the
 * control plane's discovery answer carries `chef_cert_sha256` (64 lowercase
 * hex of the certificate DER, at the root and under `discovery`). The box's
 * own /api/health/discovery reports it too as `certSha256`, but that endpoint
 * is unauthenticated and is never used as the pin. A box with no pin from the
 * control plane is refused like any other self-signed server.
 *
 * The pin covers exactly one host and port, the saved Chef. Everything else
 * keeps the default certificate checks. Where it applies:
 *   - the renderer (Chromium): certificateVerifyProc, installed on the default
 *     session before the sign-in page's /api/health/discovery probe;
 *   - main-process fetch (undici): pinnedDispatcher / fetchInit;
 *   - axios and http(s).request (verifyServer, the updater, session tracking):
 *     pinnedHttpsAgent.
 * For Node, no request byte is written to the socket until the certificate
 * matched: the connection is handed to the HTTP client only after the TLS
 * handshake, with the fingerprint checked. That is why this does not use
 * checkServerIdentity alone: Node calls it only when the chain already
 * verified, which a self-signed certificate never does.
 *
 * The local engine is started with LANA_CHEF_CERT_SHA256 (the same hex pin,
 * electron-engine-supervisor.js buildEngineEnv) and pins its upstream itself.
 */

'use strict';

const https = require('https');
const net = require('net');
const tls = require('tls');

/** 64 lowercase hex characters, colons and case ignored; null for anything else. */
function normalizeHexPin(value) {
  if (typeof value !== 'string') {return null;}
  const hex = value.replace(/:/g, '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** Electron reports certificate.fingerprint as "sha256/<base64 of the digest>". */
function hexPinToElectronFingerprint(hex) {
  const pin = normalizeHexPin(hex);
  return pin ? 'sha256/' + Buffer.from(pin, 'hex').toString('base64') : null;
}

/** The control plane's pin in a discovery answer: root first, then under discovery. */
function pinFromDiscoveryAnswer(data) {
  if (!data || typeof data !== 'object') {return null;}
  const discovery = data.discovery && typeof data.discovery === 'object' ? data.discovery : {};
  return normalizeHexPin(data.chef_cert_sha256) || normalizeHexPin(discovery.chef_cert_sha256);
}

function bareHost(hostname) {
  return String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
}

function portOf(url) {
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}

/**
 * Chef's address: https when a pin is present (the box answers plain HTTP
 * from the network with 403 HTTPS_REQUIRED), otherwise as given.
 */
function chefUrlFor({ url, host, port, chefCertSha256 }) {
  const pinned = Boolean(normalizeHexPin(chefCertSha256));
  if (!url && host) {
    const h = net.isIPv6(String(host)) ? `[${host}]` : host;
    return `${pinned ? 'https' : 'http'}://${h}${port ? ':' + port : ''}`;
  }
  if (pinned && typeof url === 'string' && /^http:\/\//i.test(url)) {
    return 'https://' + url.slice('http://'.length);
  }
  return url || null;
}

/**
 * The pin for a saved server: { host, port, sha256 } when it is reached over
 * https and carries a valid pin, otherwise null.
 */
function pinFromServer(server) {
  if (!server) {return null;}
  const sha256 = normalizeHexPin(server.chefCertSha256);
  if (!sha256 || typeof server.url !== 'string') {return null;}
  let url;
  try { url = new URL(server.url); } catch (_) { return null; }
  if (url.protocol !== 'https:') {return null;}
  return { host: bareHost(url.hostname), port: portOf(url), sha256 };
}

/** Whether a host and port are the pinned Chef. */
function isPinnedTarget(pin, host, port) {
  return Boolean(pin) && bareHost(host) === pin.host && Number(port || 443) === pin.port;
}

function isPinnedUrl(pin, rawUrl) {
  if (!pin) {return false;}
  let url;
  try { url = new URL(rawUrl); } catch (_) { return false; }
  return url.protocol === 'https:' && isPinnedTarget(pin, url.hostname, portOf(url));
}

/**
 * The renderer's decision for one certificate (session.setCertificateVerifyProc).
 * Electron gives the hostname but not the port, so the host decides here and
 * only the pinned certificate is accepted for it.
 * @returns {0|-2|-3} 0 accept, -2 refuse, -3 Chromium's own verification
 */
function verifyCertificate(request, pin) {
  if (!pin || !request || bareHost(request.hostname) !== pin.host) {return -3;}
  const fingerprint = request.certificate && request.certificate.fingerprint;
  return fingerprint === hexPinToElectronFingerprint(pin.sha256) ? 0 : -2;
}

/** Why the renderer could not trust a server, for the sign-in page's message. */
function refusalFor(request, pin, decision) {
  if (decision === -2) {return 'mismatch';}
  if (decision === -3 && request && request.verificationResult && request.verificationResult !== 'net::OK') {
    return pin && bareHost(request.hostname) === pin.host ? 'mismatch' : 'untrusted';
  }
  return null;
}

class PinMismatchError extends Error {
  constructor(host, port) {
    super(`The certificate at ${host}:${port} is not the one this organization's server uses`);
    this.name = 'PinMismatchError';
    this.code = 'CHEF_CERT_PIN_MISMATCH';
  }
}

/** sha256 hex of the peer's certificate, or ''. */
function peerFingerprintHex(socket) {
  const cert = socket && typeof socket.getPeerCertificate === 'function' ? socket.getPeerCertificate() : null;
  return cert && cert.fingerprint256 ? cert.fingerprint256.replace(/:/g, '').toLowerCase() : '';
}

/**
 * Check a socket that finished its TLS handshake without chain verification.
 * Calls back (null, socket) only when the certificate is the pinned one.
 */
function acceptIfPinned(socket, pin, callback) {
  if (peerFingerprintHex(socket) === pin.sha256) {
    callback(null, socket);
    return;
  }
  socket.destroy();
  callback(new PinMismatchError(pin.host, pin.port));
}

/**
 * An https.Agent for axios and http(s).request: the pinned Chef by its
 * fingerprint, every other host with the default checks.
 * @param {() => object|null} getPin
 * @param {object} [options] - https.Agent options (the default path's ca, for tests)
 */
function createPinnedHttpsAgent(getPin, options = {}) {
  class PinnedHttpsAgent extends https.Agent {
    createConnection(connectOptions, callback) {
      const pin = getPin();
      if (!isPinnedTarget(pin, connectOptions.host || connectOptions.hostname, connectOptions.port)) {
        return super.createConnection(connectOptions, callback);
      }
      const host = connectOptions.host || connectOptions.hostname;
      const socket = tls.connect({
        ...connectOptions,
        host,
        servername: net.isIP(bareHost(host)) ? undefined : host,
        rejectUnauthorized: false,
        session: undefined
      });
      let settled = false;
      const done = (error, value) => { if (!settled) { settled = true; callback(error, value); } };
      socket.once('secureConnect', () => acceptIfPinned(socket, pin, done));
      socket.once('error', (error) => done(error));
      // Handed over only through the callback, after the fingerprint check.
      return undefined;
    }
  }
  return new PinnedHttpsAgent({ maxCachedSessions: 0, ...options });
}

/**
 * An undici dispatcher for main-process fetch: the pinned Chef by its
 * fingerprint, every other host with the default checks.
 * @param {() => object|null} getPin
 * @param {{ undici?: object, defaultTls?: object }} [deps] - defaultTls: the default path's options (tests)
 */
function createPinnedDispatcher(getPin, { undici = require('undici'), defaultTls = {} } = {}) {
  const plain = undici.buildConnector({ ...defaultTls });
  const unchecked = undici.buildConnector({ rejectUnauthorized: false, maxCachedSessions: 0 });
  return new undici.Agent({
    connect(options, callback) {
      const pin = getPin();
      if (options.protocol !== 'https:' || !isPinnedTarget(pin, options.hostname, options.port || 443)) {
        plain(options, callback);
        return;
      }
      unchecked({ ...options, servername: net.isIP(bareHost(options.hostname)) ? undefined : options.servername }, (error, socket) => {
        if (error) { callback(error); return; }
        acceptIfPinned(socket, pin, callback);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// The app's one pin (main process): the saved server's, or the one the sign-in
// page prepared for the firm it is connecting to, before that firm is saved.

let readSavedServer = () => null;
let preparedPin = null;
let lastRefusal = null;
let sharedAgent = null;
let sharedDispatcher = null;

function configure({ getSavedServer }) {
  readSavedServer = typeof getSavedServer === 'function' ? getSavedServer : () => null;
}

function activePin() {
  if (preparedPin) {return preparedPin;}
  try { return pinFromServer(readSavedServer()); } catch (_) { return null; }
}

/** The sign-in page found a firm: pin it (or nothing, for a cloud firm) before probing it. */
function prepare(server) {
  preparedPin = pinFromServer(server);
  lastRefusal = null;
  return Boolean(preparedPin);
}

/** The firm was saved (or cleared): the saved server's pin applies again. */
function settle() {
  preparedPin = null;
}

function httpsAgent() {
  if (!sharedAgent) {sharedAgent = createPinnedHttpsAgent(activePin);}
  return sharedAgent;
}

function dispatcher() {
  if (!sharedDispatcher) {sharedDispatcher = createPinnedDispatcher(activePin);}
  return sharedDispatcher;
}

/** fetch init for a URL: the pinned dispatcher only when the URL is the pinned Chef. */
function fetchInit(url, init = {}) {
  return isPinnedUrl(activePin(), url) ? { ...init, dispatcher: dispatcher() } : init;
}

/** A fetch that pins the saved Chef. */
function pinnedFetch(fetchImpl = fetch) {
  return (url, init) => fetchImpl(url, fetchInit(String(url), init));
}

/**
 * Install the renderer's certificate check on an Electron session. Records the
 * last refusal so the sign-in page can say why a box could not be reached.
 * Chromium keeps an accepted certificate for its host for the rest of the run
 * (checked in Electron 44: re-installing the proc does not clear it), so a pin
 * removed mid-run stops trusting that same certificate only at the next start.
 * A different certificate always reaches this check and is refused.
 */
function installCertificateVerifyProc(electronSession, log = () => {}) {
  electronSession.setCertificateVerifyProc((request, callback) => {
    const pin = activePin();
    const decision = verifyCertificate(request, pin);
    const refusal = refusalFor(request, pin, decision);
    if (refusal) {
      lastRefusal = { host: bareHost(request.hostname), reason: refusal };
      log(`[chef-pin] certificate refused for ${request.hostname}: ${refusal}`);
    }
    callback(decision);
  });
}

/** Why the last certificate for this URL's host was refused: 'mismatch' | 'untrusted' | null. */
function refusalForUrl(rawUrl) {
  let host;
  try { host = bareHost(new URL(rawUrl).hostname); } catch (_) { return null; }
  return lastRefusal && lastRefusal.host === host ? lastRefusal.reason : null;
}

module.exports = {
  normalizeHexPin,
  hexPinToElectronFingerprint,
  pinFromDiscoveryAnswer,
  chefUrlFor,
  pinFromServer,
  isPinnedTarget,
  isPinnedUrl,
  verifyCertificate,
  refusalFor,
  PinMismatchError,
  createPinnedHttpsAgent,
  createPinnedDispatcher,
  configure,
  activePin,
  prepare,
  settle,
  httpsAgent,
  dispatcher,
  fetchInit,
  pinnedFetch,
  installCertificateVerifyProc,
  refusalForUrl
};
