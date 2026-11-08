'use strict';

/**
 * Screen diction (the LANA voice agent that types into any app) is part of the
 * LANA client itself, not something an organization's server turns on.
 *
 * SCREEN_DICTION_READY is the product switch. While it is false the feature is
 * off everywhere: no shortcuts, no overlay, nothing in Settings. When it ships,
 * set it to true; each person then turns it on or off for their computer in
 * Settings (off until they do).
 */
const SCREEN_DICTION_ID = 'screen-diction';
const SCREEN_DICTION_READY = false;
const SUPPORTED_PLATFORMS = Object.freeze(['darwin']);

function screenDictionAvailable(platform = process.platform, ready = SCREEN_DICTION_READY) {
  return ready === true && SUPPORTED_PLATFORMS.includes(platform);
}

/** Whether screen diction runs on this computer: available here and turned on by the person. */
function isScreenDictionActive(preference, platform = process.platform, ready = SCREEN_DICTION_READY) {
  return screenDictionAvailable(platform, ready) && preference === true;
}

const HINTS = Object.freeze({
  'Getting started': [
    'Press Command+Shift+Space to open the voice agent.',
    'Hold Control+Option to speak, then release to process.'
  ],
  Shortcuts: {
    Open: 'Command+Shift+Space',
    Capture: 'Control+Option'
  },
  Permissions: 'Microphone and Accessibility access are requested only when used.'
});

/**
 * What Settings lists: screen diction when it is available on this computer,
 * otherwise nothing (and the card stays hidden).
 */
function screenDictionViews(preference, platform = process.platform, ready = SCREEN_DICTION_READY) {
  if (!screenDictionAvailable(platform, ready)) return [];
  return [{
    id: SCREEN_DICTION_ID,
    label: 'Screen diction',
    description: 'Speak, and LANA types or acts in the app in front of you.',
    required: false,
    defaultEnabled: false,
    active: isScreenDictionActive(preference, platform, ready),
    available: true,
    platforms: SUPPORTED_PLATFORMS.slice(),
    hints: HINTS
  }];
}

module.exports = {
  SCREEN_DICTION_ID,
  SCREEN_DICTION_READY,
  SUPPORTED_PLATFORMS,
  screenDictionAvailable,
  isScreenDictionActive,
  screenDictionViews
};
