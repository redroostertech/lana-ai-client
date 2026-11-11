'use strict';

// The packaged app looked for its dock and window icons under build/icons
// beside the main script, but electron-builder leaves its build resources
// folder (build/) out of the app, so a packaged run logged "dock icon set
// failed: no icon assets found" and Windows and Linux windows had no icon
// (build machine, 2026-11-11). The icons must ship inside the app, and the
// main process must look where they ship.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.client.json'), 'utf8'));
const main = fs.readFileSync(path.join(ROOT, 'electron-main.js'), 'utf8');

test('electron-builder copies both icon sets into the app as app-icons/', () => {
  const entries = config.files.filter((f) => typeof f === 'object');
  for (const dir of ['icons', 'icons-lana-one']) {
    const entry = entries.find((f) => f.from === 'build/' + dir);
    expect(entry).toBeDefined();
    expect(entry.to).toBe('app-icons/' + dir);
    expect(entry.filter).toEqual(expect.arrayContaining(['*.png', '*.icns']));
  }
});

test('the main process looks in app-icons/ first, then build/ for unpackaged runs', () => {
  expect(main).toMatch(/'app-icons'/);
  const fn = main.slice(main.indexOf('function iconDirs'), main.indexOf('function appIconCandidates'));
  expect(fn.indexOf("'app-icons'")).toBeLessThan(fn.indexOf("'build'"));
});

test('every icon the main process asks for exists in the source tree', () => {
  for (const dir of ['icons', 'icons-lana-one']) {
    for (const f of ['icon-1024.png', 'icon-512.png', 'icon-256.png']) {
      expect(fs.existsSync(path.join(ROOT, 'build', dir, f))).toBe(true);
    }
  }
});
