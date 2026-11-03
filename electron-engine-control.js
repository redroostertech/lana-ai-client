'use strict';

/**
 * The client's control channel to the local AI engine it supervises
 * (local-ai-engine plan, phase 8d). The engine serves it at
 * /api/engine/v1/control/* on its loopback address and accepts only requests
 * carrying the per-process secret the supervisor generated for that engine
 * process (LANA_ENGINE_CONTROL_SECRET in its environment).
 *
 * - setSession(token | null): the signed-in person's own session, so the
 *   engine can report and run that person's background jobs; null on sign-out.
 * - sendSignals(signals): OS signals (electron-os-signals.js) and the
 *   "Run my background jobs on this computer" setting. A pending sleep or quit
 *   answers after the engine handed its running jobs off.
 * - backgroundJobs(): running here, recent outcomes, the server's history.
 *
 * The secret is only ever sent to a loopback address.
 */

const crypto = require('crypto');

const SECRET_HEADER = 'Lana-Engine-Control';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** A fresh secret for one engine process. */
function generateControlSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function isLoopback(url) {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch (_error) {
    return false;
  }
}

/**
 * @param {Object} deps
 * @param {Function} deps.fetch - async (url, { method, headers, body, timeoutMs }) => Response
 * @param {Function} deps.getBaseUrl - () => engine origin or null
 * @param {Function} deps.getSecret - () => the current engine process's secret or null
 * @param {number} [deps.timeoutMs]
 */
function createEngineControlClient({ fetch, getBaseUrl, getSecret, timeoutMs = 5000 }) {
  async function request(method, path, body, waitMs = timeoutMs) {
    const base = getBaseUrl();
    const secret = getSecret();
    if (!base || !secret) {return { ok: false, error: 'not_running' };}
    if (!isLoopback(base)) {return { ok: false, error: 'not_loopback' };}
    let response;
    try {
      response = await fetch(`${base}/api/engine/v1/control/${path}`, {
        method,
        headers: { [SECRET_HEADER]: secret, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        timeoutMs: waitMs
      });
    } catch (_error) {
      return { ok: false, error: 'unreachable' };
    }
    let json = null;
    try { json = await response.json(); } catch (_error) { json = null; }
    if (!response.ok) {return { ok: false, error: (json && json.code) || `status_${response.status}` };}
    return { ok: true, body: json };
  }

  return {
    setSession: (sessionToken) => request('PUT', 'session', { session_token: sessionToken || null }),
    // A sleep or quit waits for the engine's handoff (it gives each run up to 10 s).
    sendSignals: (signals, { waitMs } = {}) => request('PUT', 'signals', signals, waitMs || timeoutMs),
    backgroundJobs: () => request('GET', 'background-jobs'),
    // Phase 10: the offline copy key (base64 of 32 bytes), or null to close the copy.
    setOfflineKey: (keyBase64) => request('PUT', 'offline-key', { key: keyBase64 || null })
  };
}

module.exports = { createEngineControlClient, generateControlSecret, isLoopback, SECRET_HEADER };
