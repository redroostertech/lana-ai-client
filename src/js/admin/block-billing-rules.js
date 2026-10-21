/**
 * Block Billing Rules Admin Page
 *
 * CRUD interface for managing organization block billing rules.
 * Rules define patterns that match activity combinations and produce
 * composite activity types with UTBMS billing codes.
 */
(function () {
  'use strict';

  var _rules = [];
  var _utbmsCodes = [];

  var ACTIVITY_TYPES = ['research', 'review', 'drafting', 'communication', 'case_management', 'general'];
  var ACTIVITY_LABELS = {
    research: 'Research', review: 'Review', drafting: 'Drafting',
    communication: 'Communication', case_management: 'Case Mgmt', general: 'General'
  };

  var TABLE_ID = 'bbRulesTable';
  var PAGE_SIZE = 200;   // the API's maximum page
  var _count = null;

  function init() {
    _wireButtons();
    _loadUtbmsCodes();
    var table = document.getElementById(TABLE_ID);
    if (!table || !window.AdminTableKit) return;
    window.AdminTableKit.whenTableReady().then(function () {
      _wireTable(table);
      _loadRules();
    });
  }

  // ---------------------------------------------------------------------------
  // Table (docs/TABLE-STANDARD.md): every rule is loaded (all pages), so the
  // table sorts, filters and pages them client-side.
  // ---------------------------------------------------------------------------

  function mapRule(r) {
    return {
      id: String(r.id || ''),
      name: r.name || '',
      required_activity_types: (r.required_activity_types || []).slice(),
      composite_activity_type: r.composite_activity_type || '',
      billing_code: r.billing_code || '',
      priority: r.priority === null || r.priority === undefined ? null : Number(r.priority),
      max_gap_minutes: r.max_gap_minutes === null || r.max_gap_minutes === undefined ? null : Number(r.max_gap_minutes),
      status: r.is_active ? 'active' : 'inactive',
      created_at: r.created_at || '',
      actions: '',
      _raw: r
    };
  }

  function activityLabel(type) {
    return ACTIVITY_LABELS[type] || Lex.Utils.humanizeLabel(type);
  }

  function cellRenderers() {
    var kit = window.AdminTableKit;
    return {
      name: function (val, row) {
        var raw = (row && row._raw) || {};
        return kit.nameCell(val, raw.description || '');
      },
      required_activity_types: function (val, row) {
        var types = (val || []).map(activityLabel).join(', ');
        if (!types) return kit.muted('');
        var min = row && row._raw ? row._raw.min_distinct_types : null;
        var text = types + (min ? ' (min ' + min + ')' : '');
        return '<span class="admin-table-text" title="' + kit.esc(text) + '">' + kit.esc(text) + '</span>';
      },
      composite_activity_type: function (val) {
        return val ? '<span class="admin-table-text" title="' + kit.esc(val) + '">' + kit.esc(Lex.Utils.capitalizeFirst(val)) + '</span>' : kit.muted('');
      },
      billing_code: function (val) {
        return val ? '<span class="admin-table-text">' + kit.esc(val) + '</span>' : kit.muted('');
      },
      priority: function (val) {
        return val === null ? kit.muted('') : '<span class="admin-table-text">' + kit.esc(String(val)) + '</span>';
      },
      max_gap_minutes: function (val) {
        return val === null ? kit.muted('') : '<span class="admin-table-text">' + kit.esc(val + ' min') + '</span>';
      },
      status: function (val) {
        return kit.badge(val === 'active' ? 'Active' : 'Inactive', val === 'active' ? 'green' : 'gray');
      },
      created_at: function (val) { return kit.timeCell(val); },
      actions: function (_val, row) {
        var id = kit.esc(row.id);
        var html = '<span class="bb-row-actions">' +
          '<button type="button" class="bb-edit-btn" data-id="' + id + '">Edit</button>';
        if (row.status === 'active') {
          html += '<button type="button" class="bb-delete-btn" data-id="' + id + '">Deactivate</button>';
        }
        return html + '</span>';
      }
    };
  }

  var PRIORITY_RANGES = [
    { value: 'lt50', label: 'Under 50', max: 50 },
    { value: '50-100', label: '50–99', min: 50, max: 100 },
    { value: '100-200', label: '100–199', min: 100, max: 200 },
    { value: 'gte200', label: '200 or more', min: 200 }
  ];
  var GAP_RANGES = [
    { value: 'lt15', label: 'Under 15 min', max: 15 },
    { value: '15-30', label: '15–29 min', min: 15, max: 30 },
    { value: 'gte30', label: '30 min or more', min: 30 }
  ];

  function filterOptions(rows) {
    var client = window.AdminClientTables;
    var kit = window.AdminTableKit;
    return {
      name: { text: true, placeholder: 'Name contains...' },
      required_activity_types: {
        options: ACTIVITY_TYPES.map(function (t) { return { value: t, label: activityLabel(t) }; }),
        match: function (cell, values) {
          var types = cell || [];
          return values.some(function (v) { return types.indexOf(v) !== -1; });
        }
      },
      composite_activity_type: { text: true, placeholder: 'Composite type contains...' },
      billing_code: { options: client.valueOptions(rows, 'billing_code', String) },
      priority: client.rangeFilter(PRIORITY_RANGES),
      max_gap_minutes: client.rangeFilter(GAP_RANGES),
      status: { options: kit.labelOptions(['active', 'inactive']) },
      created_at: client.dateFilter()
    };
  }

  function _wireTable(table) {
    table.setCellRenderers(cellRenderers());
    table.setColumnFilterOptions(filterOptions([]));
    _count = window.AdminClientTables.bindCount(table, ['bbCount', 'bbSectionCount'], ['rule', 'rules']);
    window.AdminTableKit.bindToolbar({
      table: table,
      searchId: 'bbSearch',
      sortId: 'bbSort',
      orderId: 'bbSortOrder',
      filterId: 'bbStatusFilter',
      filterKey: 'status',
      noun: ['rule', 'rules'],
      onSearch: function (term) {
        if (table.dataSource) table.dataSource.setSearch(term);
        _count.update();
      }
    });
    table.addEventListener('empty-action', function () { _showRuleForm(null); });
    table.addEventListener('row-click', function (e) {
      var row = e.detail && e.detail.row;
      if (row && row._raw) _showRuleForm(row._raw);
    });
    _wireTableActions(table);
  }

  function _wireButtons() {
    var createBtn = document.getElementById('bbCreateBtn');
    if (createBtn) {
      createBtn.addEventListener('click', function () { _showRuleForm(null); });
    }
    var initBtn = document.getElementById('bbInitBtn');
    if (initBtn) {
      initBtn.addEventListener('click', _initializeDefaults);
    }
  }

  // Every page of rules (the API caps a page at 200), so the client-side
  // table holds the whole set.
  function _fetchAllRules(page, acc) {
    return api.get('/api/v1/billable-hours/block-billing/rules?include_inactive=true&limit=' + PAGE_SIZE + '&page=' + page)
      .then(function (result) {
        var rows = (result && result.data) || [];
        var total = Number(result && result.pagination && result.pagination.total);
        var all = acc.concat(rows);
        if (rows.length === PAGE_SIZE && Number.isFinite(total) && all.length < total) return _fetchAllRules(page + 1, all);
        return all;
      });
  }

  function _loadRules() {
    var table = document.getElementById(TABLE_ID);
    if (!table) return;
    _fetchAllRules(1, [])
      .then(function (rules) {
        _rules = rules;
        var rows = rules.map(mapRule);
        table.setColumnFilterOptions(filterOptions(rows));
        table.setData(rows);
        if (_count) _count.update();
      })
      .catch(function () {
        table.setError('Block billing rules could not be loaded. Check your connection and try again.');
      });
  }

  function _loadUtbmsCodes() {
    api.get('/api/v1/billable-hours/block-billing/utbms-codes')
      .then(function (result) {
        _utbmsCodes = (result && result.data) || [];
      })
      .catch(function () {
        _utbmsCodes = [];
      });
  }

  // Edit / Deactivate buttons (lex-table's row-click ignores buttons).
  function _wireTableActions(table) {
    table.addEventListener('click', function (e) {
      var editBtn = e.target.closest('.bb-edit-btn');
      if (editBtn) {
        e.stopPropagation();
        var rule = _rules.find(function (r) { return r.id === editBtn.getAttribute('data-id'); });
        if (rule) _showRuleForm(rule);
        return;
      }
      var deleteBtn = e.target.closest('.bb-delete-btn');
      if (deleteBtn) {
        e.stopPropagation();
        _deleteRule(deleteBtn.getAttribute('data-id'));
      }
    });
  }

  function _showRuleForm(existingRule) {
    var isEdit = !!existingRule;
    var r = existingRule || {};

    var typesHtml = '';
    for (var ti = 0; ti < ACTIVITY_TYPES.length; ti++) {
      var t = ACTIVITY_TYPES[ti];
      var checked = (r.required_activity_types || []).indexOf(t) !== -1 ? ' checked' : '';
      typesHtml += '<label style="display:flex;align-items:center;gap:0.375rem;font-size:0.8125rem;cursor:pointer;">';
      typesHtml += '<input type="checkbox" class="bb-type-cb" value="' + t + '"' + checked + '>';
      typesHtml += (ACTIVITY_LABELS[t] || t) + '</label>';
    }

    var codeOptions = [{ value: '', label: 'None' }].concat(_utbmsCodes.map(function (c) {
      return { value: String(c.code), label: c.code + ' — ' + c.description };
    }));

    var inputStyle = 'width:100%;padding:0.375rem 0.625rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.8125rem;';

    var html = '<div style="display:flex;flex-direction:column;gap:1rem;">';
    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">Name</label>';
    html += '<input type="text" id="bbFormName" value="' + _escapeHtml(r.name || '') + '" style="' + inputStyle + '" placeholder="e.g. Contract review and correspondence"></div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">';
    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">Priority (lower = higher)</label>';
    html += '<input type="number" id="bbFormPriority" value="' + (r.priority || 100) + '" min="1" max="1000" style="' + inputStyle + '"></div>';
    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">Max Gap (minutes)</label>';
    html += '<input type="number" id="bbFormGap" value="' + (r.max_gap_minutes || 15) + '" min="1" max="120" style="' + inputStyle + '"></div>';
    html += '</div>';

    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.375rem;">Required Activity Types</label>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:0.5rem 1rem;">' + typesHtml + '</div></div>';

    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">Min Distinct Types</label>';
    html += '<input type="number" id="bbFormMinTypes" value="' + (r.min_distinct_types || 2) + '" min="1" max="6" style="' + inputStyle + '"></div>';

    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">Composite Activity Type</label>';
    html += '<input type="text" id="bbFormComposite" value="' + _escapeHtml(r.composite_activity_type || '') + '" style="' + inputStyle + '" placeholder="e.g. Contract review and correspondence"></div>';

    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">UTBMS Billing Code</label>';
    html += '<lex-select id="bbFormCode" searchable="true" aria-label="UTBMS billing code" options=\'' + _escapeAttr(JSON.stringify(codeOptions)) + '\' value="' + _escapeHtml(r.billing_code || '') + '"></lex-select></div>';

    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">Description Hint (for AI)</label>';
    html += '<textarea id="bbFormHint" style="' + inputStyle + 'min-height:3rem;resize:vertical;" placeholder="e.g. Reviewed documents and engaged in related correspondence regarding">' + _escapeHtml(r.description_hint || '') + '</textarea></div>';

    html += '</div>';

    Lex.Drawer.open({
      heading: isEdit ? 'Edit Rule' : 'Create Rule',
      content: html,
      width: 'lg',
      buttons: [
        { label: isEdit ? 'Save Changes' : 'Create Rule', variant: 'primary', id: 'bbFormSaveBtn' }
      ]
    });

    setTimeout(function () {
      var saveBtn = document.getElementById('bbFormSaveBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          _saveRule(isEdit ? r.id : null);
        });
      }
    }, 100);
  }

  function _saveRule(ruleId) {
    var types = [];
    var checkboxes = document.querySelectorAll('.bb-type-cb:checked');
    for (var i = 0; i < checkboxes.length; i++) {
      types.push(checkboxes[i].value);
    }

    if (types.length === 0) {
      if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Select at least one activity type');
      return;
    }

    var nameEl = document.getElementById('bbFormName');
    var compositeEl = document.getElementById('bbFormComposite');
    if (!nameEl || !nameEl.value.trim() || !compositeEl || !compositeEl.value.trim()) {
      if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Name and composite type are required');
      return;
    }

    var data = {
      name: nameEl.value.trim(),
      priority: parseInt(document.getElementById('bbFormPriority').value) || 100,
      max_gap_minutes: parseInt(document.getElementById('bbFormGap').value) || 15,
      required_activity_types: types,
      min_distinct_types: parseInt(document.getElementById('bbFormMinTypes').value) || 2,
      composite_activity_type: compositeEl.value.trim(),
      billing_code: String(document.getElementById('bbFormCode').value || '') || null,
      description_hint: document.getElementById('bbFormHint').value.trim() || null
    };

    var promise = ruleId
      ? api.put('/api/v1/billable-hours/block-billing/rules/' + ruleId, data)
      : api.post('/api/v1/billable-hours/block-billing/rules', data);

    promise
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success(ruleId ? 'Rule updated' : 'Rule created');
        if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
        _loadRules();
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to save rule');
      });
  }

  function _deleteRule(ruleId) {
    function doDelete() {
      api.del('/api/v1/billable-hours/block-billing/rules/' + ruleId)
        .then(function () {
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Rule deactivated');
          _loadRules();
        })
        .catch(function () {
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to deactivate rule');
        });
    }

    Lex.Modal.confirm(
      'Deactivate Rule',
      'Are you sure you want to deactivate this block billing rule?',
      doDelete,
      { confirmText: 'Deactivate', variant: 'danger' }
    );
  }

  function _initializeDefaults() {
    api.post('/api/v1/billable-hours/block-billing/rules/initialize')
      .then(function (result) {
        var count = (result && result.data && result.data.initialized) || 0;
        if (count > 0) {
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success(count + ' default rules initialized');
          _loadRules();
        } else {
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.info('Organization already has rules — no defaults copied');
        }
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to initialize defaults');
      });
  }

  function _escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // For a single-quoted attribute holding JSON.
  function _escapeAttr(text) {
    return String(text).split('&').join('&amp;').split("'").join('&#39;');
  }

  // Pure table logic, exposed for unit tests.
  window.BlockBillingRulesTable = {
    mapRule: mapRule,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions
  };

  document.addEventListener('DOMContentLoaded', init);
})();
