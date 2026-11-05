'use strict';

/**
 * LANA Briefs in the client's main process (Briefs integration plan, phase 1).
 *
 * Briefs runs only while the organization's discovery `enabled_apps` lists `lana-notes`
 * (the saved server's `enabledApps`, refreshed at launch and on sign-in). `sync(server)`
 * starts the host when it is listed and stops it when it is not, or when the person signs
 * out (`sync(null)`). While it is off there is no Briefs IPC, no microphone or meeting audio
 * handler, no phone listener and no speech model download.
 *
 * The host itself is TypeScript (briefs/packages/host), built to briefs/dist by
 * scripts/build-briefs.js. Its language model work goes to LANA's runtime: the local AI
 * engine's route, with the person's own session.
 *
 * Never log tokens, transcript text or names: ids and states only.
 */

const path = require('path');

const BRIEFS_APP_ID = 'lana-notes';

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

/** Where the packaged app keeps files unpacked from asar (the transcription worker loads sherpa from there). */
function unpacked(file) {
  return file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

/**
 * @param {object} deps
 * @param {object} deps.electron - { app, session, protocol, desktopCapturer, systemPreferences, shell, dialog, safeStorage, nativeTheme }
 * @param {function} deps.loadHost - () => the built host module (briefs/dist/briefs-host.cjs)
 * @param {string} deps.distDir - the folder holding the built bundles
 * @param {function} deps.engineBase - () => the local AI engine's URL while it is in use, else null
 * @param {function} deps.getToken - () => the person's LANA session token, or null
 * @param {function} deps.getWindows - () => the open BrowserWindows
 * @param {function} deps.showWindow
 * @param {object} deps.log - { info, warn, error }
 */
function createBriefs(deps) {
  const { electron, log } = deps;
  let host = null;
  let starting = null;
  let stopping = null;
  let wanted = false;

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

  async function start() {
    const module = deps.loadHost();
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
      directory: path.join(electron.app.getPath('userData'), 'briefs'),
      isTrustedURL: isClientPage,
      lanaRuntime: { engineBase: () => deps.engineBase(), token: () => deps.getToken() || null },
      transcriptionWorker: unpacked(path.join(deps.distDir, 'briefs-transcription-worker.cjs')),
      bleHelper: bleHelperPath(),
      showWindow: deps.showWindow,
      quit: () => electron.app.quit(),
      applyTheme: (theme) => { electron.nativeTheme.themeSource = theme; },
      documentsPath: electron.app.getPath('documents')
    });
    for (const window of deps.getWindows()) {
      if (!window.isDestroyed()) started.addWebContents(window.webContents);
    }
    await started.restore();
    return started;
  }

  async function stopHost() {
    if (starting) await starting.catch(() => null);
    const running = host;
    host = null;
    if (running) await running.stop();
  }

  /**
   * Starts or stops Briefs to match the saved server (null: signed out or no server).
   * Calls never overlap: a start waits for a stop in progress and the other way round.
   */
  async function sync(server) {
    wanted = isBriefsEnabled(server) && Boolean(deps.getToken());
    if (stopping) await stopping;
    if (wanted && !host && !starting) {
      starting = start().then((started) => {
        host = started;
        log.info('[briefs] started');
        return started;
      }, (error) => {
        log.error(`[briefs] did not start: ${error && error.name ? error.name : 'error'}`);
        return null;
      }).finally(() => {
        starting = null;
      });
      await starting;
      if (!wanted && host) await sync(null);
      return;
    }
    if (!wanted && (host || starting)) {
      stopping = stopHost().then(() => log.info('[briefs] stopped'), () => log.error('[briefs] stop failed')).finally(() => {
        stopping = null;
      });
      await stopping;
    }
  }

  return {
    sync,
    isRunning: () => host !== null,
    /** A new client window: it gets Briefs' events while Briefs runs. */
    addWindow(window) {
      if (host && window && !window.isDestroyed()) host.addWebContents(window.webContents);
      if (!window) return;
      window.on('focus', () => host && host.focused());
      window.on('blur', () => host && host.blurred());
    },
    /** Quit: drain calls in flight and close the store. */
    stop: () => {
      wanted = false;
      return stopHost();
    }
  };
}

/** Before the app is ready: the replay audio scheme must be registered early. */
function registerBriefsSchemes(protocol, loadHost) {
  try {
    loadHost().registerBriefsSchemes(protocol);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { createBriefs, registerBriefsSchemes, isBriefsEnabled, isClientPage, BRIEFS_APP_ID };
