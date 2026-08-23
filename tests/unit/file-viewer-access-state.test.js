'use strict';

const fs = require('fs');
const path = require('path');

const pageJs = fs.readFileSync(
  path.join(__dirname, '../../src/js/file-viewer-page.js'),
  'utf8'
);

describe('File Viewer access and failed-load state', () => {
  test('uses a single non-disclosing state for storage 403 and masked 404 responses', () => {
    expect(pageJs).toContain("Number(error.status) === 403 || Number(error.status) === 404");
    expect(pageJs).toContain("showError('You do not have access to this file.')");
  });

  test('clears stale document identity before loading a different document', () => {
    const loadFileStart = pageJs.indexOf('async function loadFile(fileId)');
    const currentFileReset = pageJs.indexOf('state.currentFile = null;', loadFileStart);
    const metadataRequest = pageJs.indexOf("api.get('/api/v1/storage/files/' + encodedFileId)", loadFileStart);
    expect(loadFileStart).toBeGreaterThan(-1);
    expect(currentFileReset).toBeGreaterThan(loadFileStart);
    expect(metadataRequest).toBeGreaterThan(currentFileReset);
  });

  test('does not expose download or delete actions without loaded file metadata', () => {
    expect(pageJs).toContain("var hasLoadedFile = Boolean(state.currentFile && state.currentFile.id);");
    expect(pageJs).toContain("errorDownloadBtn.classList.toggle('hidden', !hasLoadedFile)");
    expect(pageJs).toContain("errorDeleteBtn.classList.toggle('hidden', !hasLoadedFile)");
  });

  test('encodes the URL-supplied document identity for metadata and activity routes', () => {
    expect(pageJs).toContain('var encodedFileId = encodeURIComponent(fileId);');
    expect(pageJs).toContain("api.post('/api/v1/storage/files/' + encodedFileId + '/activity'");
  });
});
