'use strict';

const P = require('../../src/js/shared/pending-submit.js');

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const scope = ['http://server', 'org', 'user', 'M-1', 'form:decide:record:1'];
const recorded = { status: 'recorded', record_ref: { kind: 'record', id: 'r1' }, message: 'Saved' };
const httpError = (status, code) => Object.assign(new Error('HTTP ' + status), { status, code });

function fixture(storage = memoryStorage()) {
  const store = P.scopedStore(storage, 'lana:server-form:pending', scope);
  let n = 0;
  const session = P.createSubmitSession({ store, makeId: () => 'req-' + (++n) });
  return { storage, store, session };
}

describe('scopedStore', () => {
  test('keys by every scope part and refuses an incomplete scope', () => {
    const storage = memoryStorage();
    const store = P.scopedStore(storage, 'p', ['a/b', 'c']);
    store.write({ x: 1 });
    expect([...storage.values.keys()]).toEqual(['p:a%2Fb:c']);
    expect(store.read()).toEqual({ x: 1 });
    store.clear();
    expect(store.read()).toBeNull();
    expect(P.scopedStore(storage, 'p', ['a', ''])).toBeNull();
    expect(P.scopedStore(null, 'p', ['a'])).toBeNull();
  });

  test('formScope needs server, organization, user, matter and target', () => {
    const user = { id: 'u', organization_id: 'o' };
    expect(P.formScope('http://s', user, 'M', 't')).toEqual(['http://s', 'o', 'u', 'M', 't']);
    expect(P.formScope('http://s', { id: 'u' }, 'M', 't')).toBeNull();
    expect(P.formScope('http://s', user, 'M', '')).toBeNull();
  });
});

describe('createSubmitSession', () => {
  test('keeps request id and values until the server confirms, then clears', async () => {
    const { storage, session } = fixture();
    let seenDuringSend = null;
    const send = jest.fn(async (body) => {
      seenDuringSend = JSON.parse([...storage.values.values()][0]);
      return recorded;
    });
    const result = await session.submit({ subject: 'record:1', binding: { version: 4 }, values: { a: 1 } }, send);
    expect(send).toHaveBeenCalledWith({ request_id: 'req-1', subject: 'record:1', binding: { version: 4 }, values: { a: 1 } });
    expect(seenDuringSend.request_id).toBe('req-1');
    expect(seenDuringSend.values).toEqual({ a: 1 });
    expect(result).toMatchObject({ status: 'recorded', replayed: false, record_ref: { kind: 'record', id: 'r1' }, message: 'Saved' });
    expect(session.pending()).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  test('a dropped connection keeps the change; a new session resends the same request and shows the replay', async () => {
    const storage = memoryStorage();
    const first = fixture(storage).session;
    await expect(first.submit({ values: { a: 1 } }, async () => { throw Object.assign(new Error('offline'), { status: 0 }); }))
      .rejects.toMatchObject({ submitOutcome: 'retryable' });
    expect(first.pending().request_id).toBe('req-1');

    const second = fixture(storage).session;
    expect(second.pending()).toMatchObject({ request_id: 'req-1', values: { a: 1 } });
    await expect(second.submit({ values: { a: 2 } }, jest.fn())).rejects.toThrow('saved change');
    const send = jest.fn(async () => ({ status: 'replayed', record_ref: { id: 'r1' } }));
    const result = await second.resend(send);
    expect(send.mock.calls[0][0]).toEqual({ request_id: 'req-1', values: { a: 1 } });
    expect(result.replayed).toBe(true);
    expect(storage.values.size).toBe(0);
  });

  test('409 FORM_STALE is stale, REQUEST_ID_REUSED reused; other 400, 403, 404, 409 and 422 are refused; all clear the saved change', async () => {
    for (const [error, outcome] of [[httpError(409, 'FORM_STALE'), 'stale'], [httpError(409, 'REQUEST_ID_REUSED'), 'reused'], [httpError(409, 'OTHER'), 'refused'],
      [httpError(422), 'refused'], [httpError(400), 'refused'], [httpError(403), 'refused'], [httpError(404, 'FORM_NOT_FOUND'), 'refused']]) {
      const { storage, session } = fixture();
      await expect(session.submit({ values: {} }, async () => { throw error; })).rejects.toMatchObject({ submitOutcome: outcome });
      expect(session.pending()).toBeNull();
      expect(storage.values.size).toBe(0);
    }
  });

  test('a 5xx or an unconfirmed answer keeps the change (control arm for the clearing cases)', async () => {
    const { session } = fixture();
    await expect(session.submit({ values: {} }, async () => { throw httpError(503); })).rejects.toMatchObject({ submitOutcome: 'retryable' });
    expect(session.pending()).not.toBeNull();
    await expect(session.resend(async () => ({ ok: true }))).rejects.toThrow('did not confirm');
    expect(session.pending()).not.toBeNull();
  });

  test('works without storage and when storage throws', async () => {
    const memoryOnly = P.createSubmitSession({ store: null, makeId: () => 'id' });
    await expect(memoryOnly.submit({ values: {} }, async () => { throw httpError(500); })).rejects.toThrow();
    expect(memoryOnly.persisted()).toBe(false);
    expect(memoryOnly.pending().request_id).toBe('id');

    const broken = { read: () => { throw new Error('blocked'); }, write: () => { throw new Error('blocked'); }, clear: () => { throw new Error('blocked'); } };
    const session = P.createSubmitSession({ store: broken, makeId: () => 'id2' });
    expect(session.pending()).toBeNull();
    await expect(session.submit({ values: { a: 1 } }, async () => recorded)).resolves.toMatchObject({ status: 'recorded' });
    expect(session.persisted()).toBe(false);
  });

  test('an unreadable or foreign saved entry is dropped, and discard clears', async () => {
    const storage = memoryStorage();
    storage.setItem('lana:server-form:pending:' + scope.map(encodeURIComponent).join(':'), '{not json');
    expect(fixture(storage).session.pending()).toBeNull();
    storage.setItem('lana:server-form:pending:' + scope.map(encodeURIComponent).join(':'), JSON.stringify({ schema_version: 9 }));
    expect(fixture(storage).session.pending()).toBeNull();
    expect(storage.values.size).toBe(0);

    const { session } = fixture();
    await expect(session.submit({ values: {} }, async () => { throw httpError(500); })).rejects.toThrow();
    session.discard();
    expect(session.pending()).toBeNull();
  });

  // The error handler puts `retryable: true` inside the error body (409 FORM_IN_PROGRESS).
  const inProgress = () => Object.assign(httpError(409, 'FORM_IN_PROGRESS'), {
    data: { error: { code: 'FORM_IN_PROGRESS', message: 'This change is still being recorded; try again shortly', retryable: true } },
  });

  test('FORM_IN_PROGRESS keeps the request id and sends it again after each backoff delay', async () => {
    const waits = [];
    const session = P.createSubmitSession({ store: null, makeId: () => 'req-1', retryDelays: [10, 20, 40], wait: async (ms) => { waits.push(ms); } });
    const send = jest.fn().mockRejectedValueOnce(inProgress()).mockRejectedValueOnce(inProgress()).mockResolvedValueOnce({ status: 'replayed', record_ref: null });
    await expect(session.submit({ values: { a: 1 } }, send)).resolves.toMatchObject({ replayed: true });
    expect(waits).toEqual([10, 20]);
    expect(send.mock.calls.map((call) => call[0].request_id)).toEqual(['req-1', 'req-1', 'req-1']);
    expect(session.pending()).toBeNull();
  });

  test('still in progress after the last delay: the change is kept for Send again (control arm: the same 409 without retryable is refused)', async () => {
    const { storage, session } = fixture();
    const slow = P.createSubmitSession({ store: P.scopedStore(storage, 'lana:server-form:pending', scope), makeId: () => 'req-9', retryDelays: [1], wait: async () => {} });
    const send = jest.fn(async () => { throw inProgress(); });
    await expect(slow.submit({ values: {} }, send)).rejects.toMatchObject({ submitOutcome: 'in_progress' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(slow.pending().request_id).toBe('req-9');
    expect(storage.values.size).toBe(1);
    expect(P.classifyError(inProgress())).toBe('in_progress');

    await expect(session.submit({ values: {} }, async () => { throw httpError(409, 'FORM_IN_PROGRESS'); })).rejects.toMatchObject({ submitOutcome: 'refused' });
    expect(P.IN_PROGRESS_RETRY_DELAYS.length).toBeGreaterThan(0);
  });

  test('isConfirmed can accept another answer shape', async () => {
    const session = P.createSubmitSession({ store: null, makeId: () => 'r', isConfirmed: (result) => Boolean(result && result.run) });
    await expect(session.submit({ values: {} }, async () => ({ run: { id: 'x' } }))).resolves.toMatchObject({ response: { run: { id: 'x' } } });
  });
});
