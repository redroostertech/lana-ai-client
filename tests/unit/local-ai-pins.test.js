'use strict';

/**
 * Pip (lqe) and the LANA engine inside the installer: the pin checks the build steps and the
 * package step run (scripts/local-ai-pins.js), the before-pack refusals, and the installer config
 * that puts both where the app looks. Every refusal has a passing control.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const pins = require('../../scripts/local-ai-pins');

const dirs = [];
function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-pins-'));
  dirs.push(dir);
  return dir;
}
function write(root, rel, data, mode) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), data);
  if (mode) {fs.chmodSync(path.join(root, rel), mode);}
}
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
afterAll(() => { for (const dir of dirs) {fs.rmSync(dir, { recursive: true, force: true });} });

test.each([
  ['darwin', 'arm64', 'macos-arm64'],
  ['mas', 'x64', 'macos-x64'],
  ['win32', 'x64', 'windows-x64'],
  ['linux', 'x64', 'linux-x64'],
  ['linux', 'ia32', null],
  ['freebsd', 'x64', null]
])('platformKey(%s, %s) is %s', (platformName, archName, key) => {
  expect(pins.platformKey(platformName, archName)).toBe(key);
});

describe('checkPip', () => {
  const pin = { version: '3.0.0', build: 'ff965d52d578', builds: { 'macos-arm64': { sha256: sha('the pinned lqe') }, 'windows-x64': { sha256: sha('the pinned lqe.exe') } } };

  test('the pinned file passes (control), on macOS and Windows', () => {
    const root = tmpRoot();
    write(root, 'build/pip/lqe', 'the pinned lqe');
    write(root, 'build/pip/lqe.exe', 'the pinned lqe.exe');
    expect(pins.checkPip({ root, platformName: 'darwin', archName: 'arm64', pin })).toEqual([]);
    expect(pins.checkPip({ root, platformName: 'win32', archName: 'x64', pin })).toEqual([]);
  });

  test.each([
    ['missing', (root) => root, /Pip is missing for this build \(macos-arm64\): build\/pip\/lqe/],
    ['a different build', (root) => { write(root, 'build/pip/lqe', 'a dev build'); return root; }, /is not the pinned Pip 3.0.0 \(ff965d52d578\)/]
  ])('refuses Pip that is %s', (_name, make, message) => {
    expect(pins.checkPip({ root: make(tmpRoot()), platformName: 'darwin', archName: 'arm64', pin }).join(' ')).toMatch(message);
  });

  describe('the Vulkan loader lqe.exe imports (Windows only)', () => {
    const withLoader = { ...pin, vulkanLoader: { platforms: ['windows-x64'], version: '1.3.296.0', file: 'vulkan-fallback/vulkan-1.dll', sha256: sha('the pinned loader') } };
    const windowsRoot = (loader) => {
      const root = tmpRoot();
      write(root, 'build/pip/lqe.exe', 'the pinned lqe.exe');
      write(root, 'build/pip/lqe', 'the pinned lqe');
      if (loader) {write(root, 'build/pip/vulkan-fallback/vulkan-1.dll', loader);}
      return root;
    };

    test('Windows with the pinned vulkan-1.dll in pip/vulkan-fallback passes (control)', () => {
      expect(pins.checkPip({ root: windowsRoot('the pinned loader'), platformName: 'win32', archName: 'x64', pin: withLoader })).toEqual([]);
    });

    test('a loader beside lqe.exe instead of in the fallback folder is refused', () => {
      const root = windowsRoot(null);
      write(root, 'build/pip/vulkan-1.dll', 'the pinned loader');
      expect(pins.checkPip({ root, platformName: 'win32', archName: 'x64', pin: withLoader }).join(' ')).toMatch(/vulkan-fallback\/vulkan-1.dll/);
    });

    test.each([
      ['missing', null, /The Vulkan loader is missing: build\/pip\/vulkan-fallback\/vulkan-1.dll/],
      ['another file', 'some other dll', /is not the pinned Vulkan loader 1.3.296.0/]
    ])('Windows refuses a loader that is %s', (_name, loader, message) => {
      expect(pins.checkPip({ root: windowsRoot(loader), platformName: 'win32', archName: 'x64', pin: withLoader }).join(' ')).toMatch(message);
    });

    test('macOS and Linux never need it (control)', () => {
      const root = windowsRoot(null);
      expect(pins.checkPip({ root, platformName: 'darwin', archName: 'arm64', pin: withLoader })).toEqual([]);
      expect(pins.vulkanLoaderFor(withLoader, 'linux-x64')).toBeNull();
      expect(pins.vulkanLoaderFor(withLoader, 'windows-x64')).toBe(withLoader.vulkanLoader);
    });
  });

  test('refuses a platform the pin has no build for', () => {
    const root = tmpRoot();
    write(root, 'build/pip/lqe', 'the pinned lqe');
    expect(pins.checkPip({ root, platformName: 'linux', archName: 'x64', pin }).join(' ')).toMatch(/no build for linux-x64/);
  });
});

describe('checkEngine', () => {
  const commit = 'a'.repeat(40);
  function engine({ manifest = {}, extra = {} } = {}) {
    const root = tmpRoot();
    write(root, 'build/engine/src/engine/index.js', 'engine bundle');
    write(root, 'build/engine/node_modules/bcrypt/prebuilds/darwin-arm64/bcrypt.node', 'native');
    for (const [rel, data] of Object.entries(extra)) {write(root, `build/engine/${rel}`, data);}
    write(root, 'build/engine/engine-manifest.json', JSON.stringify({ commit, dirty: false, platform: 'darwin', arch: 'arm64', native: ['node_modules/bcrypt/prebuilds/darwin-arm64/bcrypt.node'], ...manifest }));
    return root;
  }
  function pinFor(root) {
    const digest = pins.treeDigest(path.join(root, 'build/engine'));
    return { commit, builds: { 'macos-arm64': { files: digest.files, treeSha256: digest.sha256 } } };
  }
  const signed = ['Contents/Resources/engine/node_modules/bcrypt/prebuilds/darwin-arm64/bcrypt.node'];
  const check = (root, pin, extra = {}) => pins.checkEngine({ root, platformName: 'darwin', archName: 'arm64', pin, macBinaries: signed, ...extra }).join(' ');

  test('the pinned folder passes (control)', () => {
    const root = engine();
    expect(check(root, pinFor(root))).toBe('');
  });

  test('the tree digest leaves out the manifest and changes with any file', () => {
    const root = engine();
    const dir = path.join(root, 'build/engine');
    const first = pins.treeDigest(dir);
    expect(first.files).toBe(2);
    write(root, 'build/engine/engine-manifest.json', '{}');
    expect(pins.treeDigest(dir)).toEqual(first);
    write(root, 'build/engine/src/engine/index.js', 'engine bundlE');
    expect(pins.treeDigest(dir).sha256).not.toBe(first.sha256);
  });

  test('the digest is the backend\'s: sha256 of "<path>\\t<bytes>\\t<sha256>\\n" per file, sorted by path', () => {
    const root = engine();
    const lines = [
      `node_modules/bcrypt/prebuilds/darwin-arm64/bcrypt.node\t6\t${sha('native')}\n`,
      `src/engine/index.js\t13\t${sha('engine bundle')}\n`
    ].join('');
    expect(pins.treeDigest(path.join(root, 'build/engine')).sha256).toBe(sha(lines));
  });

  test.each([
    ['missing', () => { const root = tmpRoot(); return { root, pin: { commit, builds: {} } }; }, /The engine is missing for this build \(macos-arm64\)/],
    ['from another commit', () => { const root = engine(); return { root, pin: { ...pinFor(root), commit: 'b'.repeat(40) } }; }, /built from LANA-AI a{40}, the pin says b{40}/],
    ['from a checkout with changes', () => { const root = engine({ manifest: { dirty: true } }); return { root, pin: pinFor(root) }; }, /uncommitted changes/],
    ['for another processor', () => { const root = engine({ manifest: { arch: 'x64' } }); return { root, pin: pinFor(root) }; }, /is for darwin-x64, this build is darwin-arm64/],
    ['changed after it was pinned', () => { const root = engine(); const pin = pinFor(root); write(root, 'build/engine/node_modules/extra/index.js', 'x'); return { root, pin }; }, /does not match the pin for macos-arm64: 3 files/],
    ['not pinned for this platform', () => { const root = engine(); return { root, pin: { commit, builds: {} } }; }, /no build for macos-arm64/],
    ['holding a native file the Mac build would not sign', () => { const root = engine({ manifest: { native: ['node_modules/bcrypt/prebuilds/darwin-arm64/bcrypt.node', 'node_modules/x/x.node'] } }); return { root, pin: pinFor(root) }; }, /mac.binaries does not list these engine files.*node_modules\/x\/x.node/]
  ])('refuses an engine folder %s', (_name, make, message) => {
    const { root, pin } = make();
    expect(check(root, pin)).toMatch(message);
  });

  test('the signing list is checked only for macOS', () => {
    const root = engine({ manifest: { platform: 'linux', arch: 'x64', native: ['node_modules/x/x.node'] } });
    const digest = pins.treeDigest(path.join(root, 'build/engine'));
    const pin = { commit, builds: { 'linux-x64': { files: digest.files, treeSha256: digest.sha256 } } };
    expect(pins.checkEngine({ root, platformName: 'linux', archName: 'x64', pin, macBinaries: [] })).toEqual([]);
  });
});

describe('checkPackaged (afterPack)', () => {
  function packed() {
    const resourcesDir = tmpRoot();
    write(resourcesDir, 'pip/lqe', 'the pinned lqe');
    write(resourcesDir, 'engine/src/engine/index.js', 'engine bundle');
    write(resourcesDir, 'engine/node_modules/bcrypt/index.js', 'native wrapper');
    write(resourcesDir, 'engine/engine-manifest.json', '{}');
    const digest = pins.treeDigest(path.join(resourcesDir, 'engine'));
    const pipPin = { builds: { 'macos-arm64': { sha256: sha('the pinned lqe') } } };
    const enginePin = { builds: { 'macos-arm64': { files: digest.files, treeSha256: digest.sha256 } } };
    return { resourcesDir, pipPin, enginePin, platformName: 'darwin', archName: 'arm64' };
  }

  test('a packed app holding both pinned parts passes (control)', () => {
    expect(pins.checkPackaged(packed())).toEqual([]);
  });

  test('a packed Windows app must hold the pinned vulkan-1.dll in pip/vulkan-fallback', () => {
    const args = packed();
    write(args.resourcesDir, 'pip/lqe.exe', 'the pinned lqe.exe');
    const digest = pins.treeDigest(path.join(args.resourcesDir, 'engine'));
    const win = {
      ...args,
      platformName: 'win32',
      archName: 'x64',
      pipPin: { builds: { 'windows-x64': { sha256: sha('the pinned lqe.exe') } }, vulkanLoader: { platforms: ['windows-x64'], version: '1.3.296.0', file: 'vulkan-fallback/vulkan-1.dll', sha256: sha('the pinned loader') } },
      enginePin: { builds: { 'windows-x64': { files: digest.files, treeSha256: digest.sha256 } } }
    };
    expect(pins.checkPackaged(win).join(' ')).toMatch(/The packed app: The Vulkan loader is missing/);
    write(args.resourcesDir, 'pip/vulkan-fallback/vulkan-1.dll', 'the pinned loader');
    expect(pins.checkPackaged(win)).toEqual([]);
  });

  test.each([
    ['the packager dropped the engine\'s node_modules', (args) => fs.rmSync(path.join(args.resourcesDir, 'engine/node_modules'), { recursive: true }), /engine .* is not the pinned folder for macos-arm64: 1 files/],
    ['Pip is missing', (args) => fs.rmSync(path.join(args.resourcesDir, 'pip/lqe')), /has no Pip/],
    ['Pip is another build', (args) => write(args.resourcesDir, 'pip/lqe', 'other'), /Pip .* is not the pinned build/],
    ['the engine is missing', (args) => fs.rmSync(path.join(args.resourcesDir, 'engine'), { recursive: true }), /has no engine/]
  ])('refuses when %s', (_name, damage, message) => {
    const args = packed();
    damage(args);
    expect(pins.checkPackaged(args).join(' ')).toMatch(message);
  });

  test('after-pack checks the packed resources folder and stops the build on a problem', async () => {
    jest.resetModules();
    const checkPackaged = jest.fn(() => ['engine dropped']);
    jest.doMock('../../scripts/local-ai-pins', () => ({ checkPackaged }));
    const afterPack = require('../../scripts/after-pack');
    const context = { electronPlatformName: 'darwin', arch: 3, appOutDir: '/out', packager: { getResourcesDir: (dir) => `${dir}/App.app/Contents/Resources` } };
    await expect(afterPack(context)).rejects.toThrow('engine dropped');
    expect(checkPackaged.mock.calls[0][0]).toMatchObject({ resourcesDir: '/out/App.app/Contents/Resources', platformName: 'darwin', archName: 'arm64' });
    checkPackaged.mockReturnValue([]);
    await expect(afterPack(context)).resolves.toBeUndefined();
    jest.dontMock('../../scripts/local-ai-pins');
    jest.resetModules();
  });
});

describe('the package step', () => {
  test('before-pack runs the Pip and engine checks and stops the build on a problem', async () => {
    jest.resetModules();
    const calls = [];
    jest.doMock('../../scripts/parts-before-pack', () => async () => calls.push('parts'));
    jest.doMock('../../scripts/briefs-before-pack', () => async () => calls.push('briefs'));
    jest.doMock('../../scripts/redactor-before-pack', () => async () => calls.push('redactor'));
    jest.doMock('../../scripts/pip-before-pack', () => async () => calls.push('pip'));
    jest.doMock('../../scripts/engine-before-pack', () => async () => { calls.push('engine'); throw new Error('engine missing'); });
    const beforePack = require('../../scripts/before-pack');
    await expect(beforePack({ electronPlatformName: 'darwin', arch: 3 })).rejects.toThrow('engine missing');
    expect(calls).toEqual(['parts', 'briefs', 'redactor', 'pip', 'engine']);
    jest.dontMock('../../scripts/parts-before-pack');
    jest.dontMock('../../scripts/briefs-before-pack');
    jest.dontMock('../../scripts/redactor-before-pack');
    jest.dontMock('../../scripts/pip-before-pack');
    jest.dontMock('../../scripts/engine-before-pack');
    jest.resetModules();
  });

  test('pip-before-pack and engine-before-pack refuse with the checks\' words and pass a matching build (control)', async () => {
    jest.resetModules();
    const checkPip = jest.fn(() => ['Pip is missing']);
    const checkEngine = jest.fn(() => []);
    jest.doMock('../../scripts/local-ai-pins', () => ({ checkPip, checkEngine }));
    const pipBeforePack = require('../../scripts/pip-before-pack');
    const engineBeforePack = require('../../scripts/engine-before-pack');
    const context = { electronPlatformName: 'darwin', arch: 3, packager: { config: { mac: { binaries: ['Contents/Resources/pip/lqe'] } } } };
    await expect(pipBeforePack(context)).rejects.toThrow('Pip is missing');
    expect(checkPip.mock.calls[0][0]).toMatchObject({ platformName: 'darwin', archName: 'arm64' });
    await expect(engineBeforePack(context)).resolves.toBeUndefined();
    expect(checkEngine.mock.calls[0][0]).toMatchObject({ platformName: 'darwin', archName: 'arm64', macBinaries: ['Contents/Resources/pip/lqe'] });
    jest.dontMock('../../scripts/local-ai-pins');
    jest.resetModules();
  });

  test('every installer puts Pip and the engine where the app looks, and the Mac build signs Pip', () => {
    const config = require('../../electron-builder.client.json');
    const placed = (section) => Object.fromEntries((config[section].extraResources || []).map((entry) => [entry.to, entry.from]));
    expect(placed('mac')).toMatchObject({ 'pip/lqe': 'build/pip/lqe', engine: 'build/engine' });
    expect(placed('linux')).toMatchObject({ 'pip/lqe': 'build/pip/lqe', engine: 'build/engine' });
    expect(placed('win')).toMatchObject({ 'pip/lqe.exe': 'build/pip/lqe.exe', engine: 'build/engine' });
    // lqe.exe imports vulkan-1.dll: the Windows installer carries it in pip/vulkan-fallback, never
    // beside lqe.exe (Windows would load it there before a newer system loader); no other installer does.
    expect(placed('win')).toMatchObject({ 'pip/vulkan-fallback/vulkan-1.dll': 'build/pip/vulkan-fallback/vulkan-1.dll' });
    expect(placed('win')).not.toHaveProperty('pip/vulkan-1.dll');
    for (const section of ['mac', 'linux']) {expect(Object.keys(placed(section)).some((to) => /vulkan/i.test(to))).toBe(false);}
    expect((config.extraResources || []).some((entry) => /vulkan/i.test(entry.from))).toBe(false);
    expect(config.mac.binaries).toContain('Contents/Resources/pip/lqe');
    // electron-builder never copies a folder's own top-level node_modules, so it is a second entry.
    for (const section of ['mac', 'linux', 'win']) {expect(placed(section)).toMatchObject({ 'engine/node_modules': 'build/engine/node_modules' });}
    expect(config.afterPack).toBe('scripts/after-pack.js');
    // The supervisors' lookups: <resources>/pip/lqe and <resources>/engine/src/engine/index.js.
    const { resolvePipBinary } = require('../../electron-pip-supervisor');
    expect(resolvePipBinary({ resourcesPath: '/R', isPackaged: true, platform: 'darwin', fileExists: () => true })).toBe(path.join('/R', 'pip', 'lqe'));
    const { engineEntry } = require('../../electron-engine-supervisor');
    expect(engineEntry(path.join('/R', 'engine'))).toBe(path.join('/R', 'engine', pins.ENGINE_ENTRY));
  });

  test('the pins name full commits and the Mac builds', () => {
    const pip = require('../../pip/pip-pin.json');
    const engine = require('../../engine/engine-pin.json');
    expect(pip.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(pip.commit.startsWith(pip.build)).toBe(true);
    expect(pip.builds['macos-arm64'].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pip.cmake['macos-arm64']).toContain('-DLQE_DISTRIBUTION=ON');
    // The Vulkan loader: Windows only, the archive and the file each pinned by sha256.
    expect(pip.vulkanLoader.platforms).toEqual(['windows-x64']);
    expect(pip.vulkanLoader.archive.url).toMatch(/^https:\/\/sdk\.lunarg\.com\//);
    expect(pip.vulkanLoader.archive.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pip.vulkanLoader.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pip.vulkanLoader.file).toBe('vulkan-fallback/vulkan-1.dll');
    expect(engine.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(engine.builds['macos-arm64'].treeSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
