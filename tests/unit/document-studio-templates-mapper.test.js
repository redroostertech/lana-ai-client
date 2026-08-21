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
      expect(mapper.kindLabel('fill')).toBe('Document');
      expect(mapper.kindLabel('compose')).toBe('Document set');
      expect(mapper.kindLabel('render')).toBe('Layout');
      expect(mapper.kindLabel('FILL')).toBe('Document');
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
      expect(mapper.scopeLabel({ scope: 'matter', access_scope: 'workspace' })).toBe('Workspace');
      expect(mapper.scopeLabel({ scope: 'matter', access_scope: 'private' })).toBe('Private');
      expect(mapper.scopeLabel({ scope: 'org', access_scope: 'organization' })).toBe('Organization');
    });
  });

  describe('mapTemplateRow — org-wide editable templates', () => {
    test('org-wide fill row shows Org-wide with no matter pill but keeps the hosting workspace key', () => {
      const row = mapper.mapTemplateRow({
        kind: 'fill',
        id: 'doc-1',
        name: 'Affidavit Template.docx',
        scope: 'org',
        matter_id: null,
        source_matter_id: 'MATT-00044',
        content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      expect(row.scope).toBe('org');
      expect(row.scopeLabel).toBe('Org-wide');
      expect(row.matterId).toBe('');
      expect(row.sourceMatterId).toBe('MATT-00044');
      expect(row.contentType).toContain('wordprocessingml');
    });

    test('missing handoff fields map to empty strings', () => {
      const row = mapper.mapTemplateRow({ kind: 'compose', id: 'set-1' });
      expect(row.sourceMatterId).toBe('');
      expect(row.contentType).toBe('');
      expect(row.matterName).toBe('');
    });

    test('workspace name flows through for matter-scoped rows and into the detail Workspace field', () => {
      const dto = {
        kind: 'fill',
        id: 'doc-2',
        name: 'NDA.docx',
        scope: 'matter',
        matter_id: 'MATT-00007',
        matter_name: 'Acme Executive Separation'
      };
      expect(mapper.mapTemplateRow(dto).matterName).toBe('Acme Executive Separation');
      const detail = mapper.mapTemplateDetail('fill', dto);
      const fillSection = detail.sections.find((s) => s.title === 'Document template');
      const workspaceField = fillSection.fields.find((f) => f.label === 'Workspace');
      expect(workspaceField.value).toBe('Acme Executive Separation');
    });

    test('org-wide rows show Organization as the detail Workspace field', () => {
      const detail = mapper.mapTemplateDetail('fill', {
        kind: 'fill', id: 'doc-1', name: 'Affidavit.docx', scope: 'org', source_matter_id: 'MATT-00044'
      });
      const fillSection = detail.sections.find((s) => s.title === 'Document template');
      const workspaceField = fillSection.fields.find((f) => f.label === 'Workspace');
      expect(workspaceField.value).toBe('Organization');
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
      expect(row.kindLabel).toBe('Document set');
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

  describe('mapTemplateDetail', () => {
    function fieldMap(section) {
      const map = {};
      (section.fields || []).forEach((f) => { map[f.label] = f.value; });
      return map;
    }

    test('render: surfaces category, version, variables and public flag', () => {
      const detail = mapper.mapTemplateDetail('render', {
        kind: 'render',
        id: 'tpl-9',
        name: 'HTML Letter',
        category: 'letters',
        scope: 'org',
        version: 2,
        variable_count: 5,
        is_public: true
      });
      expect(detail.kind).toBe('render');
      expect(detail.kindLabel).toBe('Layout');
      expect(detail.base.name).toBe('HTML Letter');
      expect(detail.sections).toHaveLength(1);
      expect(detail.sections[0].title).toBe('Layout');
      const f = fieldMap(detail.sections[0]);
      expect(f.Category).toBe('letters');
      expect(f.Version).toBe('2');
      expect(f.Variables).toBe('5');
      expect(f.Public).toBe('Yes');
    });

    test('render: is_public false renders "No", absent omits the field', () => {
      const noPublic = mapper.mapTemplateDetail('render', { kind: 'render', id: 't', name: 'T' });
      expect(fieldMap(noPublic.sections[0]).Public).toBeUndefined();

      const isFalse = mapper.mapTemplateDetail('render', {
        kind: 'render', id: 't', name: 'T', is_public: false
      });
      expect(fieldMap(isFalse.sections[0]).Public).toBe('No');
    });

    test('compose: surfaces document type label, document count and status', () => {
      const detail = mapper.mapTemplateDetail('compose', {
        kind: 'compose',
        id: 'set-1',
        name: 'Demand Package',
        document_type: 'demand',
        document_type_label: 'Demand Letter',
        document_count: 3,
        status: 'active',
        scope: 'org'
      });
      expect(detail.sections[0].title).toBe('Document set');
      const f = fieldMap(detail.sections[0]);
      expect(f['Document type']).toBe('Demand Letter');
      expect(f['Documents in set']).toBe('3');
      expect(f.Status).toBe('active');
    });

    test('compose: falls back to raw document_type when no label', () => {
      const detail = mapper.mapTemplateDetail('compose', {
        kind: 'compose', id: 's', name: 'S', document_type: 'demand'
      });
      expect(fieldMap(detail.sections[0])['Document type']).toBe('demand');
    });

    test('fill: surfaces document type, variables, matter and status', () => {
      const detail = mapper.mapTemplateDetail('fill', {
        kind: 'fill',
        id: 'doc-1',
        name: 'Intake Form',
        document_type: 'intake',
        variable_count: 7,
        matter_id: 'M-100',
        status: 'active',
        scope: 'matter'
      });
      expect(detail.sections[0].title).toBe('Document template');
      const f = fieldMap(detail.sections[0]);
      expect(f['Document type']).toBe('intake');
      expect(f.Variables).toBe('7');
      // The field is labeled Workspace and falls back to the matter key when
      // no workspace name accompanies the row.
      expect(f.Workspace).toBe('M-100');
      expect(f.Status).toBe('active');
    });

    test('drops empty/null fields from kind sections', () => {
      const detail = mapper.mapTemplateDetail('compose', {
        kind: 'compose', id: 's', name: 'S'
      });
      // No document_type, count, or status provided -> no fields.
      expect(detail.sections[0].fields).toEqual([]);
    });

    test('handles null dto and derives kind from the argument', () => {
      const detail = mapper.mapTemplateDetail('render', null);
      expect(detail.kind).toBe('render');
      expect(detail.kindLabel).toBe('Layout');
      expect(detail.base.name).toBe('Untitled template');
      expect(detail.sections).toHaveLength(1);
    });

    test('unknown kind yields no kind-specific sections', () => {
      const detail = mapper.mapTemplateDetail('bogus', { kind: 'bogus', id: 'x', name: 'X' });
      expect(detail.sections).toEqual([]);
    });
  });
});
