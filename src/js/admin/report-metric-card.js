/* Report tile: renders one scalar metric result for the Reports page
   (moved out of the report page script so it renders in tests). A result whose
   data_state is not ok shows the shared DataState block instead of numbers.
   Formatting and the empty token come from here and DataState. */

(function (global) {
  'use strict';

  var EMPTY = global.DataState.EMPTY_VALUE;
  var esc = global.DataState.escapeHtml;

  function formatNumber(value, decimals) {
    if (decimals === undefined) decimals = 0;
    if (value === null || value === undefined) return EMPTY;
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  }

  function formatPercentage(value, decimals) {
    if (decimals === undefined) decimals = 1;
    if (value === null || value === undefined) return EMPTY;
    return formatNumber(value, decimals) + '%';
  }

  function getStatusColors(color) {
    var colors = {
      green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
      yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700' },
      red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' },
      gray: { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-700' }
    };
    return colors[color] || colors.gray;
  }

  // Footer pinned to the card bottom: info/edit icons (ctx.footerStart), then
  // the drilldown and any tile actions such as Add to dashboard (ctx.footerEnd).
  function footer(ctx, drilldownBtn) {
    return '<div data-metric-card-footer class="report-tile__footer">' +
      '<div class="flex items-center gap-2">' + (ctx.footerStart || '') + '</div>' +
      '<div class="flex items-center gap-3">' + (drilldownBtn || '') + (ctx.footerEnd || '') + '</div></div>';
  }

  // The page's delegated listener (report.js) opens the drilldown from these.
  function drilldownData(kind, metric) {
    return 'data-metric-drilldown="' + kind + '" data-metric-key="' + esc(metric.key) + '" data-metric-name="' + esc(metric.name) + '"';
  }

  // States that read the same calm way as on dashboards: no data source,
  // no data for these dates, and not mapped yet. Other states keep the
  // plain Reports titles.
  var CALM_STATES = { no_data_source: true, no_data: true, not_mapped: true };

  function renderState(metric, ctx) {
    var item = metric;
    var calm = CALM_STATES[metric.data_state] === true;
    // An ok tile with no number goes through the shared no-data state
    // (DataState reads an ok item with value null as no_data).
    if (isEmptyTile(metric)) {
      item = Object.assign({}, metric, { data_state: 'ok', value: null });
      calm = true;
    }
    return '<div data-metric-card class="report-tile bg-white rounded-xl shadow-sm border border-gray-200">' +
      '<div class="mb-4"><h3 class="report-tile__title font-medium text-gray-500 uppercase tracking-wide">' + esc(metric.name) + '</h3>' +
      global.DataState.freshnessBadge(metric) + '</div>' +
      global.DataState.render(item, calm ? { calm: true } : undefined) +
      footer(ctx, '') + '</div>';
  }

  // Ok (or no state sent) with no current value and no server-formatted
  // value: nothing was recorded for these dates. A real 0 is a value.
  function isEmptyTile(metric) {
    var ok = !metric.data_state || metric.data_state === 'ok';
    var empty = metric.current === null || metric.current === undefined;
    var formatted = metric.formattedCurrent !== null && metric.formattedCurrent !== undefined && metric.formattedCurrent !== '';
    return ok && empty && !formatted;
  }

  function render(metric, ctx) {
    ctx = ctx || {};
    if (global.DataState.isProblem(metric) || isEmptyTile(metric)) return renderState(metric, ctx);
    var ReportingGoalComparisonMapper = global.ReportingGoalComparisonMapper;
    // Resolve the metric's display type from its format (object { type } or a
    // string) or the legacy type/unit fields, so values render by type
    // (currency, percentage, days) with comma grouping, not just currency-vs-number.
    var fmtTypeRaw = (metric.format && typeof metric.format === 'object') ? (metric.format.type || metric.format.style) : metric.format;
    var fmtType = String(fmtTypeRaw || metric.type || '').toLowerCase();
    var isCurrency = fmtType === 'currency' || fmtType === 'currency_breakdown' || metric.type === 'currency' || metric.unit === 'dollars';
    var isPercentage = fmtType === 'percentage' || fmtType === 'percent' || metric.type === 'percentage' || metric.unit === 'percent' || metric.unit === '%';
    var isDays = fmtType === 'days' || metric.type === 'days' || metric.unit === 'days';

    var fmtCurrency = function (value) {
      if (value === null || value === undefined || isNaN(value)) return EMPTY;
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    };

    // Prior and Target now flow from the backend-provided goal/comparison blocks
    // (METRIC_GOALS_DESIGN.md sections 7 and 11). The metric layer owns the
    // status band and the prior value; the mapper degrades onto the flat fields
    // when a block is absent so older payloads keep rendering.
    var vm = ReportingGoalComparisonMapper.buildGoalComparisonViewModel(metric);

    var fmtValue = function (value) {
      if (value === null || value === undefined || isNaN(value)) return EMPTY;
      if (isCurrency) return fmtCurrency(value);
      if (isPercentage) return formatPercentage(value, 1);
      if (isDays) return formatNumber(value, 1) + (Number(value) === 1 ? ' day' : ' days');
      return formatNumber(value, 0);
    };

    var currentValue = (metric.current !== null && metric.current !== undefined && !isNaN(metric.current))
      ? fmtValue(metric.current)
      : (metric.formattedCurrent || EMPTY);

    var priorValue = vm.hasComparison
      ? fmtValue(vm.priorValue)
      : ((metric.prior !== null && metric.prior !== undefined)
          ? fmtValue(metric.prior)
          : (metric.formattedPrior || EMPTY));

    var statusColor = vm.statusColor;
    // Direction drives the comparison arrow; prefer the comparison block.
    var changeDirection = vm.changeDirection;
    var upColor = metric.invertTrend ? 'text-red-600' : 'text-green-600';
    var downColor = metric.invertTrend ? 'text-green-600' : 'text-red-600';

    var changeArrow;
    if (changeDirection === 'up') {
      changeArrow = '<svg class="w-4 h-4 ' + upColor + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path></svg>';
    } else if (changeDirection === 'down') {
      changeArrow = '<svg class="w-4 h-4 ' + downColor + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path></svg>';
    } else {
      changeArrow = '<svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14"></path></svg>';
    }

    // Direction is purely numeric; invertTrend decides whether up/down is good
    // or bad for the % Change coloring.
    var isUp = changeDirection === 'up';
    var isDown = changeDirection === 'down';

    var changeColor;
    if (metric.invertTrend) {
      changeColor = isUp ? 'text-red-600' : isDown ? 'text-green-600' : 'text-gray-600';
    } else {
      changeColor = isUp ? 'text-green-600' : isDown ? 'text-red-600' : 'text-gray-600';
    }

    var statusColors = getStatusColors(statusColor);

    // Drilldown button
    var drilldownBtn = '';
    if (metric.hasDrilldown === true) {
      drilldownBtn = '<button type="button" ' + drilldownData('generic', metric) + ' class="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 transition-colors whitespace-nowrap" title="View detailed data breakdown">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>Details</button>';
    } else if (metric.hasDrilldown !== false) {
      drilldownBtn = '<button type="button" ' + drilldownData('details', metric) + ' class="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 transition-colors whitespace-nowrap" title="View details">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>Details</button>';
    }

    // Period qualifier on the goal reflects the report's Compare By (the period
    // the goal is evaluated at).
    var goalPeriod = ctx.goalPeriod || 'monthly';

    // % Change cell: arrow + percent from the comparison block or the live
    // change; the empty token when there is no prior to compare against.
    var pctChangeCell = (vm.percentChange !== null)
      ? '<span class="inline-flex items-center gap-1 ' + changeColor + '">' + changeArrow + formatPercentage(Math.abs(vm.percentChange), 1) + '</span>'
      : '<span class="text-gray-400">' + EMPTY + '</span>';

    // Goal(s) cell: resolved goal target + period qualifier; falls back to the
    // card target (only ever a Metric Catalog goal) and "No goal set" otherwise.
    var goalCell;
    if (vm.hasGoal && vm.targetValue !== null) {
      goalCell = fmtValue(vm.targetValue) + ' <span class="text-xs font-normal text-gray-400">(' + goalPeriod + ')</span>';
    } else if (metric.target !== null && metric.target !== undefined) {
      goalCell = fmtValue(metric.target);
    } else {
      goalCell = '<span class="text-gray-400">No goal set</span>';
    }

    // Percent to Goal: backend attainment when a goal block exists; otherwise
    // current / target client-side so flat-target cards still show progress.
    var goalNumeric = (vm.hasGoal && isFinite(Number(vm.targetValue))) ? Number(vm.targetValue)
      : ((metric.target !== null && metric.target !== undefined && isFinite(Number(metric.target))) ? Number(metric.target) : null);
    var currentNumeric = (metric.current !== null && metric.current !== undefined && isFinite(Number(metric.current))) ? Number(metric.current) : null;
    var pctToGoalNum = (vm.hasGoal && vm.attainmentPct !== null) ? vm.attainmentPct
      : ((goalNumeric && goalNumeric !== 0 && currentNumeric !== null) ? (currentNumeric / goalNumeric * 100) : null);
    var percentToGoalText = (pctToGoalNum !== null && isFinite(pctToGoalNum)) ? formatNumber(pctToGoalNum, 0) + '%' : EMPTY;
    // Percent to Goal: a +/- icon shows at/over (+) vs under (-) the goal
    // (relative to 100% attainment); the value is tinted by the goal status band
    // (inverse-aware via the backend status). Neutral dash when nothing to compare.
    var pctToGoalCell;
    if (pctToGoalNum !== null && isFinite(pctToGoalNum)) {
      var goalIconPath = pctToGoalNum >= 100 ? 'M12 4v16m8-8H4' : 'M20 12H4';
      var goalIcon = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + goalIconPath + '"></path></svg>';
      pctToGoalCell = '<span class="inline-flex items-center gap-1 ' + statusColors.text + '">' + goalIcon + percentToGoalText + '</span>';
    } else {
      pctToGoalCell = '<span class="text-gray-400">' + EMPTY + '</span>';
    }

    var hiddenNote = global.DataState.comparisonNote(metric);
    return '<div data-metric-card class="report-tile bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">' +
      // Header: title (auto-fit, up to 2 lines, 14px -> 10px)
      '<div class="mb-4"><div class="flex items-start justify-between gap-2">' +
      '<h3 data-fit-text="14:10:2" class="report-tile__title font-medium text-gray-500 uppercase tracking-wide flex-1 min-w-0">' + esc(metric.name) + '</h3>' +
      '</div>' +
      // A small calm badge when the server says the data is stale.
      global.DataState.freshnessBadge(metric) + '</div>' +
      // Current period value (auto-fit, 1 line, 30px -> 14px)
      '<div class="mb-4"><div class="flex items-center justify-between mb-1"><p class="text-xs text-gray-500">Current Period</p></div>' +
      '<p data-fit-text="30:14:1" class="report-tile__value font-bold text-gray-900">' + currentValue + '</p></div>' +
      // Row 1: Prior Period | % Change (bottom border doubles as the divider),
      // or the server's message when it withheld the comparison.
      (hiddenNote
        ? '<div class="text-sm mb-4 pb-4 border-b border-gray-100">' + hiddenNote + '</div>'
        : '<div class="grid grid-cols-2 gap-4 text-sm mb-4 pb-4 border-b border-gray-100">' +
          '<div><p class="text-xs text-gray-500 mb-1">Prior Period</p>' +
          '<p data-fit-text="16:11:1" class="report-tile__cell report-tile__cell--fit font-semibold text-gray-700">' + priorValue + '</p></div>' +
          '<div><p class="text-xs text-gray-500 mb-1">% Change</p>' +
          '<p class="report-tile__cell font-semibold">' + pctChangeCell + '</p></div>' +
          '</div>') +
      // Row 2: Goal(s) | Percent to Goal.
      '<div class="grid grid-cols-2 gap-4 text-sm">' +
      '<div><p class="text-xs text-gray-500 mb-1">Goal(s)</p>' +
      '<p data-fit-text="16:11:1" class="report-tile__cell report-tile__cell--fit font-semibold text-gray-700">' + goalCell + '</p></div>' +
      '<div><p class="text-xs text-gray-500 mb-1">Percent to Goal</p>' +
      '<p class="report-tile__cell font-semibold">' + pctToGoalCell + '</p></div>' +
      '</div>' +
      // Footer: pinned to card bottom-left / bottom-right with 12px insets.
      footer(ctx, drilldownBtn) + '</div>';
  }

  // The result header: Compare By as a display label, current and prior
  // periods as their whole UTC days (the backend's plain startDate/endDate).
  function headerLabels(data) {
    var range = function (period) {
      return global.LanaTime.formatUtcDayRange(period.startDate || period.start, period.endDate || period.end) || EMPTY;
    };
    var period = data.period || {};
    var prior = data.priorPeriod;
    return {
      compareBy: global.DataState.label(period.type),
      current: range(period),
      prior: prior && (prior.startDate || prior.start) ? range(prior) : EMPTY
    };
  }

  // What an export (Export PDF, Export CSV) writes for one value: the formatted
  // text when there is one, else the raw value, worded. A distribution (a list
  // of {label, count} groups, such as Aging Status) reads as
  // "Red: 2, Yellow: 5, Green: 11 (total 18)"; a list of plain values as
  // "a, b"; a single object as "key: value, key: value".
  function isGroup(item) {
    return Boolean(item) && typeof item === 'object' && (item.label !== undefined || item.name !== undefined)
      && (item.count !== undefined || item.value !== undefined);
  }

  function distributionText(groups) {
    var total = 0;
    var parts = groups.map(function (g) {
      var label = String(g.label !== undefined ? g.label : g.name);
      var count = Number(g.count !== undefined ? g.count : g.value) || 0;
      total += count;
      return (label.charAt(0).toUpperCase() + label.slice(1)) + ': ' + formatNumber(count, 0);
    });
    return parts.join(', ') + ' (total ' + formatNumber(total, 0) + ')';
  }

  function plainText(value) {
    if (Array.isArray(value)) return value.map(plainText).join(', ');
    if (value && typeof value === 'object') {
      return Object.keys(value).map(function (key) { return key + ': ' + plainText(value[key]); }).join(', ');
    }
    return value === null || value === undefined ? '' : String(value);
  }

  function exportValue(formatted, raw) {
    var value = formatted !== null && formatted !== undefined && formatted !== '' ? formatted : raw;
    if (value === null || value === undefined || value === '') return EMPTY;
    if (Array.isArray(value)) {
      if (!value.length) return EMPTY;
      return value.every(isGroup) ? distributionText(value) : plainText(value);
    }
    if (typeof value === 'object') return plainText(value) || EMPTY;
    return value;
  }

  // The exported file's name: the report's name and the day, for example
  // "Expense Summary 2026-11-23.pdf". Characters a file name cannot hold are dropped.
  function exportFileName(reportName, day, ext) {
    var name = String(reportName || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Report';
    return name + ' ' + day + '.' + ext;
  }

  global.ReportMetricCard = { render: render, headerLabels: headerLabels, formatNumber: formatNumber, formatPercentage: formatPercentage, exportValue: exportValue, exportFileName: exportFileName };
})(window);
