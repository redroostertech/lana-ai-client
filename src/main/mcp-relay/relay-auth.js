'use strict';

const crypto = require('crypto');
const { canonicalJson } = require('./canonical-json');

const SESSION_MAX_MS = 15 * 60 * 1000;
const SESSION_IDLE_MS = 5 * 60 * 1000;

class RelayAuthenticator {
  constructor({ registrationStore, appBuild, securityGeneration, catalogHash, clock = () => Date.now() }) {
    this.registrationStore = registrationStore;
    this.appBuild = appBuild;
    this.securityGeneration = securityGeneration;
    this.catalogHash = catalogHash;
    this.clock = clock;
    this.pending = new Map();
  }

  challenge(hello) {
    validateHello(hello);
    const registration = this.registrationStore.getWithSecret(hello.registrationId);
    if (!registration) throw relayError('UNREGISTERED_CLIENT');
    if (registration.revokedAt || registration.disabled) throw relayError('CLIENT_REVOKED');
    if (registration.namespace !== hello.trustNamespace) throw relayError('UNREGISTERED_CLIENT');
    if (!hello.supportedRelayVersions.includes('1.0')) throw relayError('VERSION_MISMATCH');
    const challenge = {
      selectedRelayVersion: '1.0', serverNonce: crypto.randomBytes(32).toString('base64url'),
      sessionId: crypto.randomUUID(), appBuild: this.appBuild,
      desktopSecurityGeneration: this.securityGeneration, catalogHash: this.catalogHash,
      issuedAt: this.clock(), expiresAt: this.clock() + 30_000
    };
    this.pending.set(challenge.sessionId, { hello, challenge, registration });
    return challenge;
  }

  finish(sessionId, proof) {
    const pending = this.pending.get(sessionId); this.pending.delete(sessionId);
    if (!pending || pending.challenge.expiresAt < this.clock()) throw relayError('SESSION_EXPIRED');
    const transcript = canonicalJson({ clientHello: pending.hello, serverChallenge: pending.challenge });
    const secret = Buffer.from(pending.registration.secret, 'base64url');
    const expected = crypto.createHmac('sha256', secret).update(transcript).digest();
    const actual = decodeFixed(proof, expected.length);
    if (!actual || !crypto.timingSafeEqual(expected, actual)) throw relayError('UNREGISTERED_CLIENT');
    const salt = Buffer.concat([Buffer.from(pending.hello.clientNonce, 'base64url'), Buffer.from(pending.challenge.serverNonce, 'base64url')]);
    const material = Buffer.from(crypto.hkdfSync('sha256', secret, salt, Buffer.from(`lana-relay-1.0:${sessionId}`), 64));
    return new RelaySession({
      sessionId, registrationId: pending.registration.registrationId,
      receiveKey: material.subarray(0, 32), sendKey: material.subarray(32),
      createdAt: this.clock(), clock: this.clock
    });
  }
}

class RelaySession {
  constructor({ sessionId, registrationId, receiveKey, sendKey, createdAt, clock = () => Date.now() }) {
    this.sessionId = sessionId; this.registrationId = registrationId; this.receiveKey = receiveKey; this.sendKey = sendKey;
    this.createdAt = createdAt; this.lastUsedAt = createdAt; this.clock = clock; this.receiveCounter = 0; this.sendCounter = 0; this.closed = false;
  }
  assertActive() {
    const now = this.clock();
    if (this.closed || now - this.createdAt > SESSION_MAX_MS || now - this.lastUsedAt > SESSION_IDLE_MS) { this.close(); throw relayError('SESSION_EXPIRED'); }
  }
  sign(message) {
    this.assertActive(); this.sendCounter += 1;
    const frame = { ...message, relayVersion: '1.0', sessionId: this.sessionId, counter: this.sendCounter };
    const mac = crypto.createHmac('sha256', this.sendKey).update(canonicalJson(frame)).digest('base64url');
    this.lastUsedAt = this.clock(); return { ...frame, mac };
  }
  verify(frame) {
    this.assertActive();
    if (!frame || frame.sessionId !== this.sessionId || frame.relayVersion !== '1.0' || frame.counter !== this.receiveCounter + 1) { this.close(); throw relayError('REPLAY_DETECTED'); }
    const { mac, ...unsigned } = frame;
    const expected = crypto.createHmac('sha256', this.receiveKey).update(canonicalJson(unsigned)).digest();
    const actual = decodeFixed(mac, expected.length);
    if (!actual || !crypto.timingSafeEqual(expected, actual)) { this.close(); throw relayError('REPLAY_DETECTED'); }
    this.receiveCounter = frame.counter; this.lastUsedAt = this.clock(); return unsigned;
  }
  close() { this.closed = true; this.receiveKey.fill(0); this.sendKey.fill(0); }
}

function validateHello(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.supportedRelayVersions) || value.supportedRelayVersions.length > 5 ||
      typeof value.registrationId !== 'string' || typeof value.clientNonce !== 'string' || Buffer.from(value.clientNonce, 'base64url').length !== 32 ||
      typeof value.trustNamespace !== 'string' || !Number.isSafeInteger(value.adapterSecurityGeneration)) throw relayError('INVALID_REQUEST');
}
function decodeFixed(value, length) { try { const result = Buffer.from(String(value || ''), 'base64url'); return result.length === length ? result : null; } catch (_) { return null; } }
function relayError(code) { const error = new Error(code); error.code = code; return error; }
module.exports = { RelayAuthenticator, RelaySession, relayError, SESSION_MAX_MS, SESSION_IDLE_MS };
