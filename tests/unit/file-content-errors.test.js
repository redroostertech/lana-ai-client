'use strict';

// A document whose stored file is gone: Chef answers 410 FILE_CONTENT_MISSING
// on every read, and the viewers show "The original file is missing." instead
// of the raw response. The pure mapping, plus the File Viewer wiring that uses it.

const fs = require('fs');
const path = require('path');
const Errors = require('../../src/js/shared/file-content-errors.js');

describe('codeFromBody', () => {
  test.each([
    ['{"error":{"message":"The original file is missing.","code":"FILE_CONTENT_MISSING"}}', 'FILE_CONTENT_MISSING'],
    ['{"code":"FILE_CONTENT_MISSING"}', 'FILE_CONTENT_MISSING'],
    ['{"error":{"code":"INTERNAL_ERROR"}}', 'INTERNAL_ERROR'],
    ['{"detail":"File not found"}', null],
    ['<html>Bad gateway</html>', null],
    ['', null],
    [undefined, null],
    ['null', null]
  ])('%s gives %s', (body, code) => {
    expect(Errors.codeFromBody(body)).toBe(code);
  });
});

describe('viewerMessage', () => {
  test('the missing file is one plain sentence, with no prefix or raw detail', () => {
    const error = Object.assign(new Error('Failed to fetch PDF (410 Gone)'), { code: 'FILE_CONTENT_MISSING' });
    expect(Errors.isFileContentMissing(error)).toBe(true);
    expect(Errors.viewerMessage(error, 'Failed to load preview')).toBe('The original file is missing.');
  });

  test('control: any other failure keeps the prefix and its own message', () => {
    const error = Object.assign(new Error('Failed to fetch PDF (500 Internal Server Error)'), { code: 'INTERNAL_ERROR' });
    expect(Errors.isFileContentMissing(error)).toBe(false);
    expect(Errors.viewerMessage(error, 'Failed to load preview')).toBe('Failed to load preview: Failed to fetch PDF (500 Internal Server Error)');
    expect(Errors.isFileContentMissing(null)).toBe(false);
    expect(Errors.isFileContentMissing('FILE_CONTENT_MISSING')).toBe(true);
  });
});

describe('failureMessage (a failed download response)', () => {
  const response = (status, body) => ({ ok: false, status, text: async () => body });

  test('410 FILE_CONTENT_MISSING reads as the missing-file sentence', async () => {
    await expect(Errors.failureMessage(response(410, '{"error":{"message":"The original file is missing.","code":"FILE_CONTENT_MISSING"}}'), 'File download failed.'))
      .resolves.toBe('The original file is missing.');
  });

  test('control: any other failure keeps the caller\'s message', async () => {
    await expect(Errors.failureMessage(response(500, '{"error":{"code":"INTERNAL_ERROR"}}'), 'File download failed.')).resolves.toBe('File download failed.');
    await expect(Errors.failureMessage(response(404, '{"detail":"File not found"}'), 'File download failed.')).resolves.toBe('File download failed.');
    await expect(Errors.failureMessage({ ok: false, status: 502, text: async () => { throw new Error('body gone'); } }, 'File download failed.'))
      .resolves.toBe('File download failed.');
  });
});

describe('download and open surfaces use the module', () => {
  const SRC = path.resolve(__dirname, '../../src');
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

  test.each([
    ['doc-studio/app.js', "failureMessage(response, 'File download failed.')"],
    ['js/components/matter-documents-view.js', "failureMessage(response, 'Failed to download file. Please try again.')"],
    ['js/workspace-details.js', "failureMessage(response, 'Failed to download: ' + response.status)"],
    ['js/services/docx-template-modal.js', "failureMessage(resp, 'Failed to load file')"]
  ])('%s', (file, call) => {
    expect(read(file)).toContain('LanaFileContentErrors.' + call);
  });

  test.each([
    ['doc-studio/index.html', '../js/shared/file-content-errors.js', './app.js'],
    ['folder.html', 'js/shared/file-content-errors.js', 'js/components/matter-documents-view.js'],
    ['workspace-details.html', 'js/shared/file-content-errors.js', 'js/components/matter-documents-view.js']
  ])('%s loads the helper first', (page, helper, user) => {
    const html = read(page);
    expect(html.indexOf(helper)).toBeGreaterThan(-1);
    expect(html.indexOf(helper)).toBeLessThan(html.indexOf(user));
  });
});

describe('File Viewer wiring', () => {
  const SRC = path.resolve(__dirname, '../../src');
  const html = fs.readFileSync(path.join(SRC, 'file-viewer.html'), 'utf8');
  const page = fs.readFileSync(path.join(SRC, 'js/file-viewer-page.js'), 'utf8');

  test('the page loads the helper before its controller', () => {
    const helper = html.indexOf('js/shared/file-content-errors.js');
    expect(helper).toBeGreaterThan(-1);
    expect(helper).toBeLessThan(html.indexOf('js/file-viewer-page.js'));
  });

  test('failed reads carry the server code, and the preview and download errors go through viewerMessage', () => {
    expect(page).toMatch(/LanaFileContentErrors\.codeFromBody\(/);
    expect(page).toMatch(/LanaFileContentErrors\.viewerMessage\(error, 'Failed to load preview'\)/);
    expect(page).toMatch(/LanaFileContentErrors\.viewerMessage\(error, ''\)/);
  });
});
