'use strict';

/**
 * One computer packaging every installer: the per-target parts folders (build/parts/<target>/)
 * staged into the single-platform paths electron-builder reads, the fetch step that fills them
 * from a list of download links, the Briefs speech package per target, and the Mac helpers
 * built for both processors. Every refusal has a passing control.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const parts = require('../../scripts/client-parts');
const partsBeforePack = require('../../scripts/parts-before-pack');
const fetchParts = require('../../scripts/fetch-client-parts');

const dirs = [];
function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-parts-'));
  dirs.push(dir);
  return dir;
}
function write(root, rel, data, mode) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), data);
  if (mode) {fs.chmodSync(path.join(root, rel), mode);}
}
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
afterAll(() => { for (const dir of dirs) {fs.rmSync(dir, { recursive: true, force: true });} });

/** A parts folder for one target, each file naming the target so a wrong pick shows. */
function writeTarget(root, key) {
  const exe = key.startsWith('windows-') ? '.exe' : '';
  write(root, `build/parts/${key}/pip/lqe${exe}`, `lqe for ${key}`, 0o755);
  write(root, `build/parts/${key}/redactor/lana-redactor/lana-redactor${exe}`, `redactor for ${key}`, 0o755);
  write(root, `build/parts/${key}/engine/src/engine/index.js`, `engine for ${key}`);
}

describe('stageParts', () => {
  test.each([
    ['darwin', 'arm64', 'macos-arm64', 'lqe'],
    ['darwin', 'x64', 'macos-x64', 'lqe'],
    ['win32', 'x64', 'windows-x64', 'lqe.exe']
  ])('a %s %s build gets the %s parts', (platformName, archName, key, lqe) => {
    const root = tmpRoot();
    for (const target of ['macos-arm64', 'macos-x64', 'windows-x64']) {writeTarget(root, target);}
    expect(parts.stageParts({ root, platformName, archName })).toEqual({ staged: key });
    expect(read(root, `build/pip/${lqe}`)).toBe(`lqe for ${key}`);
    const exe = lqe.endsWith('.exe') ? '.exe' : '';
    expect(read(root, `build/redactor/lana-redactor/lana-redactor${exe}`)).toBe(`redactor for ${key}`);
    expect(read(root, 'build/engine/src/engine/index.js')).toBe(`engine for ${key}`);
    if (!exe) {expect(fs.statSync(path.join(root, 'build/pip/lqe')).mode & 0o111).not.toBe(0);}
    // The target's own folder stays for the next run.
    expect(read(root, `build/parts/${key}/pip/${lqe}`)).toBe(`lqe for ${key}`);
  });

  test('staging the next target replaces the last one, leaving no file of it behind', () => {
    const root = tmpRoot();
    writeTarget(root, 'macos-arm64');
    writeTarget(root, 'macos-x64');
    write(root, 'build/parts/macos-arm64/engine/only-on-arm64.txt', 'arm64');
    parts.stageParts({ root, platformName: 'darwin', archName: 'arm64' });
    expect(fs.existsSync(path.join(root, 'build/engine/only-on-arm64.txt'))).toBe(true);
    parts.stageParts({ root, platformName: 'darwin', archName: 'x64' });
    expect(fs.existsSync(path.join(root, 'build/engine/only-on-arm64.txt'))).toBe(false);
    expect(read(root, 'build/engine/src/engine/index.js')).toBe('engine for macos-x64');
    expect(fs.readdirSync(path.join(root, 'build')).filter((name) => name.startsWith('.'))).toEqual([]);
  });

  test('keeps symbolic links as they are (the redactor folder carries relative links on macOS)', () => {
    const root = tmpRoot();
    writeTarget(root, 'macos-arm64');
    fs.symlinkSync('lana-redactor', path.join(root, 'build/parts/macos-arm64/redactor/lana-redactor/link'));
    parts.stageParts({ root, platformName: 'darwin', archName: 'arm64' });
    expect(fs.readlinkSync(path.join(root, 'build/redactor/lana-redactor/link'))).toBe('lana-redactor');
  });

  test('refuses a target with no parts folder and leaves the staged parts alone', () => {
    const root = tmpRoot();
    writeTarget(root, 'macos-arm64');
    parts.stageParts({ root, platformName: 'darwin', archName: 'arm64' });
    expect(() => parts.stageParts({ root, platformName: 'win32', archName: 'x64' })).toThrow(/build\/parts\/windows-x64 is missing/);
    expect(read(root, 'build/pip/lqe')).toBe('lqe for macos-arm64');
  });

  test('refuses a target folder missing one part, before staging any of them', () => {
    const root = tmpRoot();
    writeTarget(root, 'macos-x64');
    fs.rmSync(path.join(root, 'build/parts/macos-x64/engine'), { recursive: true });
    expect(() => parts.stageParts({ root, platformName: 'darwin', archName: 'x64' })).toThrow(/build\/parts\/macos-x64\/engine is missing/);
    expect(fs.existsSync(path.join(root, 'build/pip'))).toBe(false);
  });

  test('without build/parts it leaves the single-platform folders as they are (one-platform builds)', () => {
    const root = tmpRoot();
    write(root, 'build/pip/lqe', 'a local lqe');
    write(root, 'build/engine/src/engine/index.js', 'a local engine');
    expect(parts.stageParts({ root, platformName: 'darwin', archName: 'arm64' })).toEqual({ staged: null });
    expect(read(root, 'build/pip/lqe')).toBe('a local lqe');
    expect(read(root, 'build/engine/src/engine/index.js')).toBe('a local engine');
  });
});

describe('Mac signing list per processor', () => {
  const listed = [
    'Contents/Resources/pip/lqe',
    'Contents/Resources/engine/node_modules/bcrypt/prebuilds/darwin-arm64/bcrypt.node',
    'Contents/Resources/engine/node_modules/bcrypt/prebuilds/darwin-x64/bcrypt.node'
  ];

  test.each([
    ['arm64', 'darwin-arm64'],
    ['x64', 'darwin-x64']
  ])('a %s build signs only its own engine files', (archName, kept) => {
    const out = parts.macBinariesFor(listed, archName);
    expect(out).toContain('Contents/Resources/pip/lqe');
    expect(out.filter((file) => file.includes('/darwin-'))).toEqual([listed.find((file) => file.includes(`/${kept}/`))]);
  });

  test('the before-pack hook narrows mac.binaries per target from the full list, every time', async () => {
    const root = tmpRoot();
    const mac = { binaries: [...listed] };
    const context = (arch) => ({ electronPlatformName: 'darwin', arch, packager: { config: { mac }, platformSpecificBuildOptions: mac } });
    await partsBeforePack(context(1), { root });
    expect(mac.binaries).toEqual([listed[0], listed[2]]);
    await partsBeforePack(context(3), { root });
    expect(mac.binaries).toEqual([listed[0], listed[1]]);
  });

  test('the Mac config lists the engine files for both processors', () => {
    const { mac } = require('../../electron-builder.client.json');
    for (const arch of ['darwin-arm64', 'darwin-x64']) {
      expect(mac.binaries).toContain(`Contents/Resources/engine/node_modules/bcrypt/prebuilds/${arch}/bcrypt.node`);
    }
  });

  test('each installer carries only its own Briefs speech package', () => {
    const { Minimatch } = require(require.resolve('minimatch', { paths: [require.resolve('app-builder-lib')] }));
    const config = require('../../electron-builder.client.json');
    const shipped = (section, arch) => {
      const excludes = config[section].files.map((p) => new Minimatch(p.slice(1).replace('${arch}', arch), { dot: true }));
      return ['darwin-arm64', 'darwin-x64', 'win-x64', 'linux-x64', 'node']
        .filter((name) => !excludes.some((m) => m.match(`node_modules/sherpa-onnx-${name}/sherpa-onnx.node`)));
    };
    expect(shipped('mac', 'arm64')).toEqual(['darwin-arm64', 'node']);
    expect(shipped('mac', 'x64')).toEqual(['darwin-x64', 'node']);
    expect(shipped('win', 'x64')).toEqual(['win-x64', 'node']);
    expect(shipped('linux', 'x64')).toEqual(['linux-x64', 'node']);
  });
});

describe('before-pack', () => {
  test('stages the target\'s parts before any check runs', async () => {
    jest.resetModules();
    const calls = [];
    jest.doMock('../../scripts/parts-before-pack', () => async () => calls.push('parts'));
    jest.doMock('../../scripts/briefs-before-pack', () => async () => calls.push('briefs'));
    jest.doMock('../../scripts/redactor-before-pack', () => async () => calls.push('redactor'));
    jest.doMock('../../scripts/pip-before-pack', () => async () => calls.push('pip'));
    jest.doMock('../../scripts/engine-before-pack', () => async () => calls.push('engine'));
    jest.doMock('../../scripts/editor-before-pack', () => async () => calls.push('editor'));
    await require('../../scripts/before-pack')({ electronPlatformName: 'darwin', arch: 3 });
    expect(calls).toEqual(['parts', 'briefs', 'redactor', 'pip', 'engine', 'editor']);
    for (const name of ['parts', 'briefs', 'redactor', 'pip', 'engine', 'editor']) {jest.dontMock(`../../scripts/${name}-before-pack`);}
    jest.resetModules();
  });
});

describe('fetch-client-parts', () => {
  const SECRET = 'sig=TOPSECRETSIGNATURE';
  let server;
  let base;
  const served = new Map();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const body = served.get(req.url.split('?')[0]);
      if (!body) {res.writeHead(404); res.end(); return;}
      res.writeHead(200);
      res.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  /** A part's archive, packed the way the build machines pack it: tar -czf <part>.tar.gz -C build/<part> . */
  function serveArchive(name, files, { shaOverride } = {}) {
    const src = tmpRoot();
    for (const [rel, data] of Object.entries(files)) {write(src, rel, data, 0o755);}
    const tarball = path.join(tmpRoot(), 'part.tar.gz');
    execFileSync('tar', ['-czf', tarball, '-C', src, '.']);
    const bytes = fs.readFileSync(tarball);
    served.set(`/${name}.tar.gz`, bytes);
    served.set(`/${name}.tar.gz.sha256`, `${shaOverride || sha(bytes)}  ${name}.tar.gz\n`);
    return `${base}/${name}.tar.gz?${SECRET}`;
  }

  const pipPin = { version: '3.0.0', build: 'ff965d52d578', builds: { 'macos-x64': { sha256: sha('the pinned x64 lqe') } } };
  const pinsFor = () => ({ pip: pipPin, engine: { commit: 'c', builds: {} }, macBinaries: [] });

  function listFile(lines) {
    const file = path.join(tmpRoot(), 'urls.txt');
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return file;
  }

  function capture() {
    const out = [];
    const log = (...args) => out.push(args.join(' '));
    return { out, log };
  }

  test('reads the list: one "<target>/<part> <url>" per line, comments and blank lines skipped', () => {
    const list = fetchParts.parseUrlList(`# links\n\nmacos-x64/pip https://x/a?${SECRET}\nmacos-x64/pip.sha256 https://x/b?${SECRET}\n`);
    expect(list).toEqual([{ key: 'macos-x64', part: 'pip', url: `https://x/a?${SECRET}`, shaUrl: `https://x/b?${SECRET}` }]);
    expect(fetchParts.parseUrlList(`windows-x64/engine https://x/e.tar.gz?${SECRET}\n`)[0].shaUrl).toBe(`https://x/e.tar.gz.sha256?${SECRET}`);
  });

  test('refuses a list line it cannot read without repeating the line', () => {
    expect(() => fetchParts.parseUrlList(`macos-x64/nothing https://x/a?${SECRET}\n`)).toThrow(/line 1/);
    try { fetchParts.parseUrlList(`macos-x64/nothing https://x/a?${SECRET}\n`); } catch (error) { expect(error.message).not.toContain(SECRET); }
  });

  test('downloads a part, checks it, and unpacks it into build/parts/<target>/<part> (control)', async () => {
    const root = tmpRoot();
    const url = serveArchive('good-pip', { lqe: 'the pinned x64 lqe' });
    const { out, log } = capture();
    await fetchParts.fetchClientParts({ root, listFile: listFile([`macos-x64/pip ${url}`]), pins: pinsFor(), log, sherpa: false });
    expect(read(root, 'build/parts/macos-x64/pip/lqe')).toBe('the pinned x64 lqe');
    expect(out.join('\n')).toContain('macos-x64/pip');
    expect(out.join('\n')).not.toContain(SECRET);
    expect(out.join('\n')).not.toContain(base);
  });

  test('refuses an archive whose sha256 does not match its .sha256, and never prints the link', async () => {
    const root = tmpRoot();
    const url = serveArchive('bad-sha', { lqe: 'the pinned x64 lqe' }, { shaOverride: sha('something else') });
    const { out, log } = capture();
    const run = fetchParts.fetchClientParts({ root, listFile: listFile([`macos-x64/pip ${url}`]), pins: pinsFor(), log, sherpa: false });
    await expect(run).rejects.toThrow(/macos-x64\/pip.*sha256/);
    const message = await run.catch((error) => error.message);
    expect(`${message}\n${out.join('\n')}`).not.toContain(SECRET);
    expect(`${message}\n${out.join('\n')}`).not.toContain(base);
    expect(fs.existsSync(path.join(root, 'build/parts/macos-x64/pip'))).toBe(false);
  });

  test('refuses a part that matches its .sha256 but not its pin, and keeps the part already there', async () => {
    const root = tmpRoot();
    write(root, 'build/parts/macos-x64/pip/lqe', 'the pinned x64 lqe');
    const url = serveArchive('off-pin', { lqe: 'a dev build of lqe' });
    const { out, log } = capture();
    const run = fetchParts.fetchClientParts({ root, listFile: listFile([`macos-x64/pip ${url}`]), pins: pinsFor(), log, sherpa: false });
    const message = await run.then(() => '', (error) => error.message);
    expect(message).toMatch(/macos-x64\/pip.*not the pinned Pip/);
    expect(`${message}\n${out.join('\n')}`).not.toContain(SECRET);
    expect(read(root, 'build/parts/macos-x64/pip/lqe')).toBe('the pinned x64 lqe');
  });

  test('refuses a redactor archive without the program for its target', async () => {
    const root = tmpRoot();
    const url = serveArchive('no-redactor', { 'lana-redactor/README': 'no program here' });
    const run = fetchParts.fetchClientParts({ root, listFile: listFile([`windows-x64/redactor ${url}`]), pins: pinsFor(), log: () => {}, sherpa: false });
    await expect(run).rejects.toThrow(/windows-x64\/redactor.*redactor program is missing/);
  });

  test('a download that fails says which part and the status, never the link', async () => {
    const root = tmpRoot();
    const { out, log } = capture();
    const run = fetchParts.fetchClientParts({ root, listFile: listFile([`macos-x64/pip ${base}/nothing.tar.gz?${SECRET}`]), pins: pinsFor(), log, sherpa: false });
    const message = await run.then(() => '', (error) => error.message);
    expect(message).toMatch(/macos-x64\/pip.*404/);
    expect(`${message}\n${out.join('\n')}`).not.toContain(SECRET);
  });
});

describe('Briefs speech package per target', () => {
  /** A registry tarball the way npm serves it: everything under package/. */
  function npmTarball(name, version) {
    const src = tmpRoot();
    write(src, 'package/package.json', JSON.stringify({ name, version }));
    write(src, 'package/sherpa-onnx.node', `native ${name}`);
    const file = path.join(tmpRoot(), `${name}.tgz`);
    execFileSync('tar', ['-czf', file, '-C', src, 'package']);
    return fs.readFileSync(file);
  }
  const integrity = (bytes) => `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;

  test('each target needs its own platform package', () => {
    expect(fetchParts.sherpaPackagesFor(['macos-arm64', 'macos-x64', 'windows-x64'])).toEqual(['sherpa-onnx-darwin-arm64', 'sherpa-onnx-darwin-x64', 'sherpa-onnx-win-x64']);
  });

  test('installs a missing package at the version package-lock pins, checked against its integrity', async () => {
    const root = tmpRoot();
    const bytes = npmTarball('sherpa-onnx-win-x64', '2.0.1');
    const lock = { packages: { 'node_modules/sherpa-onnx-win-x64': { version: '2.0.1', resolved: 'https://registry.example/w.tgz', integrity: integrity(bytes) } } };
    const download = jest.fn(async (_url, dest) => fs.writeFileSync(dest, bytes));
    await fetchParts.ensureSherpaPackages({ root, keys: ['windows-x64'], lock, download, log: () => {} });
    expect(JSON.parse(read(root, 'node_modules/sherpa-onnx-win-x64/package.json')).version).toBe('2.0.1');
    // Already there at the pinned version: left as it is.
    await fetchParts.ensureSherpaPackages({ root, keys: ['windows-x64'], lock, download, log: () => {} });
    expect(download).toHaveBeenCalledTimes(1);
  });

  test('refuses a package whose bytes do not match package-lock\'s integrity', async () => {
    const root = tmpRoot();
    const lock = { packages: { 'node_modules/sherpa-onnx-darwin-x64': { version: '2.0.1', resolved: 'https://registry.example/d.tgz', integrity: integrity(Buffer.from('other')) } } };
    const download = async (_url, dest) => fs.writeFileSync(dest, npmTarball('sherpa-onnx-darwin-x64', '2.0.1'));
    await expect(fetchParts.ensureSherpaPackages({ root, keys: ['macos-x64'], lock, download, log: () => {} })).rejects.toThrow(/sherpa-onnx-darwin-x64.*integrity/);
    expect(fs.existsSync(path.join(root, 'node_modules/sherpa-onnx-darwin-x64'))).toBe(false);
  });
});

describe('Mac helpers build for both processors', () => {
  // Required inside each test: before this change the scripts built on require and exited.
  test('the Bluetooth helper is built for arm64 and x86_64', () => {
    const args = require('../../scripts/build-briefs-ble-helper').swiftBuildArgs();
    expect(args.join(' ')).toContain('--arch arm64 --arch x86_64');
  });

  test('the screen voice helper is built for arm64 and x86_64', () => {
    const args = require('../../scripts/build-screen-voice-helper').clangArgs('/src.m', '/out');
    expect(args.join(' ')).toContain('-arch arm64 -arch x86_64');
  });

  test.each([
    ['x86_64 arm64', []],
    ['arm64', ['x86_64']],
    ['x86_64', ['arm64']]
  ])('a helper whose lipo reports "%s" is missing %j', (archs, missing) => {
    expect(parts.missingMacArchs(archs)).toEqual(missing);
  });
});

// The Intel build Mac (APFS, 2026-11-13): removing the replaced folder failed with ENOTEMPTY
// twice and the script exited 1, although the new folder was already in place. rmSync retries
// ENOTEMPTY only when maxRetries is set, and a leftover .old folder is not a failed swap.
describe('swapInto cleanup', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  function busyRemoval({ failOld }) {
    const real = fs.rmSync;
    const calls = [];
    jest.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
      calls.push({ target: String(target), options });
      if (failOld && String(target).includes('.old-')) {
        throw Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${target}'`), { code: 'ENOTEMPTY' });
      }
      return real(target, options);
    });
    return calls;
  }

  test('removes the replaced folder with retries, and a removal that still fails is only a warning', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-'));
    dirs.push(root);
    const dest = path.join(root, 'engine');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'old.txt'), 'old');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = busyRemoval({ failOld: true });
    expect(() => parts.swapInto(dest, (staging) => {
      fs.mkdirSync(staging);
      fs.writeFileSync(path.join(staging, 'new.txt'), 'new');
    })).not.toThrow();
    expect(fs.readFileSync(path.join(dest, 'new.txt'), 'utf8')).toBe('new');
    const oldRemoval = calls.find((c) => c.target.includes('.old-'));
    expect(oldRemoval.options).toMatchObject({ recursive: true, force: true, maxRetries: 5 });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not remove .*\.old-.*ENOTEMPTY/));
  });

  test('a swap whose final rename fails puts the old folder back instead of deleting it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-'));
    dirs.push(root);
    const dest = path.join(root, 'engine');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'old.txt'), 'old');
    const realRename = fs.renameSync;
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).includes('.staging-') && String(to) === dest) {throw Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' });}
      return realRename(from, to);
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => parts.swapInto(dest, (staging) => { fs.mkdirSync(staging); fs.writeFileSync(path.join(staging, 'new.txt'), 'new'); })).toThrow('EXDEV');
    expect(fs.readFileSync(path.join(dest, 'old.txt'), 'utf8')).toBe('old');
    expect(fs.readdirSync(root).filter((n) => n.includes('.old-'))).toEqual([]);
  });

  test('when putting the old folder back also fails, the original error is thrown and the old folder is kept', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-'));
    dirs.push(root);
    const dest = path.join(root, 'engine');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'old.txt'), 'old');
    const realRename = fs.renameSync;
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === dest) {throw Object.assign(new Error(`EXDEV: rename to dest failed ${path.basename(String(from))}`), { code: 'EXDEV' });}
      return realRename(from, to);
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => parts.swapInto(dest, (staging) => { fs.mkdirSync(staging); })).toThrow(/rename to dest failed \.engine\.staging-/);
    const kept = fs.readdirSync(root).filter((n) => n.includes('.old-'));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, kept[0], 'old.txt'), 'utf8')).toBe('old');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(path.join(root, kept[0])));
  });

  test('control: a failed fill still fails the swap, and dest keeps its old contents', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-'));
    dirs.push(root);
    const dest = path.join(root, 'engine');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'old.txt'), 'old');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    busyRemoval({ failOld: false });
    expect(() => parts.swapInto(dest, () => { throw new Error('copy failed'); })).toThrow('copy failed');
    expect(fs.readFileSync(path.join(dest, 'old.txt'), 'utf8')).toBe('old');
  });
});

test('removeLeftover is shared, and fetch-client-parts uses it for its work folders', () => {
  expect(typeof parts.removeLeftover).toBe('function');
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/fetch-client-parts.js'), 'utf8');
  expect(src).toMatch(/removeLeftover\(work\)/);
  expect(src).not.toMatch(/finally \{\s*fs\.rmSync\(work/);
});
