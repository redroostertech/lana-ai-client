/**
 * Unit tests — Lex.Utils.setLexButtonText
 *
 * Regression coverage for the my-tasks "Edit Task" modal bug where setting
 * `.textContent` directly on a <lex-btn> wiped its inner styled DOM. The
 * helper must:
 *   1. Update the visible <slot-content> textContent in place.
 *   2. Re-seed `_originalChildren` so subsequent re-renders (e.g. when
 *      `loading` flips) restore the NEW label, not the captured original.
 *   3. Fall back to plain textContent if no <slot-content> child is present.
 *
 * lex.utils.js is a browser IIFE attached to `window`. To avoid adding a
 * jsdom dependency just for one test, we hand-build the minimal DOM surface
 * the helper uses: `querySelector`, `textContent`, and `document.createTextNode`.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// --- Minimal DOM shim ------------------------------------------------------

function makeFakeButton({ withSlot } = {}) {
  const slot = withSlot
    ? { tagName: 'SLOT-CONTENT', textContent: 'Create Task' }
    : null;

  return {
    textContent: withSlot ? 'Create Task' : 'Old',
    _originalChildren: null,
    querySelector(selector) {
      if (selector === 'slot-content') return slot;
      return null;
    }
  };
}

// --- Load Lex.Utils against a minimal window shim --------------------------

function loadLexUtils() {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../src/js/lex/lex.utils.js'),
    'utf8'
  );
  // Provide only what the IIFE assigns to; Intl/localStorage helpers are
  // unrelated to setLexButtonText and won't be invoked in these tests.
  const fakeWindow = {
    localStorage: { getItem: () => null }
  };
  // document.createTextNode is the only document API setLexButtonText uses.
  const fakeDocument = {
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    }
  };
  const sandbox = new Function('window', 'document', src);
  sandbox(fakeWindow, fakeDocument);
  return fakeWindow;
}

// --- Tests -----------------------------------------------------------------

describe('Lex.Utils.setLexButtonText', () => {
  let win;

  beforeAll(() => {
    win = loadLexUtils();
  });

  test('exposes the helper on Lex.Utils', () => {
    expect(typeof win.Lex.Utils.setLexButtonText).toBe('function');
  });

  test('updates slot-content textContent without touching button.textContent', () => {
    const btn = makeFakeButton({ withSlot: true });
    win.Lex.Utils.setLexButtonText(btn, 'Save Changes');
    const slot = btn.querySelector('slot-content');
    expect(slot.textContent).toBe('Save Changes');
    // The outer textContent stays untouched — this is what preserves the
    // styled inner DOM (the .lex-btn-inner button, ripple wrapper, etc.).
    expect(btn.textContent).toBe('Create Task');
  });

  test('re-seeds _originalChildren so a future re-render restores the new label', () => {
    const btn = makeFakeButton({ withSlot: true });
    win.Lex.Utils.setLexButtonText(btn, 'Save Changes');
    expect(Array.isArray(btn._originalChildren)).toBe(true);
    expect(btn._originalChildren).toHaveLength(1);
    expect(btn._originalChildren[0].nodeType).toBe(3); // TEXT_NODE
    expect(btn._originalChildren[0].textContent).toBe('Save Changes');
  });

  test('falls back to button.textContent when no slot-content child exists', () => {
    const btn = makeFakeButton({ withSlot: false });
    win.Lex.Utils.setLexButtonText(btn, 'New');
    expect(btn.textContent).toBe('New');
  });

  test('is a safe no-op for null / undefined buttons', () => {
    expect(() => win.Lex.Utils.setLexButtonText(null, 'X')).not.toThrow();
    expect(() => win.Lex.Utils.setLexButtonText(undefined, 'X')).not.toThrow();
  });
});
