#!/usr/bin/env node
/**
 * Generates the LANA AI client open-source inventory. Offline: reads catalog.json, the
 * vendored files, node_modules and an esbuild metafile of the same bundles the build makes
 * (scripts/bundle-electron.js and scripts/build-tiptap.js), plus the electron-store chain
 * that electron-builder.client.json copies as node_modules, plus the LANA document editor
 * in build/lana-editor (node scripts/fetch-lana-editor.js) and the packages its own
 * notices name.
 *
 *   node scripts/licenses/generate.js           write every output
 *   node scripts/licenses/generate.js --check   exit 1 if any output is stale
 *
 * Outputs:
 *   docs/legal/sbom/lana-ai-client.cdx.json      CycloneDX 1.6 SBOM
 *   docs/legal/THIRD_PARTY_NOTICES.md           human-readable notices with full texts
 *   public_html/js/pages/open-source-licenses.data.js   data for the Open-source licenses page
 *
 * Fails when a vendored file no longer contains its catalog version, when a license text is
 * missing, when a shipped package states no license, or when build/lana-editor is missing or
 * is not the commit editor/editor.lock.json pins.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK = process.argv.includes('--check');
const catalog = readJSON(path.join(ROOT, 'scripts', 'licenses', 'catalog.json'));
const problems = [];

// The LANA document editor build that electron-builder.client.json packages as resources/lana-editor.
const EDITOR_DIR = path.join(ROOT, 'build', 'lana-editor');
const EDITOR_LOCK = path.join(ROOT, 'editor', 'editor.lock.json');

// Entry points bundled by scripts/bundle-electron.js (electron and electron-store stay external).
const ELECTRON_ENTRIES = ['electron-main.js', 'electron-preload.js', 'screen-voice-preload.js', 'electron-discovery.js', 'electron-storage.js', 'electron-updater-custom.js', 'electron-logger.js'];

// MARK: - Helpers

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fail(message) {
  problems.push(message);
}

function rel(file) {
  return path.relative(ROOT, file);
}

function startsWithAny(text, prefixes) {
  const lower = text.toLowerCase();
  return prefixes.some((prefix) => lower.startsWith(prefix));
}

/** Lines that state a copyright, without license boilerplate. */
function copyrightLines(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().split('  ').join(' ');
    if (!startsWithAny(line, ['copyright', '(c)', '©'])) continue;
    const lower = line.toLowerCase();
    if (['notice', '[yyyy]', '[name of', 'owner', 'holders'].some((word) => lower.includes(word))) continue;
    if (line.length > 200 || lines.includes(line)) continue;
    lines.push(line);
  }
  return lines.slice(0, 3);
}

class TextStore {
  constructor() {
    this.texts = new Map();
  }
  add(title, body) {
    const normalized = body.split('\r\n').join('\n').trimEnd() + '\n';
    const key = sha256(normalized).slice(0, 16);
    if (!this.texts.has(key)) this.texts.set(key, { key, title, body: normalized });
    return key;
  }
  addFile(title, file) {
    if (!fs.existsSync(file)) {
      fail(`missing license text: ${rel(file)}`);
      return null;
    }
    return this.add(title, fs.readFileSync(file, 'utf8'));
  }
}

const SPDX_IDS = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0', 'OFL-1.1', '0BSD', 'Unlicense', 'MPL-2.0', 'CC0-1.0', 'Python-2.0', 'MIT-0', 'Zlib']);
const COPYLEFT = ['GPL', 'MPL', 'EPL', 'CDDL', 'CC-BY-SA', 'CC-BY-NC', 'SSPL', 'EUPL'];

function cdxLicenses(license, name) {
  if (SPDX_IDS.has(license)) return [{ license: { id: license } }];
  if (license.includes(' AND ') || license.includes(' OR ') || license.startsWith('(')) return [{ expression: license }];
  return [{ license: { name: name || license } }];
}

function npmPurl(name, version) {
  return `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`;
}

function resolveVersion(version) {
  if (typeof version === 'string') return version;
  if (version.lock) return readJSON(path.join(ROOT, version.lock)).commit;
  return readJSON(path.join(ROOT, 'node_modules', version.npm, 'package.json')).version + (version.suffix || '');
}

// MARK: - Catalog components

function catalogItems(store) {
  return catalog.components.map((component) => {
    const version = resolveVersion(component.version);
    if (component.file !== undefined && !fs.existsSync(path.join(ROOT, component.file))) {
      fail(`${component.id}: ${component.file} is missing`);
    } else if (component.file !== undefined && (typeof component.version === 'string' || component.version.lock)) {
      const shipped = fs.readFileSync(path.join(ROOT, component.file), 'utf8');
      if (!shipped.includes(version) && !version.startsWith('not recorded')) fail(`${component.id}: ${component.file} no longer contains version ${version}; update catalog.json`);
    }
    const texts = component.texts.map((text) => store.addFile(text.title, path.join(ROOT, text.file))).filter(Boolean);
    return {
      section: component.section,
      item: {
        id: component.id,
        name: component.name,
        version,
        license: component.license,
        licenseName: component.licenseName || component.license,
        copyright: component.copyright || null,
        attribution: component.attribution || null,
        source: component.source,
        modified: component.modified || null,
        notes: component.notes || null,
        shippedAs: component.file || null,
        texts,
      },
      cdx: {
        type: component.id === 'electron' || component.id === 'chromium' ? 'framework' : component.section === 'fonts' ? 'file' : 'library',
        'bom-ref': `lana:${component.id}`,
        name: component.name,
        version,
        ...(component.purl ? { purl: `${component.purl}@${version}` } : {}),
        licenses: cdxLicenses(component.license, component.licenseName),
        ...(component.copyright ? { copyright: component.copyright } : {}),
        externalReferences: [{ type: 'website', url: component.source }],
        ...(component.file ? { properties: [{ name: 'lana:shippedAs', value: component.file }] } : {}),
      },
    };
  });
}

// MARK: - npm packages

/** The package folder for a path inside node_modules, or null. */
function packageDir(input) {
  const marker = 'node_modules/';
  const at = input.lastIndexOf(marker);
  if (at === -1) return null;
  const rest = input.slice(at + marker.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return path.join(ROOT, input.slice(0, at + marker.length), name);
}

async function bundledPackageDirs() {
  const dirs = new Set();
  const collect = (metafile) => {
    for (const input of Object.keys(metafile.inputs)) {
      const dir = packageDir(input);
      if (dir !== null) dirs.add(dir);
    }
  };
  for (const entry of ELECTRON_ENTRIES) {
    if (!fs.existsSync(path.join(ROOT, entry))) continue;
    const result = await esbuild.build({ absWorkingDir: ROOT, entryPoints: [entry], bundle: true, platform: 'node', target: 'node20', write: false, metafile: true, external: ['electron', 'electron-store'], logLevel: 'silent' });
    collect(result.metafile);
  }
  const tiptap = require(path.join(ROOT, 'scripts', 'build-tiptap.js')).baseConfig;
  const result = await esbuild.build({ ...tiptap, absWorkingDir: ROOT, write: false, metafile: true, sourcemap: false, logLevel: 'silent', outfile: 'tiptap.out.js' });
  collect(result.metafile);

  // electron-builder.client.json copies these node_modules folders into the app as-is.
  const builder = readJSON(path.join(ROOT, 'electron-builder.client.json'));
  for (const pattern of builder.files) {
    if (typeof pattern !== 'string' || !pattern.startsWith('node_modules/')) continue;
    dirs.add(path.join(ROOT, pattern.slice(0, pattern.length - '/**/*'.length)));
  }
  return [...dirs].filter((dir) => fs.existsSync(path.join(dir, 'package.json')));
}

function npmLicense(info) {
  if (typeof info.license === 'string') return info.license;
  if (info.license && info.license.type) return info.license.type;
  if (Array.isArray(info.licenses)) return info.licenses.map((entry) => entry.type || entry).join(' OR ');
  return null;
}

async function npmItems(store) {
  const seen = new Set();
  const items = [];
  const dirs = await bundledPackageDirs();
  const infos = dirs.map((dir) => ({ dir, info: readJSON(path.join(dir, 'package.json')) }));
  infos.sort((a, b) => `${a.info.name}@${a.info.version}`.localeCompare(`${b.info.name}@${b.info.version}`));
  for (const { dir, info } of infos) {
    const id = `${info.name}@${info.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const license = npmLicense(info);
    if (license === null) fail(`npm: ${id} states no license`);
    const files = fs.readdirSync(dir).filter((name) => startsWithAny(name, ['license', 'licence', 'copying', 'notice']) && fs.statSync(path.join(dir, name)).isFile()).sort();
    const texts = files.map((name) => store.addFile(`${info.name}, ${name}`, path.join(dir, name))).filter(Boolean);
    const copyright = files.flatMap((name) => copyrightLines(fs.readFileSync(path.join(dir, name), 'utf8'))).slice(0, 3).join('; ') || (typeof info.author === 'string' ? info.author : info.author && info.author.name) || null;
    const repo = typeof info.repository === 'string' ? info.repository : info.repository && info.repository.url;
    let source = info.homepage || repo || `https://www.npmjs.com/package/${info.name}`;
    if (source.startsWith('git+')) source = source.slice(4);
    if (source.endsWith('.git')) source = source.slice(0, -4);
    items.push({
      section: 'npm',
      item: {
        id: `npm:${id}`,
        name: info.name,
        version: info.version,
        license: license || 'UNKNOWN',
        licenseName: license || 'Not stated',
        copyright,
        attribution: null,
        source,
        modified: null,
        notes: texts.length === 0 ? 'This package ships no license file; its package.json states the license.' : null,
        shippedAs: null,
        texts,
      },
      cdx: {
        type: 'library',
        'bom-ref': npmPurl(info.name, info.version),
        name: info.name,
        version: info.version,
        purl: npmPurl(info.name, info.version),
        licenses: cdxLicenses(license || 'NOASSERTION'),
        ...(copyright ? { copyright } : {}),
        externalReferences: [{ type: 'website', url: source }],
      },
    });
  }
  return items;
}

// MARK: - LANA document editor packages

/** name@version (license) headers and their texts from the editor's two notices files. */
function editorPackages() {
  const packages = new Map();
  const txtFile = path.join(EDITOR_DIR, 'packages', 'redline-service', 'dist', 'THIRD_PARTY_LICENSES.txt');
  const mdFile = path.join(EDITOR_DIR, 'THIRD-PARTY-NOTICES.md');
  for (const file of [txtFile, mdFile]) if (!fs.existsSync(file)) fail(`missing editor notices: ${rel(file)}`);
  if (!fs.existsSync(txtFile) || !fs.existsSync(mdFile)) return [];
  // THIRD_PARTY_LICENSES.txt: blocks split by dashed lines, each "name@version (license)", the
  // license file path, a blank line, then the text.
  for (const block of fs.readFileSync(txtFile, 'utf8').split(/\n-{20,}\n/)) {
    const match = block.trim().match(/^(\S+)@(\d\S*) \(([^)]+)\)\n(node_modules\/\S+)\n\n([\s\S]*)$/);
    if (match === null) continue;
    const [, name, version, license, licenseFile, body] = match;
    if (!packages.has(`${name}@${version}`)) packages.set(`${name}@${version}`, { name, version, license, title: `${name}, ${path.basename(licenseFile)}`, body });
  }
  // THIRD-PARTY-NOTICES.md: "## name@version (license)" then the text in a fenced block.
  const md = fs.readFileSync(mdFile, 'utf8');
  for (const match of md.matchAll(/^## (\S+)@(\d\S*) \(([^)]+)\)\n\n```\n([\s\S]*?)\n```$/gm)) {
    const [, name, version, license, body] = match;
    if (!packages.has(`${name}@${version}`)) packages.set(`${name}@${version}`, { name, version, license, title: `${name}, license`, body });
  }
  return [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

function editorItems(store) {
  if (!fs.existsSync(path.join(EDITOR_DIR, 'editor-build.json'))) {
    fail('build/lana-editor is missing; run node scripts/fetch-lana-editor.js');
    return [];
  }
  const built = readJSON(path.join(EDITOR_DIR, 'editor-build.json')).commit;
  const pinned = readJSON(EDITOR_LOCK).commit;
  if (built !== pinned) fail(`build/lana-editor is ${built}, editor/editor.lock.json pins ${pinned}; run node scripts/fetch-lana-editor.js`);
  // Packages the catalog already lists in its editor section (pdfjs-dist is the PDF.js entry).
  const covered = new Set(catalog.components.filter((component) => component.section === 'editor' && component.purl).map((component) => component.purl.slice('pkg:npm/'.length)));
  return editorPackages()
    .filter((pkg) => !covered.has(pkg.name))
    .map((pkg) => {
      const text = store.add(pkg.title, pkg.body);
      const copyright = copyrightLines(pkg.body).join('; ') || null;
      const source = `https://www.npmjs.com/package/${pkg.name}`;
      const purl = npmPurl(pkg.name, pkg.version);
      return {
        section: 'editor-npm',
        item: { id: `editor-npm:${pkg.name}@${pkg.version}`, name: pkg.name, version: pkg.version, license: pkg.license, licenseName: pkg.license, copyright, attribution: null, source, modified: null, notes: null, shippedAs: null, texts: [text] },
        cdx: {
          type: 'library',
          'bom-ref': `lana-editor:${purl}`,
          name: pkg.name,
          version: pkg.version,
          purl,
          licenses: cdxLicenses(pkg.license),
          ...(copyright ? { copyright } : {}),
          externalReferences: [{ type: 'website', url: source }],
          properties: [{ name: 'lana:shippedAs', value: 'lana-editor' }],
        },
      };
    });
}

// MARK: - Outputs

function markdown(data) {
  const lines = [
    `# Third-party notices: ${data.product}`,
    '',
    `Generated by \`${data.generatedBy}\` (do not edit by hand). Version ${data.version}.`,
    '',
    `${data.product} includes the third-party software listed below. Each is the property of its authors and is used under the license named next to it. The full license texts follow the list. Chromium, Node.js and FFmpeg notices ship with the app as resources/licenses/LICENSES.chromium.html.`,
    '',
  ];
  for (const section of data.sections) {
    lines.push(`## ${section.title}`, '', section.detail, '');
    if (section.table) {
      lines.push('| Package | Version | License | Copyright |', '|---|---|---|---|');
      for (const item of section.items) lines.push(`| ${item.name} | ${item.version} | ${item.licenseName} | ${(item.copyright || '').split('|').join('/')} |`);
      lines.push('');
      continue;
    }
    for (const item of section.items) {
      lines.push(`### ${item.name} ${item.version}`, '', `- License: ${item.licenseName}`);
      if (item.copyright) lines.push(`- Copyright: ${item.copyright}`);
      if (item.attribution) lines.push(`- Attribution: ${item.attribution}`);
      if (item.notes) lines.push(`- Notes: ${item.notes}`);
      if (item.shippedAs) lines.push(`- Shipped as: ${item.shippedAs}`);
      lines.push(`- Source: ${item.source}`, '');
    }
  }
  lines.push('## License texts', '');
  for (const [key, text] of Object.entries(data.texts)) {
    const users = data.sections.flatMap((section) => section.items).filter((item) => item.texts.includes(key)).map((item) => `${item.name} ${item.version}`);
    lines.push(`### ${text.title}`, '', `Applies to: ${users.join(', ')}.`, '', '~~~~text', text.body.trimEnd(), '~~~~', '');
  }
  return lines.join('\n');
}

async function main() {
  const store = new TextStore();
  const entries = [...catalogItems(store), ...(await npmItems(store)), ...editorItems(store)];
  const version = readJSON(path.join(ROOT, 'package.json')).version;
  const sections = catalog.sections
    .map((section) => ({ id: section.id, title: section.title, detail: section.detail, ...(section.table ? { table: true } : {}), items: entries.filter((entry) => entry.section === section.id).map((entry) => entry.item) }))
    .filter((section) => section.items.length > 0);
  const data = {
    product: catalog.product.name,
    version,
    generatedBy: 'scripts/licenses/generate.js',
    sections,
    texts: Object.fromEntries([...store.texts.values()].map((text) => [text.key, { title: text.title, body: text.body }])),
  };
  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      tools: { components: [{ type: 'application', name: 'lana-ai-client scripts/licenses/generate.js' }] },
      component: { type: 'application', 'bom-ref': 'lana:lana-ai-client', name: catalog.product.name, version, description: catalog.product.description, supplier: { name: 'RedRooster Technologies Inc.' } },
    },
    components: entries.map((entry) => entry.cdx),
  };
  for (const entry of entries) {
    if (COPYLEFT.some((word) => entry.item.license.includes(word))) console.log(`note: ${entry.item.name}@${entry.item.version} is ${entry.item.license}`);
  }
  if (problems.length > 0) {
    console.error(`cannot generate, ${problems.length} problem(s):\n${problems.map((line) => `  ${line}`).join('\n')}`);
    process.exit(2);
  }
  const outputs = [
    [path.join(ROOT, 'docs', 'legal', 'sbom', 'lana-ai-client.cdx.json'), JSON.stringify(sbom, null, 2) + '\n'],
    [path.join(ROOT, 'docs', 'legal', 'THIRD_PARTY_NOTICES.md'), markdown(data)],
    [path.join(ROOT, 'public_html', 'js', 'pages', 'open-source-licenses.data.js'), `// Generated by scripts/licenses/generate.js. Do not edit by hand.\nwindow.LanaOpenSourceNotices = ${JSON.stringify(data)};\n`],
  ];
  let stale = 0;
  for (const [file, content] of outputs) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === content) continue;
    if (CHECK) {
      console.error(`stale: ${rel(file)}`);
      stale += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log(`wrote ${rel(file)} (${Buffer.byteLength(content)} bytes)`);
  }
  const count = sections.reduce((sum, section) => sum + section.items.length, 0);
  console.log(`${count} components, ${Object.keys(data.texts).length} license texts`);
  if (CHECK && stale > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
