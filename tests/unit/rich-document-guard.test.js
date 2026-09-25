'use strict';

const path = require('path');

const guard = require(path.join(__dirname, '../../src/js/services/rich-document-guard.js'));

// The plain contenteditable page in the File Editor only knows paragraphs.
// A document that came from a Word file must not be edited or saved there,
// because the saved text would replace the user's tables, lists and page
// breaks with a flattened copy. The guard decides from the file record.
describe('rich document guard', () => {
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  test('recognises a rich source by content type, by extension, and by a server source', () => {
    expect(guard.isRichSourceDocument({ kind: 'doc', content_type: DOCX })).toBe(true);
    expect(guard.isRichSourceDocument({ kind: 'doc', contentType: 'application/msword' })).toBe(true);
    expect(guard.isRichSourceDocument({ kind: 'doc', filename: 'Closing Disclosure.DOCX' })).toBe(true);
    expect(guard.isRichSourceDocument({ kind: 'doc', title: 'brief.odt' })).toBe(true);
    expect(guard.isRichSourceDocument({ kind: 'doc', sourceUrl: '/api/v1/storage/abc/download' })).toBe(true);
    expect(guard.isRichSourceDocument({ kind: 'doc', sourceDocumentId: 'abc' })).toBe(true);
  });

  test('control arm: notes, markdown and non-doc kinds are not rich', () => {
    expect(guard.isRichSourceDocument({ kind: 'doc', filename: 'notes.txt', content_type: 'text/plain' })).toBe(false);
    expect(guard.isRichSourceDocument({ kind: 'doc', filename: 'README.md', content_type: 'text/markdown' })).toBe(false);
    expect(guard.isRichSourceDocument({ kind: 'sheet', filename: 'table.docx' })).toBe(false);
    expect(guard.isRichSourceDocument(null)).toBe(false);
    expect(guard.isRichSourceDocument({})).toBe(false);
  });

  test('locks the fallback for a rich document unless the embed is showing it', () => {
    const file = { kind: 'doc', filename: 'agreement.docx' };
    expect(guard.fallbackLockReason(file, { embedMounted: true })).toBeNull();
    expect(guard.fallbackLockReason(file, { embedMounted: false, editorEnabled: true })).toMatch(/could not load this document/);
    expect(guard.fallbackLockReason(file, { embedMounted: false, editorEnabled: false })).toMatch(/turned off/);
    expect(guard.fallbackLockReason(file, {})).toMatch(/read-only/);
  });

  test('never locks a plain note, whatever the surface state', () => {
    const note = { kind: 'doc', filename: 'todo.txt' };
    expect(guard.fallbackLockReason(note, { embedMounted: false, editorEnabled: false })).toBeNull();
    expect(guard.fallbackLockReason(note, {})).toBeNull();
  });
});
