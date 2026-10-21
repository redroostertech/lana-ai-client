'use strict';

// The drilldown's record list is a server-paged lex-table inside a lex-modal
// (docs/TABLE-STANDARD.md); the hand-built table, pager, popovers and
// overlays are gone. Request mapping is covered in drilldown-request-contract.
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../src/js/drilldown-renderer.js'), 'utf8');

describe('drilldown renderer markup', () => {
  test('records render in a server-paged lex-table with column filters', () => {
    const tag = source.match(/<lex-table id="drilldown-table"[\s\S]*?><\/lex-table>/)[0];
    expect(tag).toContain('lex-table--card');
    expect(tag).toContain('server-paging');
    expect(tag).toContain('column-filters');
    expect(tag).toContain('limit="20"');
    expect(tag).toContain('aria-label=');
    expect(tag).not.toMatch(/\b(searchable|filterable|compact)\b/);
  });

  test('no hand-built table, pager, native select, overlay or window dialogs', () => {
    expect(source).not.toMatch(/<table[\s>]/);
    expect(source).not.toContain('drilldown-pagination');
    expect(source).not.toMatch(/<select[\s>]/);
    expect(source).not.toContain('fixed inset-0');
    expect(source).not.toMatch(/(^|[^.\w])(alert|confirm|prompt)\(/m);
    expect(source).toContain('<lex-modal id="drilldown-modal" size="full"');
    expect(source).toContain('<lex-select id="drilldown-sort-select"');
    expect(source).toContain('<lex-input id="drilldown-search"');
  });
});
