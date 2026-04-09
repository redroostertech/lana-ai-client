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

  function init() {
    _loadRules();
    _loadUtbmsCodes();
    _wireButtons();
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

  function _loadRules() {
    var loading = document.getElementById('bbRulesLoading');
    var table = document.getElementById('bbRulesTable');
    var empty = document.getElementById('bbRulesEmpty');
    if (loading) loading.classList.remove('hidden');
    if (table) table.classList.add('hidden');
    if (empty) empty.classList.add('hidden');

    api.get('/api/v1/billable-hours/block-billing/rules?include_inactive=true')
      .then(function (result) {
        _rules = (result && result.data) || [];
        if (loading) loading.classList.add('hidden');
        if (_rules.length === 0) {
          if (empty) empty.classList.remove('hidden');
        } else {
          if (table) {
            table.classList.remove('hidden');
            table.innerHTML = _renderTable(_rules);
            _wireTableActions();
          }
        }
      })
      .catch(function () {
        if (loading) loading.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
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

  function _renderTable(rules) {
    var html = '<table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">';
    html += '<thead><tr style="background:var(--lex-bg-muted,#f9fafb);text-transform:uppercase;font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);">';
    html += '<th style="padding:0.625rem 1rem;text-align:left;">Priority</th>';
    html += '<th style="padding:0.625rem 1rem;text-align:left;">Name</th>';
    html += '<th style="padding:0.625rem 1rem;text-align:left;">Required Types</th>';
    html += '<th style="padding:0.625rem 1rem;text-align:left;">Composite Type</th>';
    html += '<th style="padding:0.625rem 1rem;text-align:left;">Code</th>';
    html += '<th style="padding:0.625rem 1rem;text-align:left;">Gap</th>';
    html += '<th style="padding:0.625rem 1rem;text-align:center;">Active</th>';
    html += '<th style="padding:0.625rem 1rem;text-align:right;">Actions</th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      var bg = i % 2 === 1 ? 'background:var(--lex-bg-muted,#f9fafb);' : '';
      var opacity = r.is_active ? '' : 'opacity:0.5;';
      var types = (r.required_activity_types || []).map(function (t) {
        return ACTIVITY_LABELS[t] || t;
      }).join(', ');

      html += '<tr style="' + bg + opacity + '">';
      html += '<td style="padding:0.625rem 1rem;font-weight:600;">' + _escapeHtml(String(r.priority)) + '</td>';
      html += '<td style="padding:0.625rem 1rem;">';
      html += '<div style="font-weight:600;">' + _escapeHtml(r.name) + '</div>';
      if (r.description) html += '<div style="font-size:0.7rem;color:var(--lex-text-muted);margin-top:0.125rem;">' + _escapeHtml(r.description) + '</div>';
      html += '</td>';
      html += '<td style="padding:0.625rem 1rem;">' + _escapeHtml(types) + ' (min ' + r.min_distinct_types + ')</td>';
      html += '<td style="padding:0.625rem 1rem;font-weight:600;color:var(--lex-color-blue-700,#1d4ed8);">' + _escapeHtml(r.composite_activity_type) + '</td>';
      html += '<td style="padding:0.625rem 1rem;">' + _escapeHtml(r.billing_code || '-') + '</td>';
      html += '<td style="padding:0.625rem 1rem;">' + r.max_gap_minutes + 'min</td>';
      html += '<td style="padding:0.625rem 1rem;text-align:center;">';
      html += r.is_active
        ? '<span style="color:var(--lex-color-green-600);">Active</span>'
        : '<span style="color:var(--lex-text-muted);">Inactive</span>';
      html += '</td>';
      html += '<td style="padding:0.625rem 1rem;text-align:right;">';
      html += '<button class="bb-edit-btn" data-id="' + _escapeHtml(r.id) + '" style="font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;margin-right:0.5rem;">Edit</button>';
      if (r.is_active) {
        html += '<button class="bb-delete-btn" data-id="' + _escapeHtml(r.id) + '" style="font-size:0.75rem;color:var(--lex-color-red-600);cursor:pointer;background:none;border:none;">Deactivate</button>';
      }
      html += '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    return html;
  }

  function _wireTableActions() {
    var table = document.getElementById('bbRulesTable');
    if (!table) return;

    table.addEventListener('click', function (e) {
      var editBtn = e.target.closest('.bb-edit-btn');
      if (editBtn) {
        var rule = _rules.find(function (r) { return r.id === editBtn.getAttribute('data-id'); });
        if (rule) _showRuleForm(rule);
        return;
      }
      var deleteBtn = e.target.closest('.bb-delete-btn');
      if (deleteBtn) {
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

    var codesHtml = '<option value="">None</option>';
    for (var ci = 0; ci < _utbmsCodes.length; ci++) {
      var c = _utbmsCodes[ci];
      var selected = r.billing_code === c.code ? ' selected' : '';
      codesHtml += '<option value="' + _escapeHtml(c.code) + '"' + selected + '>' + _escapeHtml(c.code + ' — ' + c.description) + '</option>';
    }

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
    html += '<select id="bbFormCode" style="' + inputStyle + '">' + codesHtml + '</select></div>';

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
      billing_code: document.getElementById('bbFormCode').value || null,
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

    if (typeof Lex !== 'undefined' && Lex.Modal && Lex.Modal.confirm) {
      Lex.Modal.confirm({
        heading: 'Deactivate Rule',
        message: 'Are you sure you want to deactivate this block billing rule?',
        confirmLabel: 'Deactivate',
        confirmVariant: 'danger'
      }).then(function (confirmed) {
        if (confirmed) doDelete();
      });
    } else if (window.confirm('Deactivate this block billing rule?')) {
      doDelete();
    }
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

  document.addEventListener('DOMContentLoaded', init);
})();
