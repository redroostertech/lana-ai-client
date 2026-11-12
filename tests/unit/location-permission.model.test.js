'use strict';

/** Settings > General > Location: rounding and status (src/js/location-permission.model.js). */
const M = require('../../src/js/location-permission.model');

describe('roundCoordinate', () => {
  test('keeps one decimal place (about 11 km)', () => {
    expect(M.roundCoordinate(33.748995)).toBe(33.7);
    expect(M.roundCoordinate(-84.387982)).toBe(-84.4);
    expect(M.roundCoordinate(40.06)).toBe(40.1);
  });

  test('never gives -0, and gives null for anything that is not a number', () => {
    expect(Object.is(M.roundCoordinate(-0.04), 0)).toBe(true);
    expect(M.roundCoordinate(NaN)).toBeNull();
    expect(M.roundCoordinate(Infinity)).toBeNull();
    expect(M.roundCoordinate('33.7')).toBeNull();
    expect(M.roundCoordinate(undefined)).toBeNull();
  });
});

describe('statusFromError', () => {
  test('permission denied is denied; no position and timeout are unavailable', () => {
    expect(M.statusFromError({ code: 1 })).toBe('denied');
    expect(M.statusFromError({ code: 2 })).toBe('unavailable');
    expect(M.statusFromError({ code: 3 })).toBe('unavailable');
    expect(M.statusFromError(null)).toBe('unavailable');
  });
});

describe('buildReading', () => {
  const coords = { latitude: 33.748995, longitude: -84.387982, accuracy: 35, altitude: 300, heading: 10, speed: 2 };

  test('a granted reading is rounded and carries nothing else from the position', () => {
    expect(M.buildReading({ allowed: true, coords })).toEqual({ status: 'granted', approx: { lat: 33.7, lon: -84.4 }, accuracyKm: 11 });
  });

  test('the exact numbers are not anywhere in the reading', () => {
    const text = JSON.stringify(M.buildReading({ allowed: true, coords }));
    expect(text).not.toContain('33.748995');
    expect(text).not.toContain('84.387982');
    expect(text).not.toContain('altitude');
  });

  test('accuracy is the rounding, or the computer\'s own guess when that is worse', () => {
    expect(M.buildReading({ allowed: true, coords: { latitude: 1, longitude: 1, accuracy: 25400 } }).accuracyKm).toBe(26);
    expect(M.buildReading({ allowed: true, coords: { latitude: 1, longitude: 1 } }).accuracyKm).toBe(11);
  });

  test('not turned on in Settings is prompt, with no position even when one is passed', () => {
    expect(M.buildReading({ allowed: false, coords })).toEqual({ status: 'prompt', approx: null, accuracyKm: null });
  });

  test('errors, no location service and bad numbers give no position', () => {
    expect(M.buildReading({ allowed: true, error: { code: 1 } })).toEqual({ status: 'denied', approx: null, accuracyKm: null });
    expect(M.buildReading({ allowed: true, error: { code: 3 } })).toEqual({ status: 'unavailable', approx: null, accuracyKm: null });
    expect(M.buildReading({ allowed: true, supported: false })).toEqual({ status: 'unavailable', approx: null, accuracyKm: null });
    expect(M.buildReading({ allowed: true, coords: { latitude: 120, longitude: 0 } }).status).toBe('unavailable');
    expect(M.buildReading({ allowed: true, coords: { latitude: NaN, longitude: 0 } }).status).toBe('unavailable');
  });
});

describe('permissionView', () => {
  test('uses the same badge words as the other permissions', () => {
    expect(M.permissionView(null)).toMatchObject({ label: 'Checking', color: 'gray', action: null });
    expect(M.permissionView('granted')).toMatchObject({ label: 'Allowed', color: 'green', canTurnOff: true });
    expect(M.permissionView('denied')).toMatchObject({ label: 'Denied', color: 'red', action: 'retry', canTurnOff: true });
    expect(M.permissionView('unavailable')).toMatchObject({ label: 'Unavailable', color: 'gray', action: 'retry' });
    expect(M.permissionView('prompt')).toMatchObject({ label: 'Off', action: 'allow', actionLabel: 'Allow', canTurnOff: false });
  });

  test('copy says computer, never a brand of device', () => {
    ['granted', 'denied', 'unavailable', 'prompt'].forEach((status) => {
      expect(M.permissionView(status).note).not.toMatch(/\b(Mac|macOS|iPhone|Windows)\b/);
    });
  });
});

// A development build runs as the stock Electron app, so the computer lists it as "Electron"
// in Location Services. Switched off there, the position request only times out (code 3);
// switched on, it works (2026-11-12, checked on Michael's computer). The page names it.
describe('a development build', () => {
  test('a reading that found nothing says it is a development build', () => {
    expect(M.buildReading({ allowed: true, error: { code: 3 }, devBuild: true }).status).toBe('dev_build');
    expect(M.buildReading({ allowed: true, error: { code: 1 }, devBuild: true }).status).toBe('dev_build');
    expect(M.buildReading({ allowed: true, supported: false, devBuild: true }).status).toBe('dev_build');
  });

  test('control: a position found in a development build is still granted; off is still off', () => {
    expect(M.buildReading({ allowed: true, coords: { latitude: 1, longitude: 1 }, devBuild: true }).status).toBe('granted');
    expect(M.buildReading({ allowed: false, devBuild: true }).status).toBe('prompt');
  });

  test('the note says the development build is listed as Electron, and never that location cannot work', () => {
    const view = M.permissionView('dev_build');
    expect(view).toMatchObject({ label: 'Unavailable', color: 'gray', action: 'retry', canTurnOff: true });
    expect(view.note).toContain('development build');
    expect(view.note).toContain('"Electron"');
    expect(view.note).toContain('location settings');
    expect(view.note).not.toContain('does not share');
  });

  test('a timeout in the installed app points at the usual cause: LANA switched off in the location settings', () => {
    expect(M.permissionView('unavailable').note).toContain('location settings');
    expect(M.permissionView('unavailable').note).toContain('Open Settings');
  });
});

describe('Open Settings', () => {
  test('offered when the computer is not sharing its location', () => {
    ['denied', 'unavailable', 'dev_build'].forEach((status) => expect(M.permissionView(status).canOpenSettings).toBe(true));
  });

  test('control: not offered when location is allowed, off or being checked', () => {
    ['granted', 'prompt', null].forEach((status) => expect(M.permissionView(status).canOpenSettings).toBe(false));
  });
});

