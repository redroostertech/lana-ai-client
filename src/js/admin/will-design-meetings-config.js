/* Will Design Meetings Configuration - Stage 2 trust/mapping admin. */

(function () {
  'use strict';

  var state = {
    status: null,
    validation: null,
    reconciliation: null,
    editorInitialized: false,
  };

  function el(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function humanize(value) {
    if (value == null || value === '') return '-';
    return String(value)
      .replace(/[_.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function unwrap(response) {
    return response && response.data ? response.data : response;
  }

  function normalizeValidation(payload) {
    if (!payload) return null;
    var data = payload || {};
    return data.validation || data;
  }

  function latestValidation() {
    return normalizeValidation(state.validation)
      || ((state.status && state.status.validation) || {});
  }

  function dataHealthState(dataHealth) {
    if (typeof dataHealth === 'string') return dataHealth;
    return dataHealth && dataHealth.state ? dataHealth.state : 'unknown';
  }

  function dataHealthSync(dataHealth) {
    if (!dataHealth || typeof dataHealth === 'string') return null;
    return dataHealth.last_successful_sync || dataHealth.lastSuccessfulSync || null;
  }

  function toast(type, message) {
    if (window.Lex && Lex.Toast && typeof Lex.Toast[type] === 'function') {
      Lex.Toast[type](message);
    }
  }

  function setBusy(id, busy) {
    var node = el(id);
    if (!node) return;
    if (busy) {
      node.setAttribute('disabled', 'disabled');
      node.setAttribute('aria-busy', 'true');
    } else {
      node.removeAttribute('disabled');
      node.removeAttribute('aria-busy');
    }
  }

  function formatDate(value) {
    if (!value) return '-';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function compactMapping(mapping) {
    var source = mapping || {};
    return {
      integration_source_id: source.integration_source_id || null,
      mapping_version: source.mapping_version && source.mapping_version !== 'configuration-required'
        ? source.mapping_version
        : 'will-design-meetings-v1',
      status: source.status === 'active' ? 'validated' : (source.status || 'draft'),
      effective_start: source.effective_start || new Date().toISOString(),
      effective_end: source.effective_end || null,
      field_mappings: source.field_mappings || {},
      accepted_values: source.accepted_values || {
        service_offering: [],
        meeting_type: [],
        scheduled_status: [],
        completed_status: [],
        cancelled_status: [],
        no_show_status: [],
      },
      canonical_values: source.canonical_values || {},
    };
  }

  function renderTrustCard(label, value, meta, tone) {
    var border = tone === 'good' ? 'border-green-200'
      : tone === 'warn' ? 'border-amber-200'
        : tone === 'bad' ? 'border-red-200'
          : 'border-gray-200';
    var badge = tone === 'good' ? 'bg-green-50 text-green-700'
      : tone === 'warn' ? 'bg-amber-50 text-amber-800'
        : tone === 'bad' ? 'bg-red-50 text-red-700'
          : 'bg-gray-100 text-gray-700';
    return ''
      + '<article class="rounded-lg border ' + border + ' bg-white p-4 shadow-sm">'
      + '  <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">' + escapeHtml(label) + '</div>'
      + '  <div class="mt-3 text-2xl font-semibold text-gray-950">' + escapeHtml(value) + '</div>'
      + '  <div class="mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ' + badge + '">' + escapeHtml(meta || '-') + '</div>'
      + '</article>';
  }

  function renderTrustCards() {
    var container = el('willDesignTrustCards');
    if (!container) return;

    var payload = state.status || {};
    var mapping = payload.mapping || {};
    var validation = payload.validation || {};
    var certification = payload.certification || {};
    var definition = certification.definition || {};
    var organization = certification.organization || {};
    var dataHealth = certification.data_health || payload.data_health || {};
    var healthState = dataHealthState(dataHealth);
    var lastSync = dataHealthSync(dataHealth);

    container.innerHTML = [
      renderTrustCard('Definition', humanize(definition.state || 'certified'), definition.version || 'definition', 'good'),
      renderTrustCard('Organization', humanize(organization.state || payload.lifecycle_state || 'configuration_required'), organization.version || mapping.mapping_version || 'mapping', validation.valid ? 'good' : 'warn'),
      renderTrustCard('Data Health', humanize(healthState), lastSync ? formatDate(lastSync) : 'source freshness', healthState === 'healthy' ? 'good' : 'warn'),
      renderTrustCard('Mapping', humanize(mapping.status || payload.lifecycle_state || 'configuration_required'), mapping.mapping_version || 'not configured', validation.valid ? 'good' : 'bad'),
    ].join('');
  }

  function renderChips(values, tone) {
    var list = Array.isArray(values) ? values : [];
    if (!list.length) {
      return '<span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">No values observed</span>';
    }
    var color = tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-700';
    return list.slice(0, 36).map(function (value) {
      return '<span class="rounded-full ' + color + ' px-2.5 py-1 text-xs font-medium">' + escapeHtml(value) + '</span>';
    }).join('');
  }

  function renderObservedValues() {
    var container = el('willDesignObservedValues');
    if (!container) return;
    var payload = state.status || {};
    var observed = payload.observed_values || {};
    var validation = latestValidation();
    var unresolved = validation && validation.unresolved ? validation.unresolved : {};
    var sections = [
      ['Service Offering', observed.service_offering, unresolved.service_offering],
      ['Meeting Type', observed.meeting_type, unresolved.meeting_type],
      ['Meeting Status', observed.meeting_status, unresolved.meeting_status],
      ['Attorney Identity', observed.attorney_identity, unresolved.attorney_identity],
    ];

    container.innerHTML = sections.map(function (section) {
      var label = section[0];
      var values = section[1] || [];
      var gaps = section[2] || [];
      return ''
        + '<article class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">'
        + '  <div class="flex items-center justify-between gap-3">'
        + '    <div class="text-sm font-semibold text-gray-950">' + escapeHtml(label) + '</div>'
        + '    <div class="text-xs font-medium text-gray-500">' + escapeHtml(values.length + ' observed') + '</div>'
        + '  </div>'
        + '  <div class="mt-3 flex flex-wrap gap-2">' + renderChips(values, 'neutral') + '</div>'
        + (gaps.length ? '  <div class="mt-4"><div class="mb-2 text-xs font-semibold uppercase text-amber-700">Unmapped</div><div class="flex flex-wrap gap-2">' + renderChips(gaps, 'warn') + '</div></div>' : '')
        + '</article>';
    }).join('');
  }

  function renderValidationResult(result) {
    var panel = el('willDesignValidationPanel');
    if (!panel) return;
    var validation = normalizeValidation(result || state.validation) || (state.status && state.status.validation) || {};
    var errors = validation.errors || [];
    var warnings = validation.warnings || [];
    var unresolved = validation.unresolved || {};
    var unresolvedCount = Object.keys(unresolved).reduce(function (sum, key) {
      return sum + (Array.isArray(unresolved[key]) ? unresolved[key].length : 0);
    }, 0);
    var tone = validation.valid ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-950';
    panel.innerHTML = ''
      + '<div class="rounded-lg border p-4 ' + tone + '">'
      + '  <div class="text-sm font-semibold">' + escapeHtml(validation.valid ? 'Mapping validates' : 'Mapping needs attention') + '</div>'
      + '  <div class="mt-1 text-sm">' + escapeHtml(errors.length + ' errors, ' + warnings.length + ' warnings, ' + unresolvedCount + ' unresolved values') + '</div>'
      + (errors.length ? '<ul class="mt-3 list-disc pl-5 text-sm">' + errors.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>' : '')
      + (warnings.length ? '<ul class="mt-3 list-disc pl-5 text-sm">' + warnings.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>' : '')
      + '</div>';
  }

  function renderEditor(force) {
    var editor = el('willDesignMappingEditor');
    if (!editor || (state.editorInitialized && !force)) return;
    editor.value = JSON.stringify(compactMapping((state.status || {}).mapping || {}), null, 2);
    state.editorInitialized = true;
  }

  function renderReconciliation() {
    var panel = el('willDesignReconcilePanel');
    if (!panel) return;
    var data = state.reconciliation;
    if (!data) {
      panel.innerHTML = '<div class="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">No reconciliation run in this session.</div>';
      return;
    }
    var evidence = data.evidence || data;
    var passed = evidence.pass === true || evidence.status === 'passed' || evidence.reconciled === true;
    var rows = [
      ['Metric', evidence.metric_key || evidence.metricKey || 'will-design-meetings'],
      ['Period', evidence.period || '-'],
      ['Aggregate', evidence.aggregate_value != null ? evidence.aggregate_value : evidence.aggregate],
      ['Drilldown', evidence.drilldown_count != null ? evidence.drilldown_count : evidence.drilldown],
      ['Variance', evidence.variance != null ? evidence.variance : '-'],
      ['Mapping Version', evidence.mapping_version || '-'],
      ['Definition Version', evidence.metric_definition_version || evidence.definition_version || '-'],
    ];
    panel.innerHTML = ''
      + '<div class="rounded-lg border ' + (passed ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50') + ' p-4">'
      + '  <div class="text-sm font-semibold ' + (passed ? 'text-green-900' : 'text-amber-950') + '">' + escapeHtml(passed ? 'Reconciliation passed' : 'Reconciliation needs review') + '</div>'
      + '  <dl class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">'
      + rows.map(function (row) {
        return '<div><dt class="text-xs font-semibold uppercase text-gray-500">' + escapeHtml(row[0]) + '</dt><dd class="mt-1 text-sm text-gray-950">' + escapeHtml(row[1] == null ? '-' : row[1]) + '</dd></div>';
      }).join('')
      + '  </dl>'
      + '</div>';
  }

  function renderAll(forceEditor) {
    renderTrustCards();
    renderObservedValues();
    renderEditor(forceEditor);
    renderValidationResult(state.validation);
    renderReconciliation();
  }

  async function loadStatus(forceEditor) {
    setBusy('refreshWillDesignConfigBtn', true);
    try {
      var response = await api.getCommandCenterWillDesignMeetingsMapping();
      state.status = unwrap(response);
      state.validation = null;
      renderAll(forceEditor);
    } catch (err) {
      toast('error', 'Could not load Will Design Meetings mapping');
    } finally {
      setBusy('refreshWillDesignConfigBtn', false);
    }
  }

  function readMappingEditor() {
    var editor = el('willDesignMappingEditor');
    try {
      return JSON.parse(editor ? editor.value || '{}' : '{}');
    } catch (_err) {
      toast('error', 'Mapping JSON is invalid');
      return null;
    }
  }

  async function validateMapping() {
    var payload = readMappingEditor();
    if (!payload) return null;
    setBusy('validateWillDesignMappingBtn', true);
    try {
      var response = await api.validateCommandCenterWillDesignMeetingsMapping(payload);
      state.validation = unwrap(response);
      renderValidationResult(state.validation);
      renderObservedValues();
      toast(normalizeValidation(state.validation).valid ? 'success' : 'warning', 'Mapping validation complete');
      return state.validation;
    } catch (err) {
      toast('error', err && err.message ? err.message : 'Could not validate mapping');
      return null;
    } finally {
      setBusy('validateWillDesignMappingBtn', false);
    }
  }

  async function saveMapping(status) {
    var payload = readMappingEditor();
    if (!payload) return;
    payload.status = status;
    setBusy(status === 'validated' ? 'saveWillDesignValidatedBtn' : 'saveWillDesignDraftBtn', true);
    try {
      await api.saveCommandCenterWillDesignMeetingsMapping(payload);
      toast('success', status === 'validated' ? 'Mapping saved as validated' : 'Mapping draft saved');
      state.editorInitialized = false;
      await loadStatus(true);
    } catch (err) {
      toast('error', err && err.message ? err.message : 'Could not save mapping');
    } finally {
      setBusy(status === 'validated' ? 'saveWillDesignValidatedBtn' : 'saveWillDesignDraftBtn', false);
    }
  }

  async function activateMapping() {
    var payload = readMappingEditor();
    if (!payload || !payload.mapping_version) {
      toast('error', 'Mapping version is required');
      return;
    }
    if (!window.confirm('Activate mapping version ' + payload.mapping_version + '?')) return;
    setBusy('activateWillDesignMappingBtn', true);
    try {
      await api.activateCommandCenterWillDesignMeetingsMapping({
        mapping_version: payload.mapping_version,
        effective_start: payload.effective_start || null,
      });
      toast('success', 'Mapping activated');
      state.editorInitialized = false;
      await loadStatus(true);
    } catch (err) {
      toast('error', err && err.message ? err.message : 'Could not activate mapping');
    } finally {
      setBusy('activateWillDesignMappingBtn', false);
    }
  }

  async function runReconciliation() {
    var period = el('willDesignReconcilePeriod');
    setBusy('runWillDesignReconcileBtn', true);
    try {
      var response = await api.reconcileCommandCenterWillDesignMeetings({
        period: period && period.value ? period.value : 'this_month',
        reason: 'manual',
      });
      state.reconciliation = unwrap(response);
      renderReconciliation();
      toast('success', 'Reconciliation complete');
    } catch (err) {
      toast('error', err && err.message ? err.message : 'Could not run reconciliation');
    } finally {
      setBusy('runWillDesignReconcileBtn', false);
    }
  }

  function renderBreadcrumb() {
    var breadcrumb = el('willDesignConfigBreadcrumb');
    if (!breadcrumb) return;
    breadcrumb.items = [
      { label: 'Dashboard', href: 'admin/analytics.html' },
      { label: 'Will Design Meetings' },
    ];
  }

  function bindEvents() {
    var refresh = el('refreshWillDesignConfigBtn');
    var detail = el('openWillDesignDetailBtn');
    var validate = el('validateWillDesignMappingBtn');
    var saveDraft = el('saveWillDesignDraftBtn');
    var saveValidated = el('saveWillDesignValidatedBtn');
    var activate = el('activateWillDesignMappingBtn');
    var reconcile = el('runWillDesignReconcileBtn');

    if (refresh) refresh.addEventListener('click', function () { loadStatus(true); });
    if (detail) detail.addEventListener('click', function () {
      Lex.Nav.go('admin/dashboard-detail.html?type=department&card_instance=dashboard%3Aestate-planning%3Awill-design-meetings');
    });
    if (validate) validate.addEventListener('click', validateMapping);
    if (saveDraft) saveDraft.addEventListener('click', function () { saveMapping('draft'); });
    if (saveValidated) saveValidated.addEventListener('click', function () { saveMapping('validated'); });
    if (activate) activate.addEventListener('click', activateMapping);
    if (reconcile) reconcile.addEventListener('click', runReconciliation);
  }

  function init() {
    var content = el('lex-main-content');
    if (!content) return;
    if (Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }
    renderBreadcrumb();
    bindEvents();
    renderAll(false);
    loadStatus(true);
  }

  window.LanaAdmin = window.LanaAdmin || {};
  window.LanaAdmin.WillDesignMeetingsConfig = {
    __test: {
      compactMapping: compactMapping,
      humanize: humanize,
      renderTrustCard: renderTrustCard,
      renderTrustCards: renderTrustCards,
      renderChips: renderChips,
      renderObservedValues: renderObservedValues,
      renderValidationResult: renderValidationResult,
      renderReconciliation: renderReconciliation,
      dataHealthState: dataHealthState,
      latestValidation: latestValidation,
      normalizeValidation: normalizeValidation,
      setState: function (nextState) {
        state = Object.assign(state, nextState || {});
      },
      getState: function () {
        return state;
      }
    }
  };

  init();
})();
