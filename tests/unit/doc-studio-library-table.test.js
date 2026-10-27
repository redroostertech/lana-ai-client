const path = require('path');

const columnFilters = require(path.join(__dirname, '../../src/js/shared/library-column-filters.js'));

function loadModule() {
  jest.resetModules();
  return require(path.join(__dirname, '../../src/js/shared/doc-studio-library-table.js'));
}

describe('doc-studio-library-table', () => {
  let table;

  beforeEach(() => {
    global.LanaLibraryColumnFilters = columnFilters;
    global.Lex = {
      Utils: {
        formatDateTime: (value) => `DT(${value})`,
        timeAgo: (value) => `AGO(${value})`,
        humanizeLabel: (value) => {
          const text = String(value).split('_').join(' ').split('-').join(' ');
          return text.charAt(0).toUpperCase() + text.slice(1);
        }
      }
    };
    table = loadModule();
  });

  afterEach(() => {
    delete global.LanaLibraryColumnFilters;
    delete global.Lex;
  });

  describe('storedQueryParams', () => {
    test('maps paging and sort to the library API', () => {
      const params = new URLSearchParams(table.storedQueryParams({ page: 3, limit: 50, sortBy: 'name', sortDir: 'asc' }, ''));
      expect(params.get('page')).toBe('3');
      expect(params.get('page_size')).toBe('50');
      expect(params.get('sort_by')).toBe('name');
      expect(params.get('sort_order')).toBe('asc');
      expect(params.has('search')).toBe(false);
    });

    test('defaults to newest edits first and ignores unsortable columns', () => {
      const params = new URLSearchParams(table.storedQueryParams({ sortBy: 'type' }, ''));
      expect(params.get('page')).toBe('1');
      expect(params.get('page_size')).toBe('20');
      expect(params.get('sort_by')).toBe('updated_at');
      expect(params.get('sort_order')).toBe('desc');
    });

    test('maps every column filter and the search', () => {
      const now = new Date('2026-10-21T12:00:00Z');
      const params = new URLSearchParams(table.storedQueryParams({
        filters: {
          name: { operator: 'contains', value: 'lease' },
          type: { operator: 'in', value: ['pdf', 'docx'] },
          workspace: { operator: 'in', value: ['MATT-1', 'MATT-2'] },
          created_at: { operator: 'in', value: ['7d'] },
          updated_at: { operator: 'in', value: ['older'] }
        }
      }, '  acme ', now));
      expect(params.get('name')).toBe('lease');
      expect(params.get('extensions')).toBe('pdf,docx');
      expect(params.get('workspaces')).toBe('MATT-1,MATT-2');
      expect(params.get('created_after')).toBe('2026-10-14T12:00:00.000Z');
      expect(params.has('created_before')).toBe(false);
      expect(params.get('updated_before')).toBe('2026-09-21T12:00:00.000Z');
      expect(params.get('search')).toBe('acme');
    });
  });

  test('mapStoredFile keeps raw values', () => {
    const file = {
      id: 7,
      original_filename: 'Lease Agreement.PDF',
      filename: 'lease-agreement.pdf',
      matter_name: 'Acme v. Globex',
      client_matter: 'MATT-53937',
      is_template: 1,
      document_type: 'settlement_agreement',
      created_at: '2026-01-01T10:00:00Z',
      updated_at: '2026-02-01T10:00:00Z'
    };
    const row = table.mapStoredFile(file);
    expect(row).toMatchObject({
      id: 'storage:7',
      name: 'Lease Agreement.PDF',
      type: 'pdf',
      workspace: 'Acme v. Globex',
      is_template: true,
      created_at: '2026-01-01T10:00:00Z',
      updated_at: '2026-02-01T10:00:00Z',
      _kind: 'storage',
      _fileId: 7,
      _matterId: 'MATT-53937'
    });
    expect(row._raw).toBe(file);
  });

  test('mapStoredFile hides uuid workspace labels', () => {
    const row = table.mapStoredFile({ id: 1, filename: 'a.docx', matter_name: '6f1c2a34-1b2c-4d5e-8f90-1234567890ab' });
    expect(row.workspace).toBe('');
    expect(row.updated_at).toBe('');
  });

  test('mapPresentation keeps raw values', () => {
    const row = table.mapPresentation({ id: 'p1', title: 'Board Update', style: 'blueprint', card_count: 8, created_at: '2026-03-01T00:00:00Z' });
    expect(row).toMatchObject({ id: 'deck:p1', name: 'Board Update', style: 'blueprint', cards: 8, created_at: '2026-03-01T00:00:00Z', _kind: 'deck', _presentationId: 'p1' });
  });

  test('workspaceHref links to workspace details by matter id', () => {
    expect(table.workspaceHref('MATT-1', '../')).toBe('../workspace-details.html?id=MATT-1');
    expect(table.workspaceHref('a b')).toBe('workspace-details.html?id=a%20b');
  });

  describe('renderers', () => {
    test('stored cells format in the renderer', () => {
      const r = table.storedRenderers();
      const row = table.mapStoredFile({ id: 1, filename: 'x.pdf', matter_name: 'Acme', client_matter: 'MATT-9', document_type: 'nda' });
      expect(r.name('x.pdf', row)).toContain('Nda');
      expect(r.type('pdf')).toContain('PDF');
      expect(r.type('')).toContain('—');
      expect(r.workspace('Acme', row)).toContain('data-matter-id="MATT-9"');
      expect(r.workspace('', row)).toContain('—');
      expect(r.is_template(true)).toContain('<lex-badge label="Template"');
      expect(r.is_template(false)).toContain('—');
      expect(r.created_at('2026-01-01T00:00:00Z')).toContain('DT(2026-01-01T00:00:00Z)');
      expect(r.updated_at('2026-01-02T00:00:00Z')).toContain('AGO(2026-01-02T00:00:00Z)');
      expect(r.updated_at('2026-01-02T00:00:00Z')).toContain('title="DT(2026-01-02T00:00:00Z)"');
      expect(r.created_at('')).toContain('—');
    });

    test('escapes names', () => {
      const r = table.storedRenderers();
      expect(r.name('<b>x</b>', { _raw: {} })).toContain('&lt;b&gt;x&lt;/b&gt;');
    });

    test('presentation style is a capitalised badge', () => {
      const r = table.presentationRenderers();
      expect(r.style('blueprint')).toContain('label="Blueprint"');
      expect(r.cards(4)).toContain('4');
      expect(r.created_at('2026-01-01T00:00:00Z')).toContain('DT(');
    });
  });

  describe('filter options', () => {
    test('stored table filters every column the API can filter', () => {
      const map = table.storedFilterOptions({ workspaces: [{ value: 'MATT-1', label: 'Acme' }], extensions: ['pdf'] });
      expect(map.name).toEqual(expect.objectContaining({ text: true }));
      expect(map.type.options).toEqual([{ value: 'pdf', label: 'PDF' }]);
      expect(map.workspace.options).toEqual([{ value: 'MATT-1', label: 'Acme' }]);
      expect(map.created_at).toEqual({ single: true, options: columnFilters.EDITED_RANGE_OPTIONS });
      expect(map.updated_at.single).toBe(true);
    });

    test('stored type filter falls back to built-in extensions', () => {
      const map = table.storedFilterOptions({});
      expect(map.type.options.map((o) => o.value)).toEqual(table.DEFAULT_EXTENSIONS);
      expect(map.workspace).toBeUndefined();
    });

    test('presentation filters: styles from rows, section ranges, created ranges', () => {
      const rows = [
        table.mapPresentation({ id: 1, style: 'noir', card_count: 3 }),
        table.mapPresentation({ id: 2, style: 'editorial', card_count: 12 })
      ];
      const map = table.presentationFilterOptions(rows);
      expect(map.name.text).toBe(true);
      expect(map.style.options).toEqual([{ value: 'editorial', label: 'Editorial' }, { value: 'noir', label: 'Noir' }]);
      expect(map.cards.match(3, ['1_5'])).toBe(true);
      expect(map.cards.match(12, ['1_5'])).toBe(false);
      expect(map.cards.match(12, ['11_plus'])).toBe(true);
      expect(map.cards.match(8, ['6_10'])).toBe(true);
      const recent = new Date(Date.now() - 60 * 1000).toISOString();
      expect(map.created_at.match(recent, ['7d'])).toBe(true);
      expect(map.created_at.match('2020-01-01T00:00:00Z', ['7d'])).toBe(false);
    });
  });

  test('pagination and files from the library response', () => {
    const response = { files: [{ id: 1 }], pagination: { page: 2, page_size: 20, total: 41, total_pages: 3 } };
    expect(table.filesFromResponse(response)).toHaveLength(1);
    expect(table.paginationFromResponse(response, 1)).toEqual({ page: 2, page_size: 20, total: 41, total_pages: 3 });
    expect(table.paginationFromResponse({ documents: [] }, 0).total).toBe(0);
  });

  test('empty text reflects filtering', () => {
    expect(table.emptyText('stored', true)).toMatch(/clear the filters/);
    expect(table.emptyText('stored', false)).toBe('No organization documents yet.');
    expect(table.emptyText('studio', false)).toBe('No saved Doc Studio files yet.');
    expect(table.countLabel(1)).toBe('1 file');
    expect(table.countLabel(3)).toBe('3 files');
  });

  test('sort options use the column labels', () => {
    expect(table.STORED_SORT_OPTIONS.map((o) => o.label)).toEqual(['Last edited', 'Created', 'File']);
    expect(table.PRESENTATION_SORT_OPTIONS.map((o) => o.label)).toContain('Created');
    expect(Object.keys(table.SORT_BY_COLUMN).sort()).toEqual(table.STORED_SORT_OPTIONS.map((o) => o.value).sort());
  });
});
