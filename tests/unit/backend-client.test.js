const { BackendClient, SafeBackendError, normalizeBaseUrl } = require('../../src/main/backend/backend-client');

function response(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] }, text: async () => body };
}

describe('BackendClient', () => {
  it('derives method, route, and bearer credential from trusted main state', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, '{"user":{"id":"u1"}}'));
    const client = new BackendClient({ getBaseUrl: () => 'https://tenant.example.test/', getAccessToken: () => 'main-only-token', fetchImpl });
    await client.dispatchNativeOperation('auth.current');
    expect(fetchImpl).toHaveBeenCalledWith('https://tenant.example.test/api/v1/auth/me', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer main-only-token' }) }));
  });

  it('rejects caller-selected operation names and never calls fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new BackendClient({ getBaseUrl: () => 'https://x.test', getAccessToken: () => 't', fetchImpl });
    await expect(client.dispatchNativeOperation('raw_request')).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps upstream errors without returning raw bodies', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(500, '{"error":"sql and token details"}'));
    const client = new BackendClient({ getBaseUrl: () => 'https://x.test', getAccessToken: () => 't', fetchImpl });
    const error = await client.dispatchNativeOperation('auth.current').catch((value) => value);
    expect(error).toBeInstanceOf(SafeBackendError);
    expect(error.message).not.toContain('sql');
    expect(JSON.stringify(error)).not.toContain('token details');
  });

  it('requires HTTPS in production', () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(() => normalizeBaseUrl('http://127.0.0.1:8080')).toThrow('Backend request failed');
    process.env.NODE_ENV = before;
  });
});
