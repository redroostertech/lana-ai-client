'use strict';

/**
 * Card text grows and shrinks with the card's own width (container query
 * units on the card), never the viewport: headline numbers fit on one line
 * at any width, other text stays readable (never below about 11 px), and
 * long words wrap inside the card.
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../src/css/admin/insights-dashboard.css'), 'utf8');
const charts = fs.readFileSync(path.join(__dirname, '../../src/css/mini-charts.css'), 'utf8');

// The last rule for a selector in the file (later rules win).
function lastRule(source, selector) {
  const at = source.lastIndexOf(selector + ' {');
  if (at === -1) return '';
  return source.slice(at, source.indexOf('}', at));
}

function clampOf(rule) {
  const at = rule.indexOf('font-size: clamp(');
  if (at === -1) return null;
  const inner = rule.slice(at + 'font-size: clamp('.length, rule.indexOf(');', at));
  const parts = inner.split(',').map((p) => p.trim());
  return { min: parts[0], fluid: parts[1], max: parts[2] };
}

const rem = (value) => (value.endsWith('rem') ? Number(value.slice(0, -3)) * 16 : value.endsWith('px') ? Number(value.slice(0, -2)) : NaN);

describe('card text is fluid to the card', () => {
  test('cards and the metric detail summary are size containers', () => {
    expect(lastRule(css, '.dash-fluid .dash-metric-card,\n.metric-summary')).toContain('container-type: inline-size');
  });

  test.each([
    ['.dash-fluid .dash-metric-card--hero .dash-metric-card__value', 28, 56],
    ['.dash-fluid .dash-metric-card__value', 22, 36],
    ['.metric-summary .metric-summary__value', 24, 44],
  ])('%s: a headline number scales with the card (cqi), within bounds', (selector, min, max) => {
    const rule = lastRule(css, selector);
    const clamp = clampOf(rule);
    expect(clamp).not.toBeNull();
    expect(clamp.fluid).toContain('cqi');
    expect(rem(clamp.min)).toBe(min);
    expect(rem(clamp.max)).toBe(max);
    // One line, never wider than the card.
    expect(rule).toContain('white-space: nowrap');
    expect(rule).toContain('max-width: 100%');
  });

  test.each([
    '.dash-fluid .dash-metric-card__title',
    '.dash-fluid .dash-metric-card__second-line',
    '.dash-fluid .dash-metric-card__subtitle',
    '.dash-fluid .dash-card__headline',
    '.dash-fluid .dash-callouts',
    '.dash-fluid .dash-card__note',
    '.dash-fluid .dash-card__footer',
    '.metric-summary .metric-summary__title',
    '.metric-summary .metric-summary__second-line',
  ])('%s: scales with the card and never drops below 11 px', (selector) => {
    const clamp = clampOf(lastRule(css, selector));
    expect(clamp).not.toBeNull();
    expect(clamp.fluid).toContain('cqi');
    expect(rem(clamp.min)).toBeGreaterThanOrEqual(11);
  });

  test('long words and numbers wrap inside the card', () => {
    expect(lastRule(css, '.dash-fluid .dash-metric-card__title')).toContain('overflow-wrap: anywhere');
    expect(lastRule(css, '.dash-fluid .dash-callouts')).toContain('overflow-wrap: anywhere');
  });

  test('axis ticks follow the card width too', () => {
    const clamp = clampOf(lastRule(charts, '.mini-cols__tick'));
    expect(clamp).not.toBeNull();
    expect(clamp.fluid).toContain('cqi');
  });
});
