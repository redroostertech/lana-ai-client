/**
 * Search re-indexing card view model (phase 8k): the server's progress in
 * what the admin card shows.
 */
const reembed = require('../../src/js/embedding-reembed-status');

const IDENTITY = { model_id: 'nomic-embed-text-v1.5', model_version: 'f16', model_sha256: 'f7af', runtime: 'pip 3.0.0 ddedf87af419' };
const REASON = 'These documents are in matters set to never leave the firm. They are re-indexed only on their owner\'s computer, never on the firm\'s embed service.';
const data = (overrides) => ({
  identity: IDENTITY, run: { id: 'r1', status: 'running' }, vectors: { current: 30, stale: 12, excluded: 0 },
  documents: { done: 6, total: 10 }, excluded: null, last_error: null, jobs: [], label: 'Search covered part of your documents: 12 passages are being re-indexed.', ...overrides
});

describe('re-embed progress view', () => {
  test('running: state, documents done of total, percent, the server\'s label', () => {
    const view = reembed.reembedView({ status: 'success', data: data() });
    expect(view).toMatchObject({ state: 'running', badge: 'Re-indexing', tone: 'blue', percent: 60, excluded: null, error: null });
    expect(view.rows).toEqual([{ label: 'Documents re-indexed', value: '6 of 10' }]);
    expect(view.note).toContain('being re-indexed');
  });

  test('left out documents carry the count and the server\'s reason', () => {
    const view = reembed.reembedView(data({ run: { status: 'completed' }, documents: { done: 10, total: 10 }, excluded: { passages: 3, documents: 1, reason: REASON } }));
    expect(view).toMatchObject({ state: 'completed', badge: 'Up to date', tone: 'green', percent: 100 });
    expect(view.excluded).toEqual({ title: '1 document left out (3 passages)', reason: REASON });
  });

  test('the last problem is the server\'s label with its time', () => {
    const view = reembed.reembedView(data({ last_error: { label: 'A batch of 25 documents could not be re-indexed after 3 tries. The next batch starts 10 minutes later.', at: '2026-11-03T15:04:00.000Z' } }), 'en-US');
    expect(view.error.label).toBe('A batch of 25 documents could not be re-indexed after 3 tries. The next batch starts 10 minutes later.');
    expect(view.error.when).toMatch(/Nov 3/);
  });

  test('a last problem with no time still shows', () => {
    expect(reembed.reembedView(data({ last_error: { label: 'Waiting.', at: null } })).error).toEqual({ label: 'Waiting.', when: '' });
  });

  test('no run yet: not started while documents wait; up to date when every document is current', () => {
    expect(reembed.reembedView(data({ run: null, documents: { done: 0, total: 3 } }))).toMatchObject({ state: 'not_started', badge: 'Not started', percent: 0 });
    expect(reembed.reembedView(data({ run: null, documents: { done: 0, total: 0 } }))).toMatchObject({ state: 'completed', percent: 100 });
  });

  test('no embedding model on the server: not set up, no counts, the server\'s label', () => {
    const view = reembed.reembedView({ data: { identity: null, run: null, vectors: null, documents: null, excluded: null, last_error: null, jobs: [], label: 'No embedding model is configured for this organization, so nothing is re-embedded.' } });
    expect(view).toMatchObject({ state: 'not_configured', badge: 'Not set up', percent: null, rows: [] });
    expect(view.note).toContain('No embedding model');
  });

  test('the progress could not be read: unavailable, nothing invented', () => {
    for (const body of [null, undefined, { data: null }, 'oops']) {
      expect(reembed.reembedView(body)).toMatchObject({ state: 'unavailable', percent: null, rows: [], excluded: null, error: null });
    }
  });

  test('bad numbers never show as negative or above 100 percent', () => {
    expect(reembed.reembedView(data({ documents: { done: 12, total: 10 } })).percent).toBe(100);
    const odd = reembed.reembedView(data({ documents: { done: -1, total: 'x' } }));
    expect(odd.rows[0].value).toBe('0 of 0');
  });
});
