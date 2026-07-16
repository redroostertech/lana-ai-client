const crypto = require('crypto');
const { canonicalJson } = require('../../../src/main/mcp-relay/canonical-json');
const { RelayAuthenticator } = require('../../../src/main/mcp-relay/relay-auth');
const { FrameDecoder, encodeFrame, MAX_REQUEST_BYTES } = require('../../../src/main/mcp-relay/framing');
const { PairingService, RegistrationStore } = require('../../../src/main/mcp-relay/registration-store');

function stores() {
  const values = new Map();
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  const store = { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  return new RegistrationStore({ safeStorage, store, namespace: 'lana-mcp-development-v1' });
}

describe('relay registration, authentication, and framing', () => {
  it('makes pairing one-use and expires it', () => {
    let now = 100; const pairing = new PairingService({ clock: () => now }); const code = pairing.issue();
    expect(Buffer.from(code, 'base64url')).toHaveLength(16);
    expect(pairing.consume(code)).toBe(true); expect(pairing.consume(code)).toBe(false);
    const expired = pairing.issue(); now += 120001; expect(pairing.consume(expired)).toBe(false);
  });

  it('never includes registration secrets in list records and revokes immediately', () => {
    const store = stores(); const created = store.create({ claimedMetadata: { name: 'Claim', extra: 'x' }, scopes: ['read:status'] });
    expect(created.secret).toMatch(/^[A-Za-z0-9_-]+$/); expect(JSON.stringify(created.registration)).not.toContain(created.secret);
    expect(JSON.stringify(store.list())).not.toContain(created.secret); store.revoke(created.registration.registrationId);
    expect(store.getWithSecret(created.registration.registrationId)).toMatchObject({ disabled: true, revokedAt: expect.any(Number) });
  });

  it('authenticates a transcript, derives direction keys, and rejects replay', () => {
    let now = 1000; const store = stores(); const created = store.create({ scopes: ['read:status'] });
    const auth = new RelayAuthenticator({ registrationStore: store, appBuild: '4.0.0', securityGeneration: 1, catalogHash: 'a'.repeat(64), clock: () => now });
    const hello = { supportedRelayVersions: ['1.0'], registrationId: created.registration.registrationId, adapterSecurityGeneration: 1, clientNonce: crypto.randomBytes(32).toString('base64url'), trustNamespace: 'lana-mcp-development-v1' };
    const challenge = auth.challenge(hello);
    const proof = crypto.createHmac('sha256', Buffer.from(created.secret, 'base64url')).update(canonicalJson({ clientHello: hello, serverChallenge: challenge })).digest('base64url');
    const server = auth.finish(challenge.sessionId, proof);
    const clientKeyMaterial = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(created.secret, 'base64url'), Buffer.concat([Buffer.from(hello.clientNonce, 'base64url'), Buffer.from(challenge.serverNonce, 'base64url')]), Buffer.from(`lana-relay-1.0:${challenge.sessionId}`), 64));
    const unsigned = { relayVersion: '1.0', sessionId: challenge.sessionId, counter: 1, requestId: 'r1', messageType: 'capabilities.list' };
    const frame = { ...unsigned, mac: crypto.createHmac('sha256', clientKeyMaterial.subarray(0, 32)).update(canonicalJson(unsigned)).digest('base64url') };
    expect(server.verify(frame)).toMatchObject({ requestId: 'r1' });
    expect(() => server.verify(frame)).toThrow('REPLAY_DETECTED');
  });

  it('rejects oversized lengths, deep structures, prototype keys, and partial frames safely', () => {
    const badHeader = Buffer.alloc(4); badHeader.writeUInt32BE(MAX_REQUEST_BYTES + 1);
    expect(() => new FrameDecoder().push(badHeader)).toThrow('INVALID_REQUEST');
    let deep = {}; let cursor = deep; for (let i = 0; i < 34; i += 1) { cursor.x = {}; cursor = cursor.x; }
    expect(() => encodeFrame(deep)).toThrow('INVALID_REQUEST');
    expect(() => encodeFrame(JSON.parse('{"__proto__":1}'))).toThrow('INVALID_REQUEST');
    const encoded = encodeFrame({ ok: true }); const decoder = new FrameDecoder();
    expect(decoder.push(encoded.subarray(0, 3))).toEqual([]); expect(decoder.push(encoded.subarray(3))).toEqual([{ ok: true }]);
  });
});
