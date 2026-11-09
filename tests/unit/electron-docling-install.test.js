/**
 * Putting Docling on this computer (electron-docling-install.js): the pins, what counts as
 * installed, the order of the steps, and picking up after a cut. The archive is a small real
 * .tar.gz built here; downloads copy local files through the real checker (size and sha256), so
 * no network is used. Everything happens in a new temp folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { tar } = require('./support/tar-builder');
const install = require('../../electron-docling-install');
const { downloadVerified } = require('../../electron-model-download');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

describe('the real pin', () => {
  const pin = install.PIN;

  test('the macOS Apple silicon archive is pinned on models.lanaai.io under its runtime version', () => {
    const entry = install.runtimeEntry('macos-arm64');
    expect(entry.url).toBe(`https://models.lanaai.io/docling/runtime/${pin.runtimeVersion}/macos-arm64.tar.gz`);
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.sizeBytes).toBeGreaterThan(100 * 1024 ** 2);
    expect(entry.unpackedBytes).toBeGreaterThan(entry.sizeBytes);
    expect(install.runtimeEntry('windows-x64')).toBeNull();
  });

  test('the models are the servers\' files on the same mirror, without the enrichment-only ones', () => {
    const files = install.modelFiles();
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(file.url).toBe(`https://models.lanaai.io/docling/${file.path}`);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.path.split('/')).not.toContain('..');
    }
    const paths = files.map((f) => f.path);
    expect(paths).toContain('docling-project--docling-layout-heron/model.safetensors');
    expect(paths).toContain('docling-project--docling-models/model_artifacts/tableformer/accurate/tableformer_accurate.safetensors');
    expect(paths.some((p) => p.startsWith('RapidOcr/onnx/'))).toBe(true);
    expect(paths.some((p) => /CodeFormula|FigureClassifier/.test(p))).toBe(false);
  });

  test('the pinned layout sha256s match the backend\'s download script when it is beside this repo', () => {
    const script = path.join(__dirname, '..', '..', '..', 'LANA-AI', 'scripts', 'download-docling-models.sh');
    if (!fs.existsSync(script)) {return;}
    const text = fs.readFileSync(script, 'utf8');
    for (const file of install.modelFiles()) {expect(text).toContain(file.sha256);}
  });

  test('sizes: the disk holds the archive and its unpacked copy at once; the download is the archive and models', () => {
    const entry = install.runtimeEntry('macos-arm64');
    const models = pin.models.files.reduce((s, f) => s + f.sizeBytes, 0);
    expect(install.sizes('macos-arm64')).toEqual({ downloadBytes: entry.sizeBytes + models, diskBytes: entry.sizeBytes + entry.unpackedBytes + models });
    expect(install.sizes('linux-x64')).toBeNull();
  });

  test('platform names', () => {
    expect(install.platformKey('darwin', 'arm64')).toBe('macos-arm64');
    expect(install.platformKey('win32', 'x64')).toBe('windows-x64');
    expect(install.platformKey('linux', 'x64')).toBe('linux-x64');
    expect(install.platformKey('freebsd', 'x64')).toBeNull();
  });
});

describe('installing', () => {
  let tmp;
  let userData;
  let pin;
  let sources;
  let calls;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-docling-install-'));
    userData = path.join(tmp, 'userData');
    const manifest = JSON.stringify({ entry: ['python/bin/python3', '-I', '-B', '-u', '-m', 'docling_serve', 'run'] });
    const archive = zlib.gzipSync(tar([
      { name: 'python/bin/python3', data: '#!fake', mode: 0o755 },
      { name: 'lana-runtime.json', data: manifest }
    ]));
    const modelA = Buffer.from('layout model');
    const modelB = Buffer.from('table model');
    sources = {
      'https://models.lanaai.io/docling/runtime/9.9.9-1/macos-arm64.tar.gz': archive,
      'https://models.lanaai.io/docling/layout/model.safetensors': modelA,
      'https://models.lanaai.io/docling/tables/accurate/model.safetensors': modelB
    };
    pin = {
      runtimeVersion: '9.9.9-1',
      archives: { 'macos-arm64': { url: 'https://models.lanaai.io/docling/runtime/9.9.9-1/macos-arm64.tar.gz', sizeBytes: archive.length, sha256: sha(archive), unpackedBytes: 6 + manifest.length } },
      models: {
        baseUrl: 'https://models.lanaai.io/docling',
        files: [
          { path: 'layout/model.safetensors', sizeBytes: modelA.length, sha256: sha(modelA) },
          { path: 'tables/accurate/model.safetensors', sizeBytes: modelB.length, sha256: sha(modelB) }
        ]
      }
    };
    calls = [];
  });
  afterEach(() => {
    if (tmp && path.basename(tmp).startsWith('lana-docling-install-')) {fs.rmSync(tmp, { recursive: true, force: true });}
  });

  /** The real checked downloader, with fetch answered from `sources` (cut off after `cutAt` bytes when set). */
  function download({ cutAt = null } = {}) {
    return (entry, file, options) => {
      calls.push(entry.url);
      const fetchImpl = async (url, init) => {
        const body = sources[url];
        const from = init.headers && init.headers.Range ? Number(/bytes=(\d+)-/.exec(init.headers.Range)[1]) : 0;
        let bytes = body.subarray(from);
        if (cutAt != null && url === pin.archives['macos-arm64'].url && from === 0) {
          // The connection goes quiet after cutAt bytes and never ends (the downloader's stall timer cuts it).
          const head = bytes.subarray(0, cutAt);
          const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(head)); } });
          return new Response(body, { status: 200 });
        }
        return new Response(bytes, { status: from ? 206 : 200 });
      };
      return downloadVerified(entry, file, options, { fetchImpl, stallMs: cutAt != null ? 50 : 30000 });
    };
  }

  test('runtime first, unpacked and noted; then every model; then it counts as installed', async () => {
    const progress = [];
    expect(install.isInstalled(userData, 'macos-arm64', { pin })).toBe(false);
    const result = await install.install({ userDataDir: userData, key: 'macos-arm64', onProgress: (p) => progress.push(p) }, { pin, download: download() });
    expect(calls).toEqual(Object.keys(sources));
    const where = install.paths(userData, pin);
    expect(result).toEqual({ dir: where.runtime, models: where.models, program: path.join(where.runtime, 'python', 'bin', 'python3'), args: ['-I', '-B', '-u', '-m', 'docling_serve', 'run'] });
    expect(fs.readFileSync(result.program, 'utf8')).toBe('#!fake');
    expect(fs.readFileSync(path.join(where.models, 'tables', 'accurate', 'model.safetensors'), 'utf8')).toBe('table model');
    expect(install.isInstalled(userData, 'macos-arm64', { pin })).toBe(true);
    expect(install.installedEntry(userData, 'macos-arm64', { pin })).toEqual(result);
    // The archive is gone once unpacked.
    expect(fs.readdirSync(where.downloads)).toEqual([]);
    const received = progress.map((p) => p.received);
    expect(received).toEqual([...received].sort((a, b) => a - b));
    expect(progress[progress.length - 1]).toMatchObject({ received: install.sizes('macos-arm64', pin).downloadBytes, total: install.sizes('macos-arm64', pin).downloadBytes });
    expect(progress.map((p) => p.step)).toContain('unpack');
  });

  test('installed means both notes match the pin: a missing model note or another archive is not installed', async () => {
    await install.install({ userDataDir: userData, key: 'macos-arm64' }, { pin, download: download() });
    const where = install.paths(userData, pin);
    fs.rmSync(path.join(where.models, '.lana-complete'));
    expect(install.isInstalled(userData, 'macos-arm64', { pin })).toBe(false);
    expect(install.installedEntry(userData, 'macos-arm64', { pin })).toBeNull();
    await install.install({ userDataDir: userData, key: 'macos-arm64' }, { pin, download: download() });
    expect(install.isInstalled(userData, 'macos-arm64', { pin })).toBe(true);
    const otherArchive = { ...pin, archives: { 'macos-arm64': { ...pin.archives['macos-arm64'], sha256: 'f'.repeat(64) } } };
    expect(install.isInstalled(userData, 'macos-arm64', { pin: otherArchive })).toBe(false);
    const otherModels = { ...pin, models: { ...pin.models, files: [pin.models.files[0]] } };
    expect(install.modelsInstalled(userData, { pin: otherModels })).toBe(false);
  });

  test('a cut during the runtime download resumes from where it stopped', async () => {
    const cut = download({ cutAt: 40 });
    await expect(install.install({ userDataDir: userData, key: 'macos-arm64' }, { pin, download: cut })).rejects.toMatchObject({ code: 'stalled' });
    const part = path.join(install.paths(userData, pin).downloads, 'runtime-9.9.9-1-macos-arm64.tar.gz.part');
    expect(fs.statSync(part).size).toBe(40);
    await install.install({ userDataDir: userData, key: 'macos-arm64' }, { pin, download: download() });
    expect(install.isInstalled(userData, 'macos-arm64', { pin })).toBe(true);
  }, 10000);

  test('a cut during the unpack unpacks again from the kept archive, without downloading it again', async () => {
    const failing = async () => { throw Object.assign(new Error('cut'), { code: 'cancelled' }); };
    await expect(install.install({ userDataDir: userData, key: 'macos-arm64' }, { pin, download: download(), untar: failing })).rejects.toMatchObject({ code: 'cancelled' });
    expect(install.runtimeInstalled(userData, 'macos-arm64', { pin })).toBe(false);
    calls.length = 0;
    await install.install({ userDataDir: userData, key: 'macos-arm64' }, { pin, download: download() });
    expect(install.isInstalled(userData, 'macos-arm64', { pin })).toBe(true);
    // The archive was checked from its note, not fetched again (downloadVerified returns early).
    expect(fs.existsSync(install.paths(userData, pin).downloads)).toBe(true);
  });

  test('a new runtime version replaces the old folder; other files under docling are left alone', async () => {
    const old = path.join(userData, 'docling', 'runtime-1.0.0-1');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(userData, 'docling', 'docling.log'), 'log');
    await install.install({ userDataDir: userData, key: 'macos-arm64' }, { pin, download: download() });
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.readFileSync(path.join(userData, 'docling', 'docling.log'), 'utf8')).toBe('log');
  });

  test('not enough room to unpack stops before writing anything', async () => {
    const need = pin.archives['macos-arm64'].unpackedBytes;
    await expect(install.install({ userDataDir: userData, key: 'macos-arm64', freeBytes: () => need }, { pin, download: (e, f, o) => download()(e, f, { ...o, freeBytes: null }) }))
      .rejects.toMatchObject({ code: 'no_space' });
    expect(fs.existsSync(install.paths(userData, pin).runtime)).toBe(false);
  });

  test('no runtime for this kind of computer', async () => {
    await expect(install.install({ userDataDir: userData, key: 'windows-x64' }, { pin, download: download() })).rejects.toMatchObject({ code: 'unavailable' });
    expect(calls).toEqual([]);
  });
});
