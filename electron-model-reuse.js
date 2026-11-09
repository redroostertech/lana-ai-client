'use strict';

/**
 * Model files already on this computer that LANA can use instead of downloading them again
 * (first-launch plan, phase D). Main process.
 *
 *   searchFolders({ platform, home, env })   where other apps keep model files: Pip Desktop,
 *                                            ~/.llama-models, LM Studio
 *   findCandidates({ entries, folders })     files whose name and exact size match a model
 *                                            LANA would download
 *   verifyCandidates(candidates, { checksFile })  the ones whose SHA-256 matches the pin.
 *                                            Each file is hashed once: the result is kept in
 *                                            LANA's own folder (checksFile), keyed by path, size
 *                                            and change time, never next to the other app's file
 *   placeFound({ entry, source, modelsDir }) puts a checked file in LANA's models folder: a hard
 *                                            link on the same disk, else a copy that is checked
 *                                            again. The original is never moved or changed.
 */

const fs = require('fs');
const path = require('path');
const { sha256OfFile, isVerified } = require('./electron-model-download');

const MAX_DEPTH = 4; // LM Studio: models/<publisher>/<repo>/<file>

/** Folders to look in, with a plain name for each. */
function searchFolders({ platform = process.platform, home, env = process.env }) {
  const pip = platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'LQE', 'models')
    : platform === 'win32'
      ? path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Pip.cpp', 'runtime', 'models')
      : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Pip.cpp', 'runtime', 'models');
  return [
    { dir: pip, source: 'Pip' },
    { dir: path.join(home, '.llama-models'), source: 'another folder' },
    { dir: path.join(home, '.lmstudio', 'models'), source: 'LM Studio' },
    { dir: path.join(home, '.cache', 'lm-studio', 'models'), source: 'LM Studio' }
  ];
}

async function walk(dir, depth, fsImpl, visit) {
  let items;
  try { items = await fsImpl.promises.readdir(dir, { withFileTypes: true }); } catch (_error) { return; }
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isFile()) {await visit(full, item.name);}
    else if (item.isDirectory() && depth < MAX_DEPTH) {await walk(full, depth + 1, fsImpl, visit);}
  }
}

/**
 * Files named like a catalog entry with its exact size. One candidate per entry (the first found).
 * @param {Object} input
 * @param {Object[]} input.entries   { id, filename, sizeBytes, sha256 }
 * @param {{dir: string, source: string}[]} input.folders
 * @param {string} [input.skipDir]   LANA's own models folder: what is there is already in place
 */
async function findCandidates({ entries, folders, skipDir = null, fsImpl = fs }) {
  const byName = new Map(entries.map((entry) => [entry.filename, entry]));
  const found = new Map();
  const skip = skipDir ? path.resolve(skipDir) : null;
  for (const folder of folders) {
    if (skip && path.resolve(folder.dir) === skip) {continue;}
    await walk(folder.dir, 1, fsImpl, async (file, name) => {
      const entry = byName.get(name);
      if (!entry || found.has(entry.id)) {return;}
      let stat;
      try { stat = await fsImpl.promises.stat(file); } catch (_error) { return; }
      if (stat.size === entry.sizeBytes) {found.set(entry.id, { entry, path: file, source: folder.source });}
    });
  }
  return [...found.values()];
}

async function readChecks(checksFile, fsImpl) {
  try { return JSON.parse(await fsImpl.promises.readFile(checksFile, 'utf8')) || {}; } catch (_error) { return {}; }
}

/**
 * The candidates whose SHA-256 is the pinned one. A file already checked at the same size and
 * change time is not hashed again.
 */
async function verifyCandidates(candidates, { checksFile, fsImpl = fs }) {
  const checks = await readChecks(checksFile, fsImpl);
  const verified = [];
  let changed = false;
  for (const candidate of candidates) {
    let stat;
    try { stat = await fsImpl.promises.stat(candidate.path); } catch (_error) { continue; }
    const known = checks[candidate.path];
    let sha256 = known && known.sizeBytes === stat.size && known.mtimeMs === stat.mtimeMs ? known.sha256 : null;
    if (!sha256) {
      try { sha256 = await sha256OfFile(candidate.path, fsImpl); } catch (_error) { continue; }
      checks[candidate.path] = { sha256, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
      changed = true;
    }
    if (sha256 === candidate.entry.sha256) {verified.push(candidate);}
  }
  if (changed) {
    await fsImpl.promises.mkdir(path.dirname(checksFile), { recursive: true });
    await fsImpl.promises.writeFile(checksFile, JSON.stringify(checks));
  }
  return verified;
}

/**
 * Put a checked file in LANA's models folder without downloading it. Hard link when the file is
 * on the same disk, else a copy. Either way the result is checked against the pin.
 * @returns {Promise<'linked'|'copied'|'present'>}
 */
async function placeFound({ entry, source, modelsDir, fsImpl = fs }) {
  const target = path.join(modelsDir, entry.filename);
  if (await isVerified(target, entry, fsImpl)) {return 'present';}
  await fsImpl.promises.mkdir(modelsDir, { recursive: true });
  const [from, dir] = await Promise.all([fsImpl.promises.stat(source), fsImpl.promises.stat(modelsDir)]);
  let how = 'copied';
  // A file left at the target (a partial copy, an old file) is LANA's own: replace it.
  await fsImpl.promises.rm(target, { force: true });
  if (from.dev === dir.dev) {
    try { await fsImpl.promises.link(source, target); how = 'linked'; } catch (_error) { how = 'copied'; }
  }
  if (how === 'copied') {await fsImpl.promises.copyFile(source, target);}
  if (!(await isVerified(target, entry, fsImpl))) {
    await fsImpl.promises.rm(target, { force: true });
    throw new Error(`The copy of ${entry.filename} did not match, so it was removed.`);
  }
  return how;
}

module.exports = { searchFolders, findCandidates, verifyCandidates, placeFound };
