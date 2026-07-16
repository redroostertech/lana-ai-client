'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { FrameDecoder, encodeFrame } = require('./framing');
const { relayError } = require('./relay-auth');

class DesktopRelayServer {
  constructor({ namespace, authenticator, broker, appBuild, catalogHash, pairingService = null, registrationStore = null, clock = () => Date.now() }) {
    Object.assign(this, { namespace, authenticator, broker, appBuild, catalogHash, pairingService, registrationStore, clock }); this.server = null; this.metadata = null; this.connections = new Set();
  }

  async start() {
    if (process.platform !== 'darwin') throw relayError('FEATURE_DISABLED');
    const runtime = secureRuntimeDirectory(this.namespace);
    const instanceId = crypto.randomBytes(16).toString('hex');
    const socketPath = path.join(runtime, `r-${instanceId.slice(0, 12)}.sock`);
    this.server = net.createServer((socket) => this.accept(socket));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(socketPath, resolve); });
    fs.chmodSync(socketPath, 0o600);
    this.metadata = Object.freeze({ formatVersion: 1, profileId: 'default', instanceId, endpointType: 'unix', endpointName: socketPath, appPid: process.pid,
      appBuild: this.appBuild, createdAt: this.clock(), expiresAt: this.clock() + 24 * 60 * 60 * 1000, discoveryNonce: crypto.randomBytes(16).toString('base64url'), trustNamespace: this.namespace });
    atomicMetadataWrite(runtime, this.metadata);
    return this.metadata;
  }

  accept(socket) {
    socket.setTimeout(30_000); this.connections.add(socket); const decoder = new FrameDecoder();
    let phase = 'hello'; let challenge = null; let session = null;
    socket.on('data', async (chunk) => {
      try {
        for (const frame of decoder.push(chunk)) {
          if (phase === 'hello') {
            if (frame.messageType === 'PAIR_REQUEST') {
              const grant = this.pairingService && this.pairingService.consume(frame.body && frame.body.pairingCode);
              if (!grant || !this.registrationStore) throw relayError('UNREGISTERED_CLIENT');
              const created = this.registrationStore.create({ claimedMetadata: frame.body.claimedMetadata, scopes: grant.scopes || ['read:status'] });
              socket.write(encodeFrame({ messageType: 'PAIR_RESULT', body: { registrationId: created.registration.registrationId, secret: created.secret } })); socket.end(); return;
            }
            if (frame.messageType !== 'CLIENT_HELLO') throw relayError('INVALID_REQUEST');
            challenge = this.authenticator.challenge(frame.body); phase = 'proof'; socket.write(encodeFrame({ messageType: 'SERVER_CHALLENGE', body: challenge })); continue;
          }
          if (phase === 'proof') {
            if (frame.messageType !== 'CLIENT_PROOF' || !challenge || frame.body.sessionId !== challenge.sessionId) throw relayError('INVALID_REQUEST');
            session = this.authenticator.finish(challenge.sessionId, frame.body.proof); phase = 'authenticated';
            socket.write(encodeFrame(session.sign({ requestId: frame.requestId, messageType: 'SERVER_FINISH', sentTime: this.clock(), relativeDeadlineMs: 5000, body: { expiresAt: this.clock() + 15 * 60 * 1000, catalogHash: this.catalogHash } }))); continue;
          }
          const request = session.verify(frame);
          if (request.messageType === 'session.close') { socket.end(); return; }
          if (request.messageType === 'capabilities.list') {
            socket.write(encodeFrame(session.sign({ requestId: request.requestId, messageType: 'result', sentTime: this.clock(), relativeDeadlineMs: 5000, body: this.broker.listCapabilities() }))); continue;
          }
          if (request.messageType !== 'capability.invoke') throw relayError('INVALID_REQUEST');
          try {
            const outcome = await this.broker.invoke(request.body, { registrationId: session.registrationId });
            socket.write(encodeFrame(session.sign({ requestId: request.requestId, messageType: 'result', sentTime: this.clock(), relativeDeadlineMs: 5000, body: outcome })));
          } catch (error) {
            socket.write(encodeFrame(session.sign({ requestId: request.requestId, messageType: 'error', sentTime: this.clock(), relativeDeadlineMs: 5000, body: { code: error.code || 'INTERNAL_ERROR' } })));
          }
        }
      } catch (_) { if (session) session.close(); socket.destroy(); }
    });
    socket.on('timeout', () => socket.destroy()); socket.on('close', () => { if (session) session.close(); this.connections.delete(socket); });
  }

  async stop() {
    for (const socket of this.connections) socket.destroy(); this.connections.clear();
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    if (this.metadata) {
      safeUnlink(this.metadata.endpointName); safeUnlink(path.join(path.dirname(this.metadata.endpointName), 'relay.json'));
      try { fs.rmdirSync(path.dirname(this.metadata.endpointName)); } catch (_) {}
    }
    this.server = null; this.metadata = null;
  }
}

function secureRuntimeDirectory(namespace) {
  const base = process.platform === 'darwin' ? '/tmp' : (process.env.XDG_RUNTIME_DIR || os.tmpdir());
  const user = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const leaf = `lana-mcp-${user}-${crypto.createHash('sha256').update(namespace).digest('hex').slice(0, 12)}`;
  const directory = path.join(base, leaf);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw relayError('FEATURE_DISABLED');
  return directory;
}
function atomicMetadataWrite(directory, metadata) {
  const target = path.join(directory, 'relay.json'); const temporary = path.join(directory, `.relay-${crypto.randomBytes(8).toString('hex')}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(metadata), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, target); fs.chmodSync(target, 0o600);
}
function safeUnlink(filename) { try { const stat = fs.lstatSync(filename); if (!stat.isSymbolicLink() && (stat.isFile() || stat.isSocket())) fs.unlinkSync(filename); } catch (_) {} }
module.exports = { DesktopRelayServer, secureRuntimeDirectory, atomicMetadataWrite };
