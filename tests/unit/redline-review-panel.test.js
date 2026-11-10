'use strict';

// The LANA redline review panel (src/js/redline-review-panel.js): what it
// shows for a batch Chef returns, and how decisions and release move it.
// Real LanaDocumentReview underneath, a fake API client on top.

const path = require('path');

const panel = require(path.join(__dirname, '../../src/js/redline-review-panel.js'));

const BASE = '/api/v1/matters/m1/documents/doc-1/redline-batches';

function change(id, status, extra) {
  return Object.assign({
    id,
    status,
    operation: 'replace',
    original_text: 'thirty (30) days',
    proposed_text: 'ten (10) business days',
    clause_label: 'Payment terms',
    rationale: 'Shorter cure period protects the client.',
    decided_by_name: status === 'proposed' ? null : 'Pat Reviewer'
  }, extra || {});
}

function batch(extra) {
  return Object.assign({
    id: 'b1',
    title: 'Document Reviewer redlines',
    summary: '2 proposed changes.',
    status: 'proposed',
    changes: [change('c1', 'proposed'), change('c2', 'proposed', { clause_label: 'Governing law' })],
    unanchored_redlines: [
      { artifact_id: 'art-9', clause_label: 'Indemnity', current_text: 'shall indemnify', proposed_text: 'shall defend and indemnify', rationale: 'Broader.', reason: 'ambiguous', occurrences: [{}, {}, {}] },
      { artifact_id: 'art-10', clause_label: null, current_text: 'notice', proposed_text: 'written notice', reason: 'not_found' }
    ],
    updated_at: '2026-11-09T10:00:00Z'
  }, extra || {});
}

function fakeApi(handlers) {
  const calls = [];
  const route = (method) => jest.fn(async (endpoint, body) => {
    calls.push({ method, endpoint, body });
    const handler = handlers[method + ' ' + endpoint.split('?')[0]];
    if (!handler) throw new Error('Unrouted ' + method + ' ' + endpoint);
    return handler(body);
  });
  return { get: route('GET'), post: route('POST'), calls };
}

function problem(status, code) {
  const error = new Error('raw server text');
  error.status = status;
  error.code = code;
  error.data = { code, status };
  return error;
}

function container() {
  return { innerHTML: '', addEventListener: jest.fn(), removeEventListener: jest.fn() };
}

describe('redlines that could not be placed', () => {
  test('every unanchored redline is listed with a labelled reason, none dropped', () => {
    const items = panel.unplacedRedlines(batch());
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ key: 'art-9', title: 'Indemnity', currentText: 'shall indemnify', proposedText: 'shall defend and indemnify' });
    expect(items[0].reasonText).toBe('The quoted text appears in 3 places, so LANA did not guess which one.');
    expect(items[1]).toMatchObject({ key: 'art-10', title: 'Suggested change' });
    expect(items[1].reasonText).toBe('The quoted text was not found in the document.');
  });

  test('a reason the panel does not know still gets a sentence', () => {
    expect(panel.unplacedReasonText({ reason: 'something_new' })).toBe('It could not be placed in the document.');
    expect(panel.unplacedReasonText({ reason: 'editor_unavailable' })).toBe('Redline review is not available on this server yet.');
  });

  test('the panel renders them under "Could not place in the document", escaped', () => {
    const html = panel.renderPanel({ batches: [batch({ unanchored_redlines: [{ artifact_id: 'x', clause_label: '<b>Fees</b>', reason: 'spans_paragraphs' }] })] });
    expect(html).toContain('Could not place in the document (1)');
    expect(html).toContain('The quoted text runs across more than one paragraph.');
    expect(html).toContain('&lt;b&gt;Fees&lt;/b&gt;');
    expect(html).not.toContain('<b>Fees</b>');
  });

  test('a batch with none shows no such section (control arm)', () => {
    const html = panel.renderPanel({ batches: [batch({ unanchored_redlines: [] })] });
    expect(html).not.toContain('Could not place in the document');
  });
});

describe('changes and release state', () => {
  test('only a pending change in an open batch can be decided', () => {
    const rows = panel.changeRows(batch({ changes: [change('c1', 'proposed'), change('c2', 'accepted')] }));
    expect(rows.map((row) => [row.id, row.canDecide, row.statusLabel])).toEqual([['c1', true, 'Pending'], ['c2', false, 'Accepted']]);
    expect(panel.changeRows(batch({ status: 'pending_release' })).every((row) => !row.canDecide)).toBe(true);
  });

  test('release is offered only when every change is decided and one is accepted', () => {
    expect(panel.releaseState(batch()).canRelease).toBe(false);
    expect(panel.releaseState(batch()).hint).toContain('(2 left)');
    expect(panel.releaseState(batch({ changes: [change('c1', 'rejected')] })).hint).toBe('No change was accepted, so there is no new version to release.');
    expect(panel.releaseState(batch({ changes: [change('c1', 'accepted'), change('c2', 'rejected')] }))).toEqual({ canRelease: true, hint: '' });
    expect(panel.releaseState(batch({ status: 'pending_release' })).waiting).toBe(true);
  });
});

describe('controller: decisions', () => {
  test('an applied decision replaces the batch from the answer', async () => {
    const api = fakeApi({
      [`POST ${BASE}/b1/decisions`]: () => ({ data: { batch: batch({ changes: [change('c1', 'accepted'), change('c2', 'proposed')] }), applied: ['c1'], unchanged: [] } })
    });
    const view = container();
    const controller = panel.createController({ api, container: view, matterId: 'm1', documentId: 'doc-1' });
    controller.state.batches = [batch()];
    const result = await controller.decide('b1', 'c1', 'accept');
    expect(api.calls[0].body).toEqual({ decisions: [{ change_id: 'c1', action: 'accept' }] });
    expect(result.applied).toEqual(['c1']);
    expect(controller.state.batches[0].changes[0].status).toBe('accepted');
    expect(controller.state.ui.b1.notice).toBeNull();
    expect(view.innerHTML).toContain('Accepted by Pat Reviewer');
  });

  test('the same decision again is unchanged and says it was already recorded', async () => {
    const api = fakeApi({
      [`POST ${BASE}/b1/decisions`]: () => ({ data: { batch: batch({ changes: [change('c1', 'accepted')] }), applied: [], unchanged: ['c1'] } })
    });
    const controller = panel.createController({ api, container: container(), matterId: 'm1', documentId: 'doc-1' });
    controller.state.batches = [batch()];
    await controller.decide('b1', 'c1', 'accept');
    expect(controller.state.ui.b1.notice).toEqual({ tone: 'info', text: 'That decision was already recorded.' });
  });

  test('a 409 decided the other way shows the plain message and reloads the batch', async () => {
    const api = fakeApi({
      [`POST ${BASE}/b1/decisions`]: () => { throw problem(409, 'REDLINE_CHANGE_ALREADY_DECIDED'); },
      [`GET ${BASE}/b1`]: () => ({ data: batch({ changes: [change('c1', 'accepted'), change('c2', 'proposed')] }) })
    });
    const view = container();
    const controller = panel.createController({ api, container: view, matterId: 'm1', documentId: 'doc-1' });
    controller.state.batches = [batch()];
    expect(await controller.decide('b1', 'c1', 'reject')).toBeNull();
    expect(controller.state.ui.b1.notice.text).toBe('This change was already decided the other way. A decision is recorded once.');
    expect(api.calls.map((call) => call.method)).toEqual(['POST', 'GET']);
    expect(controller.state.batches[0].changes[0].status).toBe('accepted');
    expect(view.innerHTML).not.toContain('raw server text');
  });
});

describe('controller: release', () => {
  const decided = () => batch({ changes: [change('c1', 'accepted'), change('c2', 'rejected')] });

  test('201: released, the new version can be opened', async () => {
    const api = fakeApi({ [`POST ${BASE}/b1/release`]: () => ({ data: { release: { id: 'r1' }, document: { id: 'doc-2' }, ingestion: null } }) });
    const view = container();
    const controller = panel.createController({ api, container: view, matterId: 'm1', documentId: 'doc-1' });
    controller.state.batches = [decided()];
    const result = await controller.release('b1');
    expect(result.outcome).toBe('released');
    expect(api.calls[0].body).toEqual({});
    expect(controller.state.batches[0]).toMatchObject({ status: 'released', released_document_id: 'doc-2' });
    expect(view.innerHTML).toContain('data-redline-open-document="doc-2"');
    expect(view.innerHTML).toContain('Released as a new version.');
  });

  test('202: waiting for approval, and the release button stays off', async () => {
    const api = fakeApi({
      [`POST ${BASE}/b1/release`]: () => ({ data: { approval_required: true, approval_id: 'a1', approval: { id: 'a1' }, batch: Object.assign(decided(), { status: 'pending_release' }) } })
    });
    const view = container();
    const controller = panel.createController({ api, container: view, matterId: 'm1', documentId: 'doc-1' });
    controller.state.batches = [decided()];
    const result = await controller.release('b1');
    expect(result.outcome).toBe('approval_required');
    expect(controller.state.batches[0].status).toBe('pending_release');
    expect(view.innerHTML).toContain('Waiting for approval');
    expect(view.innerHTML).toContain('This release needs approval.');
    expect(view.innerHTML).toMatch(/data-redline-release="b1" disabled/);
  });

  test('a refused release shows the mapped message', async () => {
    const api = fakeApi({ [`POST ${BASE}/b1/release`]: () => { throw problem(409, 'REDLINE_BASE_DOCUMENT_CHANGED'); } });
    const view = container();
    const controller = panel.createController({ api, container: view, matterId: 'm1', documentId: 'doc-1' });
    controller.state.batches = [decided()];
    expect(await controller.release('b1')).toBeNull();
    expect(view.innerHTML).toContain('The document changed since these suggestions were made. Run the review again.');
  });
});

describe('controller: loading', () => {
  test('a server without redline review says so plainly', async () => {
    const api = fakeApi({ [`GET ${BASE}`]: () => { throw problem(503, 'REDLINE_EDITOR_UNAVAILABLE'); } });
    const view = container();
    const controller = panel.createController({ api, container: view, matterId: 'm1', documentId: 'doc-1' });
    await controller.load();
    expect(view.innerHTML).toContain('Redline review is not available on this server yet.');
    expect(api.calls[0].endpoint).toBe(BASE + '?limit=20');
  });
});
