'use strict';

const net = require('net');
const crypto = require('crypto');
const { readDiscovery } = require('./discovery');

class RelayClient {
  constructor({ namespace, registrationId, credentialStore, timeoutMs = 5000 }) { Object.assign(this, { namespace, registrationId, credentialStore, timeoutMs }); this.socket = null; }
  async connect() {
    const metadata = readDiscovery({ namespace: this.namespace });
    if ((process.platform === 'win32') !== (metadata.endpointType === 'named-pipe')) throw relayError('APP_NOT_RUNNING');
    const secret = await this.credentialStore.load(this.registrationId);
    if (!secret) throw relayError('UNREGISTERED_CLIENT');
    this.socket = await connectLocal(metadata.endpointName, this.timeoutMs);
    // Handshake/framing integration is deliberately fail-closed until the
    // desktop relay server passes platform peer-identity tests.
    this.socket.destroy(); this.socket = null;
    throw relayError('FEATURE_DISABLED');
  }
  async invoke() { throw relayError('FEATURE_DISABLED'); }
  close() { if (this.socket) this.socket.destroy(); this.socket = null; }
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
module.exports = { RelayClient, connectLocal, relayError, nonce };
