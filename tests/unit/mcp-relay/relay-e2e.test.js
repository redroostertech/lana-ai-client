const fs = require('fs');
const os = require('os');
const path = require('path');
const { RegistrationStore, PairingService } = require('../../../src/main/mcp-relay/registration-store');
const { RelayAuthenticator } = require('../../../src/main/mcp-relay/relay-auth');
const { DesktopRelayServer } = require('../../../src/main/mcp-relay/endpoint-server');
const { RelayClient, pairWithDesktop } = require('../../../mcp-adapter/src/relay-client');

describe('private desktop relay end to end', () => {
  const namespace = `lana-mcp-development-test-${process.pid}`;
  const previousTmp = process.env.TMPDIR;
  let temporary;
  beforeEach(() => { temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-relay-e2e-')); fs.chmodSync(temporary, 0o700); process.env.TMPDIR = temporary; });
  afterEach(() => { process.env.TMPDIR = previousTmp; fs.rmSync(temporary, { recursive: true, force: true }); });

  it('authenticates, invokes one fixed capability, correlates the result, and rejects unknown tools', async () => {
    const values = new Map();
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
    const recordStore = { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
    const registrations = new RegistrationStore({ safeStorage, store: recordStore, namespace });
    const created = registrations.create({ scopes: ['read:status'] });
    const authenticator = new RelayAuthenticator({ registrationStore: registrations, appBuild: 'test', securityGeneration: 1, catalogHash: 'a'.repeat(64) });
    const broker = {
      listCapabilities: () => ({ capabilities: ['lana.status.get'] }),
      invoke: jest.fn(async (request) => {
        if (request.capability !== 'lana.status.get') { const error = new Error('CAPABILITY_UNAVAILABLE'); error.code = 'CAPABILITY_UNAVAILABLE'; throw error; }
        return { correlationId: 'c1', result: { ok: true } };
      })
    };
    const server = new DesktopRelayServer({ namespace, authenticator, broker, appBuild: 'test', catalogHash: 'a'.repeat(64) });
    await server.start();
    const client = new RelayClient({ namespace, registrationId: created.registration.registrationId, credentialStore: { load: async () => created.secret }, timeoutMs: 3000 });
    try {
      await client.connect();
      await expect(client.invoke({ capability: 'lana.status.get', version: '1.0', arguments: {} })).resolves.toEqual({ correlationId: 'c1', result: { ok: true } });
      await expect(client.invoke({ capability: 'lana.matter.delete', version: '1.0', arguments: {} })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
      expect(broker.invoke).toHaveBeenCalledTimes(2);
    } finally { client.close(); await server.stop(); }
  });

  it('exchanges a one-use desktop-approved code and stores the secret only in the credential provider', async () => {
    const values = new Map(); const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
    const registrations = new RegistrationStore({ safeStorage, store: { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) }, namespace });
    const pairing = new PairingService(); const code = pairing.issue({ scopes: ['read:status'] });
    const authenticator = new RelayAuthenticator({ registrationStore: registrations, appBuild: 'test', securityGeneration: 1, catalogHash: 'a'.repeat(64) });
    const server = new DesktopRelayServer({ namespace, authenticator, broker: { listCapabilities: () => ({}), invoke: async () => ({}) }, appBuild: 'test', catalogHash: 'a'.repeat(64), pairingService: pairing, registrationStore: registrations });
    await server.start(); const credentialStore = { save: jest.fn(async () => {}) };
    try {
      const result = await pairWithDesktop({ namespace, pairingCode: code, claimedMetadata: { name: 'Claimed client' }, credentialStore });
      expect(result.registrationId).toMatch(/^[0-9a-f-]{36}$/); expect(credentialStore.save).toHaveBeenCalledWith(result.registrationId, expect.stringMatching(/^[A-Za-z0-9_-]+$/));
      await expect(pairWithDesktop({ namespace, pairingCode: code, claimedMetadata: {}, credentialStore })).rejects.toBeTruthy();
    } finally { await server.stop(); }
  });
});
