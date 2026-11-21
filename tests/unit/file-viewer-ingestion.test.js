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

const windows = [];
afterEach(() => { windows.splice(0).forEach((w) => w.close()); });

function setup({ lookups, holdLookup = false }) {
  const dom = new JSDOM(`<!doctype html><body>${panelHtml()}</body>`, { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.TextDecoder = TextDecoder;
  // The page's own clock, run by hand: a reconnect or a re-poll waits here
  // until the test says time has passed.
  const timers = new Map();
  let nextTimer = 1;
  w.setTimeout = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; };
  w.clearTimeout = (id) => { timers.delete(id); };
  const runTimers = () => { const due = [...timers.values()]; timers.clear(); due.forEach((t) => t.fn()); };
  windows.push(w);
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
  return { w, $, streams, calls, timers, runTimers, hidden: (id) => $(id).classList.contains('hidden') };
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
  const t = setup({ lookups: [] });
  t.w.api.get = async (url) => { t.calls.get.push(url); throw Object.assign(new Error('Not found'), { status: 404 }); };
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  expect(t.timers.size).toBe(0); // nothing waiting to ask again
  t.runTimers();
  await flush();
  expect(t.hidden('ingestionPanel')).toBe(true);
  expect(t.calls.get).toHaveLength(1);
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

describe('page map and the files uploaded together', () => {
  const chunked = [...reading, { stage: 'chunking_complete', at: '2026-11-21T10:00:05Z', chunk_count: 6, page_count: 4 }];

  test('a tile per page fills in as pages become searchable; choosing one asks the viewer for that page', async () => {
    const t = setup({ lookups: [job('processing', chunked)] });
    const pages = [];
    const goTo = [];
    t.w.document.addEventListener('lana-ingestion-pages', (e) => pages.push(e.detail));
    t.w.document.addEventListener('lana-viewer-go-to-page', (e) => goTo.push(e.detail.page));
    t.w.FileViewerIngestion.start({ id: 'doc-1' });
    await flush();
    const tiles = () => [...t.$('ingestionPageGrid').children];
    expect(tiles()).toHaveLength(4);
    expect(t.hidden('ingestionPages')).toBe(false);
    t.streams[0].push({ type: 'progress', ...job('processing', chunked, 70), live: { embedded_count: 3, chunk_count: 6, pages_ready: 2 } });
    await flush();
    expect(tiles().map((tile) => tile.classList.contains('file-viewer-ingestion__page--ready'))).toEqual([true, true, false, false]);
    expect(t.$('ingestionPagesCaption').textContent).toBe('2 of 4 pages searchable');
    expect(pages[pages.length - 1]).toEqual({ pageCount: 4, ready: 2, finished: false });
    tiles()[2].click();
    expect(goTo).toEqual([3]);
  });

  test('closing the panel tells the viewer to put the pages back to plain', async () => {
    const t = setup({ lookups: [job('processing', chunked)] });
    const pages = [];
    t.w.document.addEventListener('lana-ingestion-pages', (e) => pages.push(e.detail));
    t.w.FileViewerIngestion.start({ id: 'doc-1' });
    await flush();
    t.$('ingestionClose').click();
    expect(pages[pages.length - 1]).toBeNull();
  });

  const uploads = [{ id: 'doc-1', name: 'Will.pdf' }, { id: 'doc-2', name: 'Trust.pdf' }, { id: 'doc-3', name: 'Deed.pdf' }];

  test('a strip shows every file uploaded together with its progress; choosing another opens it', async () => {
    const t = setup({ lookups: [job('processing', reading), job('completed', reading, 100), job('processing', reading, 55)] });
    const opened = [];
    t.w.document.addEventListener('lana-viewer-open-upload', (e) => opened.push(e.detail.id));
    t.w.FileViewerIngestion.start({ id: 'doc-1' }, { uploads });
    await flush();
    const chips = [...t.$('ingestionUploads').children];
    expect(t.hidden('ingestionUploads')).toBe(false);
    expect(chips.map((c) => c.textContent)).toEqual(['Will.pdf', 'Trust.pdf', 'Deed.pdf']);
    expect(chips[0].getAttribute('aria-current')).toBe('true');
    expect(chips.map((c) => c.dataset.status)).toEqual(['processing', 'completed', 'processing']);
    expect(chips.map((c) => c.querySelector('progress').value)).toEqual([40, 100, 55]);
    chips[0].click();
    chips[1].click();
    expect(opened).toEqual(['doc-2']);
  });

  test('a ready file of the set still shows the panel, so the strip stays (control: a ready file on its own opens plain)', async () => {
    const t = setup({ lookups: [job('completed', reading, 100), null, null] });
    t.w.FileViewerIngestion.start({ id: 'doc-2' }, { uploads });
    await flush();
    expect(t.hidden('ingestionPanel')).toBe(false);
    expect(t.$('ingestionHeadline').textContent).toBe('Your file is ready');

    const alone = setup({ lookups: [job('completed', reading, 100)] });
    alone.w.FileViewerIngestion.start({ id: 'doc-2' }, { uploads: [uploads[1]] });
    await flush();
    expect(alone.hidden('ingestionPanel')).toBe(true);
  });

  test('the other files are asked about again only while they are still working', async () => {
    const t = setup({ lookups: [job('processing', reading), job('completed', reading, 100), job('processing', reading), job('completed', reading, 100)] });
    t.w.FileViewerIngestion.start({ id: 'doc-1' }, { uploads });
    await flush();
    const asked = () => t.calls.get.filter((u) => !u.includes('doc-1')).length;
    expect(asked()).toBe(2);
    t.runTimers();
    await flush();
    expect(asked()).toBe(3); // only doc-3, still working
    expect(t.timers.size).toBe(0); // doc-3 is done now: nothing left to ask about
  });

  test('stopping drops the next check that was waiting', async () => {
    const t = setup({ lookups: [job('processing', reading), job('processing', reading), job('processing', reading)] });
    t.w.FileViewerIngestion.start({ id: 'doc-1' }, { uploads });
    await flush();
    expect(t.timers.size).toBe(1); // the next check is waiting
    t.w.FileViewerIngestion.stop();
    expect(t.timers.size).toBe(0);
  });

  test('a large set is checked a few files per round, taking turns', async () => {
    const big = Array.from({ length: 15 }, (_, i) => ({ id: `doc-${i + 1}`, name: `F${i + 1}` }));
    const t = setup({ lookups: Array.from({ length: 60 }, () => job('processing', reading)) });
    t.w.FileViewerIngestion.start({ id: 'doc-1' }, { uploads: big });
    await flush();
    const firstRound = t.calls.get.slice(1);
    expect(firstRound).toHaveLength(6);
    t.runTimers();
    await flush();
    const secondRound = t.calls.get.slice(7);
    expect(secondRound).toHaveLength(6);
    expect(secondRound.some((u) => firstRound.includes(u))).toBe(false);
  });
});

test('a file that fails puts its pages back to plain (control: one still working keeps them lit)', async () => {
  const chunked = [...reading, { stage: 'chunking_complete', at: '2026-11-21T10:00:05Z', chunk_count: 6, page_count: 4 }];
  const t = setup({ lookups: [job('processing', chunked)] });
  const pages = [];
  t.w.document.addEventListener('lana-ingestion-pages', (e) => pages.push(e.detail));
  t.w.FileViewerIngestion.start({ id: 'doc-1' });
  await flush();
  expect(pages[pages.length - 1]).toEqual({ pageCount: 4, ready: 0, finished: false });
  t.streams[0].push({ type: 'failed', ...job('failed', chunked) });
  await flush();
  expect(pages[pages.length - 1]).toBeNull();
});
