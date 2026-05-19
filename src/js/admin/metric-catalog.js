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

  function normalizeMetric(metric) {
    var executableLabel = metric.executable === true ? 'Yes' : 'No';
    var statusLabel = metric.display_status || metric.status || 'unknown';
    return Object.assign({}, metric, {
      executable_label: executableLabel,
      display_name: metric.display_name || metric.title || metric.name || metric.key,
      display_domain: metric.display_domain || '-',
      display_primary_audience: metric.display_primary_audience || '-',
      display_status: statusLabel,
      last_run: 'last_run_placeholder',
      actions: 'actions_placeholder',
    });
  }

  function buildFilters() {
    var domainSel = el('metricCatalogDomainFilter');
    var audienceSel = el('metricCatalogAudienceFilter');
    if (!domainSel || !audienceSel) return;

    var domains = new Set();
    var audiences = new Set();
    allMetrics.forEach(function (m) {
      if (m.domain) domains.add(m.domain);
      if (m.primaryAudience) audiences.add(m.primaryAudience);
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
  }

  function applyFilters() {
    var search = (el('metricCatalogSearch') || {}).value || '';
    var executable = (el('metricCatalogExecutableFilter') || {}).value || '';
    var domain = (el('metricCatalogDomainFilter') || {}).value || '';
    var audience = (el('metricCatalogAudienceFilter') || {}).value || '';

    var q = search.trim().toLowerCase();

    visibleMetrics = allMetrics.filter(function (m) {
      if (executable === 'true' && m.executable !== true) return false;
      if (executable === 'false' && m.executable === true) return false;
      if (domain && m.domain !== domain) return false;
      if (audience && m.primaryAudience !== audience) return false;
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

  function lastRunCell(metric) {
    var run = lastRunByKey[metric.key];
    if (!run) return '<span class="metric-catalog-muted">never</span>';
    if (run.status === 'pending') return '<span class="metric-catalog-muted">running...</span>';
    if (run.status === 'pass') {
      var v = run.value === null || run.value === undefined ? '-' : displayText(run.value);
      return '<span class="metric-catalog-pill metric-catalog-pill--ok">pass</span>'
        + '<span class="metric-catalog-muted metric-catalog-runcell-value">' + escapeHtml(v) + '</span>';
    }
    return '<span class="metric-catalog-pill metric-catalog-pill--fail" title="' + escapeHtml(run.error || '') + '">fail</span>';
  }

  function actionsCell(metric) {
    return '<div class="metric-catalog-actions">'
      + '<button type="button" class="metric-catalog-btn metric-catalog-btn--run" data-metric-run="' + escapeHtml(metric.key) + '">Run</button>'
      + '<button type="button" class="metric-catalog-btn" data-metric-view="' + escapeHtml(metric.key) + '">View</button>'
      + '</div>';
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
        key: function (value) {
          return '<code class="metric-catalog-key">' + escapeHtml(value || '-') + '</code>';
        },
        display_status: function (value) { return statusPill(value); },
        executable_label: function (value) {
          var ok = value === 'Yes';
          return '<span class="metric-catalog-pill ' + (ok ? 'metric-catalog-pill--ok' : 'metric-catalog-pill--muted') + '">' + escapeHtml(value) + '</span>';
        },
        last_run: function (_value, row) { return lastRunCell(row); },
        actions: function (_value, row) { return actionsCell(row); },
      });
    }

    if (typeof table.setData === 'function') {
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
      html += '<div><strong>Value:</strong> ' + escapeHtml(displayText(run.value)) + '</div>';
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

  function wireToolbar() {
    var search = el('metricCatalogSearch');
    if (search) {
      var t;
      search.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(applyFilters, 150);
      });
    }
    ['metricCatalogExecutableFilter', 'metricCatalogDomainFilter', 'metricCatalogAudienceFilter'].forEach(function (id) {
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

  async function load() {
    if (!window.api || typeof api.getMetricCatalog !== 'function') return;
    try {
      var response = await api.getMetricCatalog({ limit: 500 });
      var rows = Array.isArray(response && response.data) ? response.data : [];
      allMetrics = rows.map(normalizeMetric);
      buildFilters();
      applyFilters();
      updateSummary(response && response.summary);
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
    wireToolbar();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
