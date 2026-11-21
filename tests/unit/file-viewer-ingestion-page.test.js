/**
 * What the file viewer page does for the live processing panel
 * (js/file-viewer-ingestion-page.js): lights the PDF's pages in LANA's PDF
 * view, and keeps them lit when the view rebuilds its pages; goes to a
 * page from a tile, in either PDF view; opens another file of an upload set.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); };

function setup({ editorPdf = true, pages = 4 } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="viewerEditor"></div><iframe id="viewerIframe"></iframe></body>',
    { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.eval(read('js/file-viewer-ingestion-page.js'));
  const host = w.document.getElementById('viewerEditor');
  const iframe = w.document.getElementById('viewerIframe');
  const build = (n) => {
    host.textContent = '';
    for (let i = 0; i < n; i += 1) {
      const page = w.document.createElement('div');
      page.className = 'le-pdf-page';
      host.appendChild(page);
    }
  };
  build(pages);
  const calls = { jump: [], navigate: [] };
  const hooks = w.FileViewerIngestionPage.create({
    host: () => host,
    isEditorPdf: () => editorPdf,
    jumpToPage: (n) => calls.jump.push(n),
    iframe: () => iframe,
    pdfUrl: () => 'blob:doc',
    uploads: () => [{ id: 'doc-1', name: 'A' }, { id: 'doc-2', name: 'B' }],
    navigate: (id) => calls.navigate.push(id)
  });
  const event = (detail) => ({ detail });
  const marks = () => [...host.querySelectorAll('.le-pdf-page')].map((p) => p.getAttribute('data-lana-ingest'));
  return { w, host, iframe, hooks, calls, event, build, marks };
}

test('pages are dimmed until searchable and lit as they become searchable; cleared, they are plain', () => {
  const t = setup();
  t.hooks.onPages(t.event({ pageCount: 4, ready: 2 }));
  expect(t.marks()).toEqual(['ready', 'ready', 'waiting', 'waiting']);
  t.hooks.onPages(t.event(null));
  expect(t.marks()).toEqual([null, null, null, null]);
});

test('pages the view builds or rebuilds later are lit too (control: after clearing, new pages stay plain)', async () => {
  const t = setup({ pages: 0 });
  t.hooks.onPages(t.event({ pageCount: 3, ready: 1 }));
  t.build(3);
  await flush();
  expect(t.marks()).toEqual(['ready', 'waiting', 'waiting']);
  t.hooks.onPages(t.event(null));
  t.build(3);
  await flush();
  expect(t.marks()).toEqual([null, null, null]);
});

test('in LANA\'s PDF view a tile scrolls to its page', () => {
  const t = setup();
  t.hooks.onGoToPage(t.event({ page: 3 }));
  expect(t.calls.jump).toEqual([3]);
});

test('in the plain PDF view a tile reopens the PDF at its page, every time it is chosen', () => {
  const t = setup({ editorPdf: false });
  const loaded = () => t.iframe.dispatchEvent(new t.w.Event('load'));
  t.hooks.onGoToPage(t.event({ page: 3 }));
  expect(t.iframe.getAttribute('src')).toBe('about:blank');
  loaded();
  expect(t.iframe.getAttribute('src')).toBe('blob:doc#page=3');
  t.hooks.onGoToPage(t.event({ page: 3 }));
  expect(t.iframe.getAttribute('src')).toBe('about:blank');
  loaded();
  expect(t.iframe.getAttribute('src')).toBe('blob:doc#page=3');
  loaded(); // the PDF's own load does not reopen it again
  expect(t.iframe.getAttribute('src')).toBe('blob:doc#page=3');
});

test('a bad page, or a hidden plain view, does nothing', () => {
  const t = setup({ editorPdf: false });
  t.hooks.onGoToPage(t.event({ page: 0 }));
  t.hooks.onGoToPage(t.event({ page: 'x' }));
  t.iframe.classList.add('hidden');
  t.hooks.onGoToPage(t.event({ page: 2 }));
  expect(t.iframe.getAttribute('src')).toBeNull();
});

test('only a file of the set is opened from the strip', () => {
  const t = setup();
  t.hooks.onOpenUpload(t.event({ id: 'doc-2' }));
  t.hooks.onOpenUpload(t.event({ id: 'someone-elses' }));
  expect(t.calls.navigate).toEqual(['doc-2']);
});

test('the set from navigation is kept to ids and names, at most 50', () => {
  const { uploadSetFrom } = require('../../src/js/file-viewer-ingestion-page');
  expect(uploadSetFrom([{ id: 'a', name: 'A', extra: 1 }, { id: 5 }, null, { id: 'b' }])).toEqual([{ id: 'a', name: 'A' }, { id: 'b', name: '' }]);
  expect(uploadSetFrom('nope')).toEqual([]);
  expect(uploadSetFrom(Array.from({ length: 60 }, (_, i) => ({ id: `d${i}` })))).toHaveLength(50);
});
