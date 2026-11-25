'use strict';

/**
 * Load state: idle, loading, loaded, empty, error, and the latest request
 * wins. A slow answer for older dates never replaces a newer one, and
 * "empty" only comes from a finished request that returned nothing.
 */

const path = require('path');
const { createLoadTracker } = require(path.join(__dirname, '../../src/js/shared/load-state.js'));

test('starts idle', () => {
  expect(createLoadTracker().state).toBe('idle');
});

test('a request is loading until it finishes', () => {
  const t = createLoadTracker();
  const id = t.begin();
  expect(t.state).toBe('loading');
  expect(t.isLoading()).toBe(true);
  expect(t.finish(id, 3)).toBe('loaded');
  expect(t.state).toBe('loaded');
  expect(t.isLoading()).toBe(false);
});

test('only a finished request with no cards is empty', () => {
  const t = createLoadTracker();
  const id = t.begin();
  expect(t.state).not.toBe('empty');
  expect(t.finish(id, 0)).toBe('empty');
});

test('a failed request is an error', () => {
  const t = createLoadTracker();
  const id = t.begin();
  expect(t.fail(id)).toBe('error');
  expect(t.state).toBe('error');
});

test('the latest request wins, in any order the answers arrive', () => {
  const t = createLoadTracker();
  const first = t.begin();
  const second = t.begin();
  expect(t.isLatest(first)).toBe(false);
  expect(t.finish(second, 5)).toBe('loaded');
  // The older answer arrives late: ignored, nothing changes.
  expect(t.finish(first, 0)).toBe(null);
  expect(t.fail(first)).toBe(null);
  expect(t.state).toBe('loaded');
});

test('an older answer arriving first does not end the newer load', () => {
  const t = createLoadTracker();
  const first = t.begin();
  t.begin();
  expect(t.finish(first, 2)).toBe(null);
  expect(t.state).toBe('loading');
});

test('it remembers whether anything has loaded yet (skeletons only the first time)', () => {
  const t = createLoadTracker();
  expect(t.hasLoaded).toBe(false);
  t.finish(t.begin(), 1);
  expect(t.hasLoaded).toBe(true);
  t.begin();
  expect(t.hasLoaded).toBe(true);
});
