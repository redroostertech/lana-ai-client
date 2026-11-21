/**
 * The file viewer's live processing panel (js/file-viewer-ingestion.js), run
 * in a DOM with the server answers faked:
 * - a file still processing opens with the panel and follows the steps live;
 * - a ready file opens plain;
 * - closing the panel stops listening, and nothing else;
 * - the panel stays through Ready, then offers Ask LANA;
 * - a failed file offers Try again, which re-runs it and follows the new run.
 */
const fs = require('fs');
const path = require('path');
const { TextEncoder, TextDecoder } = require('util');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };

function panelHtml() {
  const html = read('file-viewer.html');
  const start = html.indexOf('<aside id="ingestionPanel"');
  return html.slice(start, html.indexOf('</aside>', start) + '</aside>'.length);
}

// A stream the test feeds event by event.
function fakeStream() {
  const queue = [];
  let wake = null;
  const encoder = new TextEncoder();
  return {
    push(event) { queue.push(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); if (wake) { wake(); wake = null; } },
    end() { queue.push(null); if (wake) { wake(); wake = null; } },
    body: {
      getReader: () => ({
        async read() {
          while (!queue.length) await new Promise((r) => { wake = r; });
          const next = queue.shift();
          return next ? { done: false, value: next } : { done: true };
        }
      })
    }
  };
}

function setup({ lookups, holdLookup = false }) {
  const dom = new JSDOM(`<!doctype html><body>${panelHtml()}</body>`, { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.TextDecoder = TextDecoder;
  const streams = [];
  const calls = { get: [], post: [], fetch: [] };
  w.api = {
    baseUrl: 'http://chef',
    getHeaders: () => ({ Authorization: 'Bearer t' }),
    get: async (url) => {
      calls.get.push(url);
      if (holdLookup) await new Promise((r) => { calls.release = r; });
      return { job: lookups.shift() || null };
    },
    post: async (url) => { calls.post.push(url); return {}; }
  };
  w.fetch = async (url, options) => {
    calls.fetch.push(url);
    const stream = fakeStream();
    stream.signal = options.signal;
    streams.push(stream);
    return { ok: true, body: stream.body };
  };
  w.eval(read('js/shared/ingestion-progress.model.js'));
  w.eval(read('js/file-viewer-ingestion.js'));
  const $ = (id) => w.document.getElementById(id);
  return { w, $, streams, calls, hidden: (id) => $(id).classList.contains('hidden') };
}

const job = (status, steps = [], progress = 40) => ({ job_id: 'job-1', status, progress, steps, failed: status === 'failed' });
const reading = [{ stage: 'extracting_text', at: '2026-11-21T10:00:00Z' }];

test('a file still processing opens with the panel and follows each step as it happens', async () => {
  const t = setup({ lookups: [job('processing', reading)] });
  t.w.FileViewerIngestion.start({ id: 'doc-1', filename: 'Will.pdf' });
  await flush();
  expect(t.calls.get).toEqual(['/api/v1/storage/files/doc-1/ingestion']);
  expect(t.hidden('ingestionPanel')).toBe(false);
  expect(t.$('ingestionHeadline').textContent).toBe('LANA is working on your file');
  expect(t.calls.fetch).toEqual(['http://chef/api/v1/storage/jobs/job-1/status/stream']);

  t.streams[0].push({ type: 'progress', ...job('processing', [...reading, { stage: 'extraction_complete', at: '2026-11-21T10:00:02Z' }], 55) });
  await flush();
  expect(t.$('ingestionTrace').steps[0].status).toBe('completed');
  expect(t.$('ingestionProgressBar').getAttribute('value')).toBe('55');
});

test('a ready file opens plain: no panel, no stream', async () => {
  const t = setup({ lookups: [job('completed', reading, 100)] });
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  expect(t.hidden('ingestionPanel')).toBe(true);
  expect(t.calls.fetch).toEqual([]);
});

test('a server without live steps (404) opens the file plain and does not keep asking', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  try {
    const t = setup({ lookups: [] });
    t.w.api.get = async (url) => { t.calls.get.push(url); throw Object.assign(new Error('Not found'), { status: 404 }); };
    t.w.FileViewerIngestion.start({ id: 'doc-1' });
    await flush();
    jest.advanceTimersByTime(60000);
    await flush();
    expect(t.hidden('ingestionPanel')).toBe(true);
    expect(t.calls.get).toHaveLength(1);
  } finally {
    jest.useRealTimers();
  }
});

test('a file with no job opens plain', async () => {
  const t = setup({ lookups: [null] });
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  expect(t.hidden('ingestionPanel')).toBe(true);
});

test('closing the panel hides it and stops listening; the server work is not touched', async () => {
  const t = setup({ lookups: [job('processing', reading)] });
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  t.$('ingestionClose').click();
  expect(t.hidden('ingestionPanel')).toBe(true);
  expect(t.streams[0].signal.aborted).toBe(true);
  expect(t.calls.post).toEqual([]);
});

test('closed, then opened again after it finished: the file opens plain', async () => {
  const t = setup({ lookups: [job('processing', reading), job('completed', reading, 100)] });
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  t.$('ingestionClose').click();
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  expect(t.hidden('ingestionPanel')).toBe(true);
});

test('finishing while open: the panel stays, says Ready and offers Ask LANA; the stream ends', async () => {
  const t = setup({ lookups: [job('processing', reading)] });
  t.w.FileViewerIngestion.start({ id: 'doc-1', filename: 'Will.pdf' }, { matterId: 'MATT-1' });
  await flush();
  t.streams[0].push({ type: 'completed', ...job('completed', reading, 100) });
  t.streams[0].end();
  await flush();
  expect(t.hidden('ingestionPanel')).toBe(false);
  expect(t.$('ingestionHeadline').textContent).toBe('Your file is ready');
  expect(t.hidden('ingestionAskLana')).toBe(false);
  expect(t.$('ingestionAskLana').getAttribute('document-id')).toBe('doc-1');
  expect(t.$('ingestionAskLana').getAttribute('matter-id')).toBe('MATT-1');
  expect(t.hidden('ingestionNote')).toBe(true);
  await flush();
  expect(t.calls.get).toHaveLength(1); // ended for good: no reconnect
});

test('a failed file offers Try again, which re-runs it and follows the new run', async () => {
  const t = setup({ lookups: [job('failed', reading), job('queued', [])] });
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  expect(t.hidden('ingestionPanel')).toBe(false);
  expect(t.hidden('ingestionRetry')).toBe(false);
  expect(t.$('ingestionHeadline').textContent).toBe('LANA could not finish this file');
  t.$('ingestionRetry').click();
  await flush();
  expect(t.calls.post).toEqual(['/api/v1/documents/doc-1/reindex']);
  expect(t.calls.get).toHaveLength(2);
  expect(t.hidden('ingestionRetry')).toBe(true);
  expect(t.calls.fetch).toHaveLength(1);
});

test('opening another file stops the first one\'s stream', async () => {
  const t = setup({ lookups: [job('processing', reading), null] });
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  t.w.FileViewerIngestion.stop();
  expect(t.streams[0].signal.aborted).toBe(true);
  expect(t.hidden('ingestionPanel')).toBe(true);
});

test('closing while the first lookup is still on its way opens no stream', async () => {
  const t = setup({ lookups: [job('processing', reading)], holdLookup: true });
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  t.$('ingestionClose').click();
  t.calls.release();
  await flush();
  expect(t.calls.fetch).toEqual([]);
  expect(t.hidden('ingestionPanel')).toBe(true);
});

test('the same file started twice listens once; the first start is dropped', async () => {
  const t = setup({ lookups: [job('processing', reading), job('processing', reading)], holdLookup: true });
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  const releaseFirst = t.calls.release;
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  const releaseSecond = t.calls.release;
  releaseFirst();
  releaseSecond();
  await flush();
  expect(t.calls.fetch).toHaveLength(1);
});

test('the rows draw in the real lex-run-trace: labels, details, the running step', async () => {
  const dom = new JSDOM(`<!doctype html><body>${panelHtml()}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  ['js/lex/lex.core.js', 'js/shared/run-status.js', 'js/lex/components/foundation/lex-run-trace.js', 'js/shared/ingestion-progress.model.js']
    .forEach((file) => w.eval(read(file)));
  const trace = w.document.getElementById('ingestionTrace');
  trace.live = true;
  trace.steps = w.LanaIngestionProgress.traceSteps(job('processing', [
    ...reading,
    { stage: 'extraction_complete', at: '2026-11-21T10:00:03Z' },
    { stage: 'details_found', at: '2026-11-21T10:00:04Z', people_count: 2 }
  ]));
  await flush();
  const rows = [...trace.querySelectorAll('.lex-run-trace__step')];
  expect(rows.map((row) => row.querySelector('.lex-run-trace__label').textContent)).toEqual([
    'Reading your file', 'Finding key details', 'Safety check', 'Breaking it into sections', 'Making it searchable', 'Starting the summary'
  ]);
  expect(rows[1].querySelector('.lex-run-trace__detail').textContent).toBe('Found 2 people');
  expect(rows[2].getAttribute('aria-current')).toBe('step');
});

test('an icon-only lex-btn reads out its own label (the panel\'s Close), not the icon name', async () => {
  const dom = new JSDOM('<!doctype html><body><lex-btn id="a" variant="ghost" leading-icon="x" icon aria-label="Close"></lex-btn><lex-btn id="b" variant="ghost" leading-icon="chevron-left" icon></lex-btn></body>',
    { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/components/foundation/lex-btn.js'].forEach((file) => w.eval(read(file)));
  await flush();
  const inner = (id) => w.document.querySelector(`#${id} button.lex-btn-inner`);
  expect(inner('a').getAttribute('aria-label')).toBe('Close');
  // Control: with no label of its own, the icon name is still the fallback.
  expect(inner('b').getAttribute('aria-label')).toBe('chevron left');
});
