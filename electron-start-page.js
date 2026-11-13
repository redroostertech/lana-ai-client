'use strict';

/**
 * Which page the app opens on. Pure, so the rule is tested without Electron.
 *
 * The first-launch setup screen is the one consent step for local AI (Michael, "ask once at
 * first start"). It shows until Continue was pressed once (firstLaunchPersistence.acceptedAt),
 * also on a computer that already has a saved, signed-in server from an earlier build. When the
 * screen is done it goes where the app would have gone: into the app, or to sign in.
 *
 *   pageAfterSetup(facts)  'app' | 'login': where the app goes once setup was accepted
 *   startPage(facts)       'first-launch' | 'app' | 'login'
 *   signInPage({ acceptedAt, next })  the page the sign-in window loads; the setup screen is told
 *                          in ?next=app to go into the app when it is done (first-launch.pages.js
 *                          exitFor reads it)
 *
 * facts: { savedServer, reachable, liveSession, offlineReady, acceptedAt }
 *   offlineReady: the local engine can open without the server (electron-local-engine.js
 *   canOpenOffline), which it does only with a live session.
 */

function pageAfterSetup({ savedServer, reachable, liveSession, offlineReady } = {}) {
  if (!savedServer) {return 'login';}
  if (reachable) {return 'app';}
  return offlineReady && liveSession ? 'app' : 'login';
}

function startPage(facts = {}) {
  return facts.acceptedAt ? pageAfterSetup(facts) : 'first-launch';
}

function signInPage({ acceptedAt, next } = {}) {
  if (acceptedAt) {return 'login.html';}
  return next === 'app' ? 'first-launch.html?next=app' : 'first-launch.html';
}

/**
 * macOS dock reopen: with no window open, a dock click reopens the app for a signed-in install
 * that finished setup, the setup screen (then the app) for one that never pressed Continue, and
 * sign-in otherwise. Registered once at startup, before any startup path can return.
 */
function registerDockReopen(app, { windowOpen, startupDone = () => true, getSavedServer, acceptedAt, createWindow, createLoginWindow }) {
  app.on('activate', () => {
    // Startup is about to open its own window; opening one here too would leave two.
    if (!startupDone() || windowOpen()) {return;}
    const savedServer = getSavedServer();
    if (savedServer && acceptedAt()) {
      createWindow(savedServer.url);
    } else {
      createLoginWindow(savedServer ? 'app' : 'login');
    }
  });
}

module.exports = { startPage, pageAfterSetup, signInPage, registerDockReopen };
