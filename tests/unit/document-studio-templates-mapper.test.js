const path = require('path');

const mapper = require(path.join(
  __dirname,
  '../../src/js/shared/document-studio-templates-mapper.js'
));

describe('document-studio-templates-mapper', () => {
  describe('buildListQuery', () => {
    test('returns empty string for no/empty filters', () => {
      expect(mapper.buildListQuery()).toBe('');
      expect(mapper.buildListQuery({})).toBe('');
      expect(mapper.buildListQuery({ q: '', kind: '', matterId: '' })).toBe('');
    });

    test('emits only known params and encodes values', () => {
      const q = mapper.buildListQuery({
        kind: 'compose',
        matterId: 'M-100',
        documentType: 'settlement_agreement',
        category: 'letters',
        q: 'demand letter'
      });
      expect(q).toContain('kind=compose');
      expect(q).toContain('matter_id=M-100');
      expect(q).toContain('document_type=settlement_agreement');
      expect(q).toContain('category=letters');
      expect(q).toContain('q=demand%20letter');
      // No leading '?'
      expect(q.startsWith('?')).toBe(false);
    });

    test('drops invalid kind values', () => {
      expect(mapper.buildListQuery({ kind: 'bogus' })).toBe('');
      expect(mapper.buildListQuery({ kind: 'FILL' })).toBe('kind=fill');
    });

    test('only sends include_org_wide when explicitly false', () => {
      expect(mapper.buildListQuery({ includeOrgWide: true })).toBe('');
      expect(mapper.buildListQuery({ includeOrgWide: undefined })).toBe('');
      expect(mapper.buildListQuery({ includeOrgWide: false })).toBe('include_org_wide=false');
    });

    test('emits valid limit/offset and skips invalid', () => {
      expect(mapper.buildListQuery({ limit: 25, offset: 50 })).toBe('limit=25&offset=50');
      // offset 0 is valid and meaningful
      expect(mapper.buildListQuery({ offset: 0 })).toBe('offset=0');
      // non-numbers and bad limits are skipped
      expect(mapper.buildListQuery({ limit: 0 })).toBe('');
      expect(mapper.buildListQuery({ limit: '25' })).toBe('');
      expect(mapper.buildListQuery({ offset: -1 })).toBe('');
    });
  });

  describe('kindLabel', () => {
    test('maps known kinds', () => {
      expect(mapper.kindLabel('fill')).toBe('Fill');
      expect(mapper.kindLabel('compose')).toBe('Compose');
      expect(mapper.kindLabel('render')).toBe('Render');
      expect(mapper.kindLabel('FILL')).toBe('Fill');
    });

    test('falls back to raw value', () => {
      expect(mapper.kindLabel('other')).toBe('other');
      expect(mapper.kindLabel('')).toBe('');
      expect(mapper.kindLabel(null)).toBe('');
    });
  });

  describe('scopeLabel', () => {
    test('maps scopes', () => {
      expect(mapper.scopeLabel({ scope: 'org' })).toBe('Org-wide');
      expect(mapper.scopeLabel({ scope: 'matter' })).toBe('Matter');
      expect(mapper.scopeLabel({ scope: 'unknown' })).toBe('—');
      expect(mapper.scopeLabel({})).toBe('—');
      expect(mapper.scopeLabel(null)).toBe('—');
    });
  });

  describe('mapTemplateRow', () => {
    test('maps a compose DTO with counts and labels', () => {
      const row = mapper.mapTemplateRow({
        kind: 'compose',
        id: 'set-1',
        name: 'Demand Package',
        description: 'A set',
        document_type: 'demand',
        document_type_label: 'Demand Letter',
        scope: 'org',
        matter_id: null,
        status: 'active',
        document_count: 3,
        variable_count: null,
        version: null,
        updated_at: '2026-01-01T00:00:00Z'
      });
      expect(row.kind).toBe('compose');
      expect(row.kindLabel).toBe('Compose');
      expect(row.id).toBe('set-1');
      expect(row.name).toBe('Demand Package');
      expect(row.scopeLabel).toBe('Org-wide');
      expect(row.documentTypeLabel).toBe('Demand Letter');
      expect(row.documentCount).toBe(3);
      expect(row.variableCount).toBeNull();
      expect(row.matterId).toBe('');
    });

    test('maps a render DTO and keeps version/variable_count numeric', () => {
      const row = mapper.mapTemplateRow({
        kind: 'render',
        id: 'tpl-9',
        name: 'HTML Letter',
        category: 'letters',
        scope: 'org',
        version: 2,
        variable_count: 5
      });
      expect(row.category).toBe('letters');
      expect(row.version).toBe(2);
      expect(row.variableCount).toBe(5);
      expect(row.documentType).toBe('');
    });

    test('provides a name fallback and coerces ids to string', () => {
      const row = mapper.mapTemplateRow({ kind: 'fill', id: 42 });
      expect(row.id).toBe('42');
      expect(row.name).toBe('Untitled template');
    });

    test('handles null/undefined input', () => {
      const row = mapper.mapTemplateRow(null);
      expect(row.kind).toBe('');
      expect(row.name).toBe('Untitled template');
      expect(row.documentCount).toBeNull();
    });
  });

  describe('mapTemplates', () => {
    test('maps a full list response', () => {
      const view = mapper.mapTemplates({
        templates: [
          { kind: 'fill', id: 'a', name: 'A' },
          { kind: 'render', id: 'b', name: 'B' }
        ],
        total: 2,
        counts_by_kind: { fill: 1, compose: 0, render: 1 },
        limit: 25,
        offset: 0
      });
      expect(view.rows).toHaveLength(2);
      expect(view.rows[0].name).toBe('A');
      expect(view.total).toBe(2);
      expect(view.countsByKind).toEqual({ fill: 1, compose: 0, render: 1 });
      expect(view.limit).toBe(25);
      expect(view.offset).toBe(0);
    });

    test('defaults missing fields safely', () => {
      const view = mapper.mapTemplates({});
      expect(view.rows).toEqual([]);
      expect(view.total).toBe(0);
      expect(view.countsByKind).toEqual({ fill: 0, compose: 0, render: 0 });
      expect(view.limit).toBe(0);
      expect(view.offset).toBe(0);
    });

    test('falls back total to row count when total missing', () => {
      const view = mapper.mapTemplates({
        templates: [{ kind: 'fill', id: 'a', name: 'A' }]
      });
      expect(view.total).toBe(1);
    });
  });
});
