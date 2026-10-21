const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const table = require(path.join(SRC, 'js/shared/document-types-table.js'));
const ranges = require(path.join(SRC, 'js/shared/library-column-filters.js'));

describe('document-types-table: Learned Document Types', () => {
  // Shapes from GET /api/v1/matters/:matterId/document-types (listDocumentTypes).
  const types = [
    { document_type: 'engagement_letter', document_count: 7, avg_confidence: 0.82, source: 'auto_detected', has_structure: false },
    { document_type: 'demand_letter', document_type_label: 'Demand letter', document_count: 3, avg_confidence: 0.4,
      structure_confidence: 0.91, source: 'template_set', has_structure: true, template_set_name: 'Demands',
      created_at: '2026-10-01T10:00:00Z' },
    { document_type: 'retainer', document_count: '0', avg_confidence: null, source: 'template_set', has_structure: false }
  ];

  test('rows keep raw values and the record; confidence reads the API fields', () => {
    const rows = table.buildRows(types);
    expect(rows[0]).toMatchObject({ id: 'engagement_letter', document_type: 'engagement_letter', source: 'auto_detected',
      document_count: 7, confidence: 82, structure: 'not_analyzed', created_at: '' });
    // A learned structure's confidence wins over the auto-detected average.
    expect(rows[1]).toMatchObject({ document_type: 'Demand letter', confidence: 91, structure: 'learned', created_at: '2026-10-01T10:00:00Z' });
    expect(rows[2]).toMatchObject({ document_count: 0, confidence: null });
    expect(rows[1]._raw).toBe(types[1]);
  });

  test('renderers humanize the type, badge source/confidence/structure and format Created', () => {
    global.Lex = { Utils: {
      humanizeLabel: (v) => { const t = String(v).split('_').join(' '); return t.charAt(0).toUpperCase() + t.slice(1); },
      formatDateTime: () => '10/1/2026 6:00 AM',
      timeAgo: () => '3 weeks ago'
    } };
    try {
      const rows = table.buildRows(types);
      const r = table.renderers();
      expect(r.document_type(rows[0].document_type, rows[0])).toContain('Engagement letter');
      expect(r.document_type(rows[1].document_type, rows[1])).toContain('Demands');
      expect(r.document_type('<b>x</b>', {})).not.toContain('<b>');
      expect(r.source('template_set')).toBe('<lex-badge label="Template set" color="indigo" size="sm"></lex-badge>');
      expect(r.confidence(82)).toContain('color="green"');
      expect(r.confidence(55)).toContain('color="yellow"');
      expect(r.confidence(10)).toContain('label="10%"');
      expect(r.confidence(null)).toContain('—');
      expect(r.structure('learned')).toContain('label="Learned"');
      expect(r.created_at('2026-10-01T10:00:00Z')).toContain('10/1/2026 6:00 AM');
      expect(r.created_at('2026-10-01T10:00:00Z')).toContain('title="3 weeks ago"');
      expect(r.created_at('')).toContain('—');
    } finally {
      delete global.Lex;
    }
  });

  test('every column has a filter; numbers and dates filter by range', () => {
    const rows = table.buildRows(types);
    const map = table.filterOptions(rows, ranges);
    expect(Object.keys(map).sort()).toEqual(['confidence', 'created_at', 'document_count', 'document_type', 'source', 'structure']);
    expect(map.document_type.text).toBe(true);
    expect(map.source.options).toEqual([{ value: 'auto_detected', label: 'Auto detected' }, { value: 'template_set', label: 'Template set' }]);
    expect(map.document_count.single).toBe(true);
    expect(map.document_count.match(7, ['5-20'])).toBe(true);
    expect(map.document_count.match(20, ['5-20'])).toBe(false);
    expect(map.confidence.match(70, ['70-'])).toBe(true);
    expect(map.confidence.match(null, ['0-40'])).toBe(false);
    expect(map.created_at.options).toBe(ranges.EDITED_RANGE_OPTIONS);
    expect(map.created_at.match(new Date().toISOString(), ['today'])).toBe(true);
    expect(map.created_at.match('', ['today'])).toBe(false);
  });

  test('empty copy says when the filters emptied the table', () => {
    expect(table.emptyText(false)).toBe('No document types learned yet');
    expect(table.emptyText(true)).toContain('clear the filters');
  });

  test('workspace-details renders the lex-table, not a hand-built <table>', () => {
    const js = fs.readFileSync(path.join(SRC, 'js/workspace-details.js'), 'utf8');
    const start = js.indexOf('function buildDocumentTypesContent(');
    const body = js.slice(start, js.indexOf('function buildTemplateSetsContent(', start));
    expect(body).toContain('<lex-table id="docTypesTable" class="wd-doc-types-table lex-table--card" column-filters');
    expect(body).toContain('labels="Type,Source,Documents,Confidence,Structure,Created"');
    expect(body).not.toMatch(/<table[\s>]/);
    expect(body).not.toMatch(/\b(searchable|filterable|compact)\b/);
    const html = fs.readFileSync(path.join(SRC, 'workspace-details.html'), 'utf8');
    expect(html).toContain('<script src="js/shared/document-types-table.js"></script>');
  });
});
