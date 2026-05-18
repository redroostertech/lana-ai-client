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

  function formatNumber(value) {
    var numeric = Number(value);
    if (!isFinite(numeric)) return '-';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numeric);
  }

  function formatValue(value, format) {
    var numeric = Number(value);
    if (!isFinite(numeric)) return value == null ? '-' : String(value);
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
    var sign = movement.direction === 'down' ? '-' : '+';
    return sign + Math.abs(Number(movement.percent_change)).toFixed(1) + '%';
  }

  function formatDate(value) {
    if (!value) return '-';
    var date = new Date(value);
    if (!isFinite(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  function normalizeRowValue(value) {
    if (value == null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  }

  function flattenRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (row) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return { value: normalizeRowValue(row) };
      }
      return Object.keys(row).reduce(function (acc, key) {
        acc[key] = normalizeRowValue(row[key]);
        return acc;
      }, {});
    });
  }

  function setTableData(tableId, rows) {
    var table = el(tableId);
    var normalized = flattenRows(rows);
    if (!table || typeof table.setData !== 'function') return;

    if (normalized.length > 0) {
      table.setAttribute('columns', Object.keys(normalized[0]).slice(0, 12).join(','));
    }
    table.setData(normalized);
  }

  function renderBreadcrumb(metric) {
    var breadcrumb = el('metricDetailBreadcrumb');
    if (!breadcrumb) return;
    breadcrumb.items = [
      { label: 'Dashboard', href: 'admin/analytics.html' },
      { label: 'Metric Detail' },
      { label: metric.title || metric.name || metric.key },
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
      var title = current.title || metric.title || metric.name || metric.key || metricKey;

      var banner = el('metricDetailBanner');
      if (banner) {
        banner.heading = title;
        banner.subtitle = metric.description || current.description || 'Metric calculation and drilldown';
      }

      renderBreadcrumb({ ...metric, title: title });
      setText('metricTitle', title);
      setText('metricDomain', metric.domain || current.domain || 'Metric');
      setText('metricStatus', current.status || metric.status || '-');
      setText('metricDescription', current.description || metric.description || '');
      setText('metricCalculation', metric.calculation || current.calculation || '-');
      setText('metricBusinessLogic', metric.businessLogic || current.businessLogic || '-');
      setText('metricCurrentValue', formatValue(current.value_numeric != null ? current.value_numeric : current.value, current.format));
      setText('metricPriorValue', movement ? formatValue(movement.prior_value, current.format) : '-');
      setText('metricMovement', formatMovement(movement));
      setText('metricDirection', movement ? movement.direction : '-');

      setTableData('metricSnapshotsTable', (payload.snapshots || []).map(function (snapshot) {
        return {
          captured_at: formatDate(snapshot.captured_at),
          value: formatValue(snapshot.value_numeric, snapshot.format),
          status: snapshot.calculation_status,
          period_start: formatDate(snapshot.period_start),
          period_end: formatDate(snapshot.period_end),
        };
      }));
      setTableData('metricRawDataTable', payload.raw_data && payload.raw_data.rows ? payload.raw_data.rows : []);
    } catch (err) {
      console.error('[MetricDetail] Failed to load metric detail:', err);
      setText('metricTitle', 'Metric unavailable');
      setText('metricDescription', err.message || 'Unable to load metric detail');
    }
  }

  function init() {
    // Admin gate: matches the other admin analytics pages. Backend is still
    // authoritative on /api/v1/modules/metric-detail/:key; this is renderer-
    // layer defense-in-depth so non-admins don't even fire the request.
    if (window.Lex && Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }
    loadMetricDetail();
  }

  init();
})();
