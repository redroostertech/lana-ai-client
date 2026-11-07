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

  test('appears before Refresh with a hover card, then changes and goes away in place', async () => {
    const bar = document.querySelector('lex-topbar');
    const root = bar.querySelector('.lex-topbar-root');
    bar.statusIcon = 'wifi';
    bar.statusLabel = 'Listening for your phone';
    bar.statusTone = 'good';
    bar.statusSummary = 'Ready to receive meetings.';
    bar.statusRows = [{ label: 'Paired phones', value: 'iPhone' }];
    bar.statusAction = 'Manage phones';
    await tick();
    expect(bar.querySelector('.lex-topbar-root')).toBe(root);
    const button = status().querySelector('.lex-topbar-status');
    expect(button.getAttribute('aria-label')).toBe('Listening for your phone');
    expect(button.dataset.tone).toBe('good');
    const card = status().querySelector('[role="tooltip"]');
    expect(button.getAttribute('aria-describedby')).toBe(card.id);
    expect(card.textContent).toContain('Ready to receive meetings.');
    expect(Array.from(card.querySelectorAll('dt, dd')).map((n) => n.textContent)).toEqual(['Paired phones', 'iPhone']);
    expect(status().nextElementSibling.getAttribute('data-action')).toBe('refresh');

    // The card's button asks the page to act.
    let asked = 0;
    bar.addEventListener('topbar-status-action', () => { asked += 1; });
    card.querySelector('[data-action="status-action"] button').click();
    expect(asked).toBe(1);

    bar.statusIcon = 'wifi-off';
    bar.statusLabel = 'No phone paired';
    bar.statusTone = 'warning';
    bar.statusAction = 'Pair a phone';
    await tick();
    expect(document.querySelectorAll('[data-topbar-status]')).toHaveLength(1);
    expect(status().querySelector('.lex-topbar-status').getAttribute('aria-label')).toBe('No phone paired');
    expect(status().querySelector('.lex-topbar-status').dataset.tone).toBe('warning');
    expect(status().textContent).toContain('Pair a phone');

    bar.statusIcon = '';
    bar.statusLabel = '';
    await tick();
    expect(status()).toBeNull();
  });
});
