'use strict';

// Open-source licenses page (public_html/open-source-licenses.html): the pure model in
// js/pages/open-source-licenses.model.js and the generated inventory in
// js/pages/open-source-licenses.data.js (scripts/licenses/generate.js).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const Model = require(path.join(root, 'public_html', 'js', 'pages', 'open-source-licenses.model.js'));

function loadNotices() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public_html', 'js', 'pages', 'open-source-licenses.data.js'), 'utf8'), sandbox);
  return sandbox.window.LanaOpenSourceNotices;
}

const notices = loadNotices();
const allItems = notices.sections.flatMap((section) => section.items);

describe('open-source licenses model', () => {
  const sample = {
    sections: [
      { id: 'a', title: 'A', detail: '', items: [{ name: 'Chart.js', licenseName: 'MIT', version: '4.4.1', texts: ['k1', 'missing'] }, { name: 'Mammoth', licenseName: 'BSD-2-Clause', version: '1', texts: [] }] },
      { id: 'b', title: 'B', detail: '', items: [{ name: 'Inter', licenseName: 'OFL-1.1', version: 'woff2', texts: [] }] },
    ],
    texts: { k1: { title: 'MIT', body: 'text' } },
  };

  it('filters by name or license, ignoring case and spaces, and drops empty sections', () => {
    expect(Model.filterSections(sample, '').map((s) => s.items.length)).toEqual([2, 1]);
    expect(Model.filterSections(sample, '  bsd ').map((s) => s.items.map((i) => i.name))).toEqual([['Mammoth']]);
    expect(Model.filterSections(sample, 'ofl').map((s) => s.id)).toEqual(['b']);
    expect(Model.filterSections(sample, 'nothing')).toEqual([]);
    expect(Model.filterSections(null, 'x')).toEqual([]);
  });

  it('looks up license texts in order and skips missing keys', () => {
    expect(Model.textsFor(sample, sample.sections[0].items[0])).toEqual([{ key: 'k1', title: 'MIT', body: 'text' }]);
  });

  it('builds a subtitle and counts items', () => {
    expect(Model.subtitleFor({ version: '4.4.1', licenseName: 'MIT' })).toBe('4.4.1 · MIT');
    expect(Model.totalCount(Model.filterSections(sample, ''))).toBe(3);
  });
});

describe('generated open-source inventory', () => {
  it('covers every vendored browser library', () => {
    const shipped = new Set(allItems.map((item) => item.shippedAs).filter(Boolean));
    const vendor = fs.readdirSync(path.join(root, 'public_html', 'js', 'vendor')).filter((name) => name !== 'pdf.worker.min.js');
    for (const name of vendor) expect(shipped.has(`public_html/js/vendor/${name}`)).toBe(true);
  });

  it('gives every component a license text, except the Chromium file and packages published without one', () => {
    const missing = allItems.filter((item) => item.id !== 'chromium' && Model.textsFor(notices, item).length === 0);
    for (const item of missing) expect(item.notes).toContain('ships no license file');
    // sherpa-onnx-node: its Apache-2.0 and ONNX Runtime notices are in the catalog's Runtime entry.
    expect(missing.map((item) => item.name).sort()).toEqual(['agent-base', 'https-proxy-agent', 'lazy-val', 'sherpa-onnx-node']);
  });

  it('lists Electron and the bundled npm packages with a stated license', () => {
    expect(allItems.some((item) => item.id === 'electron')).toBe(true);
    const npm = notices.sections.find((section) => section.id === 'npm');
    expect(npm.items.length).toBeGreaterThan(50);
    for (const item of npm.items) expect(item.license).not.toBe('UNKNOWN');
  });
});
