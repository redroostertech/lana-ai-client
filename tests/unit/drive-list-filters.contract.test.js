'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('Library (drive.html) list column filters', () => {
  test('the list table is a server-paged lex-table with header filters', () => {
    const html = read('drive.html');
    const table = html.slice(html.indexOf('<lex-table\n        id="listView"'), html.indexOf('</lex-table>', html.indexOf('id="listView"')));
    expect(table).toContain('column-filters');
    expect(table).toContain('server-paging');
    expect(table).toContain('sortable-columns="name,created_at,size"');
    expect(html.indexOf('js/shared/library-column-filters.js')).toBeLessThan(html.indexOf('src="js/drive.js"'));
  });

  test('router loads the shared filter module before the page controller', () => {
    const pages = read(path.join('js', 'lex', 'lex-router.pages.js'));
    const block = pages.slice(pages.indexOf("'drive.html': {"), pages.indexOf('stylesheets', pages.indexOf("'drive.html': {")));
    expect(block.indexOf("'js/shared/library-column-filters.js'")).toBeGreaterThan(-1);
    expect(block.indexOf("'js/shared/library-column-filters.js'")).toBeLessThan(block.indexOf("'js/drive.js'"));
  });

  test('workspace filters reach /storage/matters; note scopes filter in the page', () => {
    const drive = read(path.join('js', 'drive.js'));
    expect(drive).toContain("params.append('matter_ids', ids.join(','))");
    expect(drive).toContain("params.append('created_after', range.after)");
    expect(drive).toContain("params.append('min_documents'");
    expect(drive).toContain("params.append('max_documents'");
    expect(drive).toContain('pageOfRows(filterNoteRows(rows)');
    expect(drive).toContain('storageState.columnFilters = query.filters || {}');
  });
});
