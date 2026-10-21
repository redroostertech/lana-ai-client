const path = require('path');

const columnFilters = require(path.join(__dirname, '../../src/js/shared/library-column-filters.js'));

function loadModule() {
  jest.resetModules();
  return require(path.join(__dirname, '../../src/js/shared/brainchild-table.js'));
}

describe('brainchild-table', () => {
  let table;

  beforeEach(() => {
    global.LanaLibraryColumnFilters = columnFilters;
    global.Lex = {
      Utils: {
        formatDateTime: (value) => `DT(${value})`,
        timeAgo: (value) => `AGO(${value})`
      }
    };
    table = loadModule();
  });

  afterEach(() => {
    delete global.LanaLibraryColumnFilters;
    delete global.Lex;
  });

  test('mapNote keeps raw values and the vault path', () => {
    const note = { path: 'projects/acme/kickoff.md', title: 'Kickoff', created: '2026-01-01T00:00:00Z', modified: '2026-02-01T00:00:00Z' };
    const row = table.mapNote(note);
    expect(row).toEqual({
      id: 'brainchild:projects/acme/kickoff.md',
      name: 'Kickoff',
      folder: 'projects/acme',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
      _kind: 'brainchild',
      _vaultPath: 'projects/acme/kickoff.md',
      _source: note
    });
  });

  test('noteFolder handles root notes and windows separators', () => {
    expect(table.noteFolder('inbox.md')).toBe('');
    expect(table.noteFolder('a\\b\\c.md')).toBe('a/b');
    expect(table.noteFolder('')).toBe('');
  });

  test('mapNotes de-duplicates by vault path', () => {
    const rows = table.mapNotes([{ path: 'a.md', title: 'A' }, { path: 'a.md', title: 'A again' }, { title: 'No path' }]);
    expect(rows.map((r) => r.name)).toEqual(['A', 'No path']);
    expect(table.mapNotes(null)).toEqual([]);
  });

  test('renderers format dates and show a dash for empty cells', () => {
    const r = table.renderers();
    expect(r.name('<x>')).toContain('&lt;x&gt;');
    expect(r.folder('')).toContain('—');
    expect(r.folder('a/b')).toContain('a/b');
    expect(r.created_at('2026-01-01T00:00:00Z')).toContain('DT(2026-01-01T00:00:00Z)');
    expect(r.updated_at('2026-01-01T00:00:00Z')).toContain('AGO(2026-01-01T00:00:00Z)');
    expect(r.updated_at('')).toContain('—');
  });

  test('filter options: name text and date ranges', () => {
    const map = table.filterOptions();
    expect(map.name.text).toBe(true);
    expect(map.created_at.options).toBe(columnFilters.EDITED_RANGE_OPTIONS);
    const recent = new Date(Date.now() - 1000).toISOString();
    expect(map.updated_at.match(recent, ['today'])).toBe(true);
    expect(map.created_at.match('2020-01-01T00:00:00Z', ['30d'])).toBe(false);
  });

  test('empty text and count', () => {
    expect(table.emptyText(true)).toMatch(/clear the filters/);
    expect(table.emptyText(false)).toBe('No personal notes found.');
    expect(table.countLabel(1)).toBe('1 note');
    expect(table.countLabel(0)).toBe('0 notes');
    expect(table.SORT_OPTIONS.map((o) => o.label)).toEqual(['Last edited', 'Created', 'Name', 'Folder']);
  });
});
