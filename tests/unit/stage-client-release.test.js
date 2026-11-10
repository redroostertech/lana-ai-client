/**
 * Release layout for https://releases.lanaai.io/client/ (scripts/stage-client-release.js).
 * The update feeds must point at <version>/<file>, which electron-updater's
 * generic provider resolves against client/, and the two one-arch mac feeds
 * must merge into one. Uses a temporary dist folder; nothing is uploaded.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const stage = require('../../scripts/stage-client-release.js');
const { newBaseUrl, newUrlFromBase } = require('electron-updater/out/util');

const V = '4.2.0';

function macFeed(arch) {
  const zip = `LanaAI--genesis--${V}-${arch}.zip`;
  const dmg = `LanaAI--genesis--${V}-${arch}.dmg`;
  return {
    version: V,
    files: [
      { url: zip, sha512: `zip-${arch}`, size: 10 },
      { url: dmg, sha512: `dmg-${arch}`, size: 20 }
    ],
    path: zip,
    sha512: `zip-${arch}`,
    releaseDate: arch === 'x64' ? '2026-11-09T12:00:00.000Z' : '2026-11-09T11:00:00.000Z'
  };
}

let dist;
beforeEach(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-release-'));
  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
    fs.writeFileSync(path.join(dist, rel), body);
  };
  ['arm64', 'x64'].forEach((arch) => {
    write(`latest-mac-${arch}.yml`, yaml.dump(macFeed(arch)));
    write(`macos-${arch}/LanaAI--genesis--${V}-${arch}.zip`, 'z');
    write(`macos-${arch}/LanaAI--genesis--${V}-${arch}.dmg`, 'd');
    write(`LanaAI--genesis--${V}-${arch}.zip.blockmap`, 'b');
  });
  write('latest.yml', yaml.dump({ version: V, files: [{ url: `LanaAI--genesis--${V}-setup.exe`, sha512: 'w', size: 1 }], path: `LanaAI--genesis--${V}-setup.exe` }));
  write(`windows/LanaAI--genesis--${V}-setup.exe`, 'e');
  write(`linux/LanaAI--genesis--${V}.deb`, 'deb');
  write('mac-arm64/Lana AI Client.app/Contents/Info.plist', 'skip me');
});
afterEach(() => fs.rmSync(dist, { recursive: true, force: true }));

test('feeds point at <version>/<file> and electron-updater resolves them under client/<version>/', () => {
  const plan = stage.planRelease(dist, V);
  const mac = yaml.load(plan.feeds.find((f) => f.key === 'client/latest-mac.yml').body);

  expect(mac.files.map((f) => f.url).sort()).toEqual([
    `${V}/LanaAI--genesis--${V}-arm64.dmg`,
    `${V}/LanaAI--genesis--${V}-arm64.zip`,
    `${V}/LanaAI--genesis--${V}-x64.dmg`,
    `${V}/LanaAI--genesis--${V}-x64.zip`
  ]);
  expect(mac.releaseDate).toBe('2026-11-09T12:00:00.000Z');

  const base = newBaseUrl(stage.PUBLIC_BASE);
  expect(newUrlFromBase(mac.files[0].url, base).href)
    .toBe(`https://releases.lanaai.io/client/${V}/${path.basename(mac.files[0].url)}`);
  expect(newUrlFromBase('latest-mac.yml', base).href).toBe('https://releases.lanaai.io/client/latest-mac.yml');
});

test('files land in client/<version>/ with blockmaps, and installers get stable names in client/latest/', () => {
  const plan = stage.planRelease(dist, V);
  const keys = plan.copies.map((c) => c.key);

  expect(keys).toEqual(expect.arrayContaining([
    `client/${V}/LanaAI--genesis--${V}-arm64.zip`,
    `client/${V}/LanaAI--genesis--${V}-arm64.zip.blockmap`,
    `client/${V}/LanaAI--genesis--${V}-x64.dmg`,
    `client/${V}/LanaAI--genesis--${V}-setup.exe`,
    `client/${V}/LanaAI--genesis--${V}.deb`,
    'client/latest/LANA-mac-arm64.dmg',
    'client/latest/LANA-mac-x64.dmg',
    'client/latest/LANA-windows-x64-setup.exe',
    'client/latest/LANA-linux-amd64.deb'
  ]));
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.some((k) => k.includes('Info.plist'))).toBe(false);
});

test('writeStage copies into dist/r2 and the printed plan uploads feeds last', () => {
  const plan = stage.planRelease(dist, V);
  const stageDir = stage.writeStage(dist, plan);
  expect(fs.existsSync(path.join(stageDir, 'client/latest-mac.yml'))).toBe(true);
  expect(fs.existsSync(path.join(stageDir, `client/${V}/LanaAI--genesis--${V}-x64.zip`))).toBe(true);

  const lines = [];
  stage.printUploadPlan(stageDir, plan, (l) => lines.push(l));
  const firstFeed = lines.findIndex((l) => l.includes('.yml   (feed'));
  const lastFile = lines.map((l, i) => (l.includes(`client/${V}/`) ? i : -1)).filter((i) => i >= 0).pop();
  expect(lines.join('\n')).toMatch(/NOT run/);
  expect(firstFeed).toBeGreaterThan(lastFile);

  // A second run replaces the stage instead of planning from it.
  expect(() => stage.planRelease(dist, V)).not.toThrow();
});

test('a feed for a different version or a missing file stops the staging', () => {
  expect(() => stage.planRelease(dist, '4.2.1')).toThrow(/expected 4.2.1/);
  fs.rmSync(path.join(dist, 'windows'), { recursive: true });
  expect(() => stage.planRelease(dist, V)).toThrow(/setup\.exe but it is not in/);
});

test('one-arch mac feed names map to latest-mac.yml; linux arch feeds stay separate', () => {
  expect(stage.feedNameFor('latest-mac-arm64.yml')).toBe('latest-mac.yml');
  expect(stage.feedNameFor('latest-mac.yml')).toBe('latest-mac.yml');
  expect(stage.feedNameFor('latest-linux.yml')).toBe('latest-linux.yml');
  expect(stage.feedNameFor('latest-linux-arm64.yml')).toBe('latest-linux-arm64.yml');
  expect(stage.feedNameFor('builder-debug.yml')).toBe(null);
});

test('the app and the build use the same releases address', () => {
  const root = path.resolve(__dirname, '../..');
  const builder = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.client.json'), 'utf8'));
  expect(builder.publish).toEqual({ provider: 'generic', url: stage.PUBLIC_BASE });
  expect(yaml.load(fs.readFileSync(path.join(root, 'dev-app-update.yml'), 'utf8'))).toEqual({ provider: 'generic', url: stage.PUBLIC_BASE });
  const updater = fs.readFileSync(path.join(root, 'electron-updater-custom.js'), 'utf8');
  expect(updater).toContain(`const RELEASES_URL = '${stage.PUBLIC_BASE}'`);
  expect(updater).not.toMatch(/provider: 'github'/);
  expect(fs.readFileSync(path.join(root, 'scripts/build-client.sh'), 'utf8')).not.toMatch(/gh release/);
});
