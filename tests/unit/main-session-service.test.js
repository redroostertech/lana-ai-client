const { MainSessionService, sanitizeRendererUser } = require('../../src/main/backend/session-service');

function fixture(overrides = {}) {
  const values = new Map();
  const safeStorage = {
    isEncryptionAvailable: jest.fn(() => true),
    getSelectedStorageBackend: jest.fn(() => 'keychain'),
    encryptString: jest.fn((value) => Buffer.from(`enc:${value}`)),
    decryptString: jest.fn((value) => value.toString().replace(/^enc:/, ''))
  };
  const secretStore = { get: jest.fn((key) => values.get(key)), set: jest.fn((key, value) => values.set(key, value)), delete: jest.fn((key) => values.delete(key)) };
  const backendClient = { dispatchNativeOperation: jest.fn() };
  return { service: new MainSessionService({ safeStorage, secretStore, backendClient, platform: 'darwin', ...overrides }), backendClient, values };
}

describe('MainSessionService', () => {
  it('keeps credentials out of renderer state and strips identity fields', async () => {
    const { service, backendClient, values } = fixture();
    backendClient.dispatchNativeOperation.mockResolvedValue({ token: 'header.payload.signature', user: { id: 'u1', firstName: 'Ada', email: 'secret@example.test', organization_id: 'org1', roles: ['admin'] } });
    await expect(service.login({ email: 'user@example.test', password: 'correct horse' })).resolves.toEqual({ signedIn: true, user: { id: 'u1', firstName: 'Ada' } });
    expect(JSON.stringify(service.getRendererState())).not.toContain('header.payload.signature');
    expect(JSON.stringify(service.getRendererState())).not.toContain('secret@example.test');
    expect(values.size).toBe(1);
  });

  it('fails closed when Linux safeStorage selects basic_text', () => {
    const safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' };
    const { service } = fixture({ safeStorage, platform: 'linux' });
    expect(() => service.restore()).toThrow('Secure credential storage is unavailable');
  });

  it('invalidates local authority even when backend logout fails', async () => {
    const { service, backendClient } = fixture();
    backendClient.dispatchNativeOperation.mockResolvedValueOnce({ token: 'opaque-token', user: { id: 'u1' } });
    await service.login({ email: 'user@example.test', password: 'pw' });
    backendClient.dispatchNativeOperation.mockRejectedValueOnce(new Error('offline'));
    await service.signOut();
    expect(service.getRendererState()).toEqual({ signedIn: false, user: null });
    expect(service.getAccessTokenForBackendClient()).toBeNull();
  });

  it('does not return email, role, entitlement, tenant, or token fields', () => {
    expect(sanitizeRendererUser({ id: 'u1', email: 'x', role: 'owner', entitlements: ['all'], organizationId: 'o1', token: 'secret' })).toEqual({ id: 'u1' });
  });
});
