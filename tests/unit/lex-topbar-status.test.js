/**
 * lex-topbar's status icon (statusIcon / statusLabel / statusTone): drawn before Refresh,
 * labelled for hover and screen readers, and changed or removed in place after first paint.
 * LANA Briefs uses it for "Listening for your phone".
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const LEX = ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/components/foundation/lex-btn.js', 'js/lex/components/layout/lex-topbar.js']
  .map((rel) => fs.readFileSync(path.join(SRC, rel), 'utf8'));

let window;
let document;
const tick = () => new Promise((resolve) => window.setTimeout(resolve, 0));
const status = () => document.querySelector('[data-topbar-status]');

beforeEach(async () => {
  const dom = new JSDOM('<!doctype html><body><lex-topbar heading="LANA Briefs"></lex-topbar></body>', { url: 'http://localhost/briefs/index.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  window = dom.window;
  document = window.document;
  LEX.forEach((code) => window.eval(code));
  await tick();
});

describe('lex-topbar status icon', () => {
  test('there is none by default', () => {
    expect(document.querySelector('.lex-topbar-root')).not.toBeNull();
    expect(status()).toBeNull();
  });

  test('appears before Refresh with its label, then changes and goes away in place', async () => {
    const bar = document.querySelector('lex-topbar');
    const root = bar.querySelector('.lex-topbar-root');
    bar.statusIcon = 'wifi';
    bar.statusLabel = 'Listening for your phone';
    bar.statusTone = 'good';
    await tick();
    expect(bar.querySelector('.lex-topbar-root')).toBe(root);
    expect(status().getAttribute('aria-label')).toBe('Listening for your phone');
    expect(status().getAttribute('title')).toBe('Listening for your phone');
    expect(status().dataset.tone).toBe('good');
    expect(status().nextElementSibling.getAttribute('data-action')).toBe('refresh');

    bar.statusIcon = 'wifi-off';
    bar.statusLabel = 'Signed out';
    bar.statusTone = 'warning';
    await tick();
    expect(document.querySelectorAll('[data-topbar-status]')).toHaveLength(1);
    expect(status().getAttribute('aria-label')).toBe('Signed out');
    expect(status().dataset.tone).toBe('warning');
    expect(status().dataset.icon).toBe('wifi-off');

    bar.statusIcon = '';
    bar.statusLabel = '';
    await tick();
    expect(status()).toBeNull();
  });
});
