'use strict';
const { createReviewSession, scopedDecisionStore, errorMessage } = require('../../../src/js/services/implementation-assurance-client');
const target = '44444444-4444-4444-8444-444444444444';
const decisionResult = (record, replayed = false) => ({ record, replayed, reference: { id: record.id || 'receipt' }, command: { requestId: 'stable-request', operation: 'decide', sha256: 'server-hash' } });
const assessment = () => ({ record: { evaluation: { target: { id: target }, binding: 'binding-from-server', outcome: 'unknown' } } });
function fixture() {
  const api = { request: jest.fn() };
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const store = scopedDecisionStore(storage, 'http://server', { id: 'user', organizationId: 'org' }, 'matter/scope');
  return { api, storage, store, session: createReviewSession(api, 'matter/scope', () => 'stable-request', store) };
}
test('loads bounded scoped lists without carrying actor or organization overrides', async () => {
  const { api, session } = fixture(); api.request.mockResolvedValue({ assets: [], items: [] });
  await session.load();
  expect(api.request.mock.calls).toEqual([
    ['GET', '/api/v1/implementation-assurance/matters/matter%2Fscope/assets?limit=50', null],
    ['GET', '/api/v1/implementation-assurance/matters/matter%2Fscope/records/target?limit=50', null]
  ]);
});
test('paging one remaining list does not restart an exhausted list', async () => {
  const { api, session } = fixture(); api.request.mockResolvedValue({ items: [], nextCursor: null });
  const result = await session.load(null, 'next', { assets: false, targets: true });
  expect(api.request).toHaveBeenCalledTimes(1);
  expect(api.request.mock.calls[0][1]).toContain('afterId=next');
  expect(result.assets).toEqual({ assets: [], next_cursor: null });
});
test('decision uses only the server binding and confirms the exact recorded outcome', async () => {
  const { api, session } = fixture(); api.request.mockResolvedValueOnce(assessment());
  await session.assess(target);
  api.request.mockResolvedValueOnce(decisionResult({ id: 'receipt', subject_id: target, payload_sha256: 'binding-from-server', decision: 'accept_exception' }));
  await session.decide('accept_exception', ' Reviewed the source. ');
  expect(api.request.mock.calls[1][2]).toEqual({ targetId: target, expectedBinding: 'binding-from-server', requestId: 'stable-request', decision: 'accept_exception', rationale: 'Reviewed the source.' });
  expect(session.assessment()).toBeNull();
  expect(session.pendingDecision()).toBeNull();
});
test('stale binding requires a fresh assessment and never automatically resubmits', async () => {
  const { api, session } = fixture(); api.request.mockResolvedValueOnce(assessment()); await session.assess(target);
  api.request.mockRejectedValueOnce({ status: 409 });
  await expect(session.decide('reject', 'Changed records.')).rejects.toMatchObject({ status: 409 });
  expect(session.assessment()).toBeNull();
  expect(api.request).toHaveBeenCalledTimes(2);
  await expect(session.decide('reject', 'Changed records.')).rejects.toThrow('Assess this target');
});
test('uncertain delivery retries the same request and blocks a different decision', async () => {
  const { api, session } = fixture(); api.request.mockResolvedValueOnce(assessment()); await session.assess(target);
  api.request.mockRejectedValueOnce({ status: 0 });
  await expect(session.decide('reject', 'Evidence missing.')).rejects.toMatchObject({ status: 0 });
  const original = api.request.mock.calls[1][2];
  await expect(session.decide('accept_exception', 'Different.')).rejects.toThrow('Recover the pending');
  await expect(session.assess(target)).rejects.toThrow('Recover the pending');
  api.request.mockResolvedValueOnce(decisionResult({ decision: 'reject', subject_id: target, payload_sha256: 'binding-from-server' }, true));
  expect((await session.decide('reject', 'Evidence missing.')).replayed).toBe(true);
  expect(api.request.mock.calls[2][2]).toEqual(original);
});
test('a second click cannot dispatch concurrently', async () => {
  const { api, session } = fixture(); api.request.mockResolvedValueOnce(assessment()); await session.assess(target);
  let finish;
  api.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = session.decide('reject', 'Reviewed.');
  await expect(session.decide('reject', 'Reviewed.')).rejects.toThrow('already in progress');
  expect(api.request).toHaveBeenCalledTimes(2);
  finish(decisionResult({ decision: 'reject', subject_id: target, payload_sha256: 'binding-from-server' }));
  await first;
});
test('a missing target or unconfirmed receipt cannot become a successful decision', async () => {
  const { api, session } = fixture(); api.request.mockResolvedValueOnce({ record: { evaluation: { binding: 'x', target: { id: 'other' } } } });
  await expect(session.assess(target)).rejects.toThrow('for this target');
  expect(session.assessment()).toBeNull();
  api.request.mockResolvedValueOnce(assessment()); await session.assess(target);
  api.request.mockResolvedValueOnce(decisionResult({ decision: 'reject', subject_id: 'other', payload_sha256: 'binding-from-server' }));
  await expect(session.decide('reject', 'Reviewed.')).rejects.toThrow('did not confirm');
  expect(session.pendingDecision()).not.toBeNull();
});
test('blank rationale and unavailable server never create a success claim', async () => {
  const { api, session } = fixture(); api.request.mockResolvedValueOnce(assessment()); await session.assess(target);
  await expect(session.decide('reject', '   ')).rejects.toThrow('Explain');
  expect(api.request).toHaveBeenCalledTimes(1);
  expect(errorMessage({ status: 503 })).toContain('not available');
  expect(errorMessage({ status: 404 })).toContain('not available');
  expect(errorMessage({ status: 403 })).toContain('authorized professional');
  expect(errorMessage({ status: 409 })).toContain('Assess the target again');
});


test.each([401, 403, 404, 408, 429])('refresh recovers the exact pending request after %s scoped to actor, organization, server and matter', async (status) => {
  const { api, session, storage, store } = fixture(); api.request.mockResolvedValueOnce(assessment()); await session.assess(target);
  api.request.mockRejectedValueOnce({ status });
  await expect(session.decide('reject', 'Reviewed.')).rejects.toMatchObject({ status });
  const restored = createReviewSession(api, 'matter/scope', () => 'must-not-be-used', store);
  expect(restored.pendingDecision().requestId).toBe('stable-request');
  for (const parts of [['other', 'org', 'http://server', 'matter/scope'], ['user', 'other', 'http://server', 'matter/scope'], ['user', 'org', 'http://other', 'matter/scope'], ['user', 'org', 'http://server', 'other']]) {
    expect(scopedDecisionStore(storage, parts[2], { id: parts[0], organizationId: parts[1] }, parts[3]).read()).toBeNull();
  }
  api.request.mockResolvedValueOnce(decisionResult({ decision: 'reject', subject_id: target, payload_sha256: 'binding-from-server' }, true));
  await restored.decide('reject', 'Reviewed.');
  expect(api.request.mock.calls[2][2]).toEqual(api.request.mock.calls[1][2]);
  expect(store.read()).toBeNull();
});
test('persistence failure blocks dispatch, and corrupt recovery data blocks a new decision', async () => {
  const { api } = fixture(); const broken = { read: () => null, write: () => { throw new Error('Storage unavailable'); }, clear: () => {} };
  const session = createReviewSession(api, 'matter', () => 'id', broken);
  api.request.mockResolvedValueOnce(assessment()); await session.assess(target);
  await expect(session.decide('reject', 'Reviewed.')).rejects.toThrow('Storage unavailable');
  expect(api.request).toHaveBeenCalledTimes(1);
  const corrupt = createReviewSession(api, 'matter', () => 'id', { ...broken, read: () => ({ requestId: 'incomplete' }) });
  await expect(corrupt.decide('reject', 'Reviewed.')).rejects.toThrow('Recovery must be restored');
});

test('unknown delivery followed by access loss retains the original recovery identity', async () => {
  const { api, session, store } = fixture(); api.request.mockResolvedValueOnce(assessment()); await session.assess(target);
  api.request.mockRejectedValueOnce({ status: 0 }); await expect(session.decide('reject', 'Reviewed.')).rejects.toMatchObject({ status: 0 });
  const original = store.read(); api.request.mockRejectedValueOnce({ status: 403 });
  await expect(session.decide('reject', 'Reviewed.')).rejects.toMatchObject({ status: 403 });
  expect(store.read()).toEqual(original); expect(session.pendingDecision()).toEqual(original.payload);
});

test('refreshing onboarding records invalidates a prior assessment before another decision', async () => {
  const { api, session } = fixture(); api.request.mockResolvedValueOnce(assessment()); await session.assess(target);
  session.invalidateAssessment(); expect(session.assessment()).toBeNull();
  await expect(session.decide('accept_conclusion', 'Old finding.')).rejects.toThrow('Assess this target');
  expect(api.request).toHaveBeenCalledTimes(1);
});
