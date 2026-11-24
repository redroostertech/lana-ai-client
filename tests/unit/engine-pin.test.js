/**
 * The engine this app carries (engine/engine-pin.json) is built from the
 * LANA-AI commit that routes each request local first (2026-11-23). A platform
 * not rebuilt from that commit has no entry, and packaging for it stops with a
 * plain message (scripts/local-ai-pins.js checkEngine) instead of shipping an
 * engine from another commit.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const pins = require('../../scripts/local-ai-pins');
const pin = require('../../engine/engine-pin.json');

test('the engine is pinned to the local-first LANA-AI commit, by its full id, on production', () => {
  expect(pin.commit).toBe('0d9a94aaec6535833b9540b4a63b522d7a1f8cc6');
  expect(pin.branch).toBe('production');
});

test('release 4.2.0: Pip has a build for every system', () => {
  const pip = require('../../pip/pip-pin.json');
  expect(Object.keys(pip.builds).sort()).toEqual(['linux-x64', 'macos-arm64', 'macos-x64', 'windows-x64']);
});

describe('packaging against the pin', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-pin-'));
    const dir = pins.engineDir(root);
    fs.mkdirSync(path.join(dir, 'src/engine'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/engine/index.js'), '');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = (over) => fs.writeFileSync(path.join(pins.engineDir(root), pins.ENGINE_MANIFEST), JSON.stringify({ commit: pin.commit, dirty: false, native: [], ...over }));

  test('release 4.2.0: every system has an engine built from that commit', () => {
    expect(Object.keys(pin.builds).sort()).toEqual(['linux-x64', 'macos-arm64', 'macos-x64', 'windows-x64']);
  });

  test.each([['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64']])('%s %s: an engine folder that is not the pinned build is refused', (platform, arch) => {
    manifest({ platform, arch });
    expect(pins.checkEngine({ root, platformName: platform, archName: arch, pin }).join(' ')).toContain('does not match the pin');
  });

  test('control: an engine folder from an older commit is refused for Apple chip too', () => {
    manifest({ platform: 'darwin', arch: 'arm64', commit: 'f6bac524719ca1bd6a28d42a0a0a552bfcc9f2e6' });
    expect(pins.checkEngine({ root, platformName: 'darwin', archName: 'arm64', pin }).join(' ')).toContain('the pin says 0d9a94aaec6535833b9540b4a63b522d7a1f8cc6');
  });
});
