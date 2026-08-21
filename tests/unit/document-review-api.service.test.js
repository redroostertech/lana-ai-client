'use strict';

const path = require('path');

const review = require(path.join(
  __dirname,
  '../../src/js/services/document-review-api.service.js'
));

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function makeApi(routes) {
  const calls = [];
  const handler = (method) => jest.fn(async (endpoint, payload) => {
    calls.push({ method, endpoint, payload });
    const key = method + ' ' + endpoint;
    for (const route of routes) {
      if (typeof route.match === 'string' ? key === route.match : route.match.test(key)) {
        return typeof route.reply === 'function' ? route.reply({ method, endpoint, payload }) : route.reply;
      }
    }
    throw new Error('Unrouted call: ' + key);
  });
  return { get: handler('GET'), post: handler('POST'), patch: handler('PATCH'), calls };
}

describe('LanaDocumentReview id helpers', () => {
  test('resolves explicit source document ids from row fields and metadata', () => {
    expect(review.explicitSourceDocumentId({ source_document_id: 'src-1' })).toBe('src-1');
    expect(review.explicitSourceDocumentId({ metadata: { source_document_id: 'src-2' } })).toBe('src-2');
    expect(review.explicitSourceDocumentId({ id: 'doc-1' })).toBe('');
  });

  test('flags released artifacts only when the source differs from the file id', () => {
    expect(review.isReleasedArtifact({ id: 'rel-1', source_document_id: 'src-1' })).toBe(true);
    expect(review.isReleasedArtifact({ id: 'src-1', source_document_id: 'src-1' })).toBe(false);
    expect(review.isReleasedArtifact({ id: 'src-1' })).toBe(false);
  });
});

describe('LanaDocumentReview grouping and serialization', () => {
  function delChange(overrides = {}) {
    return {
      change_key: 'revision:1',
      status: 'proposed',
      operation: 'delete',
      original_text: 'depose',
      proposed_text: null,
      edit_script: { version: '0', author: 'Michael', date: '2026-08-20T22:00:00Z', group_id: 'g1', ops: [{ op: 'deleteText', range: { paragraph: 1, start: 10, end: 16 } }] },
      anchor: { type: 'editor_revision', revision_id: '1', revision_type: 'del', index: 0 },
      metadata: {},
      ...overrides
    };
  }

  function insChange(overrides = {}) {
    return {
      change_key: 'revision:2',
      status: 'proposed',
      operation: 'insert',
      original_text: null,
      proposed_text: 'egegre',
      edit_script: { version: '0', author: 'Michael', date: '2026-08-20T22:00:00Z', group_id: 'g1', ops: [{ op: 'insertText', at: { paragraph: 1, start: 10 }, text: 'egegre' }] },
      anchor: { type: 'editor_revision', revision_id: '2', revision_type: 'ins', index: 1 },
      metadata: {},
      ...overrides
    };
  }

  test('groups an adjacent delete and insert of the same moment into one replacement', () => {
    const grouped = review.displayReviewChanges([delChange(), insChange()]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].operation).toBe('replace');
    expect(grouped[0].original_text).toBe('depose');
    expect(grouped[0].proposed_text).toBe('egegre');
    expect(grouped[0].anchor.revision_ids).toEqual(['1', '2']);
  });

  test('keeps unrelated changes separate', () => {
    const other = insChange({
      edit_script: { version: '0', ops: [{ op: 'insertText', at: { paragraph: 5, start: 0 }, text: 'x' }] },
      anchor: { revision_id: '9' },
      change_key: 'revision:9'
    });
    const grouped = review.displayReviewChanges([delChange(), other]);
    expect(grouped).toHaveLength(2);
  });

  test('review session filters baseline revisions out of persistable changes', () => {
    const session = review.createReviewSession();
    const baselineRevision = { id: 'base-1', type: 'ins', text: 'released redline', editScript: { ops: [{ op: 'insertText', at: { paragraph: 0, start: 0 }, text: 'released redline' }] } };
    session.captureBaseline({ revisions: [baselineRevision] });

    const newRevision = { id: 'new-1', type: 'ins', text: '#{{contact:name}}', author: 'Michael', date: '2026-08-21T13:00:00Z', editScript: { ops: [{ op: 'insertText', at: { paragraph: 1, start: 3 }, text: '#{{contact:name}}' }] } };
    const changes = session.persistableChanges({ revisions: [baselineRevision, newRevision] });

    expect(changes).toHaveLength(1);
    expect(changes[0].proposed_text).toBe('#{{contact:name}}');
    expect(changes[0].edit_script.ops).toHaveLength(1);
    expect(changes[0].anchor.revision_id).toBe('new-1');
  });

  test('persistable serialization keeps edit scripts replayable', () => {
    const session = review.createReviewSession();
    const revision = { id: 'r1', type: 'del', text: '{client_name}', editScript: { ops: [{ op: 'deleteText', range: { paragraph: 1, start: 0, end: 13 } }] } };
    const changes = session.persistableChanges({ revisions: [revision] });
    const scripts = review.editScriptsFromBatch({ changes });
    expect(scripts).toHaveLength(1);
    expect(scripts[0].ops).toEqual([{ op: 'deleteText', range: { paragraph: 1, start: 0, end: 13 } }]);
  });

  test('preserves every current Lana Editor operation and its script provenance', () => {
    const ops = [
      { op: 'insertText', at: { paragraph: 0, start: 0 }, text: 'A' },
      { op: 'insertBlocks', at: { paragraph: 0 }, position: 'after', blocks: [{ text: 'Block' }] },
      { op: 'deleteText', range: { paragraph: 0, start: 0, end: 1 } },
      { op: 'replaceText', range: { paragraph: 0, start: 0, end: 1 }, text: 'B' },
      { op: 'formatText', range: { paragraph: 0, start: 0, end: 1 }, marks: { bold: true } },
      { op: 'formatParagraph', at: { paragraph: 0 }, set: { align: 'center' } },
      { op: 'splitParagraph', at: { paragraph: 0, start: 1 } },
      { op: 'mergeParagraphs', at: { paragraph: 0 } }
    ];
    const baseDocumentHash = 'visible-text/1:sha256:' + 'a'.repeat(64);
    const session = review.createReviewSession();
    const changes = session.persistableChanges({
      revisions: [{
        id: 'all-live-ops',
        type: 'fmt',
        text: 'A',
        author: 'Michael',
        date: '2026-08-21T18:00:00Z',
        editScript: {
          version: '0',
          group_id: 'editor-group-1',
          baseDocumentHash,
          ops
        }
      }]
    });

    expect(changes).toHaveLength(1);
    expect(changes[0].edit_script).toEqual({
      version: '0',
      author: 'Michael',
      date: '2026-08-21T18:00:00Z',
      group_id: 'editor-group-1',
      baseDocumentHash,
      ops
    });
  });
});

describe('LanaDocumentReview API workflows', () => {
  test('loadWorkflow follows the canonical source id from releases metadata', async () => {
    const api = makeApi([
      {
        match: 'GET /api/v1/matters/MATT-1/documents/released-doc/releases?limit=20',
        reply: { data: [], metadata: { source_document_id: 'source-doc', current_document_is_release: true } }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/releases?limit=20',
        reply: { data: [{ id: 'rel-7', release_number: 7, edit_batch_id: 'batch-7' }], metadata: { source_document_id: 'source-doc' } }
      },
      {
        match: /^GET \/api\/v1\/matters\/MATT-1\/document-edit-batches\?document_id=source-doc/,
        reply: { data: [{ id: 'draft-1', status: 'draft' }, { id: 'old-1', status: 'released' }] }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/document-edit-batches/draft-1',
        reply: { data: { id: 'draft-1', status: 'draft', changes: [{ change_key: 'c1' }] } }
      }
    ]);

    const workflow = await review.loadWorkflow({ api, matterId: 'MATT-1', documentId: 'released-doc' });

    expect(workflow.sourceDocumentId).toBe('source-doc');
    expect(workflow.currentDocumentIsRelease).toBe(true);
    expect(workflow.releases).toHaveLength(1);
    expect(workflow.currentDraftBatch.changes).toHaveLength(1);
    expect(workflow.pendingReleaseBatch).toBeNull();
  });

  test('saveDraftBatch PATCHes an active draft and POSTs a new one', async () => {
    const api = makeApi([
      { match: 'PATCH /api/v1/matters/MATT-1/document-edit-batches/draft-1', reply: { data: { id: 'draft-1', status: 'draft' } } },
      { match: 'POST /api/v1/matters/MATT-1/documents/source-doc/edit-batches', reply: { data: { id: 'draft-2', status: 'draft' } } }
    ]);

    const patched = await review.saveDraftBatch({
      api,
      matterId: 'MATT-1',
      documentId: 'source-doc',
      batch: { id: 'draft-1', status: 'draft' },
      payload: { status: 'draft', changes: [] }
    });
    expect(patched.id).toBe('draft-1');

    const created = await review.saveDraftBatch({
      api,
      matterId: 'MATT-1',
      documentId: 'source-doc',
      batch: { id: 'released-1', status: 'released' },
      payload: { status: 'draft', changes: [] }
    });
    expect(created.id).toBe('draft-2');
    expect(api.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  test('saveDraftBatch PATCH forwards current editor operations without rewriting them', async () => {
    const api = makeApi([
      { match: 'PATCH /api/v1/matters/MATT-1/document-edit-batches/draft-1', reply: { data: { id: 'draft-1', status: 'draft' } } }
    ]);
    const formatOp = {
      op: 'formatText',
      range: { paragraph: 0, start: 0, end: 9 },
      marks: { bold: true, color: '#112233' }
    };
    const payload = {
      title: 'Review draft: affidavit.docx',
      status: 'draft',
      changes: [{
        change_key: 'revision:format-1',
        status: 'proposed',
        operation: 'fmt',
        edit_script: { version: '0', author: 'Michael', date: '2026-08-21T18:00:00Z', ops: [formatOp] }
      }]
    };

    await review.saveDraftBatch({
      api,
      matterId: 'MATT-1',
      documentId: 'source-doc',
      batch: { id: 'draft-1', status: 'draft' },
      payload
    });

    expect(api.calls[0].payload.changes[0].edit_script.ops[0]).toEqual(formatOp);
  });

  test('loadWorkflow hydrates pending-release batch detail for approval-safe rendering', async () => {
    const api = makeApi([
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/releases?limit=20',
        reply: { data: [], metadata: { source_document_id: 'source-doc' } }
      },
      {
        match: /^GET \/api\/v1\/matters\/MATT-1\/document-edit-batches\?document_id=source-doc/,
        reply: { data: [{ id: 'pending-1', status: 'pending_release' }] }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/document-edit-batches/pending-1',
        reply: { data: { id: 'pending-1', status: 'pending_release', changes: [{ change_key: 'c1' }] } }
      }
    ]);

    const workflow = await review.loadWorkflow({ api, matterId: 'MATT-1', documentId: 'source-doc' });

    expect(workflow.currentDraftBatch).toBeNull();
    expect(workflow.pendingReleaseBatch.changes).toHaveLength(1);
    expect(workflow.pendingDetailFailed).toBe(false);
  });

  test('active draft selection honors draft and proposed statuses only', () => {
    expect(review.activeDraftBatchFromList([
      { id: 'a', status: 'released' },
      { id: 'b', status: 'proposed' },
      { id: 'c', status: 'draft' }
    ]).id).toBe('b');
    expect(review.pendingReleaseBatchFromList([{ id: 'p', status: 'pending_release' }]).id).toBe('p');
  });
});

describe('LanaDocumentReview dates and release payloads', () => {
  test('latestActivityIso picks the newest of document and batch dates', () => {
    const iso = review.latestActivityIso(
      { updated_at: '2026-08-17T14:47:04Z', created_at: '2026-08-17T14:39:44Z' },
      { updated_at: '2026-08-21T01:10:00Z' }
    );
    expect(iso).toBe('2026-08-21T01:10:00.000Z');
    expect(review.latestActivityIso(null, null)).toBe('');
  });

  test('buildReleasePayload rejects DOCX bytes without a ZIP envelope', () => {
    expect(() => review.buildReleasePayload({
      filename: 'affidavit.docx',
      contentType: DOCX_TYPE,
      bytes: new Uint8Array([1, 2, 3])
    })).toThrow('valid Word document');
  });

  test('buildReleasePayload accepts a minimal DOCX package and names the release', () => {
    const bytes = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      0x50, 0x4b, 0x05, 0x06,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0
    ]);
    const payload = review.buildReleasePayload({
      filename: 'affidavit-template.docx',
      contentType: DOCX_TYPE,
      bytes
    });
    expect(payload.filename).toBe('affidavit-template - released.docx');
    expect(payload.content_base64).toEqual(expect.any(String));
    expect(payload.approved).toBe(false);
  });
});
