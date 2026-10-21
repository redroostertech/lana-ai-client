/* Metric Detail — canonical drilldown for registry metrics. */

(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  // Lex.Nav stores the canonical query string in history.state.path for
  // SPA-routed navigations, so window.location.search can be empty or
  // stale when this page is opened via Lex.Nav.go('admin/metric_detail.html?...').
  // Mirrors the pattern in dashboard-detail.js / dashboard-builder.js.
  function params() {
    if (window.Lex && Lex.Nav && typeof Lex.Nav.getParams === 'function') {
      return Lex.Nav.getParams();
    }
    return new URLSearchParams(window.location.search || '');
  }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value == null || value === '' ? '-' : String(value);
  }

  // Snake/dot-case identifiers (`legal_operations`, `department_legal_estate_planning`,
  // `legal_firm.estate_planning.upcoming_poa_deed_design_meetings`) must never
  // appear as plain text to users. Apply this anywhere a registry key is
  // rendered as a label, status, audience, or section.
  function humanize(value) {
    if (value == null) return '';
    return String(value)
      .replace(/[_.\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  // Zero is rendered as an em-dash everywhere a metric value, prior value,
  // or movement is shown. Users want to read "—" as "no signal yet" for both
  // missing data and the legitimately-zero case so an empty dashboard
  // doesn't look populated by a wall of zeros.
  function formatNumber(value) {
    var numeric = Number(value);
    if (!isFinite(numeric) || numeric === 0) return '-';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numeric);
  }

  function formatValue(value, format) {
    var numeric = Number(value);
    if (!isFinite(numeric)) return value == null ? '-' : String(value);
    if (numeric === 0) return '-';
    if (format === 'currency') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numeric);
    }
    if (format === 'percent' || format === 'percentage') {
      return numeric.toFixed(1) + '%';
    }
    return formatNumber(numeric);
  }

  function formatMovement(movement) {
    if (!movement || movement.percent_change == null || !isFinite(Number(movement.percent_change))) return '-';
    var pct = Number(movement.percent_change);
    if (pct === 0) return '-';
    var sign = movement.direction === 'down' ? '-' : '+';
    return sign + Math.abs(pct).toFixed(1) + '%';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function tables() {
    return window.LanaMetricTables;
  }

  function muted() {
    return '<span class="metric-detail-muted">\u2014</span>';
  }

  // Dates go through Lex.Utils (API time is UTC; shown in the user's zone).
  function dateTimeCell(value) {
    if (!value || !window.Lex || !Lex.Utils) return muted();
    var text = Lex.Utils.formatDateTime(value);
    if (!text || text === 'Never') return muted();
    return '<time class="metric-detail-time" datetime="' + escapeHtml(value) + '">' + escapeHtml(text) + '</time>';
  }

  function dateCell(value) {
    if (!value || !window.Lex || !Lex.Utils) return muted();
    var text = Lex.Utils.formatDate(value);
    if (!text || text === '-' || text === 'Never') return muted();
    return '<time class="metric-detail-time" datetime="' + escapeHtml(value) + '" title="' + escapeHtml(Lex.Utils.formatDateTime(value)) + '">' + escapeHtml(text) + '</time>';
  }

  var SNAPSHOT_STATUS_COLORS = { success: 'green', ok: 'green', error: 'red', failed: 'red', partial: 'yellow', historical_unverified: 'yellow' };

  function snapshotRenderers() {
    return {
      created_at: dateTimeCell,
      value: function (value, row) {
        var text = formatValue(value, row.format);
        return text === '-' ? muted() : escapeHtml(text);
      },
      status: function (value) {
        if (!value) return muted();
        return '<lex-badge label="' + escapeHtml(tables().humanizeLabel(value)) + '" color="' +
          escapeHtml(SNAPSHOT_STATUS_COLORS[String(value).toLowerCase()] || 'gray') + '"></lex-badge>';
      },
      period_start: dateCell,
      period_end: dateCell,
    };
  }

  function rawRenderers(dateColumns, columns) {
    var renderers = {};
    columns.forEach(function (col) {
      renderers[col] = dateColumns.indexOf(col) !== -1
        ? dateTimeCell
        : function (value) {
          if (value === null || value === undefined || value === '') return muted();
          var text = String(value);
          return '<span class="metric-detail-cell-truncate" title="' + escapeHtml(text) + '">' + escapeHtml(text) + '</span>';
        };
    });
    return renderers;
  }

  var toolbars = {};

  function setEmptyText(table, emptyCopy, filteredCopy) {
    table.emptyText = tables().emptyText(table, emptyCopy, filteredCopy);
  }

  function setSelectOptions(id, options, value) {
    var select = el(id);
    if (!select) return;
    select.options = options;
    if (value !== undefined) select.value = value;
  }

  function renderSnapshots(snapshots) {
    var table = el('metricSnapshotsTable');
    if (!table || typeof table.setData !== 'function') return;
    var shared = tables();
    var rows = (snapshots || []).map(shared.mapSnapshot);
    var filters = shared.snapshotFilterOptions(rows);
    table.setColumnFilterOptions(filters);
    setSelectOptions('metricSnapshotsStatusFilter',
      [{ value: 'all', label: 'All' }].concat(filters.status.options));
    var empty = function () {
      setEmptyText(table, 'No snapshots captured yet', 'No matching snapshots. Try a different search or clear the filters.');
    };
    if (!toolbars.snapshots) {
      toolbars.snapshots = shared.bindClientToolbar(table, {
        search: 'metricSnapshotsSearch',
        sort: 'metricSnapshotsSort',
        order: 'metricSnapshotsSortOrder',
        filter: 'metricSnapshotsStatusFilter',
        counts: ['metricSnapshotsCount', 'metricSnapshotsSectionCount']
      }, { filterKey: 'status', noun: ['snapshot', 'snapshots'], defaultSort: 'created_at' });
      table.addEventListener('lex-filter-change', empty);
    }
    empty();
    table.setData(rows);
    toolbars.snapshots.updateCount();
  }

  function renderRawData(sourceRows) {
    var table = el('metricRawDataTable');
    if (!table || typeof table.setData !== 'function') return;
    var shared = tables();
    var model = shared.rawDataTable(sourceRows, 12);
    if (model.columns.length) {
      table.setAttribute('columns', model.columns.join(','));
      table.setAttribute('labels', model.labels.join(','));
    }
    table.setCellRenderers(rawRenderers(model.dateColumns, model.columns));
    var filterMap = {};
    model.dateColumns.forEach(function (col) {
      var range = shared.createdRangeFilter();
      if (range) filterMap[col] = range;
    });
    table.setColumnFilterOptions(filterMap);
    var sortOptions = model.columns.map(function (col, i) { return { value: col, label: model.labels[i] }; });
    var defaultSort = model.columns.indexOf('created_at') !== -1 ? 'created_at' : (model.columns[0] || '');
    var defaultDir = defaultSort === 'created_at' ? 'desc' : 'asc';
    setSelectOptions('metricRawDataSort', sortOptions, defaultSort);
    var order = el('metricRawDataSortOrder');
    if (order) order.dataset.order = defaultDir;
    var empty = function () {
      setEmptyText(table, 'No source records for this period', 'No matching source records. Try a different search or clear the filters.');
    };
    if (!toolbars.raw) {
      toolbars.raw = shared.bindClientToolbar(table, {
        search: 'metricRawDataSearch',
        sort: 'metricRawDataSort',
        order: 'metricRawDataSortOrder',
        counts: ['metricRawDataCount', 'metricRawDataSectionCount']
      }, { noun: ['record', 'records'], defaultSort: defaultSort });
      table.addEventListener('lex-filter-change', empty);
    }
    empty();
    table.setData(model.rows);
    if (defaultSort && table.dataSource) {
      table.sortBy = defaultSort;
      table.sortDir = defaultDir;
      table.dataSource.setSort(defaultSort, defaultDir);
    }
    toolbars.raw.updateCount();
  }

  function renderBreadcrumb(metric) {
    var breadcrumb = el('metricDetailBreadcrumb');
    if (!breadcrumb) return;
    var leaf = metric.title || metric.name || humanize(metric.key);
    breadcrumb.items = [
      { label: 'Dashboard', href: 'admin/analytics.html' },
      { label: 'Metric Detail' },
      { label: leaf },
    ];
  }

  async function loadMetricDetail() {
    var qp = params();
    var metricKey = qp.get('metric_key') || qp.get('metricKey');
    if (!metricKey) {
      setText('metricTitle', 'Metric not selected');
      return;
    }

    // Preserve the period context the user selected on the dashboard. Without
    // these the detail page would silently fall back to defaults and surface
    // numbers that don't match the modal the user opened.
    var periodParams = {};
    var periodStart = qp.get('periodStart');
    var periodEnd = qp.get('periodEnd');
    var compareBy = qp.get('compareBy');
    if (periodStart) periodParams.periodStart = periodStart;
    if (periodEnd) periodParams.periodEnd = periodEnd;
    if (compareBy) periodParams.compareBy = compareBy;

    try {
      var hasPeriod = Object.keys(periodParams).length > 0;
      var response = await (hasPeriod
        ? api.getMetricDetail(metricKey, periodParams)
        : api.getMetricDetail(metricKey));
      var payload = response && response.data ? response.data : response;
      var metric = payload.metric || {};
      var current = payload.current || {};
      var movement = payload.movement || null;
      // Title falls through to humanized key so the page never shows
      // `legal_firm.estate_planning.upcoming_poa_deed_design_meetings` as a heading.
      var rawTitle = current.title || metric.title || metric.name || metric.key || metricKey;
      var titleLooksLikeKey = rawTitle && rawTitle === (metric.key || metric.metric_key || metricKey);
      var title = titleLooksLikeKey ? humanize(rawTitle) : rawTitle;

      var banner = el('metricDetailBanner');
      if (banner) {
        banner.heading = title;
        banner.subtitle = metric.description || current.description || 'Metric calculation and drilldown';
      }

      renderBreadcrumb({ ...metric, title: title });
      setText('metricTitle', title);
      setText('metricDomain', humanize(metric.domain || current.domain) || 'Metric');
      setText('metricStatus', humanize(current.status || metric.status) || '-');
      setText('metricDescription', current.description || metric.description || '');
      setText('metricCalculation', metric.calculation || current.calculation || '-');
      setText('metricBusinessLogic', metric.businessLogic || current.businessLogic || '-');
      setText('metricCurrentValue', formatValue(current.value_numeric != null ? current.value_numeric : current.value, current.format));
      setText('metricPriorValue', movement ? formatValue(movement.prior_value, current.format) : '-');
      setText('metricMovement', formatMovement(movement));
      // When the period had no movement (flat / 0% change), direction is
      // also not meaningful — render as dash for consistency with the
      // value cards on either side.
      var directionLabel = '-';
      if (movement && movement.direction && movement.direction !== 'flat' && Number(movement.percent_change) !== 0) {
        directionLabel = movement.direction;
      }
      setText('metricDirection', directionLabel);

      renderSnapshots(payload.snapshots || []);
      renderRawData(payload.raw_data && payload.raw_data.rows ? payload.raw_data.rows : []);
    } catch (err) {
      console.error('[MetricDetail] Failed to load metric detail:', err);
      setText('metricTitle', 'Metric unavailable');
      setText('metricDescription', err.message || 'Unable to load metric detail');
    }
  }

  // Configure the History/Source tabs and wire the panel show/hide. Two
  // tables answer different questions (time series vs. current-period rows)
  // so they live behind tabs instead of stacking, which previously made the
  // page look like it had two redundant empty states.
  function initDetailTabs() {
    var tabs = el('metricDetailTabs');
    var historyPanel = el('metricHistoryPanel');
    var sourcePanel = el('metricSourcePanel');
    if (!tabs || !historyPanel || !sourcePanel) return;

    if (typeof tabs.setAttribute === 'function') {
      tabs.setAttribute('tabs', JSON.stringify([
        { id: 'history', label: 'History', icon: 'activity' },
        { id: 'source', label: 'Source Records', icon: 'table' },
      ]));
    }

    function showPanel(tabId) {
      historyPanel.hidden = tabId !== 'history';
      sourcePanel.hidden = tabId !== 'source';
    }
    showPanel('history');

    tabs.addEventListener('tab-change', function (event) {
      var next = event.detail && event.detail.tab;
      if (next) showPanel(next);
    });
  }

  function init() {
    // Admin gate: matches the other admin analytics pages. Backend is still
    // authoritative on /api/v1/modules/metric-detail/:key; this is renderer-
    // layer defense-in-depth so non-admins don't even fire the request.
    if (window.Lex && Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }
    initDetailTabs();
    var ready = window.customElements && typeof window.customElements.whenDefined === 'function'
      ? window.customElements.whenDefined('lex-table')
      : Promise.resolve();
    ready.then(function () {
      var snapshots = el('metricSnapshotsTable');
      // Renderers must be registered before the first setData.
      if (snapshots && typeof snapshots.setCellRenderers === 'function') snapshots.setCellRenderers(snapshotRenderers());
      loadMetricDetail();
    });
  }

  init();
})();
