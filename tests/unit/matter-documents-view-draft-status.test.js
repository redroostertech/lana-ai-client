const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The folder page renders this view without the shared document-lifecycle
// utility, so the view's own status mapping is what the user sees there.
describe('MatterDocumentsView status for documents created with no text', () => {
  function renderStatuses(files) {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { runScripts: 'outside-only' });
    const code = fs.readFileSync(path.join(__dirname, '../../src/js/components/matter-documents-view.js'), 'utf8');
    dom.window.eval(code);
    const root = dom.window.document.getElementById('root');
    dom.window.MatterDocumentsView.mount(root, {
      matterId: 'MATT-1',
      files,
      api: {},
      enableSearch: false,
      enableDocStudio: false
    });
    return Array.from(root.querySelectorAll('.mdv-status-badge')).map((el) => el.textContent.trim());
  }

  const file = (id, overrides) => ({
    id,
    filename: id + '.docx',
    content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 1681,
    created_at: '2026-10-20T12:00:00.000Z',
    status: 'pending',
    processing_status: 'pending',
    ...overrides
  });

  test.each([
    ['an empty created document is a draft', { metadata: { processing_skipped_reason: 'empty_document' } }, 'Draft'],
    ['metadata stored as a JSON string is read the same way', { metadata: JSON.stringify({ processing_skipped_reason: 'empty_document' }) }, 'Draft'],
    ['a pending document without the marker is still uploaded', { metadata: {} }, 'Uploaded'],
    ['processing that started takes over the label', { processing_status: 'processing', metadata: { processing_skipped_reason: 'empty_document' } }, 'Processing'],
    ['a processed document is ready', { status: 'completed', processing_status: 'completed', metadata: { processing_skipped_reason: 'empty_document' } }, 'Ready'],
    ['a failed document still needs attention', { processing_status: 'failed', metadata: { processing_skipped_reason: 'empty_document' } }, 'Needs Attention']
  ])('%s', (_label, overrides, expected) => {
    expect(renderStatuses([file('doc', overrides)])).toEqual([expected]);
  });
});
