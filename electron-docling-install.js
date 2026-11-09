'use strict';

/**
 * Putting Docling on this computer (first-launch plan, Docling). Main process.
 *
 * Two downloads, both from models.lanaai.io, both pinned by size and sha256 in
 * docling/docling-runtime-pin.json and fetched by electron-model-download.js (resumed after a
 * cut, whole-file sha256, .verified notes, disk check):
 *
 *   the runtime  one archive per platform: a relocatable CPython 3.11 with docling-serve and
 *                its locked packages (scripts/build-docling-runtime.sh). Unpacked safely
 *                (electron-safe-untar.js) into <userData>/docling/runtime-<version>/, then the
 *                archive is deleted. A `.lana-installed` note inside names the archive's sha256.
 *   the models   layout, TableFormer and RapidOCR files into <userData>/docling/models/ (the
 *                same files and sha256s the servers use). A `.lana-complete` note names the set.
 *
 * Docling counts as installed only when both notes match the pin, so a half-done setup is never
 * started (electron-docling.js resolveDoclingCommand). A cut during the runtime download resumes;
 * a cut during the unpack unpacks again from the kept archive; a cut during the models resumes
 * at the file it stopped in. An older runtime-<version> folder is removed once the new one is in.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PIN = require('./docling/docling-runtime-pin.json');
const { downloadVerified, assertSpace } = require('./electron-model-download');
const { untarGz } = require('./electron-safe-untar');

const INSTALLED_NOTE = '.lana-installed';
const COMPLETE_NOTE = '.lana-complete';

/** "macos-arm64" and so on, or null when no runtime is built for this kind of computer. */
function platformKey(platform = process.platform, arch = process.arch) {
  const os = { darwin: 'macos', win32: 'windows', linux: 'linux' }[platform];
  const cpu = { arm64: 'arm64', x64: 'x64' }[arch];
  return os && cpu ? `${os}-${cpu}` : null;
}

/** The pinned runtime archive for this computer, or null when none is published for it. */
function runtimeEntry(key, pin = PIN) {
  const archive = key && pin.archives ? pin.archives[key] : null;
  return archive ? { id: `docling-runtime-${key}`, version: pin.runtimeVersion, ...archive } : null;
}

function modelFiles(pin = PIN) {
  return pin.models.files.map((file) => ({ ...file, url: `${pin.models.baseUrl}/${file.path}` }));
}

/** Names the model set, so a changed pin is never mistaken for a finished one. */
function modelSetId(pin = PIN) {
  const hash = crypto.createHash('sha256');
  for (const file of pin.models.files) {hash.update(`${file.path}\0${file.sizeBytes}\0${file.sha256}\n`);}
  return hash.digest('hex');
}

function paths(userDataDir, pin = PIN) {
  const root = path.join(userDataDir, 'docling');
  return {
    root,
    runtime: path.join(root, `runtime-${pin.runtimeVersion}`),
    models: path.join(root, 'models'),
    downloads: path.join(root, 'downloads')
  };
}

/**
 * Sizes for planning (src/js/local-ai-fit.model.js): bytes to download, and disk needed at the
 * busiest moment (the archive and its unpacked copy are both on disk until the archive goes).
 * Null when no runtime is published for this computer.
 */
function sizes(key, pin = PIN) {
  const entry = runtimeEntry(key, pin);
  if (!entry) {return null;}
  const models = pin.models.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  return { downloadBytes: entry.sizeBytes + models, diskBytes: entry.sizeBytes + entry.unpackedBytes + models };
}

function readJson(file, fsImpl) {
  try { return JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch (_error) { return null; }
}

function runtimeInstalled(userDataDir, key, { pin = PIN, fsImpl = fs } = {}) {
  const entry = runtimeEntry(key, pin);
  const note = entry ? readJson(path.join(paths(userDataDir, pin).runtime, INSTALLED_NOTE), fsImpl) : null;
  return Boolean(note && note.sha256 === entry.sha256 && note.version === entry.version);
}

function modelsInstalled(userDataDir, { pin = PIN, fsImpl = fs } = {}) {
  const note = readJson(path.join(paths(userDataDir, pin).models, COMPLETE_NOTE), fsImpl);
  return Boolean(note && note.set === modelSetId(pin));
}

/** True when the runtime for this computer and every model are in place (synchronous: read at launch). */
function isInstalled(userDataDir, key, options = {}) {
  return runtimeInstalled(userDataDir, key, options) && modelsInstalled(userDataDir, options);
}

/** How to start the installed runtime (lana-runtime.json "entry"), or null. */
function installedEntry(userDataDir, key, options = {}) {
  if (!isInstalled(userDataDir, key, options)) {return null;}
  const { pin = PIN, fsImpl = fs } = options;
  const dir = paths(userDataDir, pin).runtime;
  const manifest = readJson(path.join(dir, 'lana-runtime.json'), fsImpl);
  if (!manifest || !Array.isArray(manifest.entry) || !manifest.entry.length) {return null;}
  const [program, ...args] = manifest.entry;
  return { dir, models: paths(userDataDir, pin).models, program: path.join(dir, ...program.split('/')), args };
}

/**
 * Download and unpack what is missing. Progress counts downloaded bytes across the runtime and
 * the models (the unpack is quick and reported as its own step).
 * @param {Object} opts
 * @param {string} opts.userDataDir
 * @param {string} opts.key - platformKey()
 * @param {AbortSignal} [opts.signal]
 * @param {() => number|null} [opts.freeBytes] - free disk space now
 * @param {(p: { received: number, total: number, step: 'runtime'|'unpack'|'models' }) => void} [opts.onProgress]
 * @param {Object} [deps] - { download, fsImpl, pin, untar } for tests
 */
async function install({ userDataDir, key, signal, freeBytes = () => null, onProgress = () => {} }, deps = {}) {
  const { download = downloadVerified, fsImpl = fs, pin = PIN, untar = untarGz } = deps;
  const entry = runtimeEntry(key, pin);
  if (!entry) {throw Object.assign(new Error('Reading documents on this computer is not ready for this kind of computer yet.'), { code: 'unavailable' });}
  const where = paths(userDataDir, pin);
  const files = modelFiles(pin);
  const total = entry.sizeBytes + files.reduce((sum, file) => sum + file.sizeBytes, 0);
  let done;

  if (!runtimeInstalled(userDataDir, key, { pin, fsImpl })) {
    const archive = path.join(where.downloads, `runtime-${entry.version}-${key}.tar.gz`);
    await download(entry, archive, {
      signal,
      freeBytes: freeBytes(),
      onProgress: ({ received }) => onProgress({ received: Math.min(received, entry.sizeBytes), total, step: 'runtime' })
    });
    // The unpacked copy sits beside the archive until the archive is deleted.
    assertSpace(entry.unpackedBytes, freeBytes());
    onProgress({ received: entry.sizeBytes, total, step: 'unpack' });
    await untar(archive, where.runtime, { maxBytes: entry.unpackedBytes, signal });
    await fsImpl.promises.writeFile(path.join(where.runtime, INSTALLED_NOTE), JSON.stringify({ version: entry.version, sha256: entry.sha256, platform: key }));
    await fsImpl.promises.rm(archive, { force: true });
    await fsImpl.promises.rm(`${archive}.verified`, { force: true });
    await removeOtherRuntimes(where, fsImpl);
  }
  done = entry.sizeBytes;
  onProgress({ received: done, total, step: 'models' });

  if (!modelsInstalled(userDataDir, { pin, fsImpl })) {
    for (const file of files) {
      const target = path.join(where.models, ...file.path.split('/'));
      const startAt = done;
      await download(file, target, {
        signal,
        freeBytes: freeBytes(),
        onProgress: ({ received }) => onProgress({ received: startAt + Math.min(received, file.sizeBytes), total, step: 'models' })
      });
      done += file.sizeBytes;
    }
    await fsImpl.promises.writeFile(path.join(where.models, COMPLETE_NOTE), JSON.stringify({ set: modelSetId(pin) }));
  }
  onProgress({ received: total, total, step: 'models' });
  return installedEntry(userDataDir, key, { pin, fsImpl });
}

/** Older runtime-<version> folders (and their .partial leftovers) under <userData>/docling. */
async function removeOtherRuntimes(where, fsImpl) {
  const keep = path.basename(where.runtime);
  let names = [];
  try { names = await fsImpl.promises.readdir(where.root); } catch (_error) { return; }
  for (const name of names) {
    if (/^runtime-[A-Za-z0-9.+-]+$/.test(name) && name !== keep) {
      await fsImpl.promises.rm(path.join(where.root, name), { recursive: true, force: true });
    }
  }
}

module.exports = {
  PIN, platformKey, runtimeEntry, modelFiles, modelSetId, paths, sizes,
  runtimeInstalled, modelsInstalled, isInstalled, installedEntry, install
};
