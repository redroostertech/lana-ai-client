'use strict';

const { AdapterCredentialStore } = require('./credential-store');
const { RelayClient } = require('./relay-client');
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
  const registrationId = parseRegistration(argv);
  const credentialStore = new AdapterCredentialStore({ keytar: dependencies.keytar || tryKeytar(), namespace: NAMESPACE });
  if (command === 'unpair') { await credentialStore.remove(registrationId); return; }
  if (command === 'pair') {
    if (!process.stdin.isTTY) throw cliError('INTERACTIVE_TTY_REQUIRED');
    throw cliError('FEATURE_DISABLED');
  }
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
function cliError(code) { const error = new Error(code); error.code = code; return error; }
module.exports = { main, parseRegistration, NAMESPACE };
