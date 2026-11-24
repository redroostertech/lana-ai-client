'use strict';

/**
 * The release's local state file: what this machine has finished, so a rerun
 * picks up where the last run stopped. It never holds a secret or a link.
 *
 *   ~/.lana-release/<version>/state.json   (folder 700, file 600)
 *
 * --work-dir <dir> (or LANA_RELEASE_HOME) moves the whole release folder, for
 * a computer whose main disk is small: it holds sources, builds and archives.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function releaseDir(version, home = os.homedir(), base = null) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) {
    throw new Error(`The version must look like 4.2.0, three numbers. Got "${version}".`);
  }
  return path.join(base || path.join(home, '.lana-release'), version);
}

function emptyState(version) {
  return { version, phases: {}, pieces: {}, newEntries: {}, desk: [], uploaded: [], notes: [] };
}

function loadState(version, home, base) {
  const file = path.join(releaseDir(version, home, base), 'state.json');
  if (!fs.existsSync(file)) {return emptyState(version);}
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...emptyState(version), ...data };
}

function saveState(state, home, base) {
  const dir = releaseDir(state.version, home, base);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'state.json');
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  return file;
}

/** Records a finished phase and the Release Desk keys it finished. */
function markPhase(state, phase, deskKeys = []) {
  state.phases[phase] = { done: true, at: new Date().toISOString() };
  for (const key of deskKeys) {if (!state.desk.includes(key)) {state.desk.push(key);}}
}

module.exports = { releaseDir, emptyState, loadState, saveState, markPhase };
