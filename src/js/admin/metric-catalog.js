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
  // Lineage ("Appears in") per metric key, loaded once when the detail drawer
  // opens. Values: undefined (not loaded), 'pending', 'error', or the usage object.
  var usageByKey = {};
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

  // Per-open state for the goal editor. The drawer body re-renders via
  // innerHTML on period/type change, so renderGoalForm reads the metric's
  // format token and the cached per-period goal recommendation from here rather
  // than threading them through every call. Reset each time the editor opens.
  var goalEditorState = { formatToken: '', recommendations: {} };

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
      // Sortable underlying target for the Goal column; stamped each render
      // from goalIndex (goals load after the catalog) by stampGoalsToRows.
      goal_target: null,
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

  // Read-only Goal column cell. Prefers the monthly target value (the common
  // case); falls back to the weekly one. Shows a muted dash when no goal is set.
  // Visible to everyone; the editor button stays admin-only in the Actions cell.
  function goalCell(metric) {
    var mapper = goalMapper();
    if (!mapper || !mapper.hasAnyGoal(goalIndex, metric.key)) {
      return '<span class="metric-catalog-muted">-</span>';
    }
    var period = mapper.getGoal(goalIndex, metric.key, 'monthly') ? 'monthly' : 'weekly';
    var goal = mapper.getGoal(goalIndex, metric.key, period);
    var periodLabel = period === 'monthly' ? 'mo' : 'wk';
    var valueText = goal && goal.target_value != null ? displayText(goal.target_value) : 'set';
    return '<span class="metric-catalog-goal-pill" title="Goal target (' + period + ')">'
      + escapeHtml(valueText) + ' / ' + periodLabel + '</span>';
  }

  function actionsCell(metric) {
    var html = '<div class="metric-catalog-actions">'
      + '<button type="button" class="metric-catalog-btn metric-catalog-btn--run" data-metric-run="' + escapeHtml(metric.key) + '">Run</button>'
      + '<button type="button" class="metric-catalog-btn metric-catalog-btn--playground" data-metric-playground="' + escapeHtml(metric.key) + '">Playground</button>'
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
        goal_target: function (_value, row) { return goalCell(row); },
        actions: function (_value, row) { return actionsCell(row); },
      });
    }

    if (typeof table.setData === 'function') {
      // Stamp the current run state onto each row first so the table's
      // built-in sort works on real underlying values (numeric for the
      // Value column, status string for the Last Run column).
      applyRunStateToRows();
      stampGoalsToRows();
      table.setData(visibleMetrics);
    }
  }

  // Stamp each visible metric with its sortable goal target (monthly preferred,
  // then weekly) so the Goal column sorts numerically. The cell renderer reads
  // goalIndex live for display; this only feeds the table's built-in sort.
  function stampGoalsToRows() {
    var mapper = goalMapper();
    for (var i = 0; i < visibleMetrics.length; i++) {
      var m = visibleMetrics[i];
      var goal = mapper && (mapper.getGoal(goalIndex, m.key, 'monthly') || mapper.getGoal(goalIndex, m.key, 'weekly'));
      var raw = goal ? goal.target_value : null;
      m.goal_target = (raw != null && isFinite(Number(raw))) ? Number(raw) : null;
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

  function renderUsageGroup(label, items, nameFn) {
    var list = Array.isArray(items) ? items : [];
    var body = list.length === 0
      ? '<span class="metric-catalog-muted">None</span>'
      : list.map(function (it) {
        return '<span class="metric-catalog-pill metric-catalog-pill--muted">' + escapeHtml(nameFn(it)) + '</span>';
      }).join(' ');
    return '<div class="metric-catalog-usage__group">'
      + '<div class="metric-catalog-usage__sublabel">' + escapeHtml(label) + ' (' + list.length + ')</div>'
      + '<div class="metric-catalog-usage__pills">' + body + '</div>'
      + '</div>';
  }

  // "Appears in" lineage section. Renders from the usageByKey cache so a Run-
  // triggered body re-render keeps the loaded lineage; loadUsage fills it.
  function renderUsageSection(metricKey) {
    var usage = usageByKey[metricKey];
    var html = '<div class="metric-catalog-drawer__section" id="metricUsageSection">';
    html += '<div class="metric-catalog-drawer__label">Appears in</div>';
    if (usage == null || usage === 'pending') {
      html += '<div class="metric-catalog-muted">Loading usage...</div>';
    } else if (usage === 'error') {
      html += '<div class="metric-catalog-muted">Usage is unavailable.</div>';
    } else {
      if (usage.defined_in) {
        var di = usage.defined_in;
        var diText = [di.namespace, di.module_key, di.section].filter(Boolean).join(' / ');
        if (diText) html += '<div class="metric-catalog-usage__defined">Defined in ' + escapeHtml(diText) + '</div>';
      }
      html += renderUsageGroup('Dashboards', usage.dashboards, function (d) {
        return d.via === 'question' ? (d.name + ' (question)') : d.name;
      });
      html += renderUsageGroup('Boards', usage.boards, function (b) { return b.name; });
      html += renderUsageGroup('Modules', usage.modules, function (m) { return m.name; });
      html += renderUsageGroup('Reports', usage.reports, function (r) {
        return r.confidence === 'low' ? (r.name + ' (low confidence)') : r.name;
      });
    }
    html += '</div>';
    return html;
  }

  // Fetch the lineage once per metric and patch the section in place. Only
  // retries after an error; a missing endpoint degrades to "unavailable".
  async function loadUsage(metricKey) {
    if (!metricKey) return;
    if (usageByKey[metricKey] && usageByKey[metricKey] !== 'error') return;
    if (!window.api || typeof api.getMetricUsage !== 'function') {
      usageByKey[metricKey] = 'error';
    } else {
      usageByKey[metricKey] = 'pending';
      try {
        var resp = await api.getMetricUsage(metricKey);
        usageByKey[metricKey] = (resp && resp.data) ? resp.data : (resp || {});
      } catch (err) {
        usageByKey[metricKey] = 'error';
      }
    }
    var section = document.getElementById('metricUsageSection');
    if (section) section.outerHTML = renderUsageSection(metricKey);
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

    html += renderUsageSection(metric.key);

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
      loadUsage(metric.key);
    }
    setTimeout(wireDrawerButtons, 50);
  }

  // --- Playground ------------------------------------------------------------

  // Pure preset date math, replicated from dashboard-detail.js so the drawer
  // stays self-contained. Returns YYYY-MM-DD strings plus the grain the preset
  // implies. Presets carry a calendar grain; manual edits override the grain.
  function presetRange(name) {
    var today = new Date();
    var startDate;
    var endDate;
    var grain = 'monthly';

    function fmt(date) {
      var year = date.getFullYear();
      var month = String(date.getMonth() + 1).padStart(2, '0');
      var day = String(date.getDate()).padStart(2, '0');
      return year + '-' + month + '-' + day;
    }

    switch (name) {
      case 'lastMonth':
        startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        endDate = new Date(today.getFullYear(), today.getMonth(), 0);
        grain = 'monthly';
        break;
      case 'last30days':
        endDate = new Date(today);
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 29);
        grain = 'daily';
        break;
      case 'thisQuarter':
        var currentQuarter = Math.floor(today.getMonth() / 3);
        startDate = new Date(today.getFullYear(), currentQuarter * 3, 1);
        endDate = new Date(today);
        grain = 'monthly';
        break;
      case 'thisYear':
        startDate = new Date(today.getFullYear(), 0, 1);
        endDate = new Date(today);
        grain = 'monthly';
        break;
      case 'thisMonth':
      default:
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        endDate = new Date(today);
        grain = 'monthly';
        break;
    }

    return { start: fmt(startDate), end: fmt(endDate), grain: grain };
  }

  // ISO conversion mirroring dashboard-detail.toPeriodISOString: start clamps to
  // 00:00:00, end clamps to 23:59:59 so the window includes the full end day.
  function playgroundISO(value, endOfDay) {
    if (!value) return '';
    var hasTime = String(value).indexOf('T') !== -1;
    var parsed = new Date(hasTime ? value : value + (endOfDay ? 'T23:59:59' : 'T00:00:00'));
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
  }

  function preview() {
    return (typeof window !== 'undefined' && window.MetricCardPreview) || null;
  }

  // Presets shared between the control buttons and the preset-range resolver.
  var PLAYGROUND_PRESETS = [
    { key: 'thisMonth', label: 'This month' },
    { key: 'lastMonth', label: 'Last month' },
    { key: 'last30days', label: 'Last 30 days' },
    { key: 'thisQuarter', label: 'This quarter' },
    { key: 'thisYear', label: 'This year' },
  ];

  function playgroundBodyHtml() {
    var presetBtns = PLAYGROUND_PRESETS.map(function (p) {
      return '<lex-btn variant="secondary" size="sm" data-playground-preset="' + escapeHtml(p.key) + '">' + escapeHtml(p.label) + '</lex-btn>';
    }).join('');

    return '<div class="metric-catalog-playground">'
      + '<div class="metric-catalog-playground__controls">'
      + '<div class="metric-catalog-playground__presets">' + presetBtns + '</div>'
      + '<div class="metric-catalog-playground__range">'
      + '<lex-input type="date" label="Start" name="playgroundStart" id="metricPlaygroundStart"></lex-input>'
      + '<lex-input type="date" label="End" name="playgroundEnd" id="metricPlaygroundEnd"></lex-input>'
      + '<lex-segmented name="playgroundGrain" id="metricPlaygroundGrain"></lex-segmented>'
      + '<lex-btn variant="primary" size="sm" id="metricPlaygroundPreview">Preview</lex-btn>'
      + '</div>'
      + '</div>'
      + '<lex-tabs id="metricPlaygroundTabs"></lex-tabs>'
      + '<lex-card heading="Preview" padding="compact">'
      + '<div class="metric-catalog-playground__card" id="metricPlaygroundCard">'
      + '<div class="metric-catalog-muted">Loading preview...</div>'
      + '</div>'
      + '</lex-card>'
      + '<lex-card heading="Rules" padding="compact">'
      + '<div id="metricPlaygroundRules"><div class="metric-catalog-muted">-</div></div>'
      + '</lex-card>'
      + '<lex-card heading="Drilldown" padding="compact">'
      + '<div id="metricPlaygroundDrilldown"><lex-empty message="Run a preview to see drilldown rows." size="compact"></lex-empty></div>'
      + '</lex-card>'
      + '</div>';
  }

  function openPlaygroundDrawer(metric) {
    if (!window.Lex || !Lex.Drawer) return;

    Lex.Drawer.open({
      heading: 'Playground: ' + (metric.display_name || metric.key),
      content: playgroundBodyHtml(),
      width: 'xl',
      buttons: [
        { label: 'Close', variant: 'secondary', id: 'metricPlaygroundClose' },
      ],
    });

    // Last payload cache so tab switches re-render the active card without
    // refetching. definitionLoaded guards the lazy one-time catalog/goals fetch.
    var lastData = null;
    var lastDefinition = null;
    var lastGoalForPeriod = null;
    var activeTab = 'dashboard';
    var definitionLoaded = false;

    function bodyNode() {
      return document.querySelector('.lex-drawer__body, .lex-drawer-body');
    }

    function renderActiveCard() {
      var card = el('metricPlaygroundCard');
      var pv = preview();
      if (!card || !pv) return;
      if (!lastData) {
        card.innerHTML = '<div class="metric-catalog-muted">Run a preview to see this card.</div>';
        return;
      }
      var current = lastData.current || {};
      if (activeTab === 'report') {
        card.innerHTML = pv.renderReportPreviewCard({
          name: metric.display_name || metric.key,
          key: metric.key,
          current: current.value,
          format: current.format,
          goal: lastData.goal || null,
          comparison: lastData.comparison || null,
        });
      } else {
        card.innerHTML = pv.renderDashboardPreviewCard({
          title: metric.display_name || metric.key,
          key: metric.key,
          value: current.value,
          format: current.format,
          goal: lastData.goal || null,
          comparison: lastData.comparison || null,
        });
      }
    }

    function setActiveTab(tab) {
      activeTab = tab;
      var tabs = el('metricPlaygroundTabs');
      // Keep the lex-tabs strip in sync when the switch was driven by code.
      if (tabs && tabs.active !== tab) tabs.active = tab;
      renderActiveCard();
    }

    function applyPreset(name) {
      var range = presetRange(name);
      var start = el('metricPlaygroundStart');
      var end = el('metricPlaygroundEnd');
      var grain = el('metricPlaygroundGrain');
      if (start) start.value = range.start;
      if (end) end.value = range.end;
      if (grain) grain.value = range.grain;
      // Presets compare against the matching calendar window.
      runPreview(true);
    }

    async function runPreview(isPreset) {
      var pv = preview();
      var card = el('metricPlaygroundCard');
      var rulesNode = el('metricPlaygroundRules');
      var drillNode = el('metricPlaygroundDrilldown');
      var start = (el('metricPlaygroundStart') || {}).value || '';
      var end = (el('metricPlaygroundEnd') || {}).value || '';
      var grain = (el('metricPlaygroundGrain') || {}).value || 'monthly';
      if (!start || !end) return;

      if (card) card.innerHTML = '<div class="metric-catalog-muted">Loading...</div>';

      var compareMode = (typeof MetricGoalComparison !== 'undefined')
        ? MetricGoalComparison.resolveCompareMode(!!isPreset)
        : (isPreset ? 'previous_calendar' : 'previous_period');

      try {
        var response = await api.getMetricDetail(metric.key, {
          periodStart: playgroundISO(start, false),
          periodEnd: playgroundISO(end, true),
          periodType: grain,
          compareToPrevious: true,
          compareMode: compareMode,
        });
        var data = response && response.data ? response.data : response;
        lastData = data || {};
        lastGoalForPeriod = lastData.goal || null;

        // Lazily load the catalog definition + configured goal once. The goal
        // attached to the detail payload (data.goal) is already period-aware;
        // the goals list is a fallback when the detail omits one for the grain.
        if (!definitionLoaded) {
          definitionLoaded = true;
          try {
            var defResp = await api.getMetricCatalogEntry(metric.key);
            lastDefinition = (defResp && defResp.data) ? defResp.data : (defResp || null);
          } catch (e) {
            lastDefinition = null;
          }
        }

        renderActiveCard();
        if (rulesNode && pv) rulesNode.innerHTML = pv.renderRulesPanel(lastGoalForPeriod, lastDefinition);
        if (drillNode && pv) {
          var current = lastData.current || {};
          drillNode.innerHTML = pv.renderDrilldownTable(current.raw_rows);
        }
      } catch (err) {
        lastData = null;
        if (card) card.innerHTML = '<div class="metric-catalog-drawer__run metric-catalog-drawer__run--fail">'
          + '<div><strong>Error:</strong> ' + escapeHtml((err && err.message) || 'Preview failed') + '</div></div>';
      }
    }

    function wirePlaygroundButtons() {
      // The drawer body is set via innerHTML, so the Lex elements must have their
      // array/value JS properties assigned and their listeners (re)bound here,
      // mirroring the goal-editor re-bind pattern. A body-level guard keeps the
      // delegated click handler from stacking across re-renders.
      var grain = el('metricPlaygroundGrain');
      if (grain) {
        grain.options = [
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
        ];
        if (!grain.value) grain.value = 'monthly';
      }

      var tabs = el('metricPlaygroundTabs');
      if (tabs) {
        tabs.tabs = [
          { id: 'dashboard', label: 'Dashboard' },
          { id: 'report', label: 'Report' },
        ];
        tabs.active = activeTab;
        if (!tabs.dataset.bound) {
          tabs.dataset.bound = '1';
          // Cached-payload tab switch: re-render the active card, no refetch.
          tabs.addEventListener('tab-change', function (event) {
            setActiveTab(event.detail.tab);
          });
        }
      }

      var body = bodyNode();
      if (body && !body.dataset.playgroundBound) {
        body.dataset.playgroundBound = '1';
        // lex-btn surfaces a bubbling click, so a delegated handler still works
        // for the preset buttons and the Preview button.
        body.addEventListener('click', function (event) {
          var presetBtn = event.target.closest('[data-playground-preset]');
          if (presetBtn) {
            applyPreset(presetBtn.getAttribute('data-playground-preset'));
            return;
          }
          if (event.target.closest('#metricPlaygroundPreview')) {
            // A manual preview run uses whatever is in the inputs; treat it as a
            // custom range so the comparison is the prior equal-length window.
            runPreview(false);
          }
        });
      }

      var closeBtn = document.getElementById('metricPlaygroundClose');
      if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = '1';
        closeBtn.addEventListener('click', function () { if (Lex.Drawer.close) Lex.Drawer.close(); });
      }

      // Default on open: This month preset, monthly grain, auto-run once.
      applyPreset('thisMonth');
    }
    setTimeout(wirePlaygroundButtons, 50);
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

  // Plain-language help shown under the Type select. Copy matches the goal
  // engine: static compares the actual directly to the entered value;
  // rolling_average ignores the entered value and uses the average of the last
  // 3 completed periods; growth_rate treats the entered value as a percent over
  // the prior period.
  function goalTypeHelp(type) {
    if (type === 'rolling_average') {
      return 'Rolling average: the goal tracks your recent norm and adjusts over time. Use it when keeping pace with recent performance matters more than a fixed number. Target value sets how many recent completed periods to average (N) - for example, 3 averages the last three periods.';
    }
    if (type === 'growth_rate') {
      return 'Growth rate: the goal is the prior period plus a percent you set. Enter the percent in Target value (5 means 5 percent above the previous period). Use it for steady, period-over-period improvement. Example: if last period was 100 and you set 5, the target becomes 105.';
    }
    return 'Static: a fixed target for the period. The metric is compared directly to the number you enter in Target value, in the metric\'s own unit. Use it for a concrete, absolute goal. Example: bill 160 hours this month, or sign 12 new clients.';
  }

  // Help for the colour bands. Matches the engine: Green and Red are floors,
  // Yellow is the implicit middle. Blank thresholds fall back to
  // percent-of-target ratio bands.
  var GOAL_THRESHOLD_HELP = 'Green and Red are absolute values in the metric\'s own unit. An actual at or above Green shows green, at or below Red shows red, and anything in between shows yellow (for metrics where lower is better, the comparison flips). Leave both blank to use automatic bands from percent of target: 100 percent or more is green, 80 percent or more is yellow, below that is red. Example, for a goal of 12 new clients: set Green to 12 and Red to 8, so 13 reads green, 10 reads yellow, and 7 reads red.';

  // Label for the Target value field, which changes meaning per type:
  // static -> the absolute target (carrying the metric unit), growth_rate -> a
  // percent over the prior period, rolling_average -> the window N. Delegates to
  // the pure mapper so the unit logic stays unit-testable.
  function targetValueLabel(type) {
    var mapper = goalMapper();
    if (mapper && mapper.targetValueLabel) {
      return mapper.targetValueLabel(type, goalEditorState.formatToken);
    }
    if (type === 'growth_rate') return 'Growth percent';
    if (type === 'rolling_average') return 'Periods to average (N)';
    return 'Target value';
  }

  // Soft unit hint shown under the Target value field for the static type only.
  // Percentage metrics get a note that the value is a percent (we do not hard
  // block values over 100; some percentages legitimately exceed it).
  function targetValueHint(type) {
    if (type !== 'static') return '';
    var token = String(goalEditorState.formatToken || '').toLowerCase();
    if (token === 'percentage' || token === 'percent') {
      return 'Enter the percent as a number (for example, 95 for 95%). Values above 100 are allowed.';
    }
    if (token === 'currency' || token === 'currency_breakdown') {
      return 'Enter the amount in dollars, no symbol (for example, 25000).';
    }
    return '';
  }

  // Build the suggestion row markup for the currently selected period and type.
  // Returns '' when no recommendation applies (non-static type, or null value).
  function recommendationRowHtml(type, period) {
    var mapper = goalMapper();
    if (!mapper || !mapper.buildRecommendationView) return '';
    var rec = goalEditorState.recommendations[period];
    var view = mapper.buildRecommendationView(rec, goalEditorState.formatToken, type);
    if (!view.show) return '';
    var basis = view.basis
      ? '<span class="metric-catalog-goal-suggest__basis">' + escapeHtml(view.basis) + '</span>'
      : '';
    return '<div class="metric-catalog-goal-suggest" id="metricGoalSuggest">'
      + '<span class="metric-catalog-goal-suggest__label">Suggested:</span> '
      + '<span class="metric-catalog-goal-suggest__value">' + escapeHtml(view.valueDisplay) + '</span> '
      + '<lex-btn id="metricGoalSuggestUse" variant="secondary" size="sm" '
      + 'data-suggest-value="' + escapeHtml(String(view.rawValue)) + '">Use</lex-btn>'
      + basis
      + '</div>';
  }

  // Build the Green/Red threshold suggestion row for the current period. which
  // is 'green' | 'red'. Thresholds are absolute metric-unit values, so this row
  // shows for ALL target types (no type gate); it appears only when the cached
  // recommendation carries a finite recommended_green / recommended_red.
  function thresholdSuggestionRowHtml(which, period) {
    var mapper = goalMapper();
    if (!mapper || !mapper.buildThresholdSuggestionView) return '';
    var rec = goalEditorState.recommendations[period];
    var view = mapper.buildThresholdSuggestionView(rec, goalEditorState.formatToken, which);
    if (!view.show) return '';
    var useId = which === 'red' ? 'metricGoalRedSuggestUse' : 'metricGoalGreenSuggestUse';
    var target = which === 'red' ? 'metricGoalRed' : 'metricGoalGreen';
    return '<div class="metric-catalog-goal-suggest metric-catalog-goal-suggest--threshold">'
      + '<span class="metric-catalog-goal-suggest__label">Suggested:</span> '
      + '<span class="metric-catalog-goal-suggest__value">' + escapeHtml(view.valueDisplay) + '</span> '
      + '<lex-btn id="' + useId + '" variant="secondary" size="sm" '
      + 'data-suggest-value="' + escapeHtml(String(view.rawValue)) + '" '
      + 'data-suggest-target="' + target + '">Use</lex-btn>'
      + '</div>';
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

    html += '<p class="metric-catalog-goal-help" id="metricGoalTypeHelp">' + goalTypeHelp(targetType) + '</p>';

    html += '<label class="metric-catalog-goal-field">'
      + '<span class="metric-catalog-goal-field__label"><span id="metricGoalTargetValueLabel">' + escapeHtml(targetValueLabel(targetType)) + '</span> <span class="metric-catalog-goal-req">*</span></span>'
      + '<input type="number" step="any" id="metricGoalTargetValue" class="metric-catalog-goal-field__input" value="' + numAttr(g.target_value) + '" />'
      + '<span class="metric-catalog-goal-hint" id="metricGoalTargetValueHint">' + escapeHtml(targetValueHint(targetType)) + '</span>'
      + '<span class="metric-catalog-goal-error" id="metricGoalTargetValueError"></span>'
      + '</label>';

    html += '<div id="metricGoalSuggestSlot">' + recommendationRowHtml(targetType, period) + '</div>';

    html += '<div class="metric-catalog-goal-form__row">';
    html += '<label class="metric-catalog-goal-field">'
      + '<span class="metric-catalog-goal-field__label">Green threshold</span>'
      + '<input type="number" step="any" id="metricGoalGreen" class="metric-catalog-goal-field__input" value="' + numAttr(g.green_threshold) + '" />'
      + '<div id="metricGoalGreenSuggestSlot">' + thresholdSuggestionRowHtml('green', period) + '</div>'
      + '</label>';
    html += '<label class="metric-catalog-goal-field">'
      + '<span class="metric-catalog-goal-field__label">Red threshold</span>'
      + '<input type="number" step="any" id="metricGoalRed" class="metric-catalog-goal-field__input" value="' + numAttr(g.red_threshold) + '" />'
      + '<div id="metricGoalRedSuggestSlot">' + thresholdSuggestionRowHtml('red', period) + '</div>'
      + '</label>';
    html += '</div>';

    html += '<p class="metric-catalog-goal-help metric-catalog-goal-help--thresholds">' + GOAL_THRESHOLD_HELP + '</p>';

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

    // Reset the per-open format/recommendation cache. The form renders without
    // these (label has no unit, no suggestion); both are patched in once the
    // catalog entry and recommendation fetches resolve. definitionFetched
    // guards the one-time format fetch.
    goalEditorState = { formatToken: '', recommendations: {} };
    var definitionFetched = false;

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

    function currentType() {
      return (el('metricGoalType') || {}).value || 'static';
    }

    // Re-render just the suggestion slot for the current type/period. Called
    // after the type changes (suggestion hides for growth/rolling) and after a
    // recommendation fetch resolves.
    function refreshSuggestionRow() {
      var slot = el('metricGoalSuggestSlot');
      if (slot) slot.innerHTML = recommendationRowHtml(currentType(), currentPeriod);
      var greenSlot = el('metricGoalGreenSuggestSlot');
      if (greenSlot) greenSlot.innerHTML = thresholdSuggestionRowHtml('green', currentPeriod);
      var redSlot = el('metricGoalRedSuggestSlot');
      if (redSlot) redSlot.innerHTML = thresholdSuggestionRowHtml('red', currentPeriod);
    }

    // Lazily fetch the metric's format from the catalog entry once, then patch
    // the Target value label/hint and the suggestion row in place.
    function ensureFormat() {
      if (definitionFetched) return Promise.resolve();
      definitionFetched = true;
      return api.getMetricCatalogEntry(metric.key).then(function (resp) {
        var def = (resp && resp.data) ? resp.data : (resp || null);
        if (def && mapper.formatToken) {
          goalEditorState.formatToken = mapper.formatToken(def.format);
        }
        var labelNode = el('metricGoalTargetValueLabel');
        if (labelNode) labelNode.textContent = targetValueLabel(currentType());
        var hintNode = el('metricGoalTargetValueHint');
        if (hintNode) hintNode.textContent = targetValueHint(currentType());
        refreshSuggestionRow();
      }).catch(function () { /* format is optional; leave unitless */ });
    }

    // Fetch (and cache) the recommendation for a period, then patch the row.
    // No-op when already cached. Tolerant of a failed/absent endpoint.
    function ensureRecommendation(period) {
      if (Object.prototype.hasOwnProperty.call(goalEditorState.recommendations, period)) {
        refreshSuggestionRow();
        return;
      }
      goalEditorState.recommendations[period] = null;
      api.getGoalRecommendation(metric.key, period).then(function (resp) {
        var rec = (resp && resp.data) ? resp.data : (resp || null);
        goalEditorState.recommendations[period] = rec;
        if (currentPeriod === period) refreshSuggestionRow();
      }).catch(function () { /* graceful: no suggestion row */ });
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
        bindTypeSelect();
        syncRemoveButton();
        ensureRecommendation(currentPeriod);
      });
    }

    // Update the Type help text and the Target value label/hint in place when
    // the operator changes the type, without re-rendering the body (which would
    // discard other field input). Also re-renders the suggestion slot, which
    // hides for growth_rate / rolling_average.
    function bindTypeSelect() {
      var typeSel = el('metricGoalType');
      var helpNode = el('metricGoalTypeHelp');
      if (!typeSel || !helpNode) return;
      typeSel.addEventListener('change', function () {
        helpNode.textContent = goalTypeHelp(typeSel.value);
        var labelNode = el('metricGoalTargetValueLabel');
        if (labelNode) labelNode.textContent = targetValueLabel(typeSel.value);
        var hintNode = el('metricGoalTargetValueHint');
        if (hintNode) hintNode.textContent = targetValueHint(typeSel.value);
        refreshSuggestionRow();
      });
    }

    // Delegated handler for the suggestion Use buttons. The target-value button
    // fills #metricGoalTargetValue; the Green/Red threshold buttons carry a
    // data-suggest-target naming the input to fill. Bound once on the body, so
    // it survives the slot re-renders done by refreshSuggestionRow.
    function bindSuggestionUse() {
      var body = bodyNode();
      if (!body || body.dataset.suggestBound) return;
      body.dataset.suggestBound = '1';
      body.addEventListener('click', function (event) {
        var useBtn = event.target.closest('[data-suggest-value]');
        if (!useBtn) return;
        var raw = useBtn.getAttribute('data-suggest-value');
        var targetId = useBtn.getAttribute('data-suggest-target') || 'metricGoalTargetValue';
        var input = el(targetId);
        if (input && raw != null) input.value = raw;
      });
    }

    function wireGoalButtons() {
      bindPeriodSelect();
      bindTypeSelect();
      bindSuggestionUse();
      syncRemoveButton();
      // Kick off the lazy fetches; both patch their UI when they resolve and
      // neither blocks the drawer render.
      ensureFormat();
      ensureRecommendation(currentPeriod);

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
            bindTypeSelect();
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
        var playgroundBtn = event.target.closest('[data-metric-playground]');
        if (playgroundBtn) {
          event.preventDefault();
          event.stopPropagation();
          var pgKey = playgroundBtn.getAttribute('data-metric-playground');
          var pgMetric = allMetrics.find(function (m) { return m.key === pgKey; });
          if (pgMetric) openPlaygroundDrawer(pgMetric);
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
      // Goals load after the catalog so a slow/failed goals call never blocks
      // the table (already rendered above). Await them so a deep-linked goal
      // editor (from a reporting card) opens with the existing goal populated.
      await loadGoals();
      maybeOpenGoalDeepLink();
    } catch (err) {
      console.error('[MetricCatalog] Failed to load metrics:', err);
      if (window.Lex && Lex.Toast) Lex.Toast.error('Failed to load metric catalog');
    }
  }

  // Deep link from the reporting cards: ?editGoal=<key>&module=<moduleKey> opens
  // the goal editor for that metric. Resolves the catalog metric module-scoped
  // first so a bare key shared across modules can't open the wrong one.
  function resolveDeepLinkMetric(rawKey, moduleKey) {
    if (!rawKey) return null;
    var exact = allMetrics.find(function (m) { return m.key === rawKey; });
    if (exact) return exact;
    if (moduleKey) {
      var needle = '.' + moduleKey + '.' + rawKey;
      var byModule = allMetrics.find(function (m) { return String(m.key).endsWith(needle); });
      if (byModule) return byModule;
    }
    var suffix = '.' + rawKey;
    return allMetrics.find(function (m) { return String(m.key).endsWith(suffix); }) || null;
  }

  function maybeOpenGoalDeepLink() {
    if (!isGoalAdmin || typeof URLSearchParams === 'undefined') return;
    var params = new URLSearchParams(window.location.search);
    var rawKey = params.get('editGoal');
    if (!rawKey) return;
    var metric = resolveDeepLinkMetric(rawKey, params.get('module'));
    if (metric) openGoalEditor(metric);
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
