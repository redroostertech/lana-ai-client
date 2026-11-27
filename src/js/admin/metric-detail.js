/* Metric Detail: canonical drilldown for registry metrics. */

(function () {
  'use strict';

  // The firm's currency (Lex.Utils.getFirmCurrency, from /auth/me), else USD.
  function firmCurrency() {
    var host = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    var utils = host.Lex && host.Lex.Utils;
    return utils && typeof utils.getFirmCurrency === 'function' ? utils.getFirmCurrency() : 'USD';
  }

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
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: firmCurrency(), maximumFractionDigits: 0 }).format(numeric);
    }
    if (format === 'percent' || format === 'percentage') {
      return numeric.toFixed(1) + '%';
    }
    if (format === 'integer' || format === 'count') return Math.round(numeric).toLocaleString('en-US');
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

  // The Notes cell: the row's reason, a conflict badge with both values,
  // and a "Fixed in LANA" mark (MetricDetailView.rowNotes).
  function notesHtml(row) {
    var notes = view().rowNotes(row);
    var parts = [];
    if (notes.conflict) {
      // A pinned conflict that does not match the search or filters is muted.
      parts.push((notes.outsideSearch
        ? '<span class="metric-record-badge metric-record-badge--outside">Conflict, outside your search</span> '
        : '<span class="metric-record-badge metric-record-badge--conflict">Conflict</span> ')
        + notes.conflict.fields.map(function (f) {
          return '<span class="metric-record-conflict">' + escapeHtml(f.label + ': LANA ' + (f.lana || 'blank') + ', ' + (f.sourceName || 'source') + ' ' + (f.source || 'blank')) + '</span>';
        }).join(' '));
    }
    if (notes.fixed) parts.push('<span class="metric-record-badge metric-record-badge--fixed">Fixed in LANA</span>');
    if (notes.reason) parts.push('<span class="metric-record-reason">' + escapeHtml(notes.reason) + '</span>');
    // Fix data in LANA, when the row has hints and the person may use them.
    var fix = window.DataFixes ? window.DataFixes.controlsHtml(row, currentPermissions) : '';
    if (fix) parts.push(fix);
    return parts.length ? '<span class="metric-record-notes">' + parts.join(' ') + '</span>' : MUTED_DASH;
  }

  // The signed-in person's { can_correct, can_resolve_conflicts } from the
  // metric detail response.
  var currentPermissions = null;

  function recordRenderers(columns) {
    var renderers = {};
    columns.forEach(function (col) {
      if (col.type === 'notes') {
        renderers[col.key] = function (value, row) { return notesHtml(row); };
        return;
      }
      renderers[col.key] = function (value, row) {
        var text = view().formatCell(value, col);
        if (text === null) return MUTED_DASH;
        if (col.align === 'right') return '<span class="metric-detail-num">' + escapeHtml(text) + '</span>';
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

  // rowColumns: the server's row_columns (headers, formats, labels), which
  // win over the inferred columns when present.
  function renderRawData(sourceRows, rowColumns) {
    var table = el('metricRawDataTable');
    if (!table || typeof table.setData !== 'function') return;
    var shared = tables();
    var model = view().recordsTable(sourceRows, rowColumns);
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
    var sortOptions = model.columns.filter(function (col) { return col.type !== 'notes'; }).map(function (col) { return { value: col.key, label: col.label }; });
    var firstDate = model.columns.filter(function (c) { return c.type === 'date' || c.type === 'datetime'; })[0];
    // Rows the server already sorted (newest first, conflicts pinned on top)
    // keep its order.
    var serverOrder = view().keepsServerOrder(sourceRows);
    var defaultSort = serverOrder ? '' : (firstDate ? firstDate.key : (model.columns[0] ? model.columns[0].key : ''));
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
      bindRecordRows(table);
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

  // A record row opens the record panel (js/shared/report-object-panel.js),
  // and its fix controls work (js/shared/data-fixes.js). Bound once.
  function bindRecordRows(table) {
    if (table._recordRowsBound) return;
    table._recordRowsBound = true;
    table.addEventListener('row-click', function (event) {
      var row = event.detail && event.detail.row;
      var ref = row && window.ReportObjects ? window.ReportObjects.primaryRef(row) : null;
      if (!ref || !window.LanaRecordPanel) return;
      var qp = params();
      window.LanaRecordPanel.open(ref, { period: { start: qp.get('periodStart') || '', end: qp.get('periodEnd') || '' }, row: row,
        permissions: currentPermissions, onSaved: onFixSaved });
    });
    if (window.DataFixes) window.DataFixes.bind(table, { onSaved: onFixSaved });
  }

  // ── Records on the server (search, sort, filters, paging) ──────────
  // When metric detail's raw_data carries filtered_total, facets, sort or
  // filters, the table asks the server: search waits about 300 ms, and an
  // answer to an older query is ignored.
  var rowsQuery = { search: '', sortBy: '', sortDir: 'desc', filters: {}, page: 1, limit: 20 };
  var rowsToken = 0;
  var searchTimer = null;
  var lastDetail = null;

  function renderServerRows(payload) {
    var table = el('metricRawDataTable');
    if (!table || typeof table.setServerData !== 'function') return;
    var raw = payload.raw_data || {};
    var rows = Array.isArray(raw.rows) ? raw.rows : [];
    var model = view().recordsTable(rows, payload.row_columns);
    if (model.columns.length) {
      table.setAttribute('columns', model.columns.map(function (c) { return c.key; }).join(','));
      table.setAttribute('labels', model.columns.map(function (c) { return c.label; }).join(','));
    }
    table.setCellRenderers(recordRenderers(model.columns));
    table.setAttribute('server-paging', '');
    table.setColumnFilterOptions(view().facetFilterOptions(raw.facets));
    table.setServerData(rows.map(view().recordsRow), { page: rowsQuery.page, limit: rowsQuery.limit, total: Number(raw.filtered_total) || rows.length });
    var count = view().rowsCountText(raw, rows.length);
    ['metricRawDataCount', 'metricRawDataSectionCount'].forEach(function (id) {
      var node = el(id);
      if (node) node.textContent = count;
    });
    var truncated = el('metricRawDataTotalNote');
    if (truncated) {
      truncated.textContent = view().truncatedText(raw);
      truncated.hidden = !truncated.textContent;
    }
    bindServerRows(table);
    bindRecordRows(table);
  }

  function bindServerRows(table) {
    if (table._serverRowsBound) return;
    table._serverRowsBound = true;
    table.addEventListener('lex-query-change', function (event) {
      var q = event.detail || {};
      rowsQuery.page = Number(q.page) || 1;
      if (q.limit) rowsQuery.limit = Number(q.limit) || rowsQuery.limit;
      if (q.sortBy) {
        rowsQuery.sortBy = q.sortBy;
        rowsQuery.sortDir = q.sortDir === 'asc' ? 'asc' : 'desc';
        var sortNote = el('metricRawDataSortNote');
        if (sortNote) { sortNote.textContent = ''; sortNote.hidden = true; }
      }
      if (q.filters) rowsQuery.filters = q.filters;
      fetchServerRows();
    });
    var search = el('metricRawDataSearch');
    if (search) {
      search.addEventListener('lex-input', function (event) {
        var value = event.detail && event.detail.value !== undefined ? String(event.detail.value) : '';
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          searchTimer = null;
          rowsQuery.search = value;
          rowsQuery.page = 1;
          fetchServerRows();
        }, 300);
      });
    }
  }

  function fetchServerRows() {
    if (!lastDetail) return;
    var token = ++rowsToken;
    var request = Object.assign({}, lastDetail.periodParams, view().rowsRequestParams(rowsQuery));
    api.getMetricDetail(lastDetail.metricKey, request).then(function (response) {
      if (token !== rowsToken) return;
      var payload = response && response.data ? response.data : response;
      currentRows = payload && payload.raw_data && Array.isArray(payload.raw_data.rows) ? payload.raw_data.rows : [];
      renderServerRows(payload || {});
    }, function (err) {
      if (token !== rowsToken) return;
      // An unknown sort column (400): say so calmly and use the usual order.
      if (err && err.status === 400 && rowsQuery.sortBy) {
        rowsQuery.sortBy = '';
        var note = el('metricRawDataSortNote');
        if (note) {
          note.textContent = 'That column cannot be sorted here, so the records are in their usual order.';
          note.hidden = false;
        }
        fetchServerRows();
        return;
      }
      var node = el('metricRawDataCount');
      if (node) node.textContent = 'Could not load the records. Try again.';
    });
  }

  // The summary card: value with its unit, the change both ways, the prior
  // period's days, and a small comparison (or the trend when history exists).
  function renderSummary(payload, snapshots) {
    var summary = view().summary(payload);
    setText('metricSummaryValue', summary.value);
    // metadata.second_line (for example a cohort rate): a muted line under the value.
    var second = el('metricSummarySecondLine');
    if (second) {
      var secondText = window.MetricCardView ? window.MetricCardView.secondLine(payload) : '';
      second.textContent = secondText;
      second.hidden = !secondText;
    }
    var valueNode = el('metricSummaryValue');
    if (valueNode) valueNode.className = 'metric-summary__value' + (summary.noData ? ' metric-summary__value--empty' : '');
    var chip = el('metricSummaryChange');
    if (chip) {
      chip.hidden = !summary.changeText;
      chip.textContent = summary.changeText || '';
      chip.className = 'metric-summary__chip metric-summary__chip--' + (summary.direction || 'flat');
    }
    var prior = el('metricSummaryPrior');
    if (prior) {
      var days = view().dayRangeText(summary.priorDays);
      prior.textContent = summary.hiddenText || (summary.priorText ? summary.priorText + (days ? ' (' + days + ')' : '') : '');
    }
    var visual = el('metricSummaryVisual');
    if (!visual) return;
    var line = window.MetricCardView ? window.MetricCardView.sparkline(snapshots, 100, 24) : null;
    if (summary.noData) {
      visual.innerHTML = '';
    } else if (line && window.MiniCharts) {
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
  function renderHistory(snapshots, drawn) {
    var section = el('metricHistorySection');
    var line = window.MetricCardView ? window.MetricCardView.sparkline(drawn || snapshots, 100, 24) : null;
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
    ['periodStart', 'periodEnd', 'compareBy', 'from', 'dashboardId'].forEach(function (name) {
      if (qp.get(name)) parts.push(name + '=' + encodeURIComponent(qp.get(name)));
    });
    return 'admin/metric_detail.html?' + parts.join('&');
  }

  // ── About this number: the styled Data used section ───────────────
  // (js/shared/lineage-view.js maps everything; this only draws it.)
  var ICON_PATHS = {
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    funnel: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    sigma: '<path d="M18 4H6l6 8-6 8h12"/>',
    layers: '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  };

  function icon(name, cls) {
    return '<svg class="' + (cls || 'mabout__icon') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + (ICON_PATHS[name] || ICON_PATHS.info) + '</svg>';
  }

  function relative(iso) {
    return iso && window.Lex && Lex.Utils && Lex.Utils.timeAgo ? Lex.Utils.timeAgo(iso) : '';
  }

  function pillLink(label, value, key) {
    return '<a href="#" class="mabout__pill mabout__pill--link" data-metric-record-link="' + escapeHtml(metricHref(key)) + '">'
      + '<span>' + escapeHtml(label) + '</span>' + (value ? '<strong>' + escapeHtml(value) + '</strong>' : '') + '</a>';
  }

  function equationHtml(pills) {
    if (!pills) return '';
    var body;
    if (pills.type === 'equation') {
      body = pills.terms.map(function (term) {
        return (term.op ? '<span class="mabout__op">' + escapeHtml(term.op) + '</span>' : '') + pillLink(term.label, term.value, term.metric_key);
      }).join('');
    } else {
      body = pills.parts.map(function (part) {
        return part.pill ? '<span class="mabout__pill">' + escapeHtml(part.pill) + '</span>' : '<span class="mabout__word">' + escapeHtml(part.text) + '</span>';
      }).join('');
    }
    return '<div class="mabout__equation">' + body
      + (pills.result ? '<span class="mabout__op">=</span><span class="mabout__pill mabout__pill--result"><strong>' + escapeHtml(pills.result) + '</strong></span>' : '')
      + '</div>';
  }

  function flowHtml(steps) {
    return '<ol class="mabout__flow">' + steps.map(function (step) {
      return '<li class="mabout__step mabout__step--' + escapeHtml(step.key) + '">' + icon(step.icon, 'mabout__step-icon')
        + '<span class="mabout__step-title">' + escapeHtml(step.title) + '</span>'
        + step.lines.slice(0, 3).map(function (line) { return '<span class="mabout__step-line">' + escapeHtml(line) + '</span>'; }).join('')
        + '</li>';
    }).join('') + '</ol>';
  }

  function sourcesHtml(cards) {
    if (!cards.length) return '';
    return '<h3 class="mabout__heading">Where the data comes from</h3><div class="mabout__sources">' + cards.map(function (card) {
      var synced = relative(card.syncedAt);
      return '<div class="mabout__source">'
        + '<div class="mabout__source-head">' + icon('database', 'mabout__source-icon') + '<span>' + escapeHtml(card.label) + '</span></div>'
        + '<div class="mabout__total">' + escapeHtml(card.total)
        + (card.scopeNote ? ' <span class="mabout__scope" tabindex="0" title="' + escapeHtml(card.scopeNote) + '" aria-label="' + escapeHtml(card.scopeNote) + '">' + icon('info', 'mabout__scope-icon') + '</span>' : '')
        + '</div>'
        + (card.inDates ? '<span class="mabout__chip">' + escapeHtml(card.inDates) + '</span>' : '')
        + '<div class="mabout__via"><span class="mabout__dot mabout__dot--' + escapeHtml(card.status) + '" aria-hidden="true"></span>'
        + escapeHtml(card.via) + (synced ? ' \u00b7 synced ' + escapeHtml(synced) : '') + '</div>'
        + '</div>';
    }).join('') + '</div>';
  }

  function fieldsHtml(rows) {
    if (!rows.length) return '';
    return '<h3 class="mabout__heading">Which details we use</h3><ul class="mabout__fields">' + rows.map(function (row) {
      return '<li>' + icon(row.icon, 'mabout__field-icon') + '<span>' + escapeHtml(row.sentence) + '</span></li>';
    }).join('') + '</ul>';
  }

  // Current values of the inputs, for the equation pills (loaded once).
  var inputValues = {};

  function loadInputValues(lineage, redraw) {
    var inputs = lineage && Array.isArray(lineage.inputs) ? lineage.inputs : [];
    if (!inputs.length || typeof api === 'undefined' || typeof api.getMetricDetail !== 'function') return;
    var qp = params();
    inputs.forEach(function (input) {
      if (!input.metric_key || inputValues[input.metric_key] !== undefined) return;
      inputValues[input.metric_key] = '';
      api.getMetricDetail(input.metric_key, { periodStart: qp.get('periodStart') || undefined, periodEnd: qp.get('periodEnd') || undefined, rawLimit: 0 })
        .then(function (response) {
          var payload = response && response.data ? response.data : response;
          var current = (payload && payload.current) || {};
          inputValues[input.metric_key] = view().formatValue(current.value, { format: current.format, unit: current.unit }) || '';
          redraw();
        }).catch(function () { /* the pill keeps its name */ });
    });
  }

  function renderDataUsed(lineage, resultText, calculation) {
    var node = el('metricDataUsed');
    if (!node) return;
    var L = window.LineageView;
    var model = L ? L.detailModel(lineage, Date.now()) : null;
    node.hidden = !model;
    if (!model) { node.innerHTML = ''; return; }
    function draw() {
      var parts = [];
      // The calculation in words, unless "How it's calculated" already says it.
      if (model.formula && !L.sameText(model.formula, calculation)) parts.push('<p class="mabout__formula">' + escapeHtml(model.formula) + '</p>');
      parts.push(equationHtml(L.equationPills(lineage, inputValues, resultText)));
      parts.push('<h3 class="mabout__heading">How the number is built</h3>' + flowHtml(L.flowSteps(model, lineage)));
      parts.push(sourcesHtml(L.sourceCards(lineage, Date.now())));
      parts.push(fieldsHtml(L.fieldRows(lineage)));
      if (model.goal) {
        parts.push('<div class="mabout__row">' + icon('target', 'mabout__row-icon') + '<span>' + (model.goal.set
          ? 'A goal is set for this number.'
          : 'No goal yet. <a href="#" class="metric-detail-link" data-metric-record-link="admin/metric-catalog.html?editGoal='
            + escapeHtml(encodeURIComponent(model.goal.metric_key)) + '">Set one in the Metric Catalog</a>') + '</span></div>');
      }
      model.caveats.forEach(function (caveat) {
        parts.push('<div class="mabout__caveat">' + icon('alert', 'mabout__row-icon') + '<span>' + escapeHtml(caveat) + '</span></div>');
      });
      // The raw expression only for admins, folded away.
      var isAdmin = window.Lex && Lex.Auth && typeof Lex.Auth.isAdmin === 'function' && Lex.Auth.isAdmin();
      if (model.expression && isAdmin) {
        parts.push('<details class="metric-data__technical"><summary>Technical details</summary><code>' + escapeHtml(model.expression) + '</code></details>');
      }
      node.innerHTML = parts.join('');
    }
    draw();
    loadInputValues(lineage, draw);
  }

  function showBlock(blockId, textId, text) {
    var block = el(blockId);
    if (block) block.hidden = !text;
    var node = el(textId);
    if (node) node.textContent = text || '';
  }

  // When the server sent only the first page of source records, say so in
  // plain words with the full count (raw_data.total, raw_data.has_more).
  // When the server could not read the records (raw_data.rows_status
  // available: false), the calm note replaces the table, toolbar and help.
  function renderRowsStatus(status) {
    var note = el('metricRawDataUnavailable');
    if (note) {
      note.hidden = !status;
      note.innerHTML = status ? view().unavailableHtml(status) : '';
    }
    ['metricRawDataTable', 'metricRawDataToolbar', 'metricRawDataHelp', 'metricRawDataSectionCount'].forEach(function (id) {
      var node = el(id);
      if (node) node.hidden = !!status;
    });
    var total = el('metricRawDataTotalNote');
    if (status && total) total.hidden = true;
  }

  // Above the records: "As of <day>", the server's basis label, and the
  // conflicts summary (MetricDetailView.recordsHeader).
  // After a fix: update the row in place right away, then reload once the
  // server has re-normalized (refresh.expected_within_seconds).
  var currentRows = [];
  var currentRowColumns = null;
  var fixTimer = null;

  function onFixSaved(info) {
    var row = currentRows.filter(function (r) { return r && String((r.edit && r.edit.record_id) || r.record_id) === String(info.dataId); })[0];
    if (row && info.record && window.DataFixes) {
      window.DataFixes.applyRecord(row, info.record);
      try { renderRawData(currentRows, currentRowColumns); } catch (err) { /* the reload below redraws it */ }
    }
    // Refetch only when the server queued a refresh.
    if (info.delayMs === null || info.delayMs === undefined) return;
    if (fixTimer) clearTimeout(fixTimer);
    fixTimer = setTimeout(function () { fixTimer = null; loadMetricDetail(); }, info.delayMs);
  }

  function renderRecordsHeader(payload) {
    var header = view().recordsHeader(payload);
    [['metricRawDataAsOf', header.asOf], ['metricRawDataBasis', header.basis], ['metricRawDataConflicts', header.conflicts]].forEach(function (pair) {
      var node = el(pair[0]);
      if (!node) return;
      node.textContent = pair[1];
      node.hidden = !pair[1];
    });
  }

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

  // The trail reflects where the page was opened from (from=dashboard with
  // dashboardId, from=catalog, from=report; else Insights). The dashboard's
  // name comes from the API. The shell's Back goes to the parent crumb.
  function renderBreadcrumb(metric) {
    var breadcrumb = el('metricDetailBreadcrumb');
    if (!breadcrumb || !window.InsightsBreadcrumbs) return;
    var qp = params();
    var opts = {
      from: qp.get('from') || '', dashboardId: qp.get('dashboardId') || '', dashboardName: '',
      periodStart: qp.get('periodStart') || '', periodEnd: qp.get('periodEnd') || '',
      metricTitle: metric.title || metric.name || humanize(metric.key),
    };
    function draw() {
      var items = window.InsightsBreadcrumbs.metricDetail(opts);
      breadcrumb.items = items;
      var app = document.querySelector ? document.querySelector('lex-app') : null;
      if (app) app.backHref = window.InsightsBreadcrumbs.backHref(items);
    }
    draw();
    if (opts.from === 'dashboard' && opts.dashboardId && typeof api !== 'undefined' && typeof api.getBIDashboard === 'function') {
      api.getBIDashboard(opts.dashboardId).then(function (response) {
        var dashboard = response && response.data ? response.data : response;
        if (dashboard && dashboard.name) { opts.dashboardName = dashboard.name; draw(); }
      }).catch(function () { /* the crumb keeps "Dashboard" */ });
    }
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
    // All time has nothing before it to compare against.
    if (window.DashboardPeriod && window.DashboardPeriod.isAllTime({ start: periodStart, end: periodEnd })) periodParams.compareToPrevious = false;

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
      // The backend's label, else the picked dates; no line at all otherwise.
      var periodWords = view().periodText(payload.period, qp.get('periodStart'), qp.get('periodEnd'));
      // A small calm badge when the server says the data is stale
      // (data.lineage.freshness on metric detail).
      var freshness = el('metricFreshness');
      if (freshness) {
        freshness.innerHTML = window.DataState.freshnessBadge({ freshness: (payload.lineage && payload.lineage.freshness) || null });
        freshness.hidden = !freshness.innerHTML;
      }
      var periodLine = el('metricPeriodLine');
      if (periodLine) periodLine.hidden = !periodWords;
      var periodNode = el('metricPeriod');
      if (periodNode) periodNode.textContent = periodWords;

      var snapshots = payload.snapshots || [];
      // A long daily series (All time) is drawn by week or month; the
      // snapshot table keeps every row.
      var drawn = window.MetricCardView ? window.MetricCardView.bucketSnapshots(snapshots, current.format) : snapshots;
      renderSummary(payload, drawn);
      renderDataUsed(payload.lineage,
        view().summary(payload).value || '', metric.calculation || current.calculation || '');
      renderHistory(snapshots, drawn);
      // Records the server could not read get the calm note, not a table.
      var rowsStatus = view().rowsStatus(payload.raw_data);
      renderRowsStatus(rowsStatus);
      if (!rowsStatus) {
        currentPermissions = window.DataFixes ? window.DataFixes.permissionsOf(payload) : (payload.permissions || null);
        currentRows = payload.raw_data && Array.isArray(payload.raw_data.rows) ? payload.raw_data.rows : [];
        currentRowColumns = payload.row_columns;
        renderRecordsHeader(payload);
        lastDetail = { metricKey: metricKey, periodParams: periodParams };
        if (view().isServerRows(payload.raw_data)) {
          var sort = payload.raw_data.sort || {};
          if (!rowsQuery.sortBy && sort.by) { rowsQuery.sortBy = String(sort.by); rowsQuery.sortDir = sort.dir === 'asc' ? 'asc' : 'desc'; }
          renderServerRows(payload);
        } else {
          renderRawData(payload.raw_data && payload.raw_data.rows ? payload.raw_data.rows : [], payload.row_columns);
          renderRawDataTotal(payload.raw_data);
        }
      }
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
