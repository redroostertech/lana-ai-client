'use strict';

// OAuth callback state (electron-oauth-state.js): a callback without a state, or with one
// this app did not issue and that is not the backend's 64-hex form, is refused.

const { createOAuthStates } = require('../../electron-oauth-state');

describe('createOAuthStates', () => {
  test('a state this app issued is accepted once, within its time', () => {
    let now = 0;
    const states = createOAuthStates({ now: () => now, randomHex: () => 'a'.repeat(64) });
    const state = states.generate();
    expect(states.acceptsCallback(state)).toBe(true);
    now += 1;
    const again = createOAuthStates({ now: () => now, randomHex: () => 'b'.repeat(10) });
    const short = again.generate();
    expect(again.acceptsCallback(short)).toBe(true);
    expect(again.acceptsCallback(short)).toBe(false);
  });

  test('a missing or empty state is refused', () => {
    const states = createOAuthStates();
    for (const state of [null, undefined, '', '   ']) expect(states.acceptsCallback(state)).toBe(false);
  });

  test('an expired local state is refused; a backend-managed 64-hex state is accepted', () => {
    let now = 0;
    const states = createOAuthStates({ now: () => now, randomHex: () => 'c'.repeat(12) });
    const state = states.generate();
    now += 11 * 60 * 1000;
    expect(states.acceptsCallback(state)).toBe(false);
    expect(states.acceptsCallback('d'.repeat(64))).toBe(true);
    expect(states.acceptsCallback('not-a-state')).toBe(false);
  });
});

test('electron-main.js refuses a callback without a state', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'electron-main.js'), 'utf8');
  const handler = main.slice(main.indexOf('const handleOAuthCallback'), main.indexOf('\n};', main.indexOf('const handleOAuthCallback')));
  expect(handler).toMatch(/if \(!oauthStates\.acceptsCallback\(state\)\)/);
  expect(handler).not.toMatch(/if \(state && /);
});
