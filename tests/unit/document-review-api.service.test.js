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

  test('prefers the saved user-action replay chronology over document-ordered review rows', () => {
    const bold = { op: 'formatText', range: { paragraph: 0, start: 0, end: 5 }, marks: { bold: true } };
    const replace = { op: 'replaceText', range: { paragraph: 0, start: 6, end: 10 }, text: 'linked' };
    const clear = { op: 'formatText', range: { paragraph: 0, start: 0, end: 5 }, marks: { bold: false } };
    const scripts = review.editScriptsFromBatch({
      review_metadata: {
        replay_scripts: [
          { version: '0', group_id: 'bold', baseDocumentHash: 'visible-text/1:sha256:abc', ops: [bold] },
          { version: '0', group_id: 'replace', op_group_ids: ['replace'], ops: [replace] },
          { version: '0', group_id: 'clear', ops: [clear] }
        ]
      },
      changes: [
        insChange({ edit_script: { version: '0', ops: [replace] } }),
        insChange({ change_key: 'revision:9', edit_script: { version: '0', ops: [bold, clear] } })
      ]
    });

    expect(scripts.map((script) => script.group_id)).toEqual(['bold', 'replace', 'clear']);
    expect(scripts.map((script) => script.ops[0])).toEqual([bold, replace, clear]);
    expect(scripts[0].baseDocumentHash).toBe('visible-text/1:sha256:abc');
    expect(scripts[1].op_group_ids).toEqual(['replace']);
  });

  test('falls back to per-change replay when chronology metadata is absent or empty', () => {
    const change = insChange();
    expect(review.editScriptsFromBatch({ review_metadata: { replay_scripts: [] }, changes: [change] }))
      .toHaveLength(1);
    expect(review.editScriptsFromBatch({ changes: [change] })[0].ops)
      .toEqual(change.edit_script.ops);
  });

  test('replays numeric revision scripts in engine order after Undo/Redo row recreation', () => {
    const first = insChange({
      change_key: 'revision:1',
      anchor: { revision_id: '1' },
      edit_script: { version: '0', ops: [{ op: 'insertText', at: { paragraph: 0, start: 0 }, text: 'first' }] }
    });
    const split = insChange({
      change_key: 'revision:2',
      anchor: { revision_id: '2' },
      proposed_text: '¶',
      edit_script: { version: '0', ops: [{ op: 'splitParagraph', at: { paragraph: 0, start: 5 } }] }
    });
    const divergent = insChange({
      change_key: 'revision:3',
      anchor: { revision_id: '3' },
      edit_script: { version: '0', ops: [{ op: 'insertText', at: { paragraph: 1, start: 0 }, text: 'divergent' }] }
    });

    const scripts = review.editScriptsFromBatch({ changes: [first, divergent, split] });

    expect(scripts.map((script) => script.ops[0].op)).toEqual([
      'insertText',
      'splitParagraph',
      'insertText'
    ]);
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

  test('a tracked column resize reads as "Table resized" with its widths, and persists as a table format change', () => {
    // The editor records a drag on a column boundary as w:tblGridChange and
    // surfaces it as a fmt revision of kind "table" with the widths in points.
    const resizeOp = { op: 'resizeTableColumns', table: 0, widths: [1600, 1400, 3000] };
    const revision = {
      id: 'tbl-1',
      type: 'fmt',
      author: 'Michael',
      date: '2026-09-25T20:00:00Z',
      formatKind: 'table',
      formatBefore: { columnWidths: [100, 100, 100] },
      formatAfter: { columnWidths: [80, 70, 150] },
      editScript: { version: '0', ops: [resizeOp] }
    };
    const details = review.formatChangeDetailsFromRevision(revision);
    expect(details.kind).toBe('table');
    expect(details.properties).toEqual(['columnWidths']);
    expect(details.originalText).toBe('Column widths: 100 pt, 100 pt, 100 pt');
    expect(details.proposedText).toBe('Column widths: 80 pt, 70 pt, 150 pt');
    expect(review.changeLabel(revision)).toBe('Table resized');

    // A lone cell record (a resize Word made, read back per cell) reads as its width.
    const cell = review.formatChangeDetailsFromRevision({ type: 'fmt', formatKind: 'table', formatBefore: { cellWidth: 100 }, formatAfter: { cellWidth: 120 } });
    expect(cell.originalText).toBe('Cell width: 100 pt');
    expect(review.changeLabel({ type: 'fmt', formatKind: 'table', formatBefore: { cellWidth: 100 }, formatAfter: { cellWidth: 120 } })).toBe('Table resized');

    // Control arm: a single-property text change keeps its own label, and an unchanged table is no change at all.
    expect(review.changeLabel({ type: 'fmt', formatKind: 'text', formatBefore: { font: 'Arial' }, formatAfter: { font: 'Times New Roman' } })).toBe('Font');
    expect(review.formatChangeDetailsFromRevision({ type: 'fmt', formatKind: 'table', formatBefore: { columnWidths: [100, 100] }, formatAfter: { columnWidths: [100, 100] } })).toBeNull();

    const session = review.createReviewSession();
    const changes = session.persistableChanges({ revisions: [revision] });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      operation: 'format',
      original_text: 'Column widths: 100 pt, 100 pt, 100 pt',
      proposed_text: 'Column widths: 80 pt, 70 pt, 150 pt',
      edit_script: { ops: [resizeOp] },
      metadata: { format_change: { kind: 'table', properties: ['columnWidths'], before: { columnWidths: [100, 100, 100] }, after: { columnWidths: [80, 70, 150] } } }
    });
  });

  test('tracked table rows and columns read as "Row inserted", "Row deleted", "Column inserted", "Column deleted", and persist their kind', () => {
    // The editor marks an inserted or deleted row (w:ins / w:del in w:trPr)
    // and a column's cells (w:cellIns / w:cellDel) as ins/del revisions
    // carrying structureKind; the row's text is what a deletion shows.
    var insertedRow = { id: 'r1', type: 'ins', author: 'Michael', date: '2026-09-25T21:00:00Z', text: '', structureKind: 'row', editScript: { version: '0', ops: [{ op: 'insertTableRow', table: 0, row: 1, position: 'after' }] } };
    var deletedRow = { id: 'r2', type: 'del', author: 'Michael', date: '2026-09-25T21:00:00Z', text: 'Revolving Afterpay $4,486.57', structureKind: 'row', editScript: { version: '0', ops: [{ op: 'deleteTableRow', table: 0, row: 3 }] } };
    var insertedColumn = { id: 'c1', type: 'ins', author: 'Michael', date: '2026-09-25T21:00:00Z', text: '', structureKind: 'column', editScript: { version: '0', ops: [{ op: 'insertTableColumn', table: 0, column: 0, position: 'before' }] } };
    var deletedColumn = { id: 'c2', type: 'del', author: 'Michael', date: '2026-09-25T21:00:00Z', text: 'Credit', structureKind: 'column', editScript: { version: '0', ops: [{ op: 'deleteTableColumn', table: 0, column: 1 }] } };

    expect(review.changeLabel(insertedRow)).toBe('Row inserted');
    expect(review.changeLabel(deletedRow)).toBe('Row deleted');
    expect(review.changeLabel(insertedColumn)).toBe('Column inserted');
    expect(review.changeLabel(deletedColumn)).toBe('Column deleted');
    expect(review.changeProposedText(insertedRow)).toBe('New row');
    expect(review.changeProposedText(insertedColumn)).toBe('New column');
    expect(review.changeOriginalText(deletedRow)).toBe('Revolving Afterpay $4,486.57');

    var session = review.createReviewSession();
    var changes = session.persistableChanges({ revisions: [insertedRow, deletedRow, insertedColumn, deletedColumn] });
    expect(changes).toHaveLength(4);
    expect(changes[0]).toMatchObject({ operation: 'insert', proposed_text: 'New row', metadata: { structure_change: { kind: 'row' } }, edit_script: { ops: [{ op: 'insertTableRow', table: 0, row: 1, position: 'after' }] } });
    expect(changes[1]).toMatchObject({ operation: 'delete', original_text: 'Revolving Afterpay $4,486.57', metadata: { structure_change: { kind: 'row' } } });
    expect(changes[3]).toMatchObject({ operation: 'delete', metadata: { structure_change: { kind: 'column' } } });
    // A persisted row read back (no live structureKind) keeps its label through the metadata.
    expect(review.changeLabel({ operation: 'insert', proposed_text: 'New row', metadata: { structure_change: { kind: 'row' } } })).toBe('Row inserted');
    expect(review.changeLabel(review.persistedDraftChangePayload(changes[3]))).toBe('Column deleted');

    // Control arm: plain insertions and deletions keep their labels and text.
    expect(review.changeLabel({ type: 'ins', text: 'plain' })).toBe('Insertion');
    expect(review.changeProposedText({ type: 'ins', text: '' })).toBe('');
    expect(review.changeLabel({ type: 'del', text: 'x' })).toBe('Deletion');
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
      { op: 'mergeParagraphs', at: { paragraph: 0 } },
      { op: 'resizeTableColumns', table: 0, widths: [1600, 1400, 3000] },
      { op: 'insertTableRow', table: 0, row: 0, position: 'after' },
      { op: 'deleteTableRow', table: 0, row: 1 },
      { op: 'insertTableColumn', table: 0, column: 0, position: 'before', width: 720 },
      { op: 'deleteTableColumn', table: 0, column: 1 }
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

  test('resolves a pending-window successor to its approved parent release', () => {
    expect(review.draftBaseDocumentId(
      {
        id: 'successor-1',
        base_file_version_id: 'source-fv-1',
        review_metadata: { base_pending_release_batch_id: 'batch-1' }
      },
      [{ id: 'release-1', edit_batch_id: 'batch-1', file_version_id: 'release-fv-1', released_document_id: 'released-doc-1' }],
      'source-doc'
    )).toBe('released-doc-1');
  });

  test('requires the pending accepted baseline until a linked successor has an immutable parent release', () => {
    const pending = { id: 'pending-1', status: 'pending_release' };
    const successor = {
      id: 'draft-2',
      status: 'draft',
      review_metadata: { base_pending_release_batch_id: 'pending-1' }
    };

    expect(review.requiresPendingReleaseBaseline(null, pending, [])).toBe(true);
    expect(review.requiresPendingReleaseBaseline(successor, pending, [])).toBe(true);
    expect(review.requiresPendingReleaseBaseline(successor, pending, [
      { id: 'release-1', edit_batch_id: 'pending-1', released_document_id: 'released-doc-1' }
    ])).toBe(false);
    expect(review.requiresPendingReleaseBaseline({
      ...successor,
      review_metadata: { base_pending_release_batch_id: 'different-pending' }
    }, pending, [])).toBe(false);
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
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/edit-batches/batch-ok',
        reply: { data: { id: 'batch-ok', changes: [], review_metadata: { comments: [{ id: 'comment-1' }] } } }
      }
    ]);
    var groups = await review.loadReleaseChangeGroups({
      api,
      matterId: 'MATT-1',
      documentId: 'source-doc',
      releases: [
        { id: 'release-ok', edit_batch_id: 'batch-ok' },
        { id: 'release-failed', edit_batch_id: 'batch-5xx' },
        { id: 'release-without-batch' }
      ]
    });

    expect(groups).toEqual([
      expect.objectContaining({
        release_id: 'release-ok',
        changes: [],
        review_metadata: { comments: [{ id: 'comment-1' }] },
        failed: false
      }),
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
        match: /^GET \/api\/v1\/matters\/MATT-1\/documents\/source-doc\/edit-batches\?/,
        reply: { data: [{ id: 'draft-original', status: 'draft', base_file_version_id: 'source-fv-1' }] }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/edit-batches/draft-original',
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
        match: /^GET \/api\/v1\/matters\/MATT-1\/documents\/source-doc\/edit-batches\?/,
        reply: { data: [{ id: 'draft-1', status: 'draft', base_file_version_id: 'fv-7' }, { id: 'old-1', status: 'released' }] }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/edit-batches/draft-1',
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
        match: /^GET \/api\/v1\/matters\/MATT-1\/documents\/source-doc\/edit-batches\?/,
        reply: { data: [{ id: 'stale-draft', status: 'draft', base_file_version_id: 'fv-7' }] }
      }
    ]);

    const workflow = await review.loadWorkflow({ api, matterId: 'MATT-1', documentId: 'released-doc-8' });

    expect(workflow.currentBaseFileVersionId).toBe('fv-8');
    expect(workflow.currentDraftBatch).toBeNull();
    expect(api.calls.some((call) => call.endpoint.includes('/edit-batches/stale-draft'))).toBe(false);
  });

  test('saveDraftBatch PATCHes an active draft and POSTs a new one', async () => {
    const api = makeApi([
      { match: 'PATCH /api/v1/matters/MATT-1/documents/source-doc/edit-batches/draft-1', reply: { data: { id: 'draft-1', status: 'draft' } } },
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
      { match: 'PATCH /api/v1/matters/MATT-1/documents/source-doc/edit-batches/draft-1', reply: { data: { id: 'draft-1', status: 'draft' } } }
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

  test('releases through the same document-scoped batch boundary', async () => {
    const api = makeApi([
      {
        match: 'POST /api/v1/matters/MATT-1/documents/source-doc/edit-batches/draft-1/release',
        reply: { data: { batch: { id: 'draft-1', status: 'pending_release' }, approval_required: true } }
      }
    ]);

    const result = await review.releaseBatch({
      api,
      matterId: 'MATT-1',
      documentId: 'source-doc',
      batchId: 'draft-1',
      payload: { content_text: 'final' }
    });

    expect(result).toMatchObject({ approval_required: true });
    expect(api.calls[0].endpoint).toContain('/documents/source-doc/edit-batches/draft-1/release');
  });

  test('loadWorkflow hydrates pending-release batch detail for approval-safe rendering', async () => {
    const api = makeApi([
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/releases?limit=20',
        reply: { data: [], metadata: { source_document_id: 'source-doc' } }
      },
      {
        match: /^GET \/api\/v1\/matters\/MATT-1\/documents\/source-doc\/edit-batches\?/,
        reply: { data: [{ id: 'pending-1', status: 'pending_release' }] }
      },
      {
        match: 'GET /api/v1/matters/MATT-1/documents/source-doc/edit-batches/pending-1',
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

  describe('annotations kept with the draft', () => {
    const textAnchor = { space: 'visible-text/1', ranges: [{ paragraph: 3, start: 8, end: 17 }], text: '$5,000.00' };
    const pageAnchor = { space: 'pdf-page/1', page: 2, rects: [{ x: 72, y: 144.5, w: 200, h: 14 }] };

    test('reads kinds, colours and both anchor spaces, and refuses bad geometry, an unknown space or a bad colour', () => {
      expect(review.annotationKind({ kind: 'highlight' })).toBe('highlight');
      expect(review.annotationKind({ kind: 'REDLINE' })).toBe('redline');
      expect(review.annotationKind({})).toBe('comment');
      expect(review.annotationKind({ kind: 'sticker' })).toBe('comment');
      expect(review.annotationColor({ kind: 'highlight' })).toBe('#FFE066');
      expect(review.annotationColor({ kind: 'highlight', color: '#86efac' })).toBe('#86EFAC');
      expect(review.annotationColor({ kind: 'comment' })).toBe('');
      expect(review.annotationColor({ kind: 'highlight', color: 'yellow' })).toBe('#FFE066');
      expect(review.annotationLabel({ kind: 'redline' })).toBe('Suggested change');
      expect(review.annotationLabel({ kind: 'highlight' })).toBe('Highlight');
      expect(review.annotationLabel({ kind: 'comment' })).toBe('Comment');
      expect(review.annotationLabel({})).toBe('Comment');

      expect(review.normalizeAnnotationAnchor(textAnchor)).toEqual(textAnchor);
      expect(review.normalizeAnnotationAnchor(pageAnchor)).toEqual(pageAnchor);
      expect(review.normalizeAnnotationAnchor({ space: 'visible-text/1', ranges: [{ paragraph: 1, start: 9, end: 3 }] })).toBeNull();
      expect(review.normalizeAnnotationAnchor({ space: 'pdf-page/1', page: 0, rects: pageAnchor.rects })).toBeNull();
      expect(review.normalizeAnnotationAnchor({ space: 'pdf-page/1', page: 1, rects: [{ x: 1, y: 1, w: 0, h: 4 }] })).toBeNull();
      expect(review.normalizeAnnotationAnchor({ space: 'dom-offsets/1', start: 1, end: 2 })).toBeNull();
      expect(review.normalizeAnnotationAnchor(null)).toBeNull();
    });

    test('builds a new thread in the persisted shape: a highlight without text, a comment or note only with text', () => {
      const highlight = review.buildAnnotationThread({ kind: 'highlight', author: 'Michael', author_id: 'u-1', anchor: pageAnchor, date: '2026-09-25T20:00:00Z' });
      expect(highlight).toMatchObject({ kind: 'highlight', color: '#FFE066', author: 'Michael', author_id: 'u-1', text: '', scope: 'selection', anchor: pageAnchor, status: 'open', replies: [], created_at: '2026-09-25T20:00:00Z' });
      expect(highlight.id).toMatch(/^highlight-/);
      expect(highlight.thread_id).toBe(highlight.id);
      const note = review.buildAnnotationThread({ kind: 'redline', text: 'Payee is wrong', proposed_text: 'Title Bond Agency LLC', anchor: textAnchor });
      expect(note).toMatchObject({ kind: 'redline', proposed_text: 'Title Bond Agency LLC', anchor_text: '$5,000.00', anchor: textAnchor });
      expect(review.buildAnnotationThread({ kind: 'comment', text: '   ', anchor: pageAnchor })).toBeNull();
      expect(review.buildAnnotationThread({ kind: 'redline', text: '', anchor: pageAnchor })).toBeNull();
      // A comment with no anchor is a document comment.
      expect(review.buildAnnotationThread({ text: 'General' }).scope).toBe('document');
    });

    test('picks the open suggested changes a converted copy can accept: a suggestion with text to find and text to put in its place', () => {
      const threads = [
        { id: 's1', kind: 'redline', text: 'Wrong payee', proposed_text: 'Title Bond Agency LLC', anchor_text: 'Title Bond Agenc', anchor: pageAnchor },
        { id: 's2', kind: 'redline', text: 'Done', proposed_text: 'x', anchor_text: 'y', status: 'resolved' },
        { id: 's3', kind: 'redline', text: 'No printed text', proposed_text: 'x', anchor_text: 'Page 2', anchor: pageAnchor },
        { id: 's4', kind: 'redline', text: 'No suggestion', proposed_text: '', anchor_text: 'y' },
        { id: 'c1', kind: 'comment', text: 'A comment', anchor_text: 'y' },
        { id: 's5', kind: 'redline', text: 'From the quote', proposed_text: 'z', anchor: { space: 'visible-text/1', ranges: [{ paragraph: 1, start: 0, end: 3 }], text: 'abc' } }
      ];
      expect(review.openSuggestedChanges(threads).map((thread) => thread.id)).toEqual(['s1', 's5']);
      expect(review.openSuggestedChanges(null)).toEqual([]);
    });

    test('hands the embed only the threads it can draw, with resolved state and colour, and reads threads from batches and releases', () => {
      const threads = [
        { id: 'h1', kind: 'highlight', anchor: textAnchor, status: 'open' },
        { id: 'c1', text: 'Check', anchor: pageAnchor, status: 'resolved' },
        { id: 'legacy', text: 'Older comment', anchor_text: 'Deposit', anchor_start: 12, anchor_end: 19 },
        { id: '', kind: 'highlight', anchor: textAnchor },
        { id: 'broken', kind: 'highlight', anchor: { space: 'pdf-page/1', page: 1, rects: [] } }
      ];
      expect(review.embedAnnotationsFrom(threads)).toEqual([
        { id: 'h1', kind: 'highlight', color: '#FFE066', anchor: textAnchor, resolved: false },
        { id: 'c1', kind: 'comment', color: null, anchor: pageAnchor, resolved: true }
      ]);
      expect(review.embedAnnotationsFrom(null)).toEqual([]);

      expect(review.batchReviewThreads({ review_metadata: { comments: threads.slice(0, 2) } })).toEqual(threads.slice(0, 2));
      expect(review.batchReviewThreads({ review_metadata: {} })).toEqual([]);
      expect(review.batchReviewThreads(null)).toEqual([]);
      const released = review.releasedReviewThreads([
        { release_id: 'rel-1', release: { id: 'rel-1', release_number: 3, released_at: '2026-09-25T20:00:00Z' }, review_metadata: { comments: [threads[1]] } },
        { release_id: 'rel-2', review_metadata: { comments: [] } }
      ]);
      expect(released).toEqual([Object.assign({}, threads[1], { released_in: { id: 'rel-1', release_number: 3, released_at: '2026-09-25T20:00:00Z' }, read_only: true })]);
    });
  });

  describe('annotation card presentation shared by the viewer and the editor', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

    test('annotationStatusLabel reads Open or Resolved with the tone both pages used for it', () => {
      expect(review.annotationStatusLabel({ status: 'open' })).toEqual({ label: 'Open', tone: 'draft', resolved: false });
      expect(review.annotationStatusLabel({ status: 'resolved' })).toEqual({ label: 'Resolved', tone: 'release', resolved: true });
      expect(review.annotationStatusLabel({ status: 'RESOLVED' })).toEqual({ label: 'Resolved', tone: 'release', resolved: true });
      // Control arm: no status at all defaults to open, same as both pages' inline ternary did.
      expect(review.annotationStatusLabel({})).toEqual({ label: 'Open', tone: 'draft', resolved: false });
      expect(review.annotationStatusLabel(null)).toEqual({ label: 'Open', tone: 'draft', resolved: false });
    });

    test('annotationAuthorLabel falls back to Reviewer for a thread with no author', () => {
      expect(review.annotationAuthorLabel({ author: 'Michael' })).toBe('Michael');
      // Control arm: a thread with no author.
      expect(review.annotationAuthorLabel({})).toBe('Reviewer');
      expect(review.annotationAuthorLabel(null)).toBe('Reviewer');
    });

    function fakeCard() {
      const classes = new Set();
      return {
        scrollIntoView: jest.fn(),
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          has: (name) => classes.has(name)
        }
      };
    }

    test('focusAnnotationCardInDom finds the card by its attribute, activates the tab first, scrolls and pulses it', () => {
      const card = fakeCard();
      const querySelector = jest.fn(() => card);
      const activateTab = jest.fn();
      const found = review.focusAnnotationCardInDom({
        annotationId: 'c-1',
        attribute: 'data-comment-thread-id',
        activateTab,
        document: { querySelector }
      });
      expect(found).toBe(true);
      expect(activateTab).toHaveBeenCalledTimes(1);
      expect(querySelector).toHaveBeenCalledWith('[data-comment-thread-id="c-1"]');
      expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
      expect(card.classList.has('is-located')).toBe(true);
      jest.advanceTimersByTime(1600);
      expect(card.classList.has('is-located')).toBe(false);
    });

    test('focusAnnotationCardInDom defaults to the viewer attribute name when none is given', () => {
      const card = fakeCard();
      const querySelector = jest.fn(() => card);
      review.focusAnnotationCardInDom({ annotationId: 'a"1', document: { querySelector } });
      // Control arm: a quote in the id is stripped without using a regex.
      expect(querySelector).toHaveBeenCalledWith('[data-review-annotation-id="a1"]');
    });

    test('focusAnnotationCardInDom control arms: no id, and no matching card', () => {
      const querySelector = jest.fn(() => null);
      expect(review.focusAnnotationCardInDom({ annotationId: '', document: { querySelector } })).toBe(false);
      expect(querySelector).not.toHaveBeenCalled();
      expect(review.focusAnnotationCardInDom({ annotationId: 'missing', document: { querySelector } })).toBe(false);
      expect(review.focusAnnotationCardInDom({ annotationId: 'x' })).toBe(false);
    });
  });

  describe('reviewVersionSelectOptions', () => {
    test('lists the scanned source, the editable copies newest first, the current draft, then every release', () => {
      const options = review.reviewVersionSelectOptions({
        conversionSource: { id: 'src-1', filename: 'scan.pdf' },
        editableCopies: [{ id: 'copy-2', created_at: '2026-09-25T20:00:00Z' }, { id: 'copy-1', created_at: '2026-09-24T20:00:00Z' }],
        hasCurrentDraftChanges: true,
        pendingRelease: false,
        releases: [{ id: 'rel-2', release_number: 2, released_at: '2026-09-20T00:00:00Z' }],
        formatCopyMoment: (value) => 'moment:' + value,
        formatDate: (value) => 'date:' + value
      });
      expect(options.map((option) => option.value)).toEqual([
        'source-original', 'original', 'editable-copy:copy-2', 'editable-copy:copy-1', 'current', 'release:rel-2'
      ]);
      expect(options[0]).toMatchObject({ label: 'Original PDF', description: 'scan.pdf', group: 'Document' });
      expect(options[1]).toMatchObject({ label: 'Editable copy', group: 'Document' });
      expect(options[2]).toMatchObject({ label: 'Editable copy (latest)', description: 'DOCX converted from this PDF · moment:2026-09-25T20:00:00Z' });
      expect(options[3]).toMatchObject({ label: 'Editable copy' });
      expect(options[4]).toMatchObject({ label: 'Current draft', description: 'Live unreleased edits', group: 'Working copy' });
      expect(options[5]).toMatchObject({ label: 'Version 2', description: 'Version 2 · date:2026-09-20T00:00:00Z', group: 'Versions' });
    });

    test('without a conversion source the original is the source document and there is no scanned-source option', () => {
      const options = review.reviewVersionSelectOptions({ editableCopies: [], hasCurrentDraftChanges: false, releases: [] });
      expect(options[0]).toMatchObject({ value: 'original', label: 'Original', description: 'Source document' });
      expect(options.some((option) => option.value === 'source-original')).toBe(false);
    });

    test('a pending release takes precedence over live unreleased edits in the current draft description', () => {
      const options = review.reviewVersionSelectOptions({ hasCurrentDraftChanges: true, pendingRelease: true, releases: [] });
      const current = options.find((option) => option.value === 'current');
      expect(current.description).toBe('Saved draft pending release approval');
    });

    test('with no unreleased edits the current draft reads as the current document view', () => {
      const options = review.reviewVersionSelectOptions({ hasCurrentDraftChanges: false, pendingRelease: false, releases: [] });
      const current = options.find((option) => option.value === 'current');
      expect(current.description).toBe('Current document view');
    });

    test('control arm: an empty releases list, no editable copies, and no formatters given', () => {
      const options = review.reviewVersionSelectOptions({});
      expect(options.map((option) => option.value)).toEqual(['original', 'current']);
      expect(options).toEqual(review.reviewVersionSelectOptions());
    });

    test('a release with no id gets an unusable empty value rather than throwing', () => {
      const options = review.reviewVersionSelectOptions({ releases: [{ release_number: 1 }] });
      const releaseOption = options.find((option) => option.group === 'Versions');
      expect(releaseOption.value).toBe('');
      expect(releaseOption.label).toBe('Version 1');
    });
  });
});

// Smallest package the envelope check accepts: local header magic, then an end-of-central-directory record.
function tinyDocx(marker) {
  const docx = new Uint8Array(30);
  docx.set([0x50, 0x4b, 0x03, 0x04], 0);
  docx.set([0x50, 0x4b, 0x05, 0x06], 4);
  docx[29] = marker || 0;
  return docx;
}

function fakeDocument() {
  const appended = [];
  const body = {
    appendChild(node) { appended.push(node); node.parentNode = body; },
    removeChild(node) { appended.splice(appended.indexOf(node), 1); node.parentNode = null; }
  };
  return {
    body,
    appended,
    createElement: () => ({ className: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, parentNode: null })
  };
}

describe('editor UI address', () => {
  const realWindowValue = global.LANA_EDITOR_SERVICE;
  const realStorage = global.localStorage;
  const realApi = global.api;
  afterEach(() => {
    global.LANA_EDITOR_SERVICE = realWindowValue;
    global.localStorage = realStorage;
    global.api = realApi;
  });

  test('by default it is the API base plus /editor-assets (Chef serves the editor UI)', () => {
    delete global.LANA_EDITOR_SERVICE;
    global.localStorage = { getItem: () => null };
    global.api = { baseUrl: 'http://127.0.0.1:8079/' };
    expect(review.editorUiBase()).toBe('http://127.0.0.1:8079/editor-assets');
    expect(review.editorUiBase({ baseUrl: 'https://chef.example' })).toBe('https://chef.example/editor-assets');
    expect(review.EDITOR_UI_UNAVAILABLE).not.toMatch(/fetch|4710|[\u2013\u2014]/);
  });

  test('no API base yet means no editor UI address', () => {
    delete global.LANA_EDITOR_SERVICE;
    global.localStorage = { getItem: () => null };
    global.api = { baseUrl: '' };
    expect(review.editorUiBase()).toBe('');
  });

  test('a developer override wins over the API base', () => {
    global.api = { baseUrl: 'https://chef.example' };
    global.LANA_EDITOR_SERVICE = '';
    global.localStorage = { getItem: (key) => (key === 'lana-editor-service' ? 'http://editor.local:9000/' : null) };
    expect(review.editorUiBase()).toBe('http://editor.local:9000');
    global.LANA_EDITOR_SERVICE = 'http://window.local/';
    expect(review.editorUiBase()).toBe('http://window.local');
  });
});

describe('clean copy made in the browser (acceptAllBytes)', () => {
  function fakeEditor(revisionsBefore, revisionsAfter, bytesOut) {
    const editor = {
      opened: null,
      decided: null,
      shutdown: jest.fn(),
      open_file: jest.fn(async (file) => { editor.opened = file; }),
      decide: jest.fn(async (request) => { editor.decided = request; editor.done = true; }),
      reviewState: () => ({ revisions: editor.done ? revisionsAfter : revisionsBefore }),
      bytes: () => bytesOut
    };
    return editor;
  }

  test('accepts every tracked change in a hidden editor and returns its bytes', async () => {
    const doc = fakeDocument();
    const clean = tinyDocx(7);
    const editor = fakeEditor([{ id: 'r1' }, { id: 'r2' }], [], clean);
    const mountEditor = jest.fn(() => editor);
    const result = await review.acceptAllBytes({ bytes: tinyDocx(1), contentType: DOCX_TYPE, filename: 'a.docx', mountEditor, document: doc });
    expect(result).toBe(clean);
    expect(mountEditor).toHaveBeenCalledWith(expect.objectContaining({ className: 'lana-editor-offscreen' }), { mode: 'review' });
    expect(editor.decided).toEqual({ decisions: [{ id: 'r1', action: 'accept' }, { id: 'r2', action: 'accept' }] });
    expect(editor.opened.name).toBe('a.docx');
    expect(editor.shutdown).toHaveBeenCalled();
    expect(doc.appended).toEqual([]);
  });

  test('refuses when a tracked change is left over, and still cleans up', async () => {
    const doc = fakeDocument();
    const editor = fakeEditor([{ id: 'r1' }, { type: 'format' }], [{ type: 'format' }], tinyDocx(7));
    await expect(review.acceptAllBytes({ bytes: tinyDocx(1), mountEditor: () => editor, document: doc }))
      .rejects.toThrow(review.CLEAN_COPY_FAILED);
    expect(editor.shutdown).toHaveBeenCalled();
    expect(doc.appended).toEqual([]);
  });

  test('without an editor to mount it refuses rather than releasing tracked changes', async () => {
    await expect(review.acceptAllBytes({ bytes: tinyDocx(1), document: fakeDocument() }))
      .rejects.toThrow(review.CLEAN_COPY_FAILED);
  });

  test('non-DOCX bytes pass through untouched', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(review.acceptAllBytes({ bytes, contentType: 'text/markdown' })).resolves.toBe(bytes);
  });
});

describe('LANA redline review on Chef', () => {
  const BASE = '/api/v1/matters/m%201/documents/doc-1/redline-batches';
  const scope = { matterId: 'm 1', documentId: 'doc-1' };

  function problem(status, code, extra) {
    const error = new Error('server text');
    error.status = status;
    error.data = Object.assign({ code, status, title: 't', detail: 'd' }, extra || {});
    error.code = code;
    return error;
  }

  test('lists batches with page, limit and status on the document route', async () => {
    const api = makeApi([{ match: /^GET /, reply: { data: [{ id: 'b1' }], metadata: { total: 1 } } }]);
    const result = await review.listRedlineBatches(Object.assign({ api, page: 2, limit: 10, status: 'proposed' }, scope));
    expect(api.calls).toEqual([{ method: 'GET', endpoint: BASE + '?page=2&limit=10&status=proposed', payload: undefined }]);
    expect(result).toEqual({ data: [{ id: 'b1' }], metadata: { total: 1 } });
  });

  test('gets one batch and unwraps data', async () => {
    const api = makeApi([{ match: 'GET ' + BASE + '/b%2F1', reply: { data: { id: 'b/1', changes: [] } } }]);
    await expect(review.getRedlineBatch(Object.assign({ api, batchId: 'b/1' }, scope))).resolves.toEqual({ id: 'b/1', changes: [] });
  });

  test('posts decisions in the route shape and reads applied and unchanged', async () => {
    const api = makeApi([{
      match: 'POST ' + BASE + '/b1/decisions',
      reply: { data: { batch: { id: 'b1' }, applied: ['c1'], unchanged: ['c2'] } }
    }]);
    const result = await review.decideRedlineChanges(Object.assign({
      api, batchId: 'b1', decisions: [{ change_id: 'c1', action: 'accept' }, { change_id: 'c2', action: 'reject' }]
    }, scope));
    expect(api.calls[0].payload).toEqual({ decisions: [{ change_id: 'c1', action: 'accept' }, { change_id: 'c2', action: 'reject' }] });
    expect(result).toEqual({ batch: { id: 'b1' }, applied: ['c1'], unchanged: ['c2'] });
  });

  test('a decision the other way is a 409 with the plain message and its code', async () => {
    const api = { post: jest.fn(async () => { throw problem(409, 'REDLINE_CHANGE_ALREADY_DECIDED'); }) };
    await expect(review.decideRedlineChanges(Object.assign({ api, batchId: 'b1', decisions: [{ change_id: 'c1', action: 'reject' }] }, scope)))
      .rejects.toMatchObject({ code: 'REDLINE_CHANGE_ALREADY_DECIDED', status: 409, message: review.REDLINE_MESSAGES.REDLINE_CHANGE_ALREADY_DECIDED });
  });

  test('release: 201 body is released, 202 body is approval required', async () => {
    const released = makeApi([{ match: 'POST ' + BASE + '/b1/release', reply: { data: { release: { id: 'r1' }, document: { id: 'd2' }, ingestion: null } } }]);
    await expect(review.releaseRedlineBatch(Object.assign({ api: released, batchId: 'b1', releaseNotes: 'n' }, scope)))
      .resolves.toEqual({ outcome: 'released', release: { id: 'r1' }, document: { id: 'd2' }, ingestion: null });
    expect(released.calls[0].payload).toEqual({ release_notes: 'n' });

    const waiting = makeApi([{ match: /release$/, reply: { data: { approval_required: true, approval_id: 'a1', approval: { id: 'a1' }, batch: { id: 'b1', status: 'pending_release' } } } }]);
    await expect(review.releaseRedlineBatch(Object.assign({ api: waiting, batchId: 'b1', retryApproval: true }, scope)))
      .resolves.toEqual({ outcome: 'approval_required', approval_id: 'a1', approval: { id: 'a1' }, batch: { id: 'b1', status: 'pending_release' } });
    expect(waiting.calls[0].payload).toEqual({ retry_approval: true });
  });

  test('every documented code maps to a plain sentence; the two named ones are exact', () => {
    const codes = ['REDLINE_DOCUMENT_NOT_FOUND', 'REDLINE_BATCH_NOT_FOUND', 'REDLINE_CHANGE_NOT_FOUND', 'REDLINE_CHANGE_ALREADY_DECIDED',
      'REDLINE_CHANGES_UNDECIDED', 'REDLINE_NOTHING_ACCEPTED', 'REDLINE_BATCH_RELEASED', 'REDLINE_RELEASE_PENDING_APPROVAL',
      'REDLINE_RELEASE_STALE_APPROVAL', 'REDLINE_BASE_DOCUMENT_CHANGED', 'REDLINE_EDITOR_UNAVAILABLE', 'REDLINE_EDITOR_REJECTED',
      'REDLINE_INVALID_REQUEST', 'REDLINE_CONFLICT'];
    codes.forEach((code) => {
      const message = review.redlineErrorMessage(problem(409, code));
      expect(message).toBe(review.REDLINE_MESSAGES[code]);
      expect(message).not.toMatch(/[–—]|REDLINE_/);
    });
    expect(review.redlineErrorMessage(problem(503, 'REDLINE_EDITOR_UNAVAILABLE'))).toBe('Redline review is not available on this server yet.');
    expect(review.redlineErrorMessage(problem(409, 'REDLINE_BASE_DOCUMENT_CHANGED')))
      .toBe('The document changed since these suggestions were made. Run the review again.');
    // Control arm: an unknown failure does not borrow a specific message.
    expect(review.redlineErrorMessage(problem(500, 'SOMETHING_ELSE'))).toBe('Redline review did not work this time. Try again.');
    // A server without these routes answers a plain 404.
    expect(review.redlineErrorMessage(problem(404, 'NOT_FOUND'))).toBe(review.REDLINE_MESSAGES.REDLINE_EDITOR_UNAVAILABLE);
  });

  test('downloads the redlined DOCX with the sign-in, and reads the headers', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      headers: { get: (name) => ({ 'X-Lana-Redline-View': 'redline', 'X-Lana-Redline-Change-Count': '3' })[name] || null },
      arrayBuffer: async () => tinyDocx(2).buffer
    }));
    const api = { baseUrl: 'https://chef.example', token: 'tok' };
    const result = await review.fetchRedlineDocument(Object.assign({ api, batchId: 'b1', view: 'redline', fetch: fetchImpl }, scope));
    expect(fetchImpl).toHaveBeenCalledWith('https://chef.example' + BASE + '/b1/document?view=redline',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));
    expect(result.view).toBe('redline');
    expect(result.changeCount).toBe(3);
    expect(result.bytes[29]).toBe(2);
  });

  test('a problem+json answer on the document route becomes the plain message', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ code: 'REDLINE_EDITOR_UNAVAILABLE', status: 503 })
    }));
    await expect(review.fetchRedlineDocument(Object.assign({ api: { baseUrl: '' }, batchId: 'b1', fetch: fetchImpl }, scope)))
      .rejects.toMatchObject({ code: 'REDLINE_EDITOR_UNAVAILABLE', message: 'Redline review is not available on this server yet.' });
  });
});
