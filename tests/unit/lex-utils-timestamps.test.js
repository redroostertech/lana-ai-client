'use strict';

const path = require('path');
const fs = require('fs');

function loadLexUtils() {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../src/js/lex/lex.utils.js'),
    'utf8'
  );
  const fakeWindow = {
    localStorage: { getItem: () => null },
    Intl,
    Date
  };
  const fakeDocument = {
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    }
  };
  const sandbox = new Function('window', 'document', src);
  sandbox(fakeWindow, fakeDocument);
  return fakeWindow;
}

describe('Lex.Utils UTC API timestamp handling', () => {
  let win;

  beforeAll(() => {
    win = loadLexUtils();
  });

  test('normalizes timezone-less ISO timestamps as UTC', () => {
    expect(win.Lex.Utils.normalizeApiUtcTimestamp('2026-05-11T12:30:00')).toBe('2026-05-11T12:30:00Z');
    expect(win.Lex.Utils.normalizeApiUtcTimestamp('2026-05-11T12:30:00Z')).toBe('2026-05-11T12:30:00Z');
    expect(win.Lex.Utils.normalizeApiUtcTimestamp('2026-05-11T12:30:00-04:00')).toBe('2026-05-11T12:30:00-04:00');
  });

  test('parses timezone-less API timestamps to the same instant as explicit UTC', () => {
    const implicit = win.Lex.Utils.parseApiUtcDate('2026-05-11T12:30:00');
    const explicit = win.Lex.Utils.parseApiUtcDate('2026-05-11T12:30:00Z');
    expect(implicit.toISOString()).toBe('2026-05-11T12:30:00.000Z');
    expect(implicit.getTime()).toBe(explicit.getTime());
  });

  test('formats parsed UTC timestamps in the requested client timezone', () => {
    expect(win.Lex.Utils.formatDateTime('2026-05-11T12:30:00', { timeZone: 'America/New_York' }))
      .toBe('5/11/2026 8:30 AM');
    expect(win.Lex.Utils.formatTime('2026-05-11T12:30:00', { timeZone: 'America/Los_Angeles' }))
      .toBe('5:30 AM');
  });
});
