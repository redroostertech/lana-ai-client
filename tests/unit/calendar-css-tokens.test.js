'use strict';

/**
 * Every --lex-* variable the calendar CSS reads has a value in both themes.
 * Light reads only the :root blocks; dark reads :root[data-lex-theme="dark"]
 * over them. A name defined only in the dark block (some aliases are) is
 * empty in light, so an event lost its fill and edge there.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const TOKENS = fs.readFileSync(path.join(SRC, 'css/lex-tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const names = (body) => new Set([...body.matchAll(/(--lex-[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));

const darkStart = TOKENS.search(/@media screen\s*\{\s*:root\[data-lex-theme="dark"\]/);
const light = new Set();
for (const m of TOKENS.slice(0, darkStart).matchAll(/(^|\n):root\s*\{([^}]*)\}/g)) names(m[2]).forEach((n) => light.add(n));
const darkOnly = names(TOKENS.slice(darkStart, TOKENS.indexOf('}', TOKENS.indexOf('{', TOKENS.indexOf('[data-lex-theme="dark"]', darkStart)))));

describe.each(['css/lex-calendar-grid.css', 'css/calendar.css'])('%s', (file) => {
  const css = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const used = [...new Set([...css.matchAll(/var\((--lex-[a-zA-Z0-9-]+)/g)].map((m) => m[1]))];

  test('reads some Lex tokens (the scan found the file)', () => {
    expect(used.length).toBeGreaterThan(5);
  });

  test('every token it reads is defined for light (the :root blocks), so dark inherits or overrides it', () => {
    expect(used.filter((name) => !light.has(name))).toEqual([]);
  });

  test('the scan sees dark-only names (control: the alias set is not empty)', () => {
    expect(darkOnly.has('--lex-bg-card') && !light.has('--lex-bg-card')).toBe(true);
  });
});

describe('surfaces that must read apart in both themes (second review 3)', () => {
  const RAW = fs.readFileSync(path.join(SRC, 'css/lex-tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const decl = (body) => Object.fromEntries([...body.matchAll(/(--lex-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const start = RAW.search(/@media screen\s*\{\s*:root\[data-lex-theme="dark"\]/);
  const lightMap = {};
  for (const m of RAW.slice(0, start).matchAll(/(^|\n):root\s*\{([^}]*)\}/g)) Object.assign(lightMap, decl(m[2]));
  const darkOpen = RAW.indexOf('{', RAW.indexOf('[data-lex-theme="dark"]', start)) + 1;
  const darkMap = { ...lightMap, ...decl(RAW.slice(darkOpen, RAW.indexOf('}', darkOpen))) };
  const resolve = (map, value, depth = 0) => {
    const m = /^var\((--[a-zA-Z0-9-]+)(?:,[^)]*)?\)$/.exec(String(value || '').trim());
    return m && depth < 10 ? resolve(map, map[m[1]], depth + 1) : String(value || '').trim().toLowerCase();
  };
  const GRID_CSS = fs.readFileSync(path.join(SRC, 'css/lex-calendar-grid.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const backgroundOf = (selector) => {
    const rule = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(GRID_CSS);
    const value = rule && /background:\s*(var\(--lex-[a-zA-Z0-9-]+\))\s*;/.exec(rule[1]);
    return value ? value[1] : null;
  };

  test.each([
    ['.lex-cal-month-cell--outside'],
    ['.lex-cal-badge']
  ])('%s differs from the grid surface in light and dark', (selector) => {
    const grid = backgroundOf('.lex-cal-grid');
    const other = backgroundOf(selector);
    expect(grid).not.toBeNull();
    expect(other).not.toBeNull();
    expect(resolve(lightMap, other)).not.toBe(resolve(lightMap, grid));
    expect(resolve(darkMap, other)).not.toBe(resolve(darkMap, grid));
  });
});

