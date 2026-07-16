'use strict';

const { AdapterCredentialStore } = require('./credential-store');
const { RelayClient, pairWithDesktop } = require('./relay-client');
const { serve } = require('./server');

const NAMESPACE = process.env.NODE_ENV === 'production' ? 'lana-mcp-production-v1' : 'lana-mcp-development-v1';

async function main(argv, dependencies = {}) {
  const command = argv[0] || 'serve';
  if (command === 'print-config') {
    process.stdout.write(`${JSON.stringify({ command: process.execPath, args: [require.resolve('../bin/lana-mcp-adapter.js'), 'serve'] }, null, 2)}\n`); return;
  }
  if (command === 'doctor') {
    process.stderr.write(`namespace=${NAMESPACE} secureStore=${dependencies.keytar || tryKeytar() ? 'available' : 'unavailable'}\n`); return;
  }
  const credentialStore = new AdapterCredentialStore({ keytar: dependencies.keytar || tryKeytar(), namespace: NAMESPACE });
  if (command === 'pair') {
    if (!process.stdin.isTTY) throw cliError('INTERACTIVE_TTY_REQUIRED');
    process.stderr.write('Pairing code: '); const pairingCode = await readHiddenLine(process.stdin); process.stderr.write('\n');
    const result = await pairWithDesktop({ namespace: NAMESPACE, pairingCode, claimedMetadata: { name: 'Lana Desktop MCP Adapter', version: '0.1.0' }, credentialStore });
    process.stdout.write(`${result.registrationId}\n`); return;
  }
  const registrationId = parseRegistration(argv);
  if (command === 'unpair') { await credentialStore.remove(registrationId); return; }
  if (command !== 'serve') throw cliError('INVALID_COMMAND');
  const relayClient = dependencies.relayClient || new RelayClient({ namespace: NAMESPACE, registrationId, credentialStore });
  await relayClient.connect();
  await serve({ relayClient });
}

function parseRegistration(argv) {
  const index = argv.indexOf('--registration'); const value = index >= 0 ? argv[index + 1] : null;
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) throw cliError('REGISTRATION_REQUIRED');
  return value;
}
function tryKeytar() { try { return require('keytar'); } catch (_) { return null; } }
function readHiddenLine(stream) {
  return new Promise((resolve) => {
    let value = ''; const raw = Boolean(stream.isTTY && stream.setRawMode); if (raw) stream.setRawMode(true); stream.resume();
    const onData = (chunk) => { for (const byte of Buffer.from(chunk)) { if (byte === 3) process.exit(130); if (byte === 10 || byte === 13) { cleanup(); resolve(value.trim()); return; } if (byte === 127 || byte === 8) value = value.slice(0, -1); else if (byte >= 32) value += String.fromCharCode(byte); } };
    const cleanup = () => { stream.removeListener('data', onData); if (raw) stream.setRawMode(false); stream.pause(); }; stream.on('data', onData);
  });
}
function cliError(code) { const error = new Error(code); error.code = code; return error; }
module.exports = { main, parseRegistration, readHiddenLine, NAMESPACE };
