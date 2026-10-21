/*
 * document-studio-templates-mapper.js
 *
 * Pure, side-effect-free helpers for the unified Document Studio Templates view
 * (Phase 3 Part C3 client adoption). This is a THIN presentation layer over the
 * backend's UnifiedTemplate read model:
 *   GET /api/v1/document-studio/templates
 *   GET /api/v1/document-studio/templates/:kind/:id
 *
 * Contract — every function here is pure: no fetch, no DOM, no localStorage.
 * Backend rules (fan-out, ACL, normalization) live in the service; this file
 * only builds the query string and maps DTOs to display view-models.
 *
 *   - buildListQuery(filters)       -> query string (no leading '?') or ''
 *   - kindLabel(kind)               -> user-facing template type | kind
 *   - scopeLabel(template)          -> 'Org-wide' | 'Matter' | '—'
 *   - mapTemplateRow(dto)           -> list-row view-model
 *   - mapTemplates(response)        -> { rows, total, countsByKind, limit, offset }
 *
 * NOTE: NO regex anywhere — string methods only (per LEX-COMPONENT-RULES sec 11).
 */

(function (global) {
  'use strict';

  var VALID_KINDS = ['fill', 'compose', 'render'];
  // Mirrors the backend validator's sort_by / sort_order enums.
  var VALID_SORT_FIELDS = ['name', 'updated_at', 'created_at', 'workspace', 'kind', 'document_type', 'variables'];
  var VALID_SORT_ORDERS = ['asc', 'desc'];

  var KIND_LABELS = {
    fill: 'Document',
    compose: 'Document set',
    render: 'Layout'
  };

  /**
   * Display label for a template kind.
   * @param {string} kind
   * @returns {string}
   */
  function kindLabel(kind) {
    var k = String(kind || '').toLowerCase();
    return KIND_LABELS[k] || (kind ? String(kind) : '');
  }

  /**
   * Append a value to the params array as `key=encoded`, skipping empties.
   * Booleans are always emitted (false is meaningful for include_org_wide).
   */
  function _appendParam(parts, key, value) {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' && value.trim() === '') return;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
  }

  /**
   * Build the query string for the list endpoint from a filters object.
   * Returns the query WITHOUT a leading '?' (empty string when no params).
   *
   * Only known query params are emitted, mirroring the backend validator
   * (document-studio.validators.js): kind, matter_id, document_type, category,
   * q, include_org_wide, limit, offset, sort_by, sort_order, workspaces,
   * updated_after, updated_before, created_after, created_before.
   *
   * @param {Object} [filters]
   * @param {string|Array} [filters.kind]      - 'fill' | 'compose' | 'render', or a list
   * @param {string} [filters.matterId]        - string matter key
   * @param {string} [filters.documentType]
   * @param {string} [filters.category]
   * @param {string} [filters.q]               - free-text search
   * @param {boolean} [filters.includeOrgWide] - default omitted (backend defaults true)
   * @param {number} [filters.limit]
   * @param {number} [filters.offset]
   * @param {string} [filters.sortBy]          - name | updated_at | created_at | workspace | kind | document_type | variables
   * @param {string} [filters.sortOrder]       - 'asc' | 'desc'
   * @param {Array}  [filters.workspaces]      - matter ids; 'organization' = org-wide
   * @param {string} [filters.updatedAfter]    - ISO datetime (inclusive)
   * @param {string} [filters.updatedBefore]   - ISO datetime (exclusive)
   * @param {string} [filters.createdAfter]    - ISO datetime (inclusive)
   * @param {string} [filters.createdBefore]   - ISO datetime (exclusive)
   * @returns {string}
   */
  function buildListQuery(filters) {
    var f = filters || {};
    var parts = [];

    var kinds = (Array.isArray(f.kind) ? f.kind : String(f.kind || '').split(','))
      .map(function (k) { return String(k).trim().toLowerCase(); })
      .filter(function (k, i, all) { return VALID_KINDS.indexOf(k) !== -1 && all.indexOf(k) === i; });
    if (kinds.length) {
      _appendParam(parts, 'kind', kinds.join(','));
    }

    _appendParam(parts, 'matter_id', f.matterId);
    // One document type or a list (the Template Type column filter).
    var documentTypes = (Array.isArray(f.documentType) ? f.documentType : [f.documentType])
      .map(function (t) { return t === undefined || t === null ? '' : String(t).trim(); })
      .filter(Boolean);
    if (documentTypes.length) _appendParam(parts, 'document_type', documentTypes.join(','));
    _appendParam(parts, 'name', f.name);
    if (typeof f.minVariables === 'number' && f.minVariables >= 0) _appendParam(parts, 'min_variables', f.minVariables);
    if (typeof f.maxVariables === 'number' && f.maxVariables > 0) _appendParam(parts, 'max_variables', f.maxVariables);
    _appendParam(parts, 'category', f.category);
    _appendParam(parts, 'q', f.q);

    // include_org_wide is only sent when explicitly false, so we don't fight
    // the backend default (true) on every request.
    if (f.includeOrgWide === false) {
      _appendParam(parts, 'include_org_wide', 'false');
    }

    if (typeof f.limit === 'number' && f.limit > 0) {
      _appendParam(parts, 'limit', f.limit);
    }
    if (typeof f.offset === 'number' && f.offset >= 0) {
      _appendParam(parts, 'offset', f.offset);
    }

    var workspaces = (Array.isArray(f.workspaces) ? f.workspaces : [])
      .map(function (w) { return String(w).trim(); })
      .filter(Boolean);
    if (workspaces.length) _appendParam(parts, 'workspaces', workspaces.join(','));
    _appendParam(parts, 'updated_after', f.updatedAfter);
    _appendParam(parts, 'updated_before', f.updatedBefore);
    _appendParam(parts, 'created_after', f.createdAfter);
    _appendParam(parts, 'created_before', f.createdBefore);

    var sortBy = f.sortBy ? String(f.sortBy).toLowerCase() : '';
    if (VALID_SORT_FIELDS.indexOf(sortBy) !== -1) {
      _appendParam(parts, 'sort_by', sortBy);
      var sortOrder = f.sortOrder ? String(f.sortOrder).toLowerCase() : '';
      if (VALID_SORT_ORDERS.indexOf(sortOrder) !== -1) _appendParam(parts, 'sort_order', sortOrder);
    }

    return parts.join('&');
  }

  /**
   * Display label for a template's scope.
   * @param {Object} template - UnifiedTemplate (or row view-model)
   * @returns {string}
   */
  function scopeLabel(template) {
    var t = template || {};
    var accessScope = String(t.access_scope || t.accessScope || '').toLowerCase();
    if (accessScope === 'organization') return 'Organization';
    if (accessScope === 'workspace') return 'Workspace';
    if (accessScope === 'private') return 'Private';
    var scope = String(t.scope || '').toLowerCase();
    if (scope === 'org') return 'Org-wide';
    if (scope === 'matter') return 'Matter';
    return '—';
  }

  /**
   * Map a single UnifiedTemplate DTO to a display row view-model. Light
   * formatting only (labels, fallbacks); no backend rules re-implemented.
   *
   * @param {Object} dto - UnifiedTemplate from the API
   * @returns {Object} row view-model
   */
  function mapTemplateRow(dto) {
    var t = dto || {};
    var kind = String(t.kind || '').toLowerCase();

    return {
      kind: kind,
      kindLabel: kindLabel(kind),
      id: t.id != null ? String(t.id) : '',
      name: t.display_filename || t.original_filename || t.name
        ? String(t.display_filename || t.original_filename || t.name)
        : 'Untitled template',
      description: t.description != null ? String(t.description) : '',
      documentType: t.document_type != null ? String(t.document_type) : '',
      documentTypeLabel: t.document_type_label != null ? String(t.document_type_label) : '',
      category: t.category != null ? String(t.category) : '',
      scope: String(t.scope || '').toLowerCase(),
      accessScope: String(t.access_scope || '').toLowerCase(),
      scopeLabel: scopeLabel(t),
      matterId: t.matter_id != null ? String(t.matter_id) : '',
      matterName: t.matter_name != null ? String(t.matter_name) : '',
      // Hosting workspace key (always set for fill rows, even org-wide ones
      // whose matter_id is null by design) — used for File Editor handoffs.
      sourceMatterId: t.source_matter_id != null ? String(t.source_matter_id) : '',
      contentType: t.content_type != null ? String(t.content_type) : '',
      status: t.status != null ? String(t.status) : '',
      updatedAt: t.updated_at || null,
      createdAt: t.created_at || null,
      documentCount: typeof t.document_count === 'number' ? t.document_count : null,
      variableCount: typeof t.variable_count === 'number' ? t.variable_count : null,
      version: typeof t.version === 'number' ? t.version : null
    };
  }

  /**
   * Map a list response { templates, total, counts_by_kind, limit, offset }
   * to a view-model the page can render directly.
   *
   * @param {Object} response - raw API body
   * @returns {{ rows: Array, total: number,
   *   countsByKind: {fill:number, compose:number, render:number},
   *   limit: number, offset: number }}
   */
  function mapTemplates(response) {
    var res = response || {};
    var templates = Array.isArray(res.templates) ? res.templates : [];
    var rows = [];
    for (var i = 0; i < templates.length; i++) {
      rows.push(mapTemplateRow(templates[i]));
    }

    var counts = res.counts_by_kind || {};

    return {
      rows: rows,
      total: typeof res.total === 'number' ? res.total : rows.length,
      countsByKind: {
        fill: typeof counts.fill === 'number' ? counts.fill : 0,
        compose: typeof counts.compose === 'number' ? counts.compose : 0,
        render: typeof counts.render === 'number' ? counts.render : 0
      },
      limit: typeof res.limit === 'number' ? res.limit : 0,
      offset: typeof res.offset === 'number' ? res.offset : 0
    };
  }

  /**
   * Build a { label, value } field, coercing value to a display string and
   * dropping it (returns null) when there is nothing meaningful to show.
   */
  function _field(label, value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    return { label: label, value: String(value) };
  }

  /**
   * Push a field onto the list only when it has a value.
   */
  function _pushField(fields, label, value) {
    var f = _field(label, value);
    if (f) fields.push(f);
  }

  /**
   * Shape the kind-specific detail view-model for the drawer from a get-one
   * UnifiedTemplate DTO. PURE: no DOM, no fetch.
   *
   * IMPORTANT — uses only the fields the get-one endpoint actually returns. The
   * backend normalizers (template-registry.normalizers.js) collapse each engine
   * row onto the shared UnifiedTemplate shape; the response carries no raw HTML
   * template body, no document list, and no variable-name list (only counts).
   * So this maps the per-kind subset of real fields, not invented extras.
   *
   * Returns:
   *   {
   *     kind, kindLabel,
   *     base: row view-model (mapTemplateRow output),
   *     sections: [ { title, fields: [{label,value}] } ]
   *   }
   *
   * @param {string} kind - 'fill' | 'compose' | 'render'
   * @param {Object} dto  - UnifiedTemplate from GET .../templates/:kind/:id
   * @returns {Object}
   */
  function mapTemplateDetail(kind, dto) {
    var base = mapTemplateRow(dto);
    var k = base.kind || (kind ? String(kind).toLowerCase() : '');
    var sections = [];

    if (k === 'render') {
      // render: org-scoped HTML template. Real fields: category, version,
      // variable_count, is_public (status is always derived 'active').
      var renderFields = [];
      _pushField(renderFields, 'Category', base.category);
      _pushField(renderFields, 'Version', base.version);
      _pushField(renderFields, 'Variables', base.variableCount);
      var isPublic = (dto && dto.is_public != null) ? (dto.is_public ? 'Yes' : 'No') : null;
      _pushField(renderFields, 'Public', isPublic);
      sections.push({ title: 'Layout', fields: renderFields });
    } else if (k === 'compose') {
      // compose: template set. Real fields: document_type(_label),
      // document_count, status.
      var composeFields = [];
      _pushField(composeFields, 'Document type', base.documentTypeLabel || base.documentType);
      _pushField(composeFields, 'Documents in set', base.documentCount);
      _pushField(composeFields, 'Status', base.status);
      sections.push({ title: 'Document set', fields: composeFields });
    } else if (k === 'fill') {
      // fill: matter-scoped fillable document. Real fields: document_type,
      // variable_count (placeholders), status, matter scope.
      var fillFields = [];
      _pushField(fillFields, 'Document type', base.documentType);
      _pushField(fillFields, 'Released version', base.version);
      _pushField(fillFields, 'Variables', base.variableCount);
      _pushField(fillFields, 'Workspace', base.scope === 'org' ? 'Organization' : (base.matterName || base.matterId));
      _pushField(fillFields, 'Status', base.status);
      sections.push({ title: 'Document template', fields: fillFields });
    }

    return {
      kind: k,
      kindLabel: kindLabel(k),
      base: base,
      sections: sections
    };
  }

  var moduleApi = {
    VALID_KINDS: VALID_KINDS,
    buildListQuery: buildListQuery,
    kindLabel: kindLabel,
    scopeLabel: scopeLabel,
    mapTemplateRow: mapTemplateRow,
    mapTemplates: mapTemplates,
    mapTemplateDetail: mapTemplateDetail
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.DocumentStudioTemplatesMapper = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
