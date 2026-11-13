/**
 * Which page the app opens on (electron-start-page.js). The first-launch setup screen is the one
 * consent step for local AI, so it shows until Continue was pressed once, also on a computer that
 * already has a saved, signed-in server. After setup it goes where the app would have gone.
 */

const fs = require('fs');
const path = require('path');
const { startPage, pageAfterSetup, signInPage } = require('../../electron-start-page');

const SERVER = { url: 'https://firm.example', orgId: 'org-1' };
const ACCEPTED = '2026-11-09T11:00:00Z';

describe('startPage', () => {
  test('a saved, reachable, signed-in server that never pressed Continue gets the setup screen', () => {
    expect(startPage({ savedServer: SERVER, reachable: true, liveSession: true, acceptedAt: null })).toBe('first-launch');
  });

  test('after Continue a saved, reachable server opens the app', () => {
    expect(startPage({ savedServer: SERVER, reachable: true, liveSession: true, acceptedAt: ACCEPTED })).toBe('app');
  });

  test('no saved server and never pressed Continue: the setup screen', () => {
    expect(startPage({ savedServer: null, reachable: false, liveSession: false, acceptedAt: null })).toBe('first-launch');
  });

  test('no saved server after Continue: sign in', () => {
    expect(startPage({ savedServer: null, reachable: false, liveSession: false, acceptedAt: ACCEPTED })).toBe('login');
  });

  test('an unreachable server opens the app offline only with a live session and an offline copy', () => {
    expect(startPage({ savedServer: SERVER, reachable: false, liveSession: true, offlineReady: true, acceptedAt: ACCEPTED })).toBe('app');
    expect(startPage({ savedServer: SERVER, reachable: false, liveSession: false, offlineReady: true, acceptedAt: ACCEPTED })).toBe('login');
    expect(startPage({ savedServer: SERVER, reachable: false, liveSession: true, offlineReady: false, acceptedAt: ACCEPTED })).toBe('login');
  });

  test('an unreachable server that never pressed Continue still gets the setup screen first', () => {
    expect(startPage({ savedServer: SERVER, reachable: false, liveSession: true, offlineReady: true, acceptedAt: null })).toBe('first-launch');
  });
});

describe('pageAfterSetup: where the setup screen goes when it is done', () => {
  test('into the app with a saved server the app would open', () => {
    expect(pageAfterSetup({ savedServer: SERVER, reachable: true, liveSession: true })).toBe('app');
  });
  test('to sign in otherwise', () => {
    expect(pageAfterSetup({ savedServer: null, reachable: false, liveSession: false })).toBe('login');
  });
});

describe('signInPage: the page the sign-in window loads', () => {
  test('the setup screen until Continue, told to go into the app when that is next', () => {
    expect(signInPage({ acceptedAt: null, next: 'app' })).toBe('first-launch.html?next=app');
    expect(signInPage({ acceptedAt: null, next: 'login' })).toBe('first-launch.html');
    expect(signInPage({ acceptedAt: null })).toBe('first-launch.html');
  });
  test('sign in after Continue', () => {
    expect(signInPage({ acceptedAt: ACCEPTED, next: 'app' })).toBe('login.html');
  });
});

test('electron-main picks the start page with startPage, so a signed-in install still sees setup once', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../electron-main.js'), 'utf8');
  expect(main).toMatch(/require\('\.\/electron-start-page'\)/);
  expect(main).toMatch(/startPage\(\{/);
});
