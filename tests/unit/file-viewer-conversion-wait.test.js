'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '../../src');
const viewer = fs.readFileSync(path.join(SRC, 'js/file-viewer-page.js'), 'utf8');

// A PDF conversion waits on layout analysis and OCR on the server; measured
// 2026-09-25, a nine-page scan took 30 s and the client's default 30 s
// request limit expired just as it finished, so the page reported a failure
// for a copy that existed. The API client now honours a per-request timeout,
// and the viewer asks for a realistic one and watches the matter after a
// timeout instead of calling it a failure.
function loadApi(fetchImpl) {
  const context = {
    console,
    URLSearchParams,
    AbortController,
    Headers,
    FormData: class { append() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: fetchImpl,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, body: {}, getElementById: () => null },
    location: { protocol: 'http:', origin: 'http://client.test', pathname: '/app.html' },
    LanaConfig: {},
    LanaTime: {
      nowMs: () => 1000,
      nowIso: () => '2026-09-25T00:00:00.000Z',
      millisecondsSince: (start) => 1000 - start,
      MS_PER_MINUTE: 60000,
      MS_PER_HOUR: 3600000,
      formatUtcDateOnly: () => '2026-09-25'
    }
  };
  context.window = context;
  context.globalThis = context;
  const apiPath = path.join(SRC, 'js/api.js');
  vm.runInNewContext(fs.readFileSync(apiPath, 'utf8'), context, { filename: apiPath });
  return context.window.api;
}

// A fetch that only ends when its signal aborts, the way a slow server looks
// from the client.
function hangingFetch() {
  return (url, config) => new Promise((resolve, reject) => {
    const signal = config && config.signal;
    if (!signal) return;
    const abort = () => { const err = new Error('aborted'); err.name = 'AbortError'; reject(err); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

describe('API client per-request timeout', () => {
  test('options.timeout extends the wait beyond the default limit', async () => {
    const api = loadApi(hangingFetch());
    api.baseUrl = 'http://api.test';
    api.token = 'token';
    api.timeout = 20;

    let settled = false;
    const slow = api.post('/slow', { a: 1 }, { timeout: 400 }).catch((e) => e).finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 120));
    expect(settled).toBe(false);
    const error = await slow;
    expect(error.status).toBe(408);
  });

  test('control arm: without the option the default limit still applies', async () => {
    const api = loadApi(hangingFetch());
    api.baseUrl = 'http://api.test';
    api.token = 'token';
    api.timeout = 20;

    const started = Date.now();
    const error = await api.post('/slow', { a: 1 }).catch((e) => e);
    expect(error.status).toBe(408);
    expect(Date.now() - started).toBeLessThan(300);
  });
});

describe('File Viewer conversion wait', () => {
  test('asks for a realistic conversion limit and says how long it takes', () => {
    expect(viewer).toContain('var PDF_CONVERSION_TIMEOUT_MS = 180000;');
    expect(viewer).toContain('{ timeout: PDF_CONVERSION_TIMEOUT_MS }');
    expect(viewer).toContain('about half a minute for every five scanned pages');
  });

  test('a timeout is not reported as a failure while the server is still converting', () => {
    expect(viewer).toContain("if (!requestError || requestError.status !== 408) throw requestError;");
    expect(viewer).toContain('converted = await waitForConvertedCopy(file, startedAt);');
    expect(viewer).toContain('async function waitForConvertedCopy(file, startedAt)');
    expect(viewer).toContain("normalizeDocumentName(file && file.filename) + ' - editable'");
  });

  test('a failed editor mount does not leave the empty document card on the page', () => {
    const catchBlock = viewer.slice(viewer.indexOf('LANA Editor unavailable; falling back to DOCX preview') - 600, viewer.indexOf('LANA Editor unavailable; falling back to DOCX preview'));
    expect(catchBlock).toContain('setViewerDocumentCardVisible(false);');
    expect(catchBlock).toContain('setViewerDisplayControlsVisible(false);');
  });
});

describe('File Viewer notice placement', () => {
  const html = fs.readFileSync(path.join(SRC, 'file-viewer.html'), 'utf8');
  const css = fs.readFileSync(path.join(SRC, 'css/file-viewer.css'), 'utf8');

  test('the format notice sits above the scrolling content pane, not inside it', () => {
    const notice = html.indexOf('id="viewerFormatNotice"');
    const pane = html.indexOf('id="viewerContent"');
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(pane);
    const column = html.indexOf('file-viewer-content-column');
    expect(column).toBeGreaterThan(-1);
    expect(column).toBeLessThan(notice);
    expect(html).toContain('file-viewer-format-notice--static');
    expect(css).toContain('.file-viewer-format-notice--static');
  });
});
