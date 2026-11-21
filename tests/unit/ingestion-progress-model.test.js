/**
 * Live file processing: what the file viewer shows while LANA works on a file.
 * The steps come from Chef (the ingestion job); this checks how they become
 * the panel's rows and words, when the panel shows, and how the stream is
 * read. Then the wiring: the viewer starts the panel for every file it opens,
 * and the upload flows open the new file.
 */
const fs = require('fs');
const path = require('path');
const Model = require('../../src/js/shared/ingestion-progress.model');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const job = (status, steps, extra = {}) => ({ job_id: 'job-1', status, progress: 50, steps, ...extra });
const at = (n) => `2026-11-21T10:00:0${n}.000Z`;

describe('when the panel shows', () => {
  test.each([
    ['queued, not started', job('queued', []), true],
    ['processing', job('processing', [{ stage: 'extracting_text', at: at(0) }]), true],
    ['failed (shows the step that broke and Try again)', job('failed', []), true],
    ['completed (a ready file opens plain)', job('completed', []), false],
    ['cancelled', job('cancelled', []), false],
    ['no job', null, false]
  ])('%s', (_label, progress, shown) => {
    expect(Model.shouldShow(progress)).toBe(shown);
  });
});

describe('the rows', () => {
  test('a file being read: the first row is running, the rest wait', () => {
    const rows = Model.traceSteps(job('processing', [{ stage: 'extracting_text', at: at(0) }]));
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['reading', 'running'], ['details', 'pending'], ['safety', 'pending'],
      ['sections', 'pending'], ['search', 'pending'], ['summary', 'pending']
    ]);
  });

  test('done rows say what LANA found, in plain words, with how long each took', () => {
    const rows = Model.traceSteps(job('processing', [
      { stage: 'extracting_text', at: at(0) },
      { stage: 'extraction_complete', at: at(2), element_count: 40, used_ocr: false },
      { stage: 'details_found', at: at(3), people_count: 3, date_count: 1, amount_count: 0, citation_count: 2 },
      { stage: 'safety_checked', at: at(4), disposition: 'clean' },
      { stage: 'chunking_complete', at: at(5), chunk_count: 48, page_count: 12 }
    ]));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.reading).toEqual(expect.objectContaining({ status: 'completed', message: 'Read 12 pages', started_at: at(0), completed_at: at(2) }));
    expect(byId.details.message).toBe('Found 3 people, 1 date, 2 citations');
    expect(byId.safety.message).toBe('Passed');
    expect(byId.sections.message).toBe('48 sections');
    expect(byId.search.status).toBe('running');
    expect(byId.summary.status).toBe('pending');
  });

  test('a scanned file, a flagged file and nothing found read as such', () => {
    const rows = Model.traceSteps(job('processing', [
      { stage: 'extracting_text', at: at(0) },
      { stage: 'extraction_complete', at: at(1), used_ocr: true },
      { stage: 'details_found', at: at(2) },
      { stage: 'safety_checked', at: at(3), disposition: 'flagged' }
    ]));
    expect(rows[0].message).toBe('Read the scanned pages');
    expect(rows[1].message).toBe('No names, dates or amounts found');
    expect(rows[2].message).toBe('Found text that looks like instructions. LANA will not follow it.');
  });

  test('search made elsewhere (cloud firms) says it finishes in the background', () => {
    const rows = Model.traceSteps(job('processing', [{ stage: 'extracting_text', at: at(0) }, { stage: 'embeddings_deferred', at: at(1), chunk_count: 4 }]));
    expect(rows.find((r) => r.id === 'search')).toEqual(expect.objectContaining({ status: 'completed', message: 'Search finishes in the background' }));
  });

  test('a failed file marks the first unfinished row failed (control: the same steps, running)', () => {
    const steps = [{ stage: 'extracting_text', at: at(0) }, { stage: 'extraction_complete', at: at(1) }];
    expect(Model.traceSteps(job('processing', steps))[1].status).toBe('running');
    const failed = Model.traceSteps(job('failed', steps, { failed: true }));
    expect(failed.map((r) => r.status)).toEqual(['completed', 'failed', 'pending', 'pending', 'pending', 'pending']);
    expect(failed[1].message).toBe('This step did not finish');
    expect(Model.headline(job('failed', steps))).toBe('LANA could not finish this file');
  });

  test('a finished file: every row done, then Ready', () => {
    const rows = Model.traceSteps(job('completed', [{ stage: 'extracting_text', at: at(0) }]));
    expect(rows.every((r) => r.status === 'completed')).toBe(true);
    expect(rows[rows.length - 1]).toEqual(expect.objectContaining({ id: 'ready', label: 'Ready' }));
    expect(Model.headline(job('completed', []))).toBe('Your file is ready');
  });

  test('a step this client does not know is ignored, not shown', () => {
    const rows = Model.traceSteps(job('processing', [{ stage: 'extracting_text', at: at(0) }, { stage: 'something_new', at: at(1) }]));
    expect(rows).toHaveLength(6);
    expect(rows[0].status).toBe('running');
  });
});

describe('reading the stream', () => {
  test('whole frames become events; a half frame waits for the rest; heartbeats are skipped', () => {
    const first = Model.parseEvents('data: {"type":"connected"}\n\n:heartbeat\n\ndata: {"type":"progr');
    expect(first.events).toEqual([{ type: 'connected' }]);
    const second = Model.parseEvents(first.rest + 'ess","status":"processing"}\n\n');
    expect(second.events).toEqual([{ type: 'progress', status: 'processing' }]);
    expect(second.rest).toBe('');
  });
});

describe('wiring', () => {
  test('the viewer loads the panel, its rows and styles, before the page script', () => {
    const html = read('file-viewer.html');
    const order = ['js/shared/run-status.js', 'js/lex/components/foundation/lex-run-trace.js',
      'js/shared/ingestion-progress.model.js', 'js/file-viewer-ingestion.js', 'js/file-viewer-page.js']
      .map((src) => html.indexOf(`<script src="${src}"></script>`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('<link rel="stylesheet" href="css/file-viewer-ingestion.css">');
    expect(html).toContain('<link rel="stylesheet" href="css/lex-run-status.css">');
    const panel = html.slice(html.indexOf('<aside id="ingestionPanel"'), html.indexOf('</aside>', html.indexOf('<aside id="ingestionPanel"')));
    expect(panel).toContain('<lex-run-trace id="ingestionTrace"');
    expect(panel).not.toMatch(/style=|onclick=/);
  });

  test('every file the viewer opens goes through the panel: stopped first, started before the content loads, only for the file still on screen', () => {
    const src = read('js/file-viewer-page.js');
    const load = src.slice(src.indexOf('async function loadFile(fileId)'));
    const startAt = load.indexOf('FileViewerIngestion.start(response');
    expect(load.indexOf('FileViewerIngestion.stop()')).toBeGreaterThan(-1);
    expect(startAt).toBeGreaterThan(-1);
    // A preview that fails to load (likely for a file whose processing failed) must not cost the person Try again.
    expect(startAt).toBeLessThan(load.indexOf('await loadFileContent(response)'));
    // A newer load (another file or version) wins: an older one never starts its panel.
    expect(load.slice(Math.max(0, startAt - 200), startAt)).toContain('state.currentFile === response');
  });

  test.each(['js/workspace-details.js', 'js/folder.js'])('%s opens the new file in the viewer after an upload', (file) => {
    const src = read(file);
    // The first file the person chose, not the first upload to finish.
    expect(src).toMatch(/uploaded\[fileIndex\] = result|uploaded\[index\] = result/);
    expect(src).toMatch(/result\.file_id && !result\.skipped[\s\S]{0,120}_navToFileViewer\(opened\.file_id\)/);
  });
});
