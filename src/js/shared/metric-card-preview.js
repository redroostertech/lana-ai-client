/*
 * metric-card-preview.js
 *
 * Pure, side-effect-free string renderers for the Metric Catalog Playground.
 * They mirror the live dashboard card (dashboard-detail.js renderMetricCard)
 * and the reporting card (reporting.js createMetricCard) so an admin can preview
 * how a single metric would read on a dashboard and in a report, plus the goal
 * rules and a drilldown of the underlying rows.
 *
 * Contract - pure: string-in / string-out, null-safe, no fetch, no DOM, no
 * globals. Goal/comparison shaping is delegated to the existing pure mappers
 * (MetricGoalComparison, ReportingGoalComparisonMapper) which the host page
 * loads. Dual export (window.MetricCardPreview AND module.exports) mirrors
 * reporting-goal-comparison-mapper.js.
 */
(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  // The host (Electron renderer) reaches these mappers via window; Node tests
  // reach them via globalThis. Resolve both so the module degrades gracefully
  // when a mapper is absent and works under either runtime.
  function scope() {
    if (typeof globalThis !== 'undefined') return globalThis;
    return global;
  }

  // Resolve the pure mappers from globals when present. Kept as accessors so
  // the module loads even if a mapper is missing; the renderers then degrade.
  function goalComparison() {
    var g = scope();
    return (g && g.MetricGoalComparison) || (global && global.MetricGoalComparison) || null;
  }
  function reportingMapper() {
    var g = scope();
    return (g && g.ReportingGoalComparisonMapper) || (global && global.ReportingGoalComparisonMapper) || null;
  }

  // Coerce a metric format (which may be a plain string token like "currency"
  // or a registry config object like { type: 'percentage', ... }) into a
  // readable token. Used both for value formatting and the Rules "Format" row
  // so an object never renders as "[object Object]".
  function formatToken(format) {
    if (format == null) return '';
    if (typeof format === 'string') return format;
    if (typeof format === 'object') {
      var t = format.type || format.style || format.format || format.name || format.unit;
      if (t) return String(t);
      try { return JSON.stringify(format); } catch (e) { return '(object)'; }
    }
    return String(format);
  }

  // Extract human-readable calculation text. Registry calculations are often a
  // JSON wrapper { "query": "SELECT ...", ... } (as an object or a JSON string);
  // show just the SQL rather than the wrapper.
  function calculationText(calc) {
    if (calc == null) return '';
    var obj = calc;
    if (typeof calc === 'string') {
      var s = calc.trim();
      if (s.charAt(0) !== '{') return s;
      try { obj = JSON.parse(s); } catch (e) { return s; }
    }
    if (obj && typeof obj === 'object') {
      if (typeof obj.query === 'string') return obj.query;
      if (typeof obj.sql === 'string') return obj.sql;
      try { return JSON.stringify(obj); } catch (e) { return String(obj); }
    }
    return String(obj);
  }

  // Shared value formatter for the preview cards. Coerces the backend value
  // (number or numeric string) into a display string honoring the metric
  // format. Non-numeric / empty values render as a dash so an empty metric
  // never looks populated.
  // Core numeric formatter by metric format (comma grouping + unit). Does NOT
  // special-case zero, so callers that treat 0 as a real value (configured
  // targets/thresholds) get a real formatted number.
  function formatNumberByType(num, format) {
    var fmt = (formatToken(format) || 'number').toLowerCase();
    if (fmt === 'currency' || fmt === 'currency_breakdown') {
      return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    }
    if (fmt === 'percentage' || fmt === 'percent') {
      return num.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
    }
    if (fmt === 'integer' || fmt === 'count') {
      return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    if (fmt === 'days') {
      return num.toLocaleString('en-US', { maximumFractionDigits: 1 }) + (num === 1 ? ' day' : ' days');
    }
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // Card-value formatter: empty / zero render as a dash so an empty metric never
  // looks populated.
  function formatValue(value, format) {
    if (value == null || value === '') return '-';
    var num = Number(value);
    if (value === 0 || num === 0) return '-';
    if (!isFinite(num)) return escapeHtml(String(value));
    return formatNumberByType(num, format);
  }

  // ---------------------------------------------------------------------------
  // Dashboard preview card (mirrors dashboard-detail.js dash-metric-card__*).
  // Input metric: { title, key, value, format, goal, comparison }.
  // Omits the page-only info button.
  // ---------------------------------------------------------------------------
  function renderDashboardPreviewCard(metric) {
    var m = metric || {};
    var title = m.title || m.key || 'Metric';
    var value = formatValue(m.value, m.format);

    var comparisonHtml = '';
    var goalHtml = '';
    var helper = goalComparison();

    if (helper) {
      var compView = helper.buildComparisonView(m.comparison);
      if (compView) {
        var dirClass = 'dash-metric-card__delta--flat';
        var sign = '';
        if (compView.direction === 'up') { dirClass = 'dash-metric-card__delta--up'; sign = '+'; }
        else if (compView.direction === 'down') { dirClass = 'dash-metric-card__delta--down'; sign = '-'; }

        var deltaHtml = compView.deltaLabel
          ? '<span class="dash-metric-card__delta ' + dirClass + '">' + escapeHtml(sign + compView.deltaLabel) + '</span>'
          : '';
        var priorHtml = compView.hasPrevious
          ? '<span class="dash-metric-card__delta-prior">was ' + escapeHtml(formatValue(compView.previousValue, m.format)) + '</span>'
          : '';
        comparisonHtml = '<div class="dash-metric-card__comparison">'
          + deltaHtml
          + '<span class="dash-metric-card__delta-label">vs previous period</span>'
          + priorHtml
          + '</div>';
      }

      var goalView = helper.buildGoalView(m.goal);
      if (goalView) {
        var attainmentHtml = goalView.hasAttainment
          ? '<span class="dash-metric-card__goal-attainment">' + escapeHtml(goalView.attainmentLabel) + ' of goal</span>'
          : '';
        var paceHtml = goalView.pace
          ? '<span class="dash-metric-card__goal-pace">' + escapeHtml(goalView.pace.label) + '</span>'
          : '';
        goalHtml = '<div class="dash-metric-card__goal">'
          + '<span class="dash-metric-card__goal-band dash-metric-card__goal-band--' + escapeHtml(goalView.band) + '">'
          + escapeHtml(goalView.statusLabel)
          + '</span>'
          + attainmentHtml
          + paceHtml
          + '</div>';
      }
    }

    return '<article class="dash-metric-card">'
      + '<div class="dash-metric-card__top">'
      + '<div>'
      + '<div class="dash-metric-card__eyebrow">Dashboard preview</div>'
      + '<div class="dash-metric-card__title">' + escapeHtml(title) + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="dash-metric-card__result">'
      + '<div class="dash-metric-card__value">' + value + '</div>'
      + '<div class="dash-metric-card__period">Selected period</div>'
      + '</div>'
      + comparisonHtml
      + goalHtml
      + '</article>';
  }

  // ---------------------------------------------------------------------------
  // Report preview card (mirrors reporting.js createMetricCard visual: a
  // status-color background, Current value, change indicator, Prior/Target +
  // attainment grid). Input metric: { name, current, format, goal, comparison }.
  // Omits the override/drilldown/info action buttons (the Playground has its
  // own drilldown section).
  // ---------------------------------------------------------------------------
  function renderReportPreviewCard(metric) {
    var m = metric || {};
    var name = m.name || m.title || m.key || 'Metric';
    var format = m.format;
    var mapper = reportingMapper();

    var statusColor = 'gray';
    var hasGoal = false;
    var hasComparison = false;
    var targetValue = null;
    var attainmentPct = null;
    var priorValue = null;
    var percentChange = null;
    var changeDirection = 'flat';

    if (mapper) {
      var vm = mapper.buildGoalComparisonViewModel({
        goal: m.goal || null,
        comparison: m.comparison || null,
      });
      statusColor = vm.statusColor;
      hasGoal = vm.hasGoal;
      hasComparison = vm.hasComparison;
      targetValue = vm.targetValue;
      attainmentPct = vm.attainmentPct;
      priorValue = vm.priorValue;
      percentChange = vm.percentChange;
      changeDirection = vm.changeDirection;
    }

    var currentText = formatValue(m.current, format);
    var priorText = (hasComparison && priorValue != null) ? formatValue(priorValue, format) : 'N/A';
    var targetText = (hasGoal && targetValue != null) ? formatValue(targetValue, format) : 'N/A';

    var attainmentText = (hasGoal && isFiniteNumber(attainmentPct))
      ? attainmentPct.toLocaleString('en-US', { maximumFractionDigits: 0 }) + '% of target'
      : '';

    var changeText;
    if (hasComparison && isFiniteNumber(percentChange)) {
      changeText = Math.abs(percentChange).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
    } else {
      changeText = 'N/A';
    }

    var changeClass = 'metric-catalog-playground-report__change--flat';
    var changeGlyph = '=';
    var changeLabel = 'no change';
    if (changeDirection === 'up') {
      changeClass = 'metric-catalog-playground-report__change--up';
      changeGlyph = '+';
      changeLabel = 'increase';
    } else if (changeDirection === 'down') {
      changeClass = 'metric-catalog-playground-report__change--down';
      changeGlyph = '-';
      changeLabel = 'decrease';
    }

    return '<div class="metric-catalog-playground-report metric-catalog-playground-report--' + escapeHtml(statusColor) + '">'
      + '<div class="metric-catalog-playground-report__name">' + escapeHtml(name) + '</div>'
      + '<div class="metric-catalog-playground-report__current-label">Current Period</div>'
      + '<div class="metric-catalog-playground-report__current">' + currentText + '</div>'
      + '<div class="metric-catalog-playground-report__change ' + changeClass + '">'
      + escapeHtml(changeGlyph + ' ' + changeText + ' ' + changeLabel)
      + '</div>'
      + '<div class="metric-catalog-playground-report__grid">'
      + '<div><div class="metric-catalog-playground-report__sub-label">Prior Period</div>'
      + '<div class="metric-catalog-playground-report__sub-value">' + priorText + '</div></div>'
      + '<div><div class="metric-catalog-playground-report__sub-label">Target</div>'
      + '<div class="metric-catalog-playground-report__sub-value">' + targetText + '</div>'
      + (attainmentText ? '<div class="metric-catalog-playground-report__attainment">' + escapeHtml(attainmentText) + '</div>' : '')
      + '</div>'
      + '</div>'
      + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Rules panel: plain-language goal + definition rules.
  // ---------------------------------------------------------------------------
  function rulesRow(label, value) {
    return '<div class="metric-catalog-playground-rules__row">'
      + '<span class="metric-catalog-playground-rules__label">' + escapeHtml(label) + '</span>'
      + '<span class="metric-catalog-playground-rules__value">' + escapeHtml(value) + '</span>'
      + '</div>';
  }

  function targetSummary(goal, format) {
    var type = goal.target_type || 'static';
    if (type === 'rolling_average') {
      return 'Window ' + (goal.target_value != null ? goal.target_value : '?') + ' periods';
    }
    if (type === 'growth_rate') {
      return (goal.target_value != null ? goal.target_value : '?') + ' percent over prior';
    }
    return (goal.target_value != null && isFinite(Number(goal.target_value)))
      ? formatNumberByType(Number(goal.target_value), format)
      : '(none)';
  }

  function bandingSummary(goal, format) {
    var hasFloors = goal.green_threshold != null || goal.red_threshold != null;
    if (hasFloors) {
      var green = (goal.green_threshold != null && isFinite(Number(goal.green_threshold)))
        ? formatNumberByType(Number(goal.green_threshold), format) : 'blank';
      var red = (goal.red_threshold != null && isFinite(Number(goal.red_threshold)))
        ? formatNumberByType(Number(goal.red_threshold), format) : 'blank';
      return 'Green and Red are floors (Green ' + green + ', Red ' + red + '); Yellow is the band between.';
    }
    return 'Percent-of-target bands: 100 percent or more is green, 80 percent or more is yellow, below that is red.';
  }

  function renderRulesPanel(goal, definition) {
    var parts = ['<div class="metric-catalog-playground-rules">'];

    parts.push('<div class="metric-catalog-playground-rules__section">');
    parts.push('<div class="metric-catalog-playground-rules__heading">Goal</div>');
    if (goal) {
      var goalFormat = definition && definition.format;
      parts.push(rulesRow('Target', targetSummary(goal, goalFormat)));
      parts.push(rulesRow('Period', goal.target_period || '(unset)'));
      parts.push(rulesRow('Type', goal.target_type || 'static'));
      parts.push('<div class="metric-catalog-playground-rules__note">' + escapeHtml(bandingSummary(goal, goalFormat)) + '</div>');
      if (goal.notes) {
        parts.push('<div class="metric-catalog-playground-rules__note">' + escapeHtml(goal.notes) + '</div>');
      }
    } else {
      parts.push('<div class="metric-catalog-playground-rules__note">No goal configured for this period.</div>');
    }
    parts.push('</div>');

    if (definition) {
      parts.push('<div class="metric-catalog-playground-rules__section">');
      parts.push('<div class="metric-catalog-playground-rules__heading">Definition</div>');
      var fmtLabel = formatToken(definition.format);
      if (fmtLabel) parts.push(rulesRow('Format', fmtLabel));
      if (definition.inverse != null) parts.push(rulesRow('Inverse', definition.inverse ? 'Yes (lower is better)' : 'No'));
      if (definition.accumulation != null) parts.push(rulesRow('Accumulation', String(definition.accumulation)));

      var entities = definition.entities;
      if (Array.isArray(entities) && entities.length) {
        var names = entities.map(function (e) {
          if (e == null) return '';
          if (typeof e === 'string') return e;
          return e.entity_type || e.name || e.entity || e.key || '';
        }).filter(Boolean).join(', ');
        if (names) parts.push(rulesRow('Entities', names));
      }

      var calc = definition.calculation;
      if (calc != null) {
        var calcText = calculationText(calc);
        if (calcText && calcText.length > 240) calcText = calcText.slice(0, 240) + '...';
        if (calcText) {
          parts.push('<div class="metric-catalog-playground-rules__calc">'
            + '<div class="metric-catalog-playground-rules__label">Calculation</div>'
            + '<pre class="metric-catalog-playground-rules__code">' + escapeHtml(calcText) + '</pre>'
            + '</div>');
        }
      }
      parts.push('</div>');
    }

    parts.push('</div>');
    return parts.join('');
  }

  // ---------------------------------------------------------------------------
  // Drilldown table from raw_rows. Columns = union of keys across the first
  // rows, capped at ~8 columns and ~50 rows. Escapes all cell content.
  // ---------------------------------------------------------------------------
  var MAX_COLUMNS = 8;
  var MAX_ROWS = 50;

  function cellText(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (e) { return String(value); }
    }
    return String(value);
  }

  function renderDrilldownTable(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return '<div class="metric-catalog-playground-drilldown metric-catalog-playground-drilldown--empty">'
        + 'No underlying rows for this period.'
        + '</div>';
    }

    // Build the column union from the first rows (cap the scan to the rows we
    // will render so a wide tail row never adds a column nothing else fills).
    var scan = rows.slice(0, MAX_ROWS);
    var seen = {};
    var columns = [];
    for (var i = 0; i < scan.length && columns.length < MAX_COLUMNS; i++) {
      var row = scan[i];
      if (!row || typeof row !== 'object') continue;
      var keys = Object.keys(row);
      for (var k = 0; k < keys.length && columns.length < MAX_COLUMNS; k++) {
        var key = keys[k];
        if (!seen[key]) {
          seen[key] = true;
          columns.push(key);
        }
      }
    }

    if (columns.length === 0) {
      return '<div class="metric-catalog-playground-drilldown metric-catalog-playground-drilldown--empty">'
        + 'Rows have no displayable columns.'
        + '</div>';
    }

    var head = columns.map(function (c) {
      return '<th>' + escapeHtml(c) + '</th>';
    }).join('');

    var body = scan.map(function (row) {
      var cells = columns.map(function (c) {
        var val = (row && typeof row === 'object') ? row[c] : undefined;
        return '<td>' + escapeHtml(cellText(val)) + '</td>';
      }).join('');
      return '<tr>' + cells + '</tr>';
    }).join('');

    var truncated = rows.length > MAX_ROWS
      ? '<div class="metric-catalog-playground-drilldown__note">Showing first ' + MAX_ROWS + ' of ' + rows.length + ' rows.</div>'
      : '';

    return '<div class="metric-catalog-playground-drilldown">'
      + '<div class="metric-catalog-playground-drilldown__scroll">'
      + '<table class="metric-catalog-playground-drilldown__table">'
      + '<thead><tr>' + head + '</tr></thead>'
      + '<tbody>' + body + '</tbody>'
      + '</table>'
      + '</div>'
      + truncated
      + '</div>';
  }

  var api = {
    renderDashboardPreviewCard: renderDashboardPreviewCard,
    renderReportPreviewCard: renderReportPreviewCard,
    renderRulesPanel: renderRulesPanel,
    renderDrilldownTable: renderDrilldownTable,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.MetricCardPreview = api;
  }
})(typeof window !== 'undefined' ? window : this);
