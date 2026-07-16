'use strict';

const net = require('net');
const crypto = require('crypto');
const { readDiscovery } = require('./discovery');
const { FrameDecoder, encodeFrame } = require('../../src/main/mcp-relay/framing');
const { RelaySession } = require('../../src/main/mcp-relay/relay-auth');
const { canonicalJson } = require('../../src/main/mcp-relay/canonical-json');

class RelayClient {
  constructor({ namespace, registrationId, credentialStore, timeoutMs = 5000 }) { Object.assign(this, { namespace, registrationId, credentialStore, timeoutMs }); this.socket = null; }
  async connect() {
    const metadata = readDiscovery({ namespace: this.namespace });
    if ((process.platform === 'win32') !== (metadata.endpointType === 'named-pipe')) throw relayError('APP_NOT_RUNNING');
    const secret = await this.credentialStore.load(this.registrationId);
    if (!secret) throw relayError('UNREGISTERED_CLIENT');
    this.socket = await connectLocal(metadata.endpointName, this.timeoutMs); this.decoder = new FrameDecoder({ maxBytes: 1024 * 1024 }); this.waiters = [];
    this.socket.on('data', (chunk) => { try { for (const frame of this.decoder.push(chunk)) { const waiter = this.waiters.shift(); if (waiter) waiter.resolve(frame); } } catch (error) { this.rejectAll(error); this.close(); } });
    this.socket.on('error', () => { this.rejectAll(relayError('APP_NOT_RUNNING')); this.close(); });
    const hello = { supportedRelayVersions: ['1.0'], registrationId: this.registrationId, adapterSecurityGeneration: 1, clientNonce: nonce(), trustNamespace: this.namespace, claimedMetadata: { name: 'Lana Desktop MCP Adapter', version: '0.1.0' } };
    this.socket.write(encodeFrame({ messageType: 'CLIENT_HELLO', body: hello }));
    const challengeFrame = await this.nextFrame(); if (challengeFrame.messageType !== 'SERVER_CHALLENGE') throw relayError('VERSION_MISMATCH');
    const challenge = challengeFrame.body; const secretBytes = Buffer.from(secret, 'base64url');
    const proof = crypto.createHmac('sha256', secretBytes).update(canonicalJson({ clientHello: hello, serverChallenge: challenge })).digest('base64url');
    const requestId = crypto.randomUUID(); this.socket.write(encodeFrame({ requestId, messageType: 'CLIENT_PROOF', body: { sessionId: challenge.sessionId, proof } }));
    const salt = Buffer.concat([Buffer.from(hello.clientNonce, 'base64url'), Buffer.from(challenge.serverNonce, 'base64url')]);
    const material = Buffer.from(crypto.hkdfSync('sha256', secretBytes, salt, Buffer.from(`lana-relay-1.0:${challenge.sessionId}`), 64)); secretBytes.fill(0);
    this.session = new RelaySession({ sessionId: challenge.sessionId, registrationId: this.registrationId, receiveKey: material.subarray(32), sendKey: material.subarray(0, 32), createdAt: Date.now() });
    const finish = this.session.verify(await this.nextFrame()); if (finish.messageType !== 'SERVER_FINISH') throw relayError('VERSION_MISMATCH');
    return finish.body;
  }
  async invoke(request) {
    if (!this.socket || !this.session) throw relayError('APP_NOT_RUNNING'); const requestId = crypto.randomUUID();
    this.socket.write(encodeFrame(this.session.sign({ requestId, messageType: 'capability.invoke', sentTime: Date.now(), relativeDeadlineMs: 120000, body: request })));
    const response = this.session.verify(await this.nextFrame()); if (response.requestId !== requestId) throw relayError('INVALID_REQUEST');
    if (response.messageType === 'error') throw relayError(response.body.code); if (response.messageType !== 'result') throw relayError('INVALID_REQUEST'); return response.body;
  }
  nextFrame() { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(relayError('DEADLINE_EXCEEDED')), this.timeoutMs); this.waiters.push({ resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } }); }); }
  rejectAll(error) { for (const waiter of this.waiters || []) waiter.reject(error); this.waiters = []; }
  close() { if (this.session) this.session.close(); if (this.socket) this.socket.destroy(); this.session = null; this.socket = null; }
}

async function pairWithDesktop({ namespace, pairingCode, claimedMetadata, credentialStore, timeoutMs = 5000 }) {
  const metadata = readDiscovery({ namespace }); const socket = await connectLocal(metadata.endpointName, timeoutMs); const decoder = new FrameDecoder();
  try {
    socket.write(encodeFrame({ messageType: 'PAIR_REQUEST', body: { pairingCode, claimedMetadata } }));
    const result = await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => reject(relayError('DEADLINE_EXCEEDED')), timeoutMs);
      socket.on('data', (chunk) => { try { const frames = decoder.push(chunk); if (frames[0] && !settled) { settled = true; clearTimeout(timer); resolve(frames[0]); } } catch (_) { if (!settled) { settled = true; clearTimeout(timer); reject(relayError('INVALID_REQUEST')); } } });
      socket.on('error', () => { if (!settled) { settled = true; clearTimeout(timer); reject(relayError('APP_NOT_RUNNING')); } });
      socket.on('close', () => { if (!settled) { settled = true; clearTimeout(timer); reject(relayError('UNREGISTERED_CLIENT')); } });
    });
    if (result.messageType !== 'PAIR_RESULT' || !result.body || !result.body.registrationId || !result.body.secret) throw relayError('UNREGISTERED_CLIENT');
    await credentialStore.save(result.body.registrationId, result.body.secret);
    return { registrationId: result.body.registrationId };
  } finally { socket.destroy(); }
}

function connectLocal(endpointName, timeoutMs) {
  return new Promise((resolve, reject) => {
    // A path-only connect is required. Supplying a host or port is structurally impossible here.
    const socket = net.createConnection({ path: endpointName });
    const timer = setTimeout(() => { socket.destroy(); reject(relayError('APP_NOT_RUNNING')); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', () => { clearTimeout(timer); reject(relayError('APP_NOT_RUNNING')); });
  });
}
function relayError(code) { const error = new Error(code); error.code = code; return error; }
function nonce() { return crypto.randomBytes(32).toString('base64url'); }
module.exports = { RelayClient, pairWithDesktop, connectLocal, relayError, nonce };
