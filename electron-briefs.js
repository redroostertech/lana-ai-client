'use strict';

/**
 * LANA Briefs in the client's main process (Briefs integration plan, phase 1).
 *
 * Briefs runs only while the organization's discovery `enabled_apps` lists `lana-notes`
 * (the saved server's `enabledApps`, refreshed at launch and on sign-in) and someone is
 * signed in. `sync(server)` starts the host when both hold and stops it when either goes
 * away (`sync(null)` on sign-out). While it is off nothing of Briefs is loaded: no IPC, no
 * microphone or meeting audio handler, no phone listener, no speech model download.
 *
 * Each person has their own Briefs folder (`userData/briefs/people/<key>`, the key a hash
 * of the organization and user ids in their session), so on a shared computer the next
 * person never opens the previous person's meetings, phone pairing or session. A different
 * person signing in stops the previous host first.
 *
 * There is one session, the client's. Briefs has no sign-in, token or sign-out of its own: it
 * reads the client's session when it needs it, is told when it changes (sign-in, a refreshed
 * token), and when the person's session ends (sign-out, or another person signing in) it
 * revokes the phones' background access before it stops. Turning Briefs off for the firm
 * only stops it.
 *
 * Starts and stops run one at a time, in order. A start that fails is cleaned up by the
 * host itself; a restore that fails stops the host it started.
 *
 * The host is TypeScript (briefs/packages/host), built to briefs/dist by
 * scripts/build-briefs.js and loaded only when it starts. Its language model work goes to
 * LANA's runtime: the local AI engine's route, with the person's own session.
 *
 * Never log tokens, ids, transcript text or names: states only.
 */

const crypto = require('crypto');
const { execFile } = require('child_process');
const { speechPackages } = require('./electron-local-models');
const path = require('path');

const BRIEFS_APP_ID = 'lana-notes';
// Must match AUDIO_SCHEME in briefs/packages/host/src/main/services/meetingAudio.ts
// (tests/unit/electron-briefs.test.js checks). Registered before the app is ready without
// loading the host, so Briefs costs nothing at launch while it is off.
const BRIEFS_AUDIO_SCHEME = 'lana-audio';

function appId(item) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return '';
  return String(item.id || item.app_id || item.slug || item.key || '').trim();
}

/** Whether the saved server's discovery lists LANA Briefs. */
function isBriefsEnabled(server) {
  return Boolean(server && Array.isArray(server.enabledApps) && server.enabledApps.some((item) => appId(item) === BRIEFS_APP_ID));
}

/** The client's own pages are file:// pages (as the token store trusts them). */
function isClientPage(url) {
  try {
    return new URL(url).protocol === 'file:';
  } catch (_) {
    return false;
  }
}

/** The claims of a session token (read, not verified: LANA checks the token), or null. */
function claimsOf(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function text(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** Who a token belongs to: organization and user ids, email and name when the token carries them. */
function personOf(token) {
  const claims = claimsOf(token);
  if (!claims) return null;
  const id = text(claims.userId || claims.user_id || claims.sub);
  if (!id) return null;
  return {
    id,
    organizationID: text(claims.organizationId || claims.organization_id || claims.org),
    email: text(claims.email),
    firstName: text(claims.firstName || claims.first_name),
    lastName: text(claims.lastName || claims.last_name)
  };
}

/** The person a session token belongs to, as a folder name: a hash of their organization and user ids. Null when it names no person. */
function personKey(token) {
  const person = personOf(token);
  return person ? crypto.createHash('sha256').update(`${person.organizationID}:${person.id}`).digest('hex').slice(0, 24) : null;
}

/**
 * The client's one session as Briefs reads it, or null when signed out: the token, where
 * LANA calls go (the client's API base) and who is signed in. Never logged.
 */
function sessionSnapshot(token, apiBase, server) {
  const person = personOf(token);
  if (!person || !apiBase) return null;
  return {
    token,
    apiBase,
    user: { ...person, organizationName: text(server && server.orgName) }
  };
}

/**
 * The password of a macOS keychain item, read with the system's `security` tool (no shell).
 * macOS asks the person to allow it. Null when they decline or there is none. Never logged.
 */
function readKeychainPassword(service) {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { timeout: 120000 }, (error, stdout) => {
      resolve(error ? null : String(stdout).replace(/\n$/, '') || null);
    });
  });
}

/** Where the packaged app keeps files unpacked from asar (the transcription worker loads sherpa from there). */
function unpacked(file) {
  return file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

/** A window that has finished loading a page (Briefs' tone and prompts need one). */
function isLoaded(window) {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isLoading() && window.webContents.getURL());
}

/**
 * @param {object} deps
 * @param {object} deps.electron - { app, session, protocol, desktopCapturer, systemPreferences, shell, dialog, safeStorage, nativeTheme }
 * @param {function} deps.loadHost - () => the built host module (briefs/dist/briefs-host.cjs)
 * @param {string} deps.distDir - the folder holding the built bundles
 * @param {function} deps.engineBase - () => the local AI engine's URL while it is in use, else null
 * @param {function} deps.apiBase - () => the client's API base (the engine, which forwards to the firm's server, or the server)
 * @param {function} deps.getServer - () => the saved server (discovery), or null
 * @param {function} deps.getToken - () => the person's LANA session token, or null
 * @param {function} [deps.readKeychainPassword] - tests: stands in for the macOS keychain
 * @param {function} deps.getWindows - () => the open BrowserWindows
 * @param {function} deps.showWindow
 * @param {object} deps.log - { info, warn, error }
 */
function createBriefs(deps) {
  const { electron, log } = deps;
  let host = null;
  let hostKey = null;
  let queue = Promise.resolve();
  // Ends a start's wait for a loaded window (a stop or a switch is queued behind it).
  let cancelWait = null;
  let startingKey = null;

  // Every client window gets Briefs' events while it runs and tells it about focus.
  electron.app.on('browser-window-created', (_event, window) => {
    if (host) host.addWebContents(window.webContents);
  });
  electron.app.on('browser-window-focus', () => host && host.focused());
  electron.app.on('browser-window-blur', () => host && host.blurred());

  function bleHelperPath() {
    if (process.platform !== 'darwin') return null;
    // Built by scripts/build-briefs-ble-helper.js; shipped as an extra resource.
    const helper = electron.app.isPackaged
      ? path.join(process.resourcesPath, 'briefs', 'LanaBleWake')
      : path.join(__dirname, 'build', 'briefs', 'LanaBleWake');
    try {
      return require('fs').existsSync(helper) ? helper : null;
    } catch (_) {
      return null;
    }
  }

  /** Resolves true once a client window has loaded a page, or false when cancelled. */
  function windowLoaded() {
    if (deps.getWindows().some(isLoaded)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (loaded) => {
        electron.app.removeListener('browser-window-created', watch);
        cancelWait = null;
        resolve(loaded);
      };
      const check = () => {
        if (deps.getWindows().some(isLoaded)) done(true);
      };
      cancelWait = () => done(false);
      const watch = (_event, window) => window.webContents.once('did-finish-load', check);
      electron.app.on('browser-window-created', watch);
      for (const window of deps.getWindows()) {
        if (!window.isDestroyed()) window.webContents.once('did-finish-load', check);
      }
    });
  }

  function addOpenWindows() {
    for (const window of deps.getWindows()) {
      if (!window.isDestroyed()) host.addWebContents(window.webContents);
    }
  }

  async function start(key) {
    startingKey = key;
    try {
      await open(key);
    } finally {
      startingKey = null;
    }
  }

  /**
   * The one-time import from the standalone LANA Briefs app (1e): only into a person folder
   * that does not exist yet, only the person the old app was signed in as, and only while
   * the old app is closed. macOS asks the person to allow LANA to open the old app's
   * keystore entry. The outcome is logged as a state only.
   */
  async function importFromStandalone(module, directory) {
    const person = personOf(deps.getToken());
    if (!person || typeof module.importStandalone !== 'function') return;
    try {
      const outcome = await module.importStandalone({
        sources: module.standaloneSources(electron.app.getPath('appData')),
        target: directory,
        person: { id: person.id, email: person.email },
        readOldKey: deps.readKeychainPassword || readKeychainPassword,
        sealer: module.safeStorageSealer(electron.safeStorage)
      });
      if (outcome !== 'targetExists' && outcome !== 'notFound' && outcome !== 'unsupported') log.info(`[briefs] standalone import: ${outcome}`);
    } catch (_) {
      log.error('[briefs] standalone import failed');
    }
  }

  async function open(key) {
    const module = deps.loadHost();
    const directory = path.join(electron.app.getPath('userData'), 'briefs', 'people', key);
    await importFromStandalone(module, directory);
    const started = await module.startBriefsHost({
      electron: {
        app: electron.app,
        session: electron.session.defaultSession,
        protocol: electron.protocol,
        desktopCapturer: electron.desktopCapturer,
        systemPreferences: electron.systemPreferences,
        shell: electron.shell,
        dialog: electron.dialog,
        safeStorage: electron.safeStorage
      },
      directory,
      isTrustedURL: isClientPage,
      engineBase: () => deps.engineBase(),
      session: () => sessionSnapshot(deps.getToken() || null, deps.apiBase(), deps.getServer()),
      // The one model catalog: Briefs downloads its speech models from the client's pinned list.
      speechPackages: speechPackages(),
      transcriptionWorker: unpacked(path.join(deps.distDir, 'briefs-transcription-worker.cjs')),
      bleHelper: bleHelperPath(),
      showWindow: deps.showWindow,
      quit: () => electron.app.quit(),
      applyTheme: (theme) => { electron.nativeTheme.themeSource = theme; },
      documentsPath: electron.app.getPath('documents')
    });
    host = started;
    hostKey = key;
    addOpenWindows();
    try {
      // The host reads its saved session and opens the phone gateway once a page is there
      // to play the pairing tone and show prompts.
      if (!(await windowLoaded())) return;
      addOpenWindows();
      await started.restore();
    } catch (error) {
      host = null;
      hostKey = null;
      await started.stop().catch(() => {});
      throw error;
    }
  }

  /** `ended`: the person's session ended (sign-out, another person), so the phones' background access goes first. */
  async function stopHost(ended = false) {
    const running = host;
    if (!running) return;
    if (ended) await running.endSession().catch(() => log.error('[briefs] session end failed'));
    await running.stop();
    if (host === running) {
      host = null;
      hostKey = null;
    }
  }

  function enqueue(work) {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }

  /** Starts, stops or switches Briefs to match the saved server (null: signed out or no server). */
  function wantedKey(server) {
    const token = deps.getToken();
    return isBriefsEnabled(server) && token ? personKey(token) : null;
  }

  function sync(server) {
    // A start waiting for a window gives way only when what is wanted changed (signed out,
    // turned off, another person); a token refresh for the same person lets it finish.
    if (cancelWait && wantedKey(server) !== startingKey) cancelWait();
    return enqueue(async () => {
      const key = wantedKey(server);
      if (host && hostKey === key) {
        // Same person: a sign-in event or a refreshed token. Briefs reads the session again.
        host.sessionChanged();
        return;
      }
      if (host && hostKey !== key) {
        // Signed out, or another person signed in: their session ended. Turned off for the firm: it only stops.
        const token = deps.getToken();
        const ended = !token || personKey(token) !== hostKey;
        try {
          await stopHost(ended);
          log.info('[briefs] stopped');
        } catch (_) {
          log.error('[briefs] stop failed');
        }
      }
      if (key && !host) {
        try {
          await start(key);
          log.info('[briefs] started');
        } catch (error) {
          log.error(`[briefs] did not start: ${error && error.name ? error.name : 'error'}`);
        }
      }
    });
  }

  return {
    sync,
    isRunning: () => host !== null,
    /** Quit: waits for any start or stop in progress, then drains calls and closes the store. */
    stop: () => {
      if (cancelWait) cancelWait();
      return enqueue(() => stopHost());
    }
  };
}

/** Before the app is ready: the replay audio scheme must be registered early. Loads nothing of Briefs. */
function registerBriefsSchemes(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: BRIEFS_AUDIO_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
}

module.exports = { createBriefs, registerBriefsSchemes, isBriefsEnabled, isClientPage, personKey, sessionSnapshot, BRIEFS_APP_ID, BRIEFS_AUDIO_SCHEME };
