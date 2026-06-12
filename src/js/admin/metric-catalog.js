/* Metric Catalog Inspector — admin tool to verify all 326 metrics execute. */

(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // All numeric values rendered by this page are capped at 2 decimal
  // places. Operators are inspecting "did this metric run", not consuming
  // the precision, so the noise of long fractional tails (e.g.
  // 0.3333333333333) is removed here in one place.
  function formatNumeric(value) {
    var num = Number(value);
    if (!isFinite(num)) return null;
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function displayText(value) {
    if (value == null || value === '') return '-';
    if (typeof value === 'number') {
      var formatted = formatNumeric(value);
      return formatted == null ? String(value) : formatted;
    }
    if (typeof value === 'string') {
      // Some metric values come back as numeric strings ("123.456789").
      // Format them too so the cap is consistent across types.
      var asNum = Number(value);
      if (value.trim() !== '' && isFinite(asNum)) {
        var formattedStr = formatNumeric(asNum);
        return formattedStr == null ? value : formattedStr;
      }
      return value;
    }
    if (typeof value === 'object') {
      try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
    }
    return String(value);
  }

  function setText(id, value) {
    var node = el(id);
    if (!node) return;
    if (value == null) {
      node.textContent = '-';
      return;
    }
    // Pipe through displayText so numeric counts pick up the 2dp cap and
    // the comma grouping (e.g. 1,234 instead of 1234).
    if (typeof value === 'number') {
      node.textContent = displayText(value);
      return;
    }
    node.textContent = String(value);
  }

  // Last execution result per metric. Keyed by metric key so the table cell
  // and the detail drawer share a single source of truth without a re-fetch
  // every render.
  var lastRunByKey = {};
  var allMetrics = [];
  var visibleMetrics = [];
  var passedCount = 0;
  var failedCount = 0;

  // Goal index: metric_key -> { weekly?: goal, monthly?: goal }. Loaded once
  // after the catalog loads (see loadGoals). The actions cell reads this to
  // render the read-only goal pill and, for admins, the Goal editor button.
  var goalIndex = {};
  // Cached admin flag: only system_admin / org_admin may set or edit goals.
  // Resolved once at init from Lex.Auth (same source the page already uses to
  // gate access). Non-admins never see the Goal action.
  var isGoalAdmin = false;

  function goalMapper() {
    return (typeof window !== 'undefined' && window.MetricGoalFormMapper) || null;
  }

  function normalizeMetric(metric) {
    var executableLabel = metric.executable === true ? 'Yes' : 'No';
    var statusLabel = metric.display_status || metric.status || 'unknown';
    return Object.assign({}, metric, {
      executable_label: executableLabel,
      display_name: metric.display_name || metric.title || metric.name || metric.key,
      display_domain: metric.display_domain || '-',
      display_primary_audience: metric.display_primary_audience || '-',
      display_status: statusLabel,
      // Sortable underlying values for the Last Run / Value columns.
      // Filled in just before render from lastRunByKey so the table can
      // sort numerically (value) or alphabetically (status) without
      // re-parsing the rendered HTML.
      last_run_status: 'never',
      last_run_value: null,
      actions: 'actions_placeholder',
    });
  }

  // Produce a sortable numeric (or null) for the Value column from a metric
  // run result. Mirrors the categorical logic in summarizeRunValue but
  // returns the raw underlying number / array-length / null so lex-table
  // can sort it correctly.
  function sortableRunValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string') {
      var asNum = Number(value);
      return value.trim() !== '' && isFinite(asNum) ? asNum : null;
    }
    if (Array.isArray(value)) return value.length;
    if (typeof value === 'object') {
      var candidates = ['value', 'total', 'count', 'amount', 'rate', 'percentage', 'percent'];
      for (var i = 0; i < candidates.length; i++) {
        if (Object.prototype.hasOwnProperty.call(value, candidates[i])) {
          return sortableRunValue(value[candidates[i]]);
        }
      }
    }
    return null;
  }

  // Stamp each visible metric with the latest run status + sortable value
  // pulled from lastRunByKey. Called every render so a fresh run shows up
  // in the table immediately and the sort indicator stays consistent.
  function applyRunStateToRows() {
    for (var i = 0; i < visibleMetrics.length; i++) {
      var m = visibleMetrics[i];
      var run = lastRunByKey[m.key];
      if (!run) {
        m.last_run_status = 'never';
        m.last_run_value = null;
      } else if (run.status === 'pending') {
        m.last_run_status = 'pending';
        m.last_run_value = null;
      } else {
        m.last_run_status = run.status;
        m.last_run_value = run.status === 'pass' ? sortableRunValue(run.value) : null;
      }
    }
  }

  // Normalize an entity name to snake_case so the filter option value is
  // stable regardless of whether the registry shipped "Calendar Event",
  // "calendar event", or "calendar_event". The display label is still
  // produced via humanize() so the dropdown reads naturally.
  function normalizeEntityKey(name) {
    return String(name == null ? '' : name)
      .trim()
      .toLowerCase()
      .replace(/[\s.\-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  function buildFilters() {
    var domainSel = el('metricCatalogDomainFilter');
    var audienceSel = el('metricCatalogAudienceFilter');
    var entitySel = el('metricCatalogEntityFilter');
    if (!domainSel || !audienceSel) return;

    var domains = new Set();
    var audiences = new Set();
    // Track entity options as normalized key -> humanized display label so
    // duplicates collapse (e.g. "Calendar Event" + "calendar_event" become
    // one option) while the label stays human-readable.
    var entityLabels = {};
    allMetrics.forEach(function (m) {
      if (m.domain) domains.add(m.domain);
      if (m.primaryAudience) audiences.add(m.primaryAudience);
      if (Array.isArray(m.entities)) {
        m.entities.forEach(function (raw) {
          var name = entityName(raw);
          if (!name) return;
          var key = normalizeEntityKey(name);
          if (!key) return;
          if (!entityLabels[key]) entityLabels[key] = humanize(name);
        });
      }
    });

    function fill(select, set) {
      // Drop existing dynamic options (keep the first "all" option).
      while (select.options.length > 1) select.remove(1);
      Array.from(set).sort().forEach(function (raw) {
        var opt = document.createElement('option');
        opt.value = raw;
        // Use the humanizer pattern from the registry.
        opt.textContent = String(raw).replace(/[_.-]+/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); });
        select.appendChild(opt);
      });
    }
    fill(domainSel, domains);
    fill(audienceSel, audiences);

    if (entitySel) {
      while (entitySel.options.length > 1) entitySel.remove(1);
      Object.keys(entityLabels).sort().forEach(function (key) {
        var opt = document.createElement('option');
        opt.value = key;
        opt.textContent = entityLabels[key];
        entitySel.appendChild(opt);
      });
    }
  }

  function applyFilters() {
    var search = (el('metricCatalogSearch') || {}).value || '';
    var executable = (el('metricCatalogExecutableFilter') || {}).value || '';
    var domain = (el('metricCatalogDomainFilter') || {}).value || '';
    var audience = (el('metricCatalogAudienceFilter') || {}).value || '';
    var entity = (el('metricCatalogEntityFilter') || {}).value || '';

    var q = search.trim().toLowerCase();

    visibleMetrics = allMetrics.filter(function (m) {
      if (executable === 'true' && m.executable !== true) return false;
      if (executable === 'false' && m.executable === true) return false;
      if (domain && m.domain !== domain) return false;
      if (audience && m.primaryAudience !== audience) return false;
      if (entity) {
        if (!Array.isArray(m.entities)) return false;
        var hasEntity = m.entities.some(function (raw) {
          return normalizeEntityKey(entityName(raw)) === entity;
        });
        if (!hasEntity) return false;
      }
      if (q) {
        var hay = [m.key, m.name, m.title, m.description, m.domain, m.primaryAudience]
          .filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    renderTable();
  }

  function statusPill(status) {
    var cls = 'metric-catalog-pill';
    var lower = String(status || '').toLowerCase();
    if (lower.indexOf('active') !== -1) cls += ' metric-catalog-pill--ok';
    else if (lower.indexOf('planned') !== -1) cls += ' metric-catalog-pill--warn';
    else cls += ' metric-catalog-pill--muted';
    return '<span class="' + cls + '">' + escapeHtml(status || '-') + '</span>';
  }

  // Compact summary for the Last Run cell. Arrays-of-rows and large
  // objects collapse to a row count or "(object)" tag so the table row
  // stays single-line. The drawer renders the full payload.
  function summarizeRunValue(value) {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') return displayText(value);
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'string') {
      var asNum = Number(value);
      if (value.trim() !== '' && isFinite(asNum)) return displayText(asNum);
      return value.length > 80 ? value.slice(0, 77) + '...' : value;
    }
    if (Array.isArray(value)) {
      return displayText(value.length) + (value.length === 1 ? ' row' : ' rows');
    }
    if (typeof value === 'object') {
      // Look for a numeric-ish leaf the backend commonly nests (total,
      // value, count). Falls back to "(object)" so we never spill
      // "[object Object]" into the cell.
      var candidates = ['value', 'total', 'count', 'amount', 'rate', 'percentage', 'percent'];
      for (var i = 0; i < candidates.length; i++) {
        if (Object.prototype.hasOwnProperty.call(value, candidates[i])) {
          return summarizeRunValue(value[candidates[i]]);
        }
      }
      return '(object)';
    }
    return String(value);
  }

  // Status-only cell — pill for pass/fail/pending/never. The Value column
  // is rendered separately so it can be sorted on the raw numeric.
  function lastRunStatusCell(metric) {
    var run = lastRunByKey[metric.key];
    if (!run) return '<span class="metric-catalog-muted">never</span>';
    if (run.status === 'pending') return '<span class="metric-catalog-muted">running...</span>';
    if (run.status === 'pass') return '<span class="metric-catalog-pill metric-catalog-pill--ok">pass</span>';
    return '<span class="metric-catalog-pill metric-catalog-pill--fail" title="' + escapeHtml(run.error || '') + '">fail</span>';
  }

  function lastRunValueCell(metric) {
    var run = lastRunByKey[metric.key];
    if (!run || run.status !== 'pass') return '<span class="metric-catalog-muted">-</span>';
    var summary = summarizeRunValue(run.value);
    return '<span class="metric-catalog-runcell-value">' + escapeHtml(summary) + '</span>';
  }

  // Compact read-only indicator shown in the row when a goal exists for the
  // metric. Prefers the monthly target value (the common case); falls back to
  // the weekly one. Visible to everyone; the editor button is admin-only.
  function goalIndicator(metric) {
    var mapper = goalMapper();
    if (!mapper || !mapper.hasAnyGoal(goalIndex, metric.key)) return '';
    var goal = mapper.getGoal(goalIndex, metric.key, 'monthly')
      || mapper.getGoal(goalIndex, metric.key, 'weekly');
    var label = goal && goal.target_value != null
      ? 'Goal ' + displayText(goal.target_value)
      : 'Goal';
    return '<span class="metric-catalog-goal-pill" title="Goal set for this metric">' + escapeHtml(label) + '</span>';
  }

  function actionsCell(metric) {
    var html = '<div class="metric-catalog-actions">'
      + goalIndicator(metric)
      + '<button type="button" class="metric-catalog-btn metric-catalog-btn--run" data-metric-run="' + escapeHtml(metric.key) + '">Run</button>'
      + '<button type="button" class="metric-catalog-btn" data-metric-view="' + escapeHtml(metric.key) + '">View</button>';
    if (isGoalAdmin) {
      html += '<button type="button" class="metric-catalog-btn metric-catalog-btn--goal" data-metric-goal="' + escapeHtml(metric.key) + '">Goal</button>';
    }
    html += '</div>';
    return html;
  }

  function renderTable() {
    var table = el('metricCatalogTable');
    if (!table) return;

    if (typeof table.setCellRenderers === 'function') {
      table.setCellRenderers({
        display_name: function (value) {
          // Description lives in the side panel — keep the table row clean.
          return '<strong>' + escapeHtml(value || '-') + '</strong>';
        },
        display_status: function (value) { return statusPill(value); },
        executable_label: function (value) {
          var ok = value === 'Yes';
          return '<span class="metric-catalog-pill ' + (ok ? 'metric-catalog-pill--ok' : 'metric-catalog-pill--muted') + '">' + escapeHtml(value) + '</span>';
        },
        last_run_status: function (_value, row) { return lastRunStatusCell(row); },
        last_run_value: function (_value, row) { return lastRunValueCell(row); },
        actions: function (_value, row) { return actionsCell(row); },
      });
    }

    if (typeof table.setData === 'function') {
      // Stamp the current run state onto each row first so the table's
      // built-in sort works on real underlying values (numeric for the
      // Value column, status string for the Last Run column).
      applyRunStateToRows();
      table.setData(visibleMetrics);
    }
  }

  function updateSummary(summary) {
    setText('metricCatalogTotal', summary && summary.total != null ? summary.total : allMetrics.length);
    setText('metricCatalogExecutable', summary && summary.executableCatalogMetrics != null ? summary.executableCatalogMetrics : allMetrics.filter(function (m) { return m.executable; }).length);
    setText('metricCatalogPlanned', summary && summary.plannedCatalogMetrics != null ? summary.plannedCatalogMetrics : allMetrics.filter(function (m) { return m.status === 'planned'; }).length);
    refreshRunCounts();
  }

  function refreshRunCounts() {
    setText('metricCatalogPassed', passedCount + ' pass');
    setText('metricCatalogFailed', failedCount + ' fail');
  }

  // Pulls the numeric value out of /metric-detail's payload. The endpoint
  // returns `{ current: { value, value_numeric } }` shape per metric-detail
  // page, so check both.
  function extractValue(payload) {
    if (!payload) return null;
    var current = payload.current || {};
    if (current.value_numeric !== null && current.value_numeric !== undefined) return current.value_numeric;
    if (current.value !== null && current.value !== undefined) return current.value;
    return null;
  }

  async function runMetric(metricKey) {
    if (!metricKey || !window.api || typeof api.getMetricDetail !== 'function') return null;
    lastRunByKey[metricKey] = { status: 'pending' };
    renderTable();

    var started = Date.now();
    try {
      var response = await api.getMetricDetail(metricKey);
      var payload = response && response.data ? response.data : response;
      var elapsed = Date.now() - started;
      // status 'unregistered' is the synthesized stub for keys not in the
      // canonical registry — treat as a soft pass since the endpoint
      // returned without throwing.
      lastRunByKey[metricKey] = {
        status: 'pass',
        value: extractValue(payload),
        elapsed_ms: elapsed,
        payload: payload,
      };
      passedCount += 1;
    } catch (err) {
      var msg = (err && err.message) || 'Run failed';
      lastRunByKey[metricKey] = {
        status: 'fail',
        error: msg,
        elapsed_ms: Date.now() - started,
      };
      failedCount += 1;
    }
    refreshRunCounts();
    renderTable();
    return lastRunByKey[metricKey];
  }

  async function runVisible() {
    var btn = el('metricCatalogRunAllBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Running...'; }
    // Reset counters so the summary reflects this batch run only.
    passedCount = 0;
    failedCount = 0;
    refreshRunCounts();
    var queue = visibleMetrics.slice();
    // Sequential to keep DB load reasonable on a 300+ metric run.
    for (var i = 0; i < queue.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await runMetric(queue[i].key);
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Run visible'; }
  }

  // Resolve the display name out of an entity entry. The registry uses
  // several shapes depending on the metric:
  //   - "matter" (plain string)
  //   - { name: "matter" } or { entity: "matter" } or { key: "matter" }
  //   - { "Entity Type": "Feedback", "Fields": [...], "Description": "..." }
  //     (full canonical entity spec from the catalog group)
  // We pull the most descriptive name field we can find and ignore the
  // rest so the pill stays compact.
  function entityName(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      var keys = ['Entity Type', 'entityType', 'entity_type', 'name', 'entity', 'key', 'id', 'type', 'label'];
      for (var i = 0; i < keys.length; i++) {
        if (Object.prototype.hasOwnProperty.call(value, keys[i]) && value[keys[i]]) {
          return String(value[keys[i]]);
        }
      }
    }
    return String(value);
  }

  function humanize(value) {
    return String(value).replace(/[_.\-]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/\b\w/g, function (l) { return l.toUpperCase(); });
  }

  function renderPillSection(label, values) {
    if (!Array.isArray(values) || values.length === 0) return '';
    var pills = values.map(function (v) {
      var name = entityName(v);
      if (!name) return '';
      return '<span class="metric-catalog-entity-pill">' + escapeHtml(humanize(name)) + '</span>';
    }).filter(Boolean).join('');
    if (!pills) return '';
    return '<div class="metric-catalog-drawer__section">'
      + '<div class="metric-catalog-drawer__label">' + escapeHtml(label) + '</div>'
      + '<div class="metric-catalog-entity-pills">' + pills + '</div>'
      + '</div>';
  }

  function renderDrawerBody(metric) {
    var run = lastRunByKey[metric.key] || {};
    var calculation = metric.calculation == null ? '(no calculation defined)' : metric.calculation;
    var businessLogic = metric.businessLogic == null ? '' : metric.businessLogic;

    var html = '<div class="metric-catalog-drawer">';

    html += '<div class="metric-catalog-drawer__section">';
    html += '<div class="metric-catalog-drawer__label">Key</div>';
    html += '<code class="metric-catalog-key">' + escapeHtml(metric.key) + '</code>';
    html += '</div>';

    html += '<div class="metric-catalog-drawer__grid">';
    html += '<div><div class="metric-catalog-drawer__label">Domain</div><div>' + escapeHtml(metric.display_domain || '-') + '</div></div>';
    html += '<div><div class="metric-catalog-drawer__label">Audience</div><div>' + escapeHtml(metric.display_primary_audience || '-') + '</div></div>';
    html += '<div><div class="metric-catalog-drawer__label">Status</div><div>' + statusPill(metric.display_status) + '</div></div>';
    html += '<div><div class="metric-catalog-drawer__label">Executable</div><div>' + escapeHtml(metric.executable_label) + '</div></div>';
    html += '</div>';

    if (metric.description) {
      html += '<div class="metric-catalog-drawer__section">';
      html += '<div class="metric-catalog-drawer__label">Description</div>';
      html += '<p>' + escapeHtml(metric.description) + '</p>';
      html += '</div>';
    }

    // Entities / criteria / dimensions come straight from the registry
    // catalog group. Render each as a pill list so the data dependencies
    // are obvious at a glance — useful when an operator is checking
    // whether a metric's source tables are populated yet.
    html += renderPillSection('Required Entities', metric.entities);
    html += renderPillSection('Criteria', metric.criteria);
    html += renderPillSection('Dimensions', metric.dimensions);

    html += '<div class="metric-catalog-drawer__section">';
    html += '<div class="metric-catalog-drawer__label">Calculation</div>';
    html += '<pre class="metric-catalog-drawer__code">' + escapeHtml(displayText(calculation)) + '</pre>';
    html += '</div>';

    if (businessLogic) {
      html += '<div class="metric-catalog-drawer__section">';
      html += '<div class="metric-catalog-drawer__label">Business Logic</div>';
      html += '<pre class="metric-catalog-drawer__code">' + escapeHtml(displayText(businessLogic)) + '</pre>';
      html += '</div>';
    }

    html += '<div class="metric-catalog-drawer__section">';
    html += '<div class="metric-catalog-drawer__label">Last Run</div>';
    if (!run.status) {
      html += '<div class="metric-catalog-muted">Not yet executed. Click "Run now" to execute the calculation.</div>';
    } else if (run.status === 'pending') {
      html += '<div class="metric-catalog-muted">Running...</div>';
    } else if (run.status === 'pass') {
      html += '<div class="metric-catalog-drawer__run">';
      html += '<div><strong>Value:</strong> ' + escapeHtml(summarizeRunValue(run.value)) + '</div>';
      html += '<div><strong>Elapsed:</strong> ' + escapeHtml(displayText(run.elapsed_ms)) + ' ms</div>';
      html += '</div>';
      if (run.payload) {
        html += '<details class="metric-catalog-drawer__payload"><summary>Full payload</summary>';
        html += '<pre>' + escapeHtml(JSON.stringify(run.payload, null, 2)) + '</pre>';
        html += '</details>';
      }
    } else {
      html += '<div class="metric-catalog-drawer__run metric-catalog-drawer__run--fail">';
      html += '<div><strong>Error:</strong> ' + escapeHtml(run.error || 'Unknown failure') + '</div>';
      html += '<div><strong>Elapsed:</strong> ' + escapeHtml(displayText(run.elapsed_ms || 0)) + ' ms</div>';
      html += '</div>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  function openDetailDrawer(metric) {
    if (!window.Lex || !Lex.Drawer) return;
    Lex.Drawer.open({
      heading: metric.display_name || metric.key,
      content: renderDrawerBody(metric),
      width: 'lg',
      buttons: [
        { label: 'Run now', variant: 'primary', id: 'metricCatalogDrawerRun' },
        { label: 'Close', variant: 'secondary', id: 'metricCatalogDrawerClose' },
      ],
    });

    // The drawer footer buttons live outside the body. The body itself is
    // re-rendered after each run to surface the latest result, but the
    // footer survives, so the click handler only needs to bind once.
    function wireDrawerButtons() {
      var runBtn = document.getElementById('metricCatalogDrawerRun');
      if (runBtn && !runBtn.dataset.bound) {
        runBtn.dataset.bound = '1';
        runBtn.addEventListener('click', async function () {
          runBtn.disabled = true;
          runBtn.textContent = 'Running...';
          await runMetric(metric.key);
          var body = document.querySelector('.lex-drawer__body, .lex-drawer-body');
          if (body) body.innerHTML = renderDrawerBody(metric);
          runBtn.disabled = false;
          runBtn.textContent = 'Run again';
        });
      }
      var closeBtn = document.getElementById('metricCatalogDrawerClose');
      if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = '1';
        closeBtn.addEventListener('click', function () { if (Lex.Drawer.close) Lex.Drawer.close(); });
      }
    }
    setTimeout(wireDrawerButtons, 50);
  }

  // --- Goal editor -----------------------------------------------------------

  // Re-render just the row(s) for one metric after a goal save/remove so the
  // indicator updates without a full table reload.
  function rerenderRow() {
    renderTable();
  }

  function numAttr(value) {
    return value == null ? '' : escapeHtml(String(value));
  }

  // Build the editor form for a metric, pre-filled with the goal for the
  // currently selected period (period defaults to monthly).
  function renderGoalForm(metric, period) {
    var mapper = goalMapper();
    var goal = mapper ? mapper.getGoal(goalIndex, metric.key, period) : null;
    var g = goal || {};
    var targetType = g.target_type || 'static';

    function typeOption(value, label) {
      var sel = targetType === value ? ' selected' : '';
      return '<option value="' + value + '"' + sel + '>' + label + '</option>';
    }
    function periodOption(value, label) {
      var sel = period === value ? ' selected' : '';
      return '<option value="' + value + '"' + sel + '>' + label + '</option>';
    }

    var html = '<div class="metric-catalog-goal-form">';
    html += '<div class="metric-catalog-drawer__section">';
    html += '<div class="metric-catalog-drawer__label">Metric</div>';
    html += '<code class="metric-catalog-key">' + escapeHtml(metric.key) + '</code>';
    html += '</div>';

    html += '<div class="metric-catalog-goal-form__row">';
    html += '<label class="metric-catalog-goal-field">'
      + '<span class="metric-catalog-goal-field__label">Period</span>'
      + '<select id="metricGoalPeriod" class="metric-catalog-goal-field__input">'
      + periodOption('monthly', 'Monthly')
      + periodOption('weekly', 'Weekly')
      + '</select></label>';
    html += '<label class="metric-catalog-goal-field">'
      + '<span class="metric-catalog-goal-field__label">Type</span>'
      + '<select id="metricGoalType" class="metric-catalog-goal-field__input">'
      + typeOption('static', 'Static')
      + typeOption('rolling_average', 'Rolling average')
      + typeOption('growth_rate', 'Growth rate')
      + '</select></label>';
    html += '</div>';

    html += '<label class="metric-catalog-goal-field">'
      + '<span class="metric-catalog-goal-field__label">Target value <span class="metric-catalog-goal-req">*</span></span>'
      + '<input type="number" step="any" id="metricGoalTargetValue" class="metric-catalog-goal-field__input" value="' + numAttr(g.target_value) + '" />'
      + '<span class="metric-catalog-goal-error" id="metricGoalTargetValueError"></span>'
      + '</label>';

    html += '<div class="metric-catalog-goal-form__row metric-catalog-goal-form__row--thirds">';
    html += '<label class="metric-catalog-goal-field">'
      + '<span class="metric-catalog-goal-field__label">Green threshold</span>'
      + '<input type="number" step="any" id="metricGoalGreen" class="metric-catalog-goal-field__input" value="' + numAttr(g.green_threshold) + '" /></label>';
    html += '<label class="metric-catalog-goal-field">'
      + '<span class="metric-catalog-goal-field__label">Yellow threshold</span>'
      + '<input type="number" step="any" id="metricGoalYellow" class="metric-catalog-goal-field__input" value="' + numAttr(g.yellow_threshold) + '" /></label>';
    html += '<label class="metric-catalog-goal-field">'
      + '<span class="metric-catalog-goal-field__label">Red threshold</span>'
      + '<input type="number" step="any" id="metricGoalRed" class="metric-catalog-goal-field__input" value="' + numAttr(g.red_threshold) + '" /></label>';
    html += '</div>';

    html += '<label class="metric-catalog-goal-field">'
      + '<span class="metric-catalog-goal-field__label">Notes</span>'
      + '<textarea id="metricGoalNotes" class="metric-catalog-goal-field__input" rows="2">' + escapeHtml(g.notes || '') + '</textarea></label>';

    html += '</div>';
    return html;
  }

  function readGoalForm() {
    return {
      target_value: (el('metricGoalTargetValue') || {}).value,
      target_type: (el('metricGoalType') || {}).value,
      target_period: (el('metricGoalPeriod') || {}).value,
      green_threshold: (el('metricGoalGreen') || {}).value,
      yellow_threshold: (el('metricGoalYellow') || {}).value,
      red_threshold: (el('metricGoalRed') || {}).value,
      notes: (el('metricGoalNotes') || {}).value,
    };
  }

  function clearGoalErrors() {
    var node = el('metricGoalTargetValueError');
    if (node) node.textContent = '';
  }

  function showGoalErrors(errors) {
    var node = el('metricGoalTargetValueError');
    if (node) node.textContent = errors.target_value || '';
  }

  function openGoalEditor(metric) {
    if (!isGoalAdmin || !window.Lex || !Lex.Drawer) return;
    var mapper = goalMapper();
    if (!mapper) return;

    // currentPeriod tracks the period select so the body can be re-rendered
    // with the right pre-filled values when the operator switches Weekly/Monthly.
    var currentPeriod = mapper.getGoal(goalIndex, metric.key, 'monthly') ? 'monthly'
      : (mapper.getGoal(goalIndex, metric.key, 'weekly') ? 'weekly' : 'monthly');

    Lex.Drawer.open({
      heading: 'Goal: ' + (metric.display_name || metric.key),
      content: renderGoalForm(metric, currentPeriod),
      width: 'md',
      buttons: [
        { label: 'Save goal', variant: 'primary', id: 'metricGoalSave' },
        { label: 'Remove', variant: 'danger', id: 'metricGoalRemove' },
        { label: 'Close', variant: 'secondary', id: 'metricGoalClose' },
      ],
    });

    function bodyNode() {
      return document.querySelector('.lex-drawer__body, .lex-drawer-body');
    }

    // Reflect the Remove button availability against the period currently shown.
    function syncRemoveButton() {
      var removeBtn = document.getElementById('metricGoalRemove');
      if (!removeBtn) return;
      var existing = mapper.getGoal(goalIndex, metric.key, currentPeriod);
      removeBtn.disabled = !existing;
    }

    // Bind the period select inside the (re-rendered) body each time so the
    // form reloads that period's saved values.
    function bindPeriodSelect() {
      var sel = el('metricGoalPeriod');
      if (!sel) return;
      sel.addEventListener('change', function () {
        currentPeriod = sel.value;
        var body = bodyNode();
        if (body) body.innerHTML = renderGoalForm(metric, currentPeriod);
        bindPeriodSelect();
        syncRemoveButton();
      });
    }

    function wireGoalButtons() {
      bindPeriodSelect();
      syncRemoveButton();

      var saveBtn = document.getElementById('metricGoalSave');
      if (saveBtn && !saveBtn.dataset.bound) {
        saveBtn.dataset.bound = '1';
        saveBtn.addEventListener('click', async function () {
          clearGoalErrors();
          var result = mapper.buildGoalPayload(readGoalForm());
          if (!result.ok) {
            showGoalErrors(result.errors);
            return;
          }
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
          try {
            await api.upsertMetricGoal(metric.key, result.payload);
            // Reflect the saved goal in the in-memory index, then re-render.
            if (!goalIndex[metric.key]) goalIndex[metric.key] = {};
            goalIndex[metric.key][result.payload.target_period] = Object.assign(
              { metric_key: metric.key }, result.payload
            );
            rerenderRow();
            syncRemoveButton();
            if (Lex.Toast) Lex.Toast.success('Goal saved');
          } catch (err) {
            if (Lex.Toast) Lex.Toast.error('Failed to save goal: ' + ((err && err.message) || 'error'));
          } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save goal';
          }
        });
      }

      var removeBtn = document.getElementById('metricGoalRemove');
      if (removeBtn && !removeBtn.dataset.bound) {
        removeBtn.dataset.bound = '1';
        removeBtn.addEventListener('click', async function () {
          var period = (el('metricGoalPeriod') || {}).value || currentPeriod;
          if (!mapper.getGoal(goalIndex, metric.key, period)) return;
          removeBtn.disabled = true;
          removeBtn.textContent = 'Removing...';
          try {
            await api.deleteMetricGoal(metric.key, period);
            if (goalIndex[metric.key]) {
              delete goalIndex[metric.key][period];
              if (Object.keys(goalIndex[metric.key]).length === 0) delete goalIndex[metric.key];
            }
            // Clear the form fields for the now-removed period.
            var body = bodyNode();
            if (body) body.innerHTML = renderGoalForm(metric, period);
            bindPeriodSelect();
            rerenderRow();
            if (Lex.Toast) Lex.Toast.success('Goal removed');
          } catch (err) {
            if (Lex.Toast) Lex.Toast.error('Failed to remove goal: ' + ((err && err.message) || 'error'));
          } finally {
            removeBtn.textContent = 'Remove';
            syncRemoveButton();
          }
        });
      }

      var closeBtn = document.getElementById('metricGoalClose');
      if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = '1';
        closeBtn.addEventListener('click', function () { if (Lex.Drawer.close) Lex.Drawer.close(); });
      }
    }
    setTimeout(wireGoalButtons, 50);
  }

  function wireToolbar() {
    var search = el('metricCatalogSearch');
    if (search) {
      var t;
      search.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(applyFilters, 150);
      });
    }
    ['metricCatalogExecutableFilter', 'metricCatalogDomainFilter', 'metricCatalogEntityFilter', 'metricCatalogAudienceFilter'].forEach(function (id) {
      var node = el(id);
      if (node) node.addEventListener('change', applyFilters);
    });
    var runAll = el('metricCatalogRunAllBtn');
    if (runAll) runAll.addEventListener('click', runVisible);

    var content = el('lex-main-content');
    if (content) {
      content.addEventListener('click', function (event) {
        var runBtn = event.target.closest('[data-metric-run]');
        if (runBtn) {
          event.preventDefault();
          event.stopPropagation();
          runMetric(runBtn.getAttribute('data-metric-run'));
          return;
        }
        var viewBtn = event.target.closest('[data-metric-view]');
        if (viewBtn) {
          var key = viewBtn.getAttribute('data-metric-view');
          var metric = allMetrics.find(function (m) { return m.key === key; });
          if (metric) openDetailDrawer(metric);
          return;
        }
        var goalBtn = event.target.closest('[data-metric-goal]');
        if (goalBtn && isGoalAdmin) {
          event.preventDefault();
          event.stopPropagation();
          var goalKey = goalBtn.getAttribute('data-metric-goal');
          var goalMetric = allMetrics.find(function (m) { return m.key === goalKey; });
          if (goalMetric) openGoalEditor(goalMetric);
        }
      });

      var table = el('metricCatalogTable');
      if (table) {
        table.addEventListener('row-click', function (event) {
          var row = event.detail && event.detail.row;
          if (row && row.key) openDetailDrawer(row);
        });
      }
    }
  }

  // Fetch configured goals once and index them by metric_key + period. A
  // failure here is non-fatal: the catalog still renders, just without goal
  // indicators. Re-renders the table so the indicators appear.
  async function loadGoals() {
    var mapper = goalMapper();
    if (!mapper || !window.api || typeof api.getMetricGoals !== 'function') return;
    try {
      var response = await api.getMetricGoals();
      var goals = (response && Array.isArray(response.goals)) ? response.goals
        : (response && response.data && Array.isArray(response.data.goals)) ? response.data.goals
        : [];
      goalIndex = mapper.indexGoals(goals);
      renderTable();
    } catch (err) {
      console.error('[MetricCatalog] Failed to load metric goals:', err);
    }
  }

  async function load() {
    if (!window.api || typeof api.getMetricCatalog !== 'function') return;
    try {
      var response = await api.getMetricCatalog({ limit: 500 });
      var rows = Array.isArray(response && response.data) ? response.data : [];
      allMetrics = rows.map(normalizeMetric);
      buildFilters();
      applyFilters();
      updateSummary(response && response.summary);
      // Goals are loaded after the catalog so a slow/failed goals call never
      // blocks the metric table from rendering.
      loadGoals();
    } catch (err) {
      console.error('[MetricCatalog] Failed to load metrics:', err);
      if (window.Lex && Lex.Toast) Lex.Toast.error('Failed to load metric catalog');
    }
  }

  function init() {
    if (window.Lex && Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }
    // Only system_admin / org_admin may set or edit goals. Reuse the same
    // Lex.Auth role source the page already gates access on; non-admins reach
    // the catalog but see no Goal action.
    isGoalAdmin = !!(window.Lex && Lex.Auth && (Lex.Auth.isSystemAdmin() || Lex.Auth.isOrgAdmin()));
    wireToolbar();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
