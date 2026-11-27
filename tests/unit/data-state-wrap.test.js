'use strict';

/**
 * insufficient_data reasons are now longer, specific sentences. The state
 * block wraps them in full everywhere: no one-line clamp, no ellipsis, long
 * words break instead of overflowing the card.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function rulesFor(css, selector) {
  const out = [];
  let at = css.indexOf(selector);
  while (at !== -1) {
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    const head = css.slice(css.lastIndexOf('}', at) + 1, open);
    if (head.indexOf(selector) !== -1) out.push(css.slice(open + 1, close));
    at = css.indexOf(selector, close);
  }
  return out;
}

test('the shared reason text wraps and breaks long words', () => {
  const rules = rulesFor(read('css/components.css'), '.lex-data-state__reason').join(';');
  expect(rules).toContain('overflow-wrap: anywhere');
  expect(rules).toContain('white-space: normal');
});

test('no stylesheet clamps or truncates the reason', () => {
  ['css/components.css', 'css/admin/insights-dashboard.css', 'css/admin/report.css'].forEach((file) => {
    const rules = rulesFor(read(file), 'lex-data-state__reason').join(';');
    ['line-clamp', 'text-overflow: ellipsis', 'white-space: nowrap', 'max-height'].forEach((bad) => expect(rules).not.toContain(bad));
  });
});

describe('long freshness labels (several sources) wrap without breaking the card footer', () => {
  test('the badge wraps and breaks long words', () => {
    const rules = rulesFor(read('css/components.css'), '.lex-freshness').join(';');
    expect(rules).toContain('white-space: normal');
    expect(rules).toContain('overflow-wrap: anywhere');
    expect(rules).toContain('max-width: 100%');
  });
  test('the footer wraps onto a second line and the period can shrink', () => {
    const css = read('css/admin/insights-dashboard.css');
    const footer = rulesFor(css, '.dash-card__footer').join(';');
    expect(footer).toContain('flex-wrap: wrap');
    expect(rulesFor(css, '.dash-card__footer .dash-metric-card__period').join(';')).toContain('min-width: 0');
    expect(rulesFor(css, '.dash-metric-card__period .lex-freshness').join(';')).not.toContain('nowrap');
  });
});

describe('the metric detail records table scrolls inside its card, never the page', () => {
  const css = read('css/admin/insights-dashboard.css');
  test('the layout grid column can shrink below the table width', () => {
    expect(rulesFor(css, '.metric-detail-layout').join(';')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(rulesFor(css, '#metricSourcePanel').join(';')).toContain('min-width: 0');
    const table = rulesFor(css, '#metricRawDataTable').join(';');
    expect(table).toContain('max-width: 100%');
    expect(table).toContain('overflow-x: auto');
  });
  test('the Notes cell wraps at about 280px', () => {
    const notes = rulesFor(css, '.metric-record-notes').join(';');
    expect(notes).toContain('white-space: normal');
    expect(notes).toContain('max-width: 280px');
  });
});
