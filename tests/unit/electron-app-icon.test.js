'use strict';

/**
 * The LANA icon for native dialogs and the dock (electron-app-icon.js): found in the packaged
 * layout (app-icons/<flavor dir>) or the source tree (build/<flavor dir>), brand-aware,
 * cached, and undefined when there is no usable file, so a dialog falls back to the default.
 */

const path = require('path');
const { createAppIcon, iconDirs } = require('../../electron-app-icon');
const { trackedMessageBox, setDialogIcon } = require('../../electron-confirm');

const ROOT = '/app';

function fakeNativeImage(empty = new Set()) {
  return { createFromPath: jest.fn((file) => ({ file, isEmpty: () => empty.has(file) })) };
}

describe('where the icon is', () => {
  test('packaged (app-icons/) first, then the source tree (build/), per flavor', () => {
    expect(iconDirs({ rootDir: ROOT, flavor: 'lana' })).toEqual([path.join(ROOT, 'app-icons', 'icons'), path.join(ROOT, 'build', 'icons')]);
    expect(iconDirs({ rootDir: ROOT, flavor: 'lana-one' })).toEqual([path.join(ROOT, 'app-icons', 'icons-lana-one'), path.join(ROOT, 'build', 'icons-lana-one')]);
  });

  test('a packaged app uses app-icons/, a dev run build/', () => {
    const packaged = createAppIcon({ nativeImage: fakeNativeImage(), rootDir: ROOT, flavor: 'lana', fileExists: (f) => f === path.join(ROOT, 'app-icons', 'icons', 'icon-512.png') });
    expect(packaged.image().file).toBe(path.join(ROOT, 'app-icons', 'icons', 'icon-512.png'));
    const dev = createAppIcon({ nativeImage: fakeNativeImage(), rootDir: ROOT, flavor: 'lana-one', fileExists: (f) => f.startsWith(path.join(ROOT, 'build', 'icons-lana-one')) });
    expect(dev.image().file).toBe(path.join(ROOT, 'build', 'icons-lana-one', 'icon-512.png'));
  });

  test('the real source tree has both flavors\' icons', () => {
    const fs = require('fs');
    for (const flavor of ['lana', 'lana-one']) {
      const icon = createAppIcon({ nativeImage: fakeNativeImage(), rootDir: path.join(__dirname, '..', '..'), flavor, fileExists: fs.existsSync });
      expect(icon.image()).toBeDefined();
    }
  });

  test('cached, and undefined when the file is missing or the image is empty', () => {
    const nativeImage = fakeNativeImage();
    const icon = createAppIcon({ nativeImage, rootDir: ROOT, flavor: 'lana', fileExists: () => true });
    icon.image(); icon.image();
    expect(nativeImage.createFromPath).toHaveBeenCalledTimes(1);
    expect(createAppIcon({ nativeImage, rootDir: ROOT, flavor: 'lana', fileExists: () => false }).image()).toBeUndefined();
    const emptyAll = fakeNativeImage({ has: () => true });
    expect(createAppIcon({ nativeImage: emptyAll, rootDir: ROOT, flavor: 'lana', fileExists: () => true }).image()).toBeUndefined();
    const throwing = { createFromPath: () => { throw new Error('bad'); } };
    expect(createAppIcon({ nativeImage: throwing, rootDir: ROOT, flavor: 'lana', fileExists: () => true }).image()).toBeUndefined();
  });
});

describe('tracked dialogs get the LANA icon', () => {
  afterEach(() => setDialogIcon(null));

  test('the icon is passed on a tracked dialog', async () => {
    const icon = { lana: true };
    setDialogIcon(() => icon);
    const dialog = { showMessageBox: jest.fn(async () => ({ response: 0 })) };
    await trackedMessageBox(dialog, undefined, { message: 'Open this link?', buttons: ['Open', 'Cancel'], cancelId: 1 });
    expect(dialog.showMessageBox.mock.calls[0][0].icon).toBe(icon);
  });

  test('a caller\'s own icon wins; no icon available means none is set', async () => {
    setDialogIcon(() => ({ lana: true }));
    const own = { own: true };
    const dialog = { showMessageBox: jest.fn(async () => ({ response: 0 })) };
    await trackedMessageBox(dialog, { id: 1 }, { message: 'x', icon: own });
    expect(dialog.showMessageBox.mock.calls[0][1].icon).toBe(own);
    setDialogIcon(() => undefined);
    await trackedMessageBox(dialog, undefined, { message: 'y' });
    expect('icon' in dialog.showMessageBox.mock.calls[1][0]).toBe(false);
    setDialogIcon(() => { throw new Error('no icon'); });
    await expect(trackedMessageBox(dialog, undefined, { message: 'z' })).resolves.toEqual({ response: 0 });
  });
});

test('electron-main.js gives the dialogs and the dock the same icon', () => {
  const main = require('fs').readFileSync(path.join(__dirname, '..', '..', 'electron-main.js'), 'utf8');
  expect(main).toMatch(/const appIcon = createAppIcon\(\{ nativeImage, rootDir: __dirname, flavor: BRAND_FLAVOR \}\);/);
  expect(main).toMatch(/setDialogIcon\(\(\) => appIcon\.image\(\)\);/);
  expect(main).toMatch(/app\.dock\.setIcon\(appIcon\.image\(\{ dock: true \}\)\)/);
});
