'use strict';

/** Screen diction is a core client feature behind a product switch (src/screen-voice/feature.js). */
const {
  SCREEN_DICTION_READY,
  screenDictionAvailable,
  isScreenDictionActive,
  screenDictionViews
} = require('../../src/screen-voice/feature');

describe('screen diction feature switch', () => {
  test('ships turned off', () => {
    expect(SCREEN_DICTION_READY).toBe(false);
    expect(screenDictionAvailable('darwin')).toBe(false);
    expect(isScreenDictionActive(true, 'darwin')).toBe(false);
    expect(screenDictionViews(true, 'darwin')).toEqual([]);
  });

  test('once ready, it runs only on macOS and only when the person turns it on', () => {
    expect(isScreenDictionActive(true, 'darwin', true)).toBe(true);
    expect(isScreenDictionActive(undefined, 'darwin', true)).toBe(false);
    expect(isScreenDictionActive(false, 'darwin', true)).toBe(false);
    expect(isScreenDictionActive(true, 'win32', true)).toBe(false);
  });

  test('once ready, Settings lists it with its on/off state', () => {
    const [view] = screenDictionViews(true, 'darwin', true);
    expect(view).toMatchObject({ id: 'screen-diction', label: 'Screen diction', active: true, required: false, available: true });
    expect(screenDictionViews(false, 'darwin', true)[0].active).toBe(false);
    expect(screenDictionViews(true, 'linux', true)).toEqual([]);
  });
});
