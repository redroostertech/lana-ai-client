'use strict';

/**
 * Every renderer-to-main IPC channel of the client's own windows, and what a
 * call must look like (docs/plans/harden-ipc.md). electron-ipc-guard.js
 * refuses a channel that is not listed here, a sender that is not the top
 * frame of an app page, and arguments that do not match.
 *
 *   kind     'invoke' (ipcRenderer.invoke), 'sync' (sendSync) or 'send' (send)
 *   args     one validator per argument; extra arguments are refused
 *   pages    only these pages (paths inside public_html) may call it
 *   gesture  the person clicked or typed in that window in the last 30 seconds
 *
 * Pages inside the app shell (app.html) keep app.html as their URL, so a page
 * limit is set only for standalone pages (sign-in and the app-link pages).
 *
 * The preloads (electron-preload.js, screen-voice-preload.js) name these
 * channels as literals; tests/unit/ipc-allowlist.test.js keeps the three in step.
 */

const { V } = require('./electron-ipc-guard');
const { MAX_TOKEN_LENGTH } = require('./electron-token-store');

const URL_MAX = 8192;
const SMALL = 4 * 1024;
const MEDIUM = 64 * 1024;
const LARGE = 256 * 1024;

// The pages that find and save the firm this app connects to.
const SERVER_PAGES = Object.freeze(['login.html', 'accept-invite.html', 'activate.html', 'mfa-setup.html', 'shared-link.html']);
// The pages that look a firm up through hosted discovery.
const DISCOVERY_PAGES = Object.freeze(['login.html', 'activate.html']);

const invoke = (args = [], extra = {}) => Object.freeze({ kind: 'invoke', args, ...extra });
const none = invoke();
const obj = (maxBytes = SMALL) => [V.object(maxBytes)];

const IPC_POLICY = Object.freeze({
  // App basics and logging
  'get-config': none,
  'get-version': none,
  'renderer-log-error': invoke([V.string(SMALL * 4), V.optional(V.small(MEDIUM))]),
  'renderer-log-info': invoke([V.string(SMALL * 4)]),

  // Login token (electron-token-store.js). Any app page: sign-in sets it,
  // every page's token refresh sets it, sign-out clears it.
  'auth-token:get': Object.freeze({ kind: 'sync', args: [] }),
  'auth-token:set': Object.freeze({ kind: 'sync', args: [V.optional(V.string(MAX_TOKEN_LENGTH))] }),
  'auth-token:clear': Object.freeze({ kind: 'sync', args: [] }),
  'auth-token:migrate': Object.freeze({ kind: 'sync', args: [V.string(MAX_TOKEN_LENGTH)] }),

  // The firm this app connects to (server repoint): sign-in and app-link pages only.
  'save-settings': invoke(obj(LARGE), { pages: SERVER_PAGES }),
  'chef-pin:prepare': invoke(obj(), { pages: SERVER_PAGES }),
  'chef-pin:refusal': invoke([V.optional(V.string(URL_MAX))]),
  // Hosted discovery, asked by main so the firm's service keys never reach a page. The pages
  // that look a firm up: sign-in and account activation. The handler checks the fields.
  'discovery:resolve': invoke(obj(), { pages: DISCOVERY_PAGES }),
  // A connect link's org id that arrived before the sign-in page showed (electron-main.js).
  'connect-link:take': invoke([], { pages: ['login.html'] }),
  'get-saved-server': none,
  'app-links:login-context': none,
  'app-links:take-pending': invoke(obj()),
  'engine:api-base-sync': Object.freeze({ kind: 'sync', args: [] }),
  'editor-service:base-url-sync': Object.freeze({ kind: 'sync', args: [] }),

  // Local AI engine (electron-local-engine.js)
  'engine:status': none,
  'engine:restart': none,
  'engine:set-enabled': invoke(obj()),
  'engine:set-background-jobs': invoke(obj()),
  'engine:background-jobs': none,

  // Appearance (electron-appearance.js)
  'appearance:get': none,
  'appearance:set': invoke([V.string(32)]),

  // First-launch setup and Settings > Capabilities (electron-first-launch-ipc.js)
  'first-launch:plan': none,
  'first-launch:choose': invoke(obj()),
  'first-launch:find-existing': none,
  'first-launch:continue': invoke(obj()),
  'first-launch:pause': none,
  'first-launch:resume': none,
  'first-launch:status': none,
  'first-launch:capabilities': none,
  'first-launch:servers': none,
  'first-launch:switch-chat': invoke(obj()),
  // Try again on a stopped local server (Settings > Capabilities; the first-launch screen).
  'first-launch:retry-server': invoke(obj(), { pages: ['settings-v2.html', 'first-launch.html'] }),

  // Settings > Screen diction
  'capabilities:list': none,
  'capabilities:set-active': invoke(obj()),
  'capabilities:set-open-at-login': invoke(obj()),
  'capabilities:get-voice-settings': none,
  'capabilities:set-voice-settings': invoke(obj(MEDIUM)),
  'capabilities:get-voice-permissions': none,
  'capabilities:request-voice-permission': invoke(obj()),

  // Settings > General > Location (electron-location.js)
  'location:get-choice': none,
  'location:set-choice': invoke(obj()),
  'location:system': none,
  'location:open-system-settings': invoke([], { gesture: true }),

  // Updates. The page never names the update server: the saved firm's is used.
  'check-updates': invoke([V.nullish()]),
  'install-update': invoke([V.nullish()], { gesture: true }),
  'settings:system-info': none,
  'settings:ai-topology': none,
  'settings:update-status': none,
  'settings:check-for-updates': none,
  'settings:install-update': invoke([], { gesture: true }),
  // The update window's buttons (electron-updater-custom.js checks it is that window).
  'update-dialog-response': Object.freeze({ kind: 'send', args: [V.oneOf(['update', 'later', 'skip', 'retry'])], pages: ['update-dialog.html'] }),

  // Session tracking (js/session/session-tracker.js). Main supplies the API base and token.
  'session-tracker:initialize': none,
  'session-tracker:start': none,

  // Shell: the system browser (src/electron-external-url.js limits the schemes).
  // A recent click or the app's own dialog, and a rate limit: electron-external-open.js.
  'open-external-url': invoke([V.string(URL_MAX)]),

  // Brainchild vault (file system)
  'brainchild:discover': none,
  'brainchild:link': invoke(obj()),
  'brainchild:status': none,
  'brainchild:listNotes': invoke(obj()),
  'brainchild:search': invoke(obj()),
  'brainchild:getNote': invoke(obj()),
  'brainchild:pickInstall': invoke([], { gesture: true }),
  'brainchild:pickVault': invoke([], { gesture: true }),
  'brainchild:unlink': invoke([], { gesture: true }),
  'brainchild:revealNote': invoke(obj(), { gesture: true }),

  // Connector OAuth
  'generate-oauth-state': none,

  // PAC bridge consent. respond-consent checks the window it asked and, to allow, a gesture.
  'companion-bridge:respond-consent': invoke(obj()),
  'settings:list-bridge-consents': none,
  'settings:revoke-bridge-consent': invoke(obj(), { gesture: true }),

  // LANA Briefs (electron-briefs.js); its own bridge channels are checked by its host.
  'briefs:running': none
});

/**
 * Size limits (payloadBytes, electron-ipc-guard.js) for the channels registered outside the
 * guard: the screen voice overlay (src/screen-voice/electron-screen-voice.js, which also checks
 * that the sender is the overlay page) and LANA Briefs (its typed bridge and the capture frames,
 * checked by its host through electron-briefs.js). update-dialog-response is in IPC_POLICY.
 */
const RAW_IPC_LIMITS = Object.freeze({
  screenVoice: Object.freeze({
    default: 64 * 1024,
    // A recording as base64 (the host refuses over 16 MB of base64 itself).
    'screen-voice:audio-complete': 17 * 1024 * 1024,
    'screen-voice:realtime-event': 256 * 1024
  }),
  briefs: Object.freeze({
    bridgeCall: 8 * 1024 * 1024,
    recordingFrame: 4 * 1024 * 1024,
    recordingLevels: 1024,
    talkFrame: 1024 * 1024
  })
});

/** Main-to-renderer channels the client preload listens on. */
const EVENT_CHANNELS = Object.freeze([
  'engine:state',
  'appearance:changed',
  'first-launch:status-changed',
  'update-available',
  'update-downloaded',
  'update-progress',
  'update-error',
  'oauth-callback',
  'companion-bridge:request-consent',
  // lana-ai://connect/<org-id>: the checked org id for the sign-in page (electron-main.js handleConnectLink).
  'connect-link:org'
]);

module.exports = { IPC_POLICY, EVENT_CHANNELS, RAW_IPC_LIMITS, SERVER_PAGES, DISCOVERY_PAGES };
