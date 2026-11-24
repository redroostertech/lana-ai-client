/* Metric Detail: canonical drilldown for registry metrics. */

(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  // Blank stats and cells use the shared empty token (js/shared/data-state.js).
  var EMPTY = window.DataState.EMPTY_VALUE;

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
    if (node) node.textContent = value == null || value === '' ? EMPTY : String(value);
  }

  // Snake/dot-case identifiers (`legal_operations`, `department_legal_family_law`,
  // `legal_firm.family_law.upcoming_custody_hearings`) must never
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

  // Zero is rendered as the empty token everywhere a metric value, prior
  // value, or movement is shown. Users read it as no signal yet for both
  // missing data and the legitimately-zero case so an empty dashboard
  // doesn't look populated by a wall of zeros.
  function formatNumber(value) {
    var numeric = Number(value);
    if (!isFinite(numeric) || numeric === 0) return EMPTY;
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numeric);
  }

  function formatValue(value, format) {
    var numeric = Number(value);
    if (!isFinite(numeric)) return value == null ? EMPTY : String(value);
    if (numeric === 0) return EMPTY;
    if (format === 'currency') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numeric);
    }
    if (format === 'percent' || format === 'percentage') {
      return numeric.toFixed(1) + '%';
    }
    return formatNumber(numeric);
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
    return '<span class="metric-detail-muted">' + EMPTY + '</span>';
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
        return text === EMPTY ? muted() : escapeHtml(text);
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

  function view() {
    return window.MetricDetailView;
  }

  // Source records read as words: no internal ids, dates as days, a muted
  // dash for an empty cell, and the matter opening its workspace when the
  // row carries one (js/shared/metric-detail-view.js).
  var MUTED_DASH = '<span class="metric-detail-muted">-</span>';

  function recordRenderers(columns) {
    var renderers = {};
    columns.forEach(function (col) {
      renderers[col.key] = function (value, row) {
        var text = view().cellText(value, col.type);
        if (text === null) return MUTED_DASH;
        if (col.key === 'matter_name' && row && row._href) {
          return '<a class="metric-detail-link" href="#" data-metric-record-link="' + escapeHtml(row._href) + '">' + escapeHtml(text) + '</a>';
        }
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
    var model = view().recordsTable(sourceRows);
    if (model.columns.length) {
      table.setAttribute('columns', model.columns.map(function (c) { return c.key; }).join(','));
      table.setAttribute('labels', model.columns.map(function (c) { return c.label; }).join(','));
    }
    table.setCellRenderers(recordRenderers(model.columns));
    var filterMap = {};
    model.columns.filter(function (c) { return c.type === 'date' || c.type === 'datetime'; }).forEach(function (col) {
      var range = shared.createdRangeFilter();
      if (range) filterMap[col.key] = range;
    });
    table.setColumnFilterOptions(filterMap);
    var sortOptions = model.columns.map(function (col) { return { value: col.key, label: col.label }; });
    var firstDate = model.columns.filter(function (c) { return c.type === 'date' || c.type === 'datetime'; })[0];
    var defaultSort = firstDate ? firstDate.key : (model.columns[0] ? model.columns[0].key : '');
    var defaultDir = firstDate ? 'desc' : 'asc';
    setSelectOptions('metricRawDataSort', sortOptions, defaultSort);
    var order = el('metricRawDataSortOrder');
    if (order) order.dataset.order = defaultDir;
    var empty = function () {
      setEmptyText(table, 'No records for these dates', 'No matching records. Try a different search or clear the filters.');
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
    table.setData((Array.isArray(sourceRows) ? sourceRows : []).map(view().recordsRow));
    if (defaultSort && table.dataSource) {
      table.sortBy = defaultSort;
      table.sortDir = defaultDir;
      table.dataSource.setSort(defaultSort, defaultDir);
    }
    toolbars.raw.updateCount();
  }

  // The summary card: value with its unit, the change both ways, the prior
  // period's days, and a small comparison (or the trend when history exists).
  function renderSummary(payload, snapshots) {
    var summary = view().summary(payload);
    setText('metricSummaryValue', summary.value);
    var chip = el('metricSummaryChange');
    if (chip) {
      chip.hidden = !summary.changeText;
      chip.textContent = summary.changeText || '';
      chip.className = 'metric-summary__chip metric-summary__chip--' + (summary.direction || 'flat');
    }
    var prior = el('metricSummaryPrior');
    if (prior) {
      var days = view().dayRangeText(summary.priorDays);
      prior.textContent = summary.priorText ? summary.priorText + (days ? ' (' + days + ')' : '') : '';
    }
    var visual = el('metricSummaryVisual');
    if (!visual) return;
    var line = window.MetricCardView ? window.MetricCardView.sparkline(snapshots, 100, 24) : null;
    if (line && window.MiniCharts) {
      visual.innerHTML = window.MiniCharts.sparklineSvg(line);
    } else if (summary.bars) {
      visual.innerHTML = '<div class="metric-summary__bars">'
        + '<div class="metric-summary__bar-row"><span>This period</span><svg viewBox="0 0 100 10" preserveAspectRatio="none"><rect class="metric-summary__bar metric-summary__bar--current" x="0" y="0" width="' + summary.bars.currentPct + '" height="10"></rect></svg></div>'
        + '<div class="metric-summary__bar-row"><span>Prior period</span><svg viewBox="0 0 100 10" preserveAspectRatio="none"><rect class="metric-summary__bar metric-summary__bar--prior" x="0" y="0" width="' + summary.bars.priorPct + '" height="10"></rect></svg></div>'
        + '</div>';
    } else {
      visual.innerHTML = '';
    }
  }

  // History shows only with at least two stored values; otherwise nothing.
  function renderHistory(snapshots) {
    var section = el('metricHistorySection');
    var line = window.MetricCardView ? window.MetricCardView.sparkline(snapshots, 100, 24) : null;
    if (section) section.hidden = !line;
    var chart = el('metricHistoryChart');
    if (chart) chart.innerHTML = line && window.MiniCharts ? window.MiniCharts.sparklineSvg(line) : '';
    if (line) renderSnapshots(snapshots);
  }

  // Data used (data.lineage, js/shared/lineage-view.js): the calculation in
  // words, the inputs as an equation, where the data comes from, which
  // details we read, what is included, the dates rule, the goal, and caveats.
  function metricHref(key) {
    var qp = params();
    var parts = ['metric_key=' + encodeURIComponent(key)];
    ['periodStart', 'periodEnd', 'compareBy'].forEach(function (name) {
      if (qp.get(name)) parts.push(name + '=' + encodeURIComponent(qp.get(name)));
    });
    return 'admin/metric_detail.html?' + parts.join('&');
  }

  function syncedText(system) {
    if (system.stale) return '<span class="metric-data__stale" title="This source has not synced for over a week">' + escapeHtml(system.staleText) + '</span>';
    if (!system.syncedAt || !window.Lex || !Lex.Utils || !Lex.Utils.timeAgo) return '';
    return '<span class="metric-data__synced">synced ' + escapeHtml(Lex.Utils.timeAgo(system.syncedAt)) + '</span>';
  }

  function renderDataUsed(lineage) {
    var node = el('metricDataUsed');
    if (!node) return;
    var model = window.LineageView ? window.LineageView.detailModel(lineage, Date.now()) : null;
    node.hidden = !model;
    if (!model) { node.innerHTML = ''; return; }
    var parts = ['<h3 class="metric-about__label">Data used</h3>'];
    if (model.formula) parts.push('<p class="metric-data__formula">' + escapeHtml(model.formula) + '</p>');
    if (model.equation) {
      parts.push('<p class="metric-data__equation">' + model.equation.map(function (term) {
        return (term.op ? '<span class="metric-data__op">' + escapeHtml(term.op) + '</span> ' : '')
          + '<a href="#" class="metric-detail-link" data-metric-record-link="' + escapeHtml(metricHref(term.metric_key)) + '">' + escapeHtml(term.title) + '</a>';
      }).join(' ') + '</p>');
    }
    if (model.sources.length) {
      parts.push('<h4 class="metric-data__heading">Where the data comes from</h4><ul class="metric-data__list">' + model.sources.map(function (source) {
        return '<li><span class="metric-data__source">' + escapeHtml(source.line) + '</span>'
          + (source.systems.length ? '<span class="metric-data__systems">' + source.systems.map(function (system) {
            return '<span class="metric-data__system">' + escapeHtml(system.label) + (system.records ? ' (' + escapeHtml(system.records) + ')' : '') + ' ' + syncedText(system) + '</span>';
          }).join('') + '</span>' : '')
          + '</li>';
      }).join('') + '</ul>');
    }
    if (model.fieldSentences.length) {
      parts.push('<h4 class="metric-data__heading">Which details we use</h4><ul class="metric-data__list">'
        + model.fieldSentences.map(function (sentence) { return '<li>' + escapeHtml(sentence) + '</li>'; }).join('') + '</ul>');
    }
    if (model.filters.length) {
      parts.push('<h4 class="metric-data__heading">Included</h4><div class="metric-data__chips">' + model.filters.map(function (filter) {
        return '<span class="metric-data__chip" title="' + escapeHtml(filter.detail) + '">' + escapeHtml(filter.label) + '</span>';
      }).join('') + '</div>');
    }
    if (model.periodRule) parts.push('<h4 class="metric-data__heading">Dates</h4><p>' + escapeHtml(model.periodRule) + '</p>');
    if (model.goal) {
      parts.push('<h4 class="metric-data__heading">Goal</h4><p>' + (model.goal.set
        ? 'A goal is set for this number.'
        : 'No goal yet. <a href="#" class="metric-detail-link" data-metric-record-link="admin/metric-catalog.html?editGoal='
          + escapeHtml(encodeURIComponent(model.goal.metric_key)) + '">Set one in the Metric Catalog</a>') + '</p>');
    }
    if (model.caveats.length) {
      parts.push('<div class="metric-data__caveats">' + model.caveats.map(function (c) { return '<p>' + escapeHtml(c) + '</p>'; }).join('') + '</div>');
    }
    // The raw expression only for admins, folded away.
    var isAdmin = window.Lex && Lex.Auth && typeof Lex.Auth.isAdmin === 'function' && Lex.Auth.isAdmin();
    if (model.expression && isAdmin) {
      parts.push('<details class="metric-data__technical"><summary>Technical details</summary><code>' + escapeHtml(model.expression) + '</code></details>');
    }
    node.innerHTML = parts.join('');
  }

  function showBlock(blockId, textId, text) {
    var block = el(blockId);
    if (block) block.hidden = !text;
    var node = el(textId);
    if (node) node.textContent = text || '';
  }

  // When the server sent only the first page of source records, say so in
  // plain words with the full count (raw_data.total, raw_data.has_more).
  function renderRawDataTotal(rawData) {
    var note = el('metricRawDataTotalNote');
    if (!note) return;
    var shown = rawData && Array.isArray(rawData.rows) ? rawData.rows.length : 0;
    var total = rawData ? Number(rawData.total) : NaN;
    if (!rawData || !rawData.has_more || !isFinite(total) || total <= shown) {
      note.hidden = true;
      note.textContent = '';
      return;
    }
    note.hidden = false;
    note.textContent = 'Showing the first ' + shown.toLocaleString('en-US') + ' of ' + total.toLocaleString('en-US') + ' records.';
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
    // numbers that don't match the modal the user opened. The days are the
    // firm's plain days, sent as they are: the backend bounds them in the
    // firm's zone.
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
      // Title falls through to humanized key so the page never shows
      // `legal_firm.family_law.upcoming_custody_hearings` as a heading.
      var rawTitle = current.title || metric.title || metric.name || metric.key || metricKey;
      var titleLooksLikeKey = rawTitle && rawTitle === (metric.key || metric.metric_key || metricKey);
      var title = titleLooksLikeKey ? humanize(rawTitle) : rawTitle;

      var banner = el('metricDetailBanner');
      if (banner) {
        banner.heading = title;
        banner.subtitle = 'The number, how it moved, and the records behind it.';
      }

      renderBreadcrumb({ ...metric, title: title });
      setText('metricTitle', title);
      // About this number: plain words from the catalog; empty blocks hide.
      var description = current.description || metric.description || '';
      var lead = el('metricDescription');
      if (lead) { lead.textContent = description; lead.hidden = !description; }
      showBlock('metricCalculationBlock', 'metricCalculation', metric.calculation || current.calculation || '');
      showBlock('metricBusinessLogicBlock', 'metricBusinessLogic', metric.businessLogic || current.businessLogic || '');
      // The backend names the period in the firm's days (data.period.label).
      setText('metricPeriod', payload.period && payload.period.label);

      var snapshots = payload.snapshots || [];
      renderSummary(payload, snapshots);
      renderDataUsed(payload.lineage);
      renderHistory(snapshots);
      renderRawData(payload.raw_data && payload.raw_data.rows ? payload.raw_data.rows : []);
      renderRawDataTotal(payload.raw_data);
    } catch (err) {
      console.error('[MetricDetail] Failed to load metric detail:', err);
      setText('metricTitle', 'Metric unavailable');
      setText('metricDescription', err.message || 'Unable to load metric detail');
    }
  }

  // A matter in the records opens its workspace.
  function initRecordLinks() {
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('[data-metric-record-link]') : null;
      if (!link) return;
      event.preventDefault();
      if (window.Lex && Lex.Nav) Lex.Nav.go(link.getAttribute('data-metric-record-link'));
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
    initRecordLinks();
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
