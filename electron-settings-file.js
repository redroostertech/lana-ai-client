'use strict';

/**
 * Opening the client's encrypted settings file (server-config.json): the saved server, the
 * sign-in token's ciphertext, local engine and Brainchild settings.
 *
 * Two rules, from 2026-11-05, when the file was lost twice on one Mac:
 *
 * 1. The key is built from things that do not change: the computer's hardware id (macOS
 *    IOPlatformUUID, Windows MachineGuid, Linux machine-id) and the home folder. It used to
 *    be built from the network host name, which macOS changes on a name conflict (for
 *    example `...-5066.local` to `...-5117.local`); after that the file could not be read.
 *    A file written with the old key (the current host name) is read once and rewritten with
 *    the new key.
 * 2. A file that cannot be read is never deleted: it is set aside next to itself as
 *    `server-config.unreadable-<time>.json` and the app starts with fresh settings, so it
 *    can still be recovered.
 *
 * Never log the file's contents or the keys.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KEY_SUFFIX = 'lana-ai-client-stable';

/** The key the client used before: host name and home folder. Kept to read older files once. */
function legacyKey({ hostname = os.hostname(), homedir = os.homedir() } = {}) {
  return crypto.createHash('sha256').update(`${hostname}-${homedir}-${KEY_SUFFIX}`).digest('hex');
}

/** This computer's hardware id, or null when it cannot be read. */
function machineId({ platform = process.platform, run = execFileSync, read = fs.readFileSync } = {}) {
  try {
    if (platform === 'darwin') {
      const out = String(run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 }));
      const match = /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{36})"/.exec(out);
      return match ? match[1].toUpperCase() : null;
    }
    if (platform === 'win32') {
      const out = String(run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', timeout: 5000 }));
      const match = /MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]{36})/.exec(out);
      return match ? match[1].toLowerCase() : null;
    }
    const id = String(read('/etc/machine-id', 'utf8')).trim();
    return /^[0-9a-f]{32}$/.test(id) ? id : null;
  } catch (_) {
    return null;
  }
}

/** The settings key: hardware id and home folder. Falls back to the legacy key when the id cannot be read. */
function stableKey({ id = machineId(), homedir = os.homedir(), legacy = legacyKey() } = {}) {
  if (!id) return legacy;
  return crypto.createHash('sha256').update(`${id}-${homedir}-${KEY_SUFFIX}-v2`).digest('hex');
}

/**
 * Opens the settings store. With the stable key first; else with the legacy key, then
 * rewrites the file with the stable key; else sets the file aside and starts fresh.
 *
 * @param {object} deps
 * @param {Function} deps.Store - electron-store
 * @param {object} deps.options - electron-store options without the key ({ name, defaults })
 * @param {string} deps.directory - the folder the file is in (the app's userData)
 * @param {string} deps.key - the stable key
 * @param {string} deps.legacy - the legacy key
 * @param {object} deps.log - { info, error }
 * @param {Function} [deps.now]
 * @returns {{ store: object, outcome: 'opened' | 'migrated' | 'setAside' }}
 */
function openSettingsStore({ Store, options, directory, key, legacy, log, now = () => new Date() }) {
  const file = path.join(directory, `${options.name}.json`);
  try {
    return { store: new Store({ ...options, encryptionKey: key, clearInvalidConfig: false }), outcome: 'opened' };
  } catch (_) {
    // Not readable with the stable key: an older file, or one that cannot be read at all.
  }
  if (legacy && legacy !== key) {
    try {
      const old = new Store({ ...options, encryptionKey: legacy, clearInvalidConfig: false });
      const data = { ...old.store };
      const backup = `${file}.migrating-${now().getTime()}`;
      fs.renameSync(file, backup);
      try {
        const store = new Store({ ...options, encryptionKey: key, clearInvalidConfig: false });
        store.store = data;
        fs.rmSync(backup, { force: true });
        log.info('[electron-settings] Settings moved to the stable key');
        return { store, outcome: 'migrated' };
      } catch (error) {
        // Put the original back: nothing is lost.
        fs.rmSync(file, { force: true });
        fs.renameSync(backup, file);
        throw error;
      }
    } catch (_) {
      // Not readable with the legacy key either.
    }
  }
  if (fs.existsSync(file)) {
    const aside = path.join(directory, `${options.name}.unreadable-${now().getTime()}.json`);
    fs.renameSync(file, aside);
    log.error(`[electron-settings] Settings could not be read; set aside as ${path.basename(aside)}, starting fresh`);
  }
  return { store: new Store({ ...options, encryptionKey: key, clearInvalidConfig: false }), outcome: 'setAside' };
}

module.exports = { openSettingsStore, stableKey, legacyKey, machineId };
