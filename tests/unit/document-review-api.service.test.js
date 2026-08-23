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

  test('persists semantic font before/after values without rewriting the format operation', () => {
    const session = review.createReviewSession();
    const formatOp = {
      op: 'formatText',
      range: { paragraph: 0, start: 0, end: 5 },
      marks: { font: 'Times New Roman' }
    };
    const changes = session.persistableChanges({
      revisions: [{
        id: 'font-1',
        type: 'fmt',
        text: 'Alpha',
        author: 'Michael',
        date: '2026-08-21T18:00:00Z',
        formatKind: 'text',
        formatBefore: {
          font: 'Arial', size: 11, bold: false, italic: false,
          underline: false, strike: false, superscript: false,
          subscript: false, color: '#112233', highlight: null
        },
        formatAfter: {
          font: 'Times New Roman', size: 11, bold: false, italic: false,
          underline: false, strike: false, superscript: false,
          subscript: false, color: '#112233', highlight: null
        },
        editScript: { version: '0', author: 'Michael', date: '2026-08-21T18:00:00Z', ops: [formatOp] }
      }]
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      operation: 'format',
      original_text: 'Font: Arial',
      proposed_text: 'Font: Times New Roman',
      edit_script: { ops: [formatOp] },
      anchor: { revision_id: 'font-1', revision_type: 'fmt' },
      metadata: {
        format_change: {
          kind: 'text',
          properties: ['font'],
          before: { font: 'Arial' },
          after: { font: 'Times New Roman' }
        }
      }
    });
    expect(review.changeLabel(changes[0])).toBe('Font');
    expect(review.changeLabel(Object.assign({}, changes[0], {
      released_in: { release_number: 8 }
    }))).toBe('Font');
    expect(review.persistedDraftChangePayload(changes[0])).toMatchObject({
      operation: 'format',
      original_text: 'Font: Arial',
      proposed_text: 'Font: Times New Roman',
      edit_script: { ops: [formatOp] },
      metadata: { format_change: { properties: ['font'] } }
    });
  });

  test('prefers semantic formatting metadata over a legacy generic text fallback', () => {
    const persisted = {
      operation: 'format',
      original_text: 'previous draft text',
      proposed_text: 'Captured local edit',
      metadata: {
        format_change: {
          kind: 'text',
          properties: ['font'],
          before: { font: 'Arial' },
          after: { font: 'Times New Roman' }
        }
      }
    };

    expect(review.changeLabel(persisted)).toBe('Font');
    expect(review.changeOriginalText(persisted)).toBe('Font: Arial');
    expect(review.changeProposedText(persisted)).toBe('Font: Times New Roman');
  });

  test('audits size, marks, color, and alignment with readable semantic values', () => {
    const text = review.formatChangeDetailsFromRevision({
      type: 'fmt',
      formatKind: 'text',
      formatBefore: { size: 11, bold: false, italic: false, underline: false, color: '#111111' },
      formatAfter: { size: 14, bold: true, italic: true, underline: true, color: '#AABBCC' }
    });
    expect(text.properties).toEqual(['size', 'bold', 'italic', 'underline', 'color']);
    expect(text.originalText).toBe('Size: 11 pt; Bold: Off; Italic: Off; Underline: Off; Text color: #111111');
    expect(text.proposedText).toBe('Size: 14 pt; Bold: On; Italic: On; Underline: On; Text color: #AABBCC');

    const paragraph = review.formatChangeDetailsFromRevision({
      type: 'fmt',
      formatKind: 'paragraph',
      formatBefore: { alignment: 'left' },
      formatAfter: { alignment: 'both' }
    });
    expect(paragraph.originalText).toBe('Alignment: Left');
    expect(paragraph.proposedText).toBe('Alignment: Justified');
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
  test('resolves an original-based draft to the canonical source document', () => {
    expect(review.draftBaseDocumentId(
      { id: 'draft-original', base_file_version_id: 'source-fv-1' },
      [{ id: 'release-1', file_version_id: 'release-fv-1', released_document_id: 'released-doc-1' }],
      'source-doc'
    )).toBe('source-doc');
  });

  test('resolves a Release-N-based draft to that immutable release document', () => {
    expect(review.draftBaseDocumentId(
      { id: 'draft-8', base_file_version_id: 'release-fv-8' },
      [
        { id: 'release-9', file_version_id: 'release-fv-9', released_document_id: 'released-doc-9' },
        { id: 'release-8', file_version_id: 'release-fv-8', released_document_id: 'released-doc-8' }
      ],
      'source-doc'
    )).toBe('released-doc-8');
  });

  test('uses server predecessor identity when a release parent is outside the loaded 20-row rail', () => {
    var visibleReleases = [];
    for (var releaseNumber = 40; releaseNumber >= 21; releaseNumber -= 1) {
      visibleReleases.push({
        id: 'release-' + releaseNumber,
        release_number: releaseNumber,
        released_document_id: 'released-doc-' + releaseNumber
      });
    }
    visibleReleases[19].previous_released_document_id = 'released-doc-20';

    expect(review.previousReleaseDocumentId(
      visibleReleases[19],
      visibleReleases,
      'source-doc'
    )).toBe('released-doc-20');
  });

  test('loads every release page so versions older than the first 20 remain selectable', async () => {
    var firstPage = [];
    for (var releaseNumber = 40; releaseNumber >= 21; releaseNumber -= 1) {
      firstPage.push({ id: 'release-' + releaseNumber, release_number: releaseNumber });
    }
    var api = makeApi([
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/releases?limit=20',
        reply: { data: firstPage, metadata: { total: 20, source_document_id: 'source-doc' } }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/releases?limit=20&page=2',
        reply: { data: [{ id: 'release-20', release_number: 20 }], metadata: { total: 21 } }
      }
    ]);

    var result = await review.loadReleaseLineage({ api, matterId: 'MATT-1', documentId: 'source-doc' });

    expect(result.data).toHaveLength(21);
    expect(result.data[20]).toEqual(expect.objectContaining({ id: 'release-20' }));
    expect(api.calls).toHaveLength(2);
  });

  test('reports batch-detail hydration failure without discarding the list row', async () => {
    var api = makeApi([]);
    var summary = { id: 'draft-failed', status: 'draft' };
    var result = await review.hydrateBatchDetail({ api, matterId: 'MATT-1', batch: summary });

    expect(result.failed).toBe(true);
    expect(result.batch).toBe(summary);
    expect(result.error).toBeInstanceOf(Error);
  });

  test('distinguishes an unavailable release batch detail from a valid empty release', async () => {
    var api = makeApi([
      {
        match: 'GET /api/v1/matters/MATT-1/document-edit-batches/batch-ok',
        reply: { data: { id: 'batch-ok', changes: [] } }
      }
    ]);
    var groups = await review.loadReleaseChangeGroups({
      api,
      matterId: 'MATT-1',
      releases: [
        { id: 'release-ok', edit_batch_id: 'batch-ok' },
        { id: 'release-failed', edit_batch_id: 'batch-5xx' },
        { id: 'release-without-batch' }
      ]
    });

    expect(groups).toEqual([
      expect.objectContaining({ release_id: 'release-ok', changes: [], failed: false }),
      expect.objectContaining({ release_id: 'release-failed', changes: [], failed: true }),
      expect.objectContaining({ release_id: 'release-without-batch', changes: [], failed: true })
    ]);
  });

  test('loads an original-based draft with replayable scripts on the source bytes', async () => {
    var insertScript = {
      version: '0',
      ops: [{ op: 'insertText', at: { paragraph: 0, start: 0 }, text: 'Original draft' }]
    };
    var api = makeApi([
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/releases?limit=20',
        reply: {
          data: [{ id: 'rel-1', released_document_id: 'released-doc-1', file_version_id: 'release-fv-1', release_number: 1 }],
          metadata: { source_document_id: 'source-doc', current_document_is_release: false }
        }
      },
      {
        match: /^GET \/api\/v1\/matters\/MATT-1\/document-edit-batches\?document_id=source-doc/,
        reply: { data: [{ id: 'draft-original', status: 'draft', base_file_version_id: 'source-fv-1' }] }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/document-edit-batches/draft-original',
        reply: { data: { id: 'draft-original', status: 'draft', base_file_version_id: 'source-fv-1', changes: [{ change_key: 'c1', edit_script: insertScript }] } }
      }
    ]);

    var workflow = await review.loadWorkflow({ api, matterId: 'MATT-1', documentId: 'source-doc' });

    expect(workflow.currentDraftBatch.id).toBe('draft-original');
    expect(review.draftBaseDocumentId(workflow.currentDraftBatch, workflow.releases, workflow.sourceDocumentId)).toBe('source-doc');
    expect(review.editScriptsFromBatch(workflow.currentDraftBatch)).toHaveLength(1);
    expect(review.editScriptsFromBatch(workflow.currentDraftBatch)[0].ops).toEqual(insertScript.ops);
  });

  test('loadWorkflow follows the canonical source id from releases metadata', async () => {
    const api = makeApi([
      {
        match: 'GET /api/v1/matters/MATT-1/documents/released-doc/releases?limit=20',
        reply: { data: [{ id: 'rel-7', released_document_id: 'released-doc', file_version_id: 'fv-7', release_number: 7, edit_batch_id: 'batch-7' }], metadata: { source_document_id: 'source-doc', current_document_is_release: true } }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/releases?limit=20',
        reply: { data: [{ id: 'rel-7', released_document_id: 'released-doc', file_version_id: 'fv-7', release_number: 7, edit_batch_id: 'batch-7' }], metadata: { source_document_id: 'source-doc' } }
      },
      {
        match: /^GET \/api\/v1\/matters\/MATT-1\/document-edit-batches\?document_id=source-doc/,
        reply: { data: [{ id: 'draft-1', status: 'draft', base_file_version_id: 'fv-7' }, { id: 'old-1', status: 'released' }] }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/document-edit-batches/draft-1',
        reply: { data: { id: 'draft-1', status: 'draft', base_file_version_id: 'fv-7', changes: [{ change_key: 'c1', edit_script: { version: '0', ops: [{ op: 'insertText', at: { paragraph: 0, start: 0 }, text: 'Release draft' }] } }] } }
      }
    ]);

    const workflow = await review.loadWorkflow({ api, matterId: 'MATT-1', documentId: 'released-doc' });

    expect(workflow.sourceDocumentId).toBe('source-doc');
    expect(workflow.currentDocumentIsRelease).toBe(true);
    expect(workflow.currentBaseFileVersionId).toBe('fv-7');
    expect(workflow.releases).toHaveLength(1);
    expect(workflow.currentDraftBatch.changes).toHaveLength(1);
    expect(workflow.pendingReleaseBatch).toBeNull();
    expect(review.draftBaseDocumentId(workflow.currentDraftBatch, workflow.releases, workflow.sourceDocumentId)).toBe('released-doc');
    expect(review.editScriptsFromBatch(workflow.currentDraftBatch)[0].ops[0].text).toBe('Release draft');
  });

  test('loadWorkflow does not replay a draft from another release version', async () => {
    const release = { id: 'rel-8', released_document_id: 'released-doc-8', file_version_id: 'fv-8', release_number: 8 };
    const api = makeApi([
      {
        match: 'GET /api/v1/matters/MATT-1/documents/released-doc-8/releases?limit=20',
        reply: { data: [release], metadata: { source_document_id: 'source-doc', current_document_is_release: true } }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/releases?limit=20',
        reply: { data: [release], metadata: { source_document_id: 'source-doc' } }
      },
      {
        match: /^GET \/api\/v1\/matters\/MATT-1\/document-edit-batches\?document_id=source-doc/,
        reply: { data: [{ id: 'stale-draft', status: 'draft', base_file_version_id: 'fv-7' }] }
      }
    ]);

    const workflow = await review.loadWorkflow({ api, matterId: 'MATT-1', documentId: 'released-doc-8' });

    expect(workflow.currentBaseFileVersionId).toBe('fv-8');
    expect(workflow.currentDraftBatch).toBeNull();
    expect(api.calls.some((call) => call.endpoint.includes('/document-edit-batches/stale-draft'))).toBe(false);
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
        reply: {
          data: {
            id: 'pending-1',
            status: 'pending_release',
            changes: [{ change_key: 'c1' }],
            release_approval: { id: 'approval-1', status: 'expired' }
          }
        }
      }
    ]);

    const workflow = await review.loadWorkflow({ api, matterId: 'MATT-1', documentId: 'source-doc' });

    expect(workflow.currentDraftBatch).toBeNull();
    expect(workflow.pendingReleaseBatch.changes).toHaveLength(1);
    expect(workflow.pendingReleaseBatch.release_approval).toEqual({ id: 'approval-1', status: 'expired' });
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
