const path = require('path');
const fs = require('fs');

const tableApi = require(path.join(__dirname, '../../src/js/shared/skills-table.js'));
const ranges = require(path.join(__dirname, '../../src/js/shared/library-column-filters.js'));

describe('skills-table', () => {
  describe('mapSkillRow', () => {
    test('keeps raw values: slugs, full description, numeric runs, ISO created_at', () => {
      const longText = 'x'.repeat(240);
      const row = tableApi.mapSkillRow({
        skill_id: 'sk-1',
        skill_name: 'Weekly digest',
        skill_description: longText,
        category: 'document-intelligence',
        skill_type: 'event_driven',
        skill_version: '2.1.0',
        installation_count: 12,
        created_at: '2026-10-01T15:16:00Z'
      });
      expect(row).toMatchObject({
        skill_id: 'sk-1',
        skill_name: 'Weekly digest',
        description: longText,
        category: 'document-intelligence',
        skill_type: 'event_driven',
        version: '2.1.0',
        installation_count: 12,
        created_at: '2026-10-01T15:16:00Z'
      });
      expect(row._raw.skill_id).toBe('sk-1');
    });

    test('falls back to config/metadata and defaults', () => {
      const row = tableApi.mapSkillRow({
        skill_id: 'sk-2',
        skill_name: 'A',
        skill_config: { description: 'From config', skill_type: 'manual' },
        metadata: { tags: ['intake'] },
        total_executions: 3
      });
      expect(row.description).toBe('From config');
      expect(row.category).toBe('automation');
      expect(row.skill_type).toBe('manual');
      expect(row.version).toBe('1.0.0');
      expect(row.installation_count).toBe(3);
      expect(row.tags).toEqual(['intake']);
      expect(row.created_at).toBe('');
    });

    test('accepts the renamed automations shape', () => {
      const row = tableApi.mapSkillRow({
        automation_id: 'au-1',
        automation_name: 'Lead intake',
        automation_description: 'Desc',
        automation_version: '3.0.0',
        total_executions: 7,
        created_at: '2026-01-01T00:00:00Z'
      });
      expect(row).toMatchObject({ skill_id: 'au-1', skill_name: 'Lead intake', description: 'Desc', version: '3.0.0', installation_count: 7 });
    });
  });

  describe('labels and options', () => {
    test('labelFor humanizes slugs and enums with a capital first letter', () => {
      expect(tableApi.labelFor('document-intelligence')).toBe('Document intelligence');
      expect(tableApi.labelFor('event_driven')).toBe('Event driven');
      expect(tableApi.labelFor('')).toBe('');
    });

    test('valueOptions lists distinct values with readable labels, sorted', () => {
      const rows = [{ category: 'workflow' }, { category: 'ai-assistance' }, { category: 'workflow' }, { category: '' }];
      expect(tableApi.valueOptions(rows, 'category')).toEqual([
        { value: 'ai-assistance', label: 'Ai assistance' },
        { value: 'workflow', label: 'Workflow' }
      ]);
    });

    test('categoryFilterOptions starts with All', () => {
      expect(tableApi.categoryFilterOptions([{ category: 'automation' }])).toEqual([
        { value: 'all', label: 'All' },
        { value: 'automation', label: 'Automation' }
      ]);
    });
  });

  describe('column filters', () => {
    const rows = [
      tableApi.mapSkillRow({ skill_id: '1', skill_name: 'A', category: 'workflow', skill_type: 'manual', skill_version: '1.0.0', installation_count: 0 }),
      tableApi.mapSkillRow({ skill_id: '2', skill_name: 'B', category: 'automation', skill_type: 'scheduled', skill_version: '2.0.0', installation_count: 150 })
    ];

    test('every column has a filter', () => {
      const map = tableApi.columnFilterOptions(rows, ranges);
      const columns = ['skill_name', 'description', 'category', 'skill_type', 'version', 'installation_count', 'created_at'];
      columns.forEach((col) => expect(map[col]).toBeDefined());
      expect(map.skill_name.text).toBe(true);
      expect(map.description.text).toBe(true);
      expect(map.skill_type.options.map((o) => o.label)).toEqual(['Manual', 'Scheduled']);
      expect(map.version.options.map((o) => o.label)).toEqual(['1.0.0', '2.0.0']);
      expect(map.created_at.single).toBe(true);
      expect(map.created_at.options).toBe(ranges.EDITED_RANGE_OPTIONS);
    });

    test('runs ranges match min inclusive, max exclusive', () => {
      expect(tableApi.inRunRange(0, 'none')).toBe(true);
      expect(tableApi.inRunRange(1, 'none')).toBe(false);
      expect(tableApi.inRunRange(9, '1_10')).toBe(true);
      expect(tableApi.inRunRange(10, '1_10')).toBe(false);
      expect(tableApi.inRunRange(100, 'over_100')).toBe(true);
      expect(tableApi.inRunRange(5, 'unknown')).toBe(true);
      const map = tableApi.columnFilterOptions(rows, ranges);
      expect(map.installation_count.match(150, ['over_100'])).toBe(true);
      expect(map.installation_count.match(3, ['over_100'])).toBe(false);
    });

    test('created range matches through the shared range helper', () => {
      const map = tableApi.columnFilterOptions(rows, ranges);
      const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      expect(map.created_at.match(recent, ['7d'])).toBe(true);
      expect(map.created_at.match(old, ['7d'])).toBe(false);
      expect(map.created_at.match(old, ['older'])).toBe(true);
    });

    test('without the range helper there is no created filter rather than a broken one', () => {
      expect(tableApi.columnFilterOptions(rows, null).created_at).toBeUndefined();
    });
  });

  describe('cellRenderers', () => {
    const renderers = tableApi.cellRenderers();

    test('formats labels in renderers, not rows', () => {
      expect(renderers.category('document-intelligence')).toBe('Document intelligence');
      expect(renderers.skill_type('event_driven')).toBe('Event driven');
    });

    test('name is semibold and escaped; description truncates with the full text in title', () => {
      expect(renderers.skill_name('<b>x</b>')).toContain('skills-table-name');
      expect(renderers.skill_name('<b>x</b>')).toContain('&lt;b&gt;x&lt;/b&gt;');
      const html = renderers.description('A long description');
      expect(html).toContain('skills-table-truncate');
      expect(html).toContain('title="A long description"');
    });

    test('empty cells show a muted dash', () => {
      ['skill_name', 'description', 'category', 'skill_type', 'version', 'created_at'].forEach((col) => {
        expect(renderers[col]('')).toContain('—');
      });
    });

    test('runs show the number', () => {
      expect(renderers.installation_count(1234)).toBe('1,234');
    });

    test('created uses Lex.Utils.formatDateTime', () => {
      const previous = global.Lex;
      global.Lex = { Utils: { formatDateTime: () => '1/20/2026 3:16 PM' } };
      try {
        const html = tableApi.cellRenderers().created_at('2026-01-20T20:16:00Z');
        expect(html).toContain('1/20/2026 3:16 PM');
        expect(html).toContain('datetime="2026-01-20T20:16:00Z"');
      } finally {
        global.Lex = previous;
      }
    });
  });

  describe('state helpers', () => {
    test('empty text depends on search and filters', () => {
      expect(tableApi.isFiltered('', {})).toBe(false);
      expect(tableApi.isFiltered(' a ', {})).toBe(true);
      expect(tableApi.isFiltered('', { category: { operator: 'in', value: ['workflow'] } })).toBe(true);
      expect(tableApi.emptyText(true)).toMatch(/No matching skills/);
      expect(tableApi.emptyText(false)).toBe('No skills yet');
    });

    test('count label', () => {
      expect(tableApi.countLabel(1)).toBe('1 skill');
      expect(tableApi.countLabel(0)).toBe('0 skills');
      expect(tableApi.countLabel(42)).toBe('42 skills');
    });

    test('sort options use the column labels', () => {
      expect(tableApi.SORT_OPTIONS.find((o) => o.value === 'created_at').label).toBe('Created');
    });
  });

  describe('skills.html markup', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../src/skills.html'), 'utf8');
    const tag = html.slice(html.indexOf('<lex-table'), html.indexOf('</lex-table>'));

    test('table follows the standard attributes', () => {
      expect(tag).toContain('id="skillsListView"');
      expect(tag).toContain('lex-table--card');
      expect(tag).toContain('column-filters');
      expect(tag).toContain('limit="20"');
      expect(tag).toContain('aria-label="Skills"');
      ['searchable', 'filterable', 'compact', ' sortable ', 'paginated', 'page-size'].forEach((attr) => {
        expect(tag).not.toContain(attr);
      });
    });

    test('toolbar and scripts are present; no outside pager', () => {
      expect(html).toContain('id="skillsSearch"');
      expect(html).toContain('id="skillsSort"');
      expect(html).toContain('id="skillsSortOrder"');
      expect(html).toContain('id="skillsCount"');
      expect(html).toContain('id="skillsSectionCount"');
      expect(html).not.toContain('id="list-pagination"');
      expect(html).toContain('js/lex/components/form/lex-input.js');
      expect(html).toContain('js/shared/library-column-filters.js');
      expect(html.indexOf('js/shared/skills-table.js')).toBeLessThan(html.indexOf('js/skills.js'));
    });
  });
});
