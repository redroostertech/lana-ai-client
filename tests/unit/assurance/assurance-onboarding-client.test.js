'use strict';
const { createCommandSession, createOnboardingClient, normalizePending } = require('../../../src/js/services/assurance-onboarding-client');
function setup() {
  let stored = null;
  const store = { read: () => stored, write: value => { stored = JSON.parse(JSON.stringify(value)); }, clear: () => { stored = null; } };
  const api = { request: jest.fn() };
  return { api, store, session: createCommandSession(api, 'matter', store, () => 'request') };
}
function receipt(operation = 'savePlan', requestId = 'request') { return { command: { operation, requestId, sha256: 'server-hash' }, record: { id: 'record' }, reference: { id: 'record', version: 1, sha256: 'reference-hash' } }; }
test('persists before dispatch and verifies the exact command receipt', async () => {
  const { api, store, session } = setup();
  api.request.mockImplementation(async (method, path, body) => { expect(store.read().payload).toEqual(body); expect(path).toBe('/api/v1/implementation-assurance/matters/matter/plans'); return receipt(); });
  await session.execute('savePlan', { expectedVersion: 0, releases: [] });
  expect(session.pending()).toBeNull(); expect(store.read()).toBeNull();
});
test('one mailbox blocks a different form and restores the original payload after refresh', async () => {
  const { api, store, session } = setup(); api.request.mockRejectedValueOnce({ status: 408 });
  const payload = { expectedVersion: 0, releases: [{ id: 'original' }] };
  await expect(session.execute('savePlan', payload)).rejects.toMatchObject({ status: 408 }); payload.releases[0].id = 'modified';
  await expect(session.execute('recordObservation', {})).rejects.toThrow('Recover the pending');
  const restored = createCommandSession(api, 'matter', store, () => 'wrong');
  api.request.mockResolvedValueOnce(receipt()); await restored.retry();
  expect(api.request.mock.calls[1][2]).toEqual(api.request.mock.calls[0][2]);
  expect(api.request.mock.calls[1][2].releases[0].id).toBe('original');
});
test.each([401,403,404,408,429,500,0])('preserves command identity on %s', async status => {
  const { api, session } = setup(); api.request.mockRejectedValue({ status });
  await expect(session.execute('savePlan', {})).rejects.toMatchObject({ status }); expect(session.pending().payload.requestId).toBe('request');
});
test.each([400,409,422])('clears definitively refused command on %s', async status => {
  const { api, session } = setup(); api.request.mockRejectedValue({ status });
  await expect(session.execute('savePlan', {})).rejects.toMatchObject({ status }); expect(session.pending()).toBeNull();
});
test('wrong receipt does not manufacture success; concurrent clicks do not dispatch twice', async () => {
  const { api, session } = setup(); let finish;
  api.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const running = session.execute('savePlan', {}); await expect(session.execute('savePlan', {})).rejects.toThrow('already in progress');
  expect(api.request).toHaveBeenCalledTimes(1); finish(receipt('saveTarget'));
  await expect(running).rejects.toThrow('did not confirm'); expect(session.pending()).not.toBeNull();
});
test('legacy pending decision is recoverable without inventing a new request', () => {
  const prior = { targetId: 'target', expectedBinding: 'hash', requestId: 'old', decision: 'reject', rationale: 'Reviewed' };
  expect(normalizePending(prior)).toEqual({ schemaVersion: 1, operation: 'decide', payload: prior });
});
test('bounded lookups and records use declared paths; arbitrary endpoints are refused', async () => {
  const { api } = setup(); api.request.mockResolvedValue({}); const client = createOnboardingClient(api, 'matter/scope');
  await client.status(); await client.lookup('releases', 'next'); await client.records('plan');
  expect(api.request.mock.calls[1][1]).toBe('/api/v1/implementation-assurance/matters/matter%2Fscope/lookups/releases?limit=50&afterId=next');
  await expect(client.lookup('../../other')).rejects.toThrow('Unknown');
});

test('asset commands preserve request_id and expected revision on exact retry', async () => {
  const { api, session } = setup(); api.request.mockRejectedValueOnce({ status: 408 });
  await expect(session.execute('updateAsset', { assetId: 'asset', expected_revision: 'revision-1', fields: { description: 'Updated' } })).rejects.toMatchObject({ status: 408 });
  expect(api.request.mock.calls[0]).toEqual(['PATCH', '/api/v1/implementation-assurance/matters/matter/assets/asset', { request_id: 'request', expected_revision: 'revision-1', fields: { description: 'Updated' } }]);
  api.request.mockResolvedValueOnce({ id: 'asset', revision: 'revision-2', description: 'Updated', replayed: true, command: { requestId: 'request', operation: 'updateAsset', sha256: 'server-hash' } });
  const result = await session.retry(); expect(result.record.id).toBe('asset'); expect(result.replayed).toBe(true);
  expect(api.request.mock.calls[1]).toEqual(api.request.mock.calls[0]);
});
test('closeout acceptance must return the exact bound professional receipt', async () => {
  const { api, session } = setup(); api.request.mockResolvedValueOnce({ ...receipt('acceptCloseout'), record: { id: 'decision', subject_id: 'wrong', decision: 'accept_closeout', payload_sha256: 'binding' } });
  await expect(session.execute('acceptCloseout', { closeoutId: 'closeout', expectedBinding: 'binding', scopeAcknowledgement: 'recorded_plan_targets', rationale: 'Reviewed' })).rejects.toThrow('bound closeout');
  expect(session.pending()).not.toBeNull();
});
test('rulebook lookups and starter preview use the rulebook paths only', async () => {
  const { api } = setup(); api.request.mockResolvedValue({}); const client = createOnboardingClient(api, 'matter');
  await client.lookup('rulebooks'); await client.starter('US-IN');
  expect(api.request.mock.calls[0][1]).toBe('/api/v1/implementation-assurance/matters/matter/lookups/rulebooks?limit=50');
  expect(api.request.mock.calls[1]).toEqual(['GET', '/api/v1/implementation-assurance/rulebooks/starter?jurisdiction=US-IN', null]);
  await expect(client.lookup('protocols')).rejects.toThrow('Unknown lookup');
  await expect(client.starter('US-XX')).rejects.toThrow('Unknown jurisdiction');
});
test('rulebook adoption is a global exact command that survives an unknown outcome', async () => {
  const { api, session } = setup(); api.request.mockRejectedValueOnce({ status: 0 });
  const payload = { jurisdiction: 'US-GA', expectedVersion: 0, rationale: 'Reviewed starter' };
  await expect(session.execute('adoptRulebook', payload)).rejects.toMatchObject({ status: 0 });
  expect(api.request.mock.calls[0]).toEqual(['POST', '/api/v1/implementation-assurance/rulebooks/adopt', { ...payload, requestId: 'request' }]);
  await expect(session.execute('adoptRulebook', { ...payload, rationale: 'Different' })).rejects.toThrow('Recover the pending');
  api.request.mockResolvedValueOnce(receipt('adoptRulebook'));
  await session.retry(); expect(api.request.mock.calls[1]).toEqual(api.request.mock.calls[0]); expect(session.pending()).toBeNull();
});
test('stale rulebook adoption is a definitive refusal and publish uses the renamed route', async () => {
  const { api, session } = setup(); api.request.mockRejectedValueOnce({ status: 409 });
  await expect(session.execute('adoptRulebook', { jurisdiction: 'US-FL', expectedVersion: 0, rationale: 'x' })).rejects.toMatchObject({ status: 409 });
  expect(session.pending()).toBeNull();
  api.request.mockResolvedValueOnce(receipt('publishRulebook')); await session.execute('publishRulebook', { expectedVersion: 0, definition: {} });
  expect(api.request.mock.calls[1][1]).toBe('/api/v1/implementation-assurance/rulebooks');
  await expect(session.execute('publishProtocol', {})).rejects.toThrow('not available');
});
