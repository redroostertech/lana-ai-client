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

  it('gives every component a license text, except the Chromium file, RedRooster owned lana-editor and packages published without one', () => {
    const missing = allItems.filter((item) => item.id !== 'chromium' && item.id !== 'lana-editor' && Model.textsFor(notices, item).length === 0);
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

// The LANA document editor (build/lana-editor, packaged to resources/lana-editor) ships its own
// license files. Skipped when the editor is not built (node scripts/fetch-lana-editor.js).
const editorDir = path.join(root, 'build', 'lana-editor');
const describeEditor = fs.existsSync(path.join(editorDir, 'editor-build.json')) ? describe : describe.skip;

describeEditor('LANA document editor in the inventory', () => {
  const sbom = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'legal', 'sbom', 'lana-ai-client.cdx.json'), 'utf8'));
  const purls = new Set(sbom.components.map((component) => component.purl).filter(Boolean));
  const normalize = (text) => text.split('\r\n').join('\n').trimEnd() + '\n';
  const noticeBodies = new Set(Object.values(notices.texts).map((text) => text.body));
  const purl = (name, version) => `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`;
  const listed = (name, version) => allItems.some((item) => item.version === version && item.name.split(/[ (),]+/).includes(name));

  function editorPackages() {
    const found = new Map();
    const txt = fs.readFileSync(path.join(editorDir, 'packages', 'redline-service', 'dist', 'THIRD_PARTY_LICENSES.txt'), 'utf8');
    for (const match of txt.matchAll(/^(\S+)@(\d\S*) \(([^)]+)\)\nnode_modules\//gm)) found.set(`${match[1]}@${match[2]}`, { name: match[1], version: match[2] });
    const md = fs.readFileSync(path.join(editorDir, 'THIRD-PARTY-NOTICES.md'), 'utf8');
    for (const match of md.matchAll(/^## (\S+)@(\d\S*) \(([^)]+)\)$/gm)) found.set(`${match[1]}@${match[2]}`, { name: match[1], version: match[2] });
    return [...found.values()];
  }

  function licenseFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : licenseFiles(file);
      return /^licen[cs]e/i.test(entry.name) ? [file] : [];
    });
  }

  it('lists lana-editor itself at the pinned commit as RedRooster owned code', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'editor', 'editor.lock.json'), 'utf8'));
    const editor = allItems.find((item) => item.id === 'lana-editor');
    expect(editor).toBeDefined();
    expect(editor.version).toBe(lock.commit);
    expect(editor.license).toBe('Proprietary');
    expect(editor.copyright).toContain('RedRooster Technologies');
    expect(sbom.components.some((component) => component['bom-ref'] === 'lana:lana-editor' && component.version === lock.commit)).toBe(true);
  });

  it('lists every package the editor names in its notices, in the notices and the SBOM', () => {
    const packages = editorPackages();
    expect(packages.length).toBeGreaterThan(60);
    const missingNotices = packages.filter((pkg) => !listed(pkg.name, pkg.version)).map((pkg) => `${pkg.name}@${pkg.version}`);
    const missingSbom = packages.filter((pkg) => !purls.has(purl(pkg.name, pkg.version))).map((pkg) => `${pkg.name}@${pkg.version}`);
    expect(missingNotices).toEqual([]);
    expect(missingSbom).toEqual([]);
  });

  it('carries the text of every license file the editor ships (pdf.js, wasm decoders, fonts)', () => {
    const files = licenseFiles(editorDir);
    expect(files.length).toBeGreaterThanOrEqual(12);
    const missing = files.filter((file) => !noticeBodies.has(normalize(fs.readFileSync(file, 'utf8')))).map((file) => path.relative(editorDir, file));
    expect(missing).toEqual([]);
  });
});
