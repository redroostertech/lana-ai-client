'use strict';

/**
 * The LANA icon as a nativeImage, for native dialogs (electron-confirm.js trackedMessageBox)
 * and the macOS dock. In a dev run the process is Electron.app, so without it dialogs and the
 * dock show Electron's icon.
 *
 * Where the PNGs are: a packaged app carries them as app-icons/<dir> (electron-builder copies
 * build/icons there, electron-builder.client.json "files"); a dev run reads build/<dir> in the
 * source tree. <dir> follows the brand flavor (src/js/brand/lana-brand.js): icons for LANA,
 * icons-lana-one for LANA One. The same layout on mac, Windows and Linux.
 */

const fs = require('fs');
const path = require('path');

// A dialog's icon: big enough for every platform's dialog. The dock takes the master.
const DIALOG_FILES = Object.freeze(['icon-512.png', 'icon-256.png', 'icon.png']);
const DOCK_FILES = Object.freeze(['icon-1024.png', 'icon-512.png', 'icon.png']);

function iconDirs({ rootDir, flavor }) {
  const dir = flavor === 'lana-one' ? 'icons-lana-one' : 'icons';
  return [path.join(rootDir, 'app-icons', dir), path.join(rootDir, 'build', dir)];
}

/**
 * @param {{ nativeImage: { createFromPath: Function }, rootDir: string, flavor: string, fileExists?: Function }} deps
 */
function createAppIcon({ nativeImage, rootDir, flavor, fileExists = fs.existsSync }) {
  const cache = new Map();

  function load(files) {
    for (const dir of iconDirs({ rootDir, flavor })) {
      for (const name of files) {
        const file = path.join(dir, name);
        if (!fileExists(file)) continue;
        try {
          const image = nativeImage.createFromPath(file);
          if (image && !image.isEmpty()) return image;
        } catch (_error) { /* try the next file */ }
      }
    }
    return undefined;
  }

  return {
    /** The icon, or undefined (the caller then uses the default). Cached. */
    image({ dock = false } = {}) {
      const key = dock ? 'dock' : 'dialog';
      if (!cache.has(key)) cache.set(key, load(dock ? DOCK_FILES : DIALOG_FILES));
      return cache.get(key);
    },
    /** The window icon file (icon-256.png), for BrowserWindow's icon option. */
    windowIconPath() {
      const dirs = iconDirs({ rootDir, flavor });
      return dirs.map((d) => path.join(d, 'icon-256.png')).find((file) => fileExists(file)) || path.join(dirs[0], 'icon-256.png');
    }
  };
}

module.exports = { createAppIcon, iconDirs };
