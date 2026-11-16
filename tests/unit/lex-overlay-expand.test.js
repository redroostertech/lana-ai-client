'use strict';

/**
 * Lex.OverlayExpand: the shared expand/collapse rules for lex-modal and
 * lex-drawer (default on, opt-outs, labels, per-id session memory).
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(read('lex/lex.core.js'));
  return dom.window;
}

function memoryStore() {
  const data = {};
  return {
    data,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

describe('Lex.OverlayExpand rules', () => {
  let X;
  beforeEach(() => { X = boot().Lex.OverlayExpand; });

  test('is exposed by lex.core', () => {
    expect(X).toBeDefined();
  });

  test('regular modals and drawers are expandable by default', () => {
    expect(X.isExpandable({})).toBe(true);
    expect(X.isExpandable({ size: 'md' })).toBe(true);
    expect(X.isExpandable({ size: 'xl', expandable: true })).toBe(true);
    expect(X.isExpandable()).toBe(true);
  });

  test('an explicit expandable false opts out', () => {
    expect(X.isExpandable({ expandable: false })).toBe(false);
    expect(X.isExpandable({ expandable: 'false' })).toBe(false);
  });

  test('small dialogs never expand', () => {
    expect(X.isExpandable({ size: 'sm' })).toBe(false);
    expect(X.isExpandable({ size: 'sm', expandable: true })).toBe(false);
  });

  test('palettes and already full size overlays have no toggle', () => {
    expect(X.isExpandable({ palette: true })).toBe(false);
    expect(X.isExpandable({ size: 'full' })).toBe(false);
  });

  test('label and icon follow the state', () => {
    expect(X.label(false)).toBe('Full screen');
    expect(X.label(true)).toBe('Exit full screen');
    expect(X.icon(false)).toContain('<svg');
    expect(X.icon(true)).toContain('<svg');
    expect(X.icon(true)).not.toBe(X.icon(false));
  });

  test('sync sets aria-pressed, label, title and icon on the button', () => {
    const doc = new JSDOM('<button></button>').window.document;
    const btn = doc.querySelector('button');
    X.sync(btn, true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Exit full screen');
    expect(btn.title).toBe('Exit full screen');
    expect(btn.querySelector('path').getAttribute('d')).toBe('M4 14h6v6');
    X.sync(btn, false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Full screen');
  });

  test('remembers the state per overlay id for the session', () => {
    const store = memoryStore();
    expect(X.recall('taskDrawer', store)).toBe(null);
    X.remember('taskDrawer', true, store);
    expect(X.recall('taskDrawer', store)).toBe(true);
    expect(X.recall('otherModal', store)).toBe(null);
    X.remember('taskDrawer', false, store);
    expect(X.recall('taskDrawer', store)).toBe(false);
  });

  test('no id means nothing is stored or recalled', () => {
    const store = memoryStore();
    X.remember('', true, store);
    expect(Object.keys(store.data)).toHaveLength(0);
    expect(X.recall('', store)).toBe(null);
  });

  test('a storage that throws never breaks the toggle', () => {
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(() => X.remember('a', true, broken)).not.toThrow();
    expect(X.recall('a', broken)).toBe(null);
  });
});
