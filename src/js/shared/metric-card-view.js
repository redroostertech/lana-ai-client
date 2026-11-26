/**
 * Metric card view model (pure, no DOM).
 *
 * Reads one dashboard card (GET /api/v1/modules/dashboard-metric-cards) or a
 * metric detail payload and decides what a tile draws: bars for a list value, the arrow against the previous period, progress
 * toward a goal, a sparkline from stored history, and the numbers the
 * count-up passes through. Drawing lives in mini-charts.js; goal and
 * comparison wording reuse metric-goal-comparison.js.
 *
 * Lists are detected from the value shape only, never by metric key.
 * No regex anywhere (per Lex rules).
 */
(function (root, factory) {
  var goalComparison = (root && root.MetricGoalComparison)
    || (typeof require === 'function' ? require('../dashboard/metric-goal-comparison.js') : null);
  var api = factory(goalComparison);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MetricCardView = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (GoalComparison) {
  'use strict';

  function toNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    var number = Number(value);
    return isFinite(number) ? number : null;
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function sentenceCase(text) {
    var words = String(text || '').split('_').join(' ').split('-').join(' ').split('.').join(' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
  }


  // ── List values to bars ───────────────────────────────────────
  // The list row fields the server sends (no guessing):
  //   plain lists:        { service_key, service_label, value }
  //   actual vs needed:   { service_key, service_label, actual_count, needed_count, variance, average_case_value }
  // needed_count is null until a goal exists.
  var ACTUAL_KEY = 'actual_count';
  var NEEDED_KEY = 'needed_count';
  var VALUE_KEY = 'value';
  var LABEL_KEYS = ['service_label', 'label', 'name', 'title', 'display_name', 'period_label', 'week_label', 'month_label',
    'week', 'month', 'week_start', 'month_start', 'period_start', 'period', 'service_key', 'key', 'id'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function isActualVsNeeded(row) {
    return !!row && typeof row === 'object' && row[ACTUAL_KEY] !== undefined;
  }

  // "2026-01-05" or an ISO instant -> "Jan 5, 2026"; anything else unchanged.
  function dayLabel(text) {
    var day = text.length >= 10 && text.charAt(4) === '-' && text.charAt(7) === '-' ? text.substring(0, 10) : null;
    if (!day || (text.length > 10 && text.charAt(10) !== 'T')) return text;
    var month = Number(day.substring(5, 7));
    var date = Number(day.substring(8, 10));
    if (!(month >= 1 && month <= 12) || !(date >= 1 && date <= 31)) return text;
    return MONTHS[month - 1] + ' ' + date + ', ' + day.substring(0, 4);
  }

  // The first field named *_name ("attorney_name"), for rows without a label.
  function nameField(row) {
    var keys = Object.keys(row);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (key.length > 5 && key.slice(-5) === '_name' && row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== '') return key;
    }
    return null;
  }

  function rowLabel(row, index) {
    if (row === null || row === undefined) return 'Item ' + (index + 1);
    if (typeof row !== 'object') return String(row);
    if (row.service_label === undefined || row.service_label === null || row.service_label === '') {
      var named = nameField(row);
      if (named) return String(row[named]);
    }
    for (var i = 0; i < LABEL_KEYS.length; i += 1) {
      var key = LABEL_KEYS[i];
      var value = row[key];
      if (value === null || value === undefined || String(value).trim() === '') continue;
      var text = String(value);
      if (key === 'key' || key === 'id' || key.slice(-4) === '_key') return sentenceCase(text);
      return dayLabel(text);
    }
    return 'Item ' + (index + 1);
  }

  // A row the server could not rate (status insufficient_data, rate null)
  // carries value_label, for example "Too few to rate".
  function rowValueLabel(row) {
    var text = row.value_label;
    return typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
  }

  // metadata.second_line (for example a cohort rate under the main rate):
  // { label, value (0 to 100 or null), format: 'percentage', numerator,
  // denominator }. Cards carry it on card.metadata (absent when there is
  // none); metric detail on current.metadata. Formatted here ("Cohort rate
  // 42%"); a null value, or any other shape, shows nothing.
  function secondLine(item) {
    if (!item || typeof item !== 'object') return '';
    var holder = item.current && typeof item.current === 'object' ? item.current : item;
    var line = holder.metadata && holder.metadata.second_line;
    if (!line || typeof line !== 'object') return '';
    var value = toNumber(line.value);
    if (value === null) return '';
    var text = round1(value) + (line.format === 'percentage' ? '%' : '');
    return line.label ? String(line.label).trim() + ' ' + text : text;
  }

  function pctOf(value, max) {
    return value !== null && value > 0 && max > 0 ? round1((value / max) * 100) : 0;
  }

  /**
   * @param {*} value - card.value
   * @param {number} [limit=8] - rows to draw; the rest are counted
   * @returns {null|{empty, rows:[{label,value,second,pct,secondPct}], paired, neededPending, max, seriesLabels, hiddenCount}}
   *   paired: at least one row has a needed count, so needed bars are drawn.
   *   neededPending: actual vs needed rows whose needed counts are all still
   *   null (no goal yet): only actual bars are drawn.
   */
  function listBars(value, limit) {
    if (!Array.isArray(value)) return null;
    if (!value.length) return { empty: true, rows: [], paired: false, neededPending: false, max: 0, seriesLabels: [], hiddenCount: 0 };
    var cap = limit > 0 ? limit : 8;
    var actualVsNeeded = value.some(isActualVsNeeded);
    var parsed = value.map(function (row, index) {
      // Records whose source value is not mapped yet (Settings > Mappings).
      var muted = !!(row && typeof row === 'object' && (row.not_mapped === true || row.service_key === 'not_mapped' || row.key === 'not_mapped'));
      var isObject = row && typeof row === 'object';
      var value = isObject ? toNumber(row[actualVsNeeded ? ACTUAL_KEY : VALUE_KEY]) : toNumber(row);
      return {
        label: muted ? 'Not mapped' : rowLabel(row, index),
        value: value,
        second: isObject && actualVsNeeded ? toNumber(row[NEEDED_KEY]) : null,
        muted: muted,
        // No number but the server's value_label ("Too few to rate"): show
        // it in place of the bar, never a 0 bar.
        valueLabel: isObject && value === null ? rowValueLabel(row) : null,
        // A bucket the picked dates cut short (partial: true).
        partial: !!(isObject && row.partial === true),
      };
    });
    var paired = parsed.some(function (row) { return row.second !== null; });
    var max = 0;
    parsed.forEach(function (row) {
      if (row.value !== null && row.value > max) max = row.value;
      if (row.second !== null && row.second > max) max = row.second;
    });
    var rows = parsed.slice(0, cap).map(function (row) {
      var out = {
        label: row.label,
        value: row.value,
        second: row.second,
        pct: pctOf(row.value, max),
        secondPct: row.second === null ? null : pctOf(row.second, max),
        muted: row.muted,
      };
      if (row.valueLabel) out.valueLabel = row.valueLabel;
      if (row.partial) out.partial = true;
      return out;
    });
    return {
      empty: false,
      rows: rows,
      paired: paired,
      neededPending: actualVsNeeded && !paired,
      max: max,
      seriesLabels: paired ? ['Actual', 'Needed'] : [],
      hiddenCount: Math.max(0, parsed.length - cap),
    };
  }

  // The unit of a list card's numbers: the server's row_format (currency |
  // integer | percentage) when it sends one, else the card format:
  // currency_breakdown is dollars, table (and the *_count fields) are plain
  // numbers. Returns 'currency' | 'number' | 'percent'.
  var ROW_FORMATS = { currency: 'currency', integer: 'number', percentage: 'percent' };
  var LIST_VALUE_FORMATS = { currency_breakdown: 'currency', table: 'number' };

  function listValueFormat(card) {
    var rowFormat = card && typeof card.row_format === 'string' ? ROW_FORMATS[card.row_format.toLowerCase()] : null;
    if (rowFormat) return rowFormat;
    var format = card && card.format;
    if (format && typeof format === 'object') format = format.type || format.style;
    return LIST_VALUE_FORMATS[String(format || '').toLowerCase()] || 'number';
  }

  // A list whose items are rates or averages has no meaningful sum: the
  // server says so with formatted_value null, a percentage format, or
  // metadata.aggregation average | rate. Show the items only, no total.
  var NO_TOTAL_AGGREGATIONS = { average: true, avg: true, mean: true, rate: true, ratio: true, percentage: true };

  function listHasNoTotal(card) {
    if (!card || !Array.isArray(card.value)) return false;
    if (Object.prototype.hasOwnProperty.call(card, 'formatted_value') && card.formatted_value === null) return true;
    if (listValueFormat(card) === 'percent') return true;
    var format = card.format && typeof card.format === 'object' ? card.format.type || card.format.style : card.format;
    if (String(format || '').toLowerCase().indexOf('percent') === 0) return true;
    var aggregation = card.metadata && card.metadata.aggregation;
    return !!(aggregation && NO_TOTAL_AGGREGATIONS[String(aggregation).toLowerCase()]);
  }

  // ── Comparison arrow ──────────────────────────────────────────
  // Uses the server's direction and percent_change. No percent, no arrow.
  function comparisonArrow(comparison) {
    if (!comparison || typeof comparison !== 'object' || toNumber(comparison.percent_change) === null) return null;
    var view = GoalComparison.buildComparisonView(comparison);
    var magnitude = view.deltaLabel;
    if (view.direction === 'up') return { direction: 'up', text: '+' + magnitude, spoken: 'Up ' + magnitude + ' from the previous period' };
    if (view.direction === 'down') return { direction: 'down', text: '-' + magnitude, spoken: 'Down ' + magnitude + ' from the previous period' };
    return { direction: 'flat', text: magnitude, spoken: 'No change from the previous period' };
  }

  // ── Goal progress ─────────────────────────────────────────────
  var GOAL_NOTES = {
    unverified_current_observation: 'This number is not confirmed yet, so goal progress is on hold.',
    unsupported_rolling_goal: 'Progress toward a rolling goal is not shown on this card yet.',
    unsupported_goal_type: 'Progress toward this kind of goal is not shown on this card yet.',
    compatible_prior_unavailable: 'There is no earlier period to measure this goal against yet.',
  };
  var DEFAULT_GOAL_NOTE = 'Progress toward this goal is not available for these dates.';
  var PACE_CHIPS = { ahead: 'Ahead', behind: 'Behind', on_track: 'On track' };

  /**
   * @param {Object|null} goal - card.goal (metric-goals.service evaluateGoal)
   * @returns {null|{available:false,note}|{available:true, fillPct, attainmentLabel, band, statusLabel, target,
   *   paceMarkerPct, paceStatus, paceLabel, met}}
   */
  function goalProgress(goal) {
    if (!goal || typeof goal !== 'object') return null;
    var attainment = toNumber(goal.attainment_pct);
    var target = toNumber(goal.target_value_resolved);
    if (goal.reason || attainment === null || target === null) {
      return { available: false, note: GOAL_NOTES[goal.reason] || DEFAULT_GOAL_NOTE };
    }
    var view = GoalComparison.buildGoalView(goal);
    var pacing = goal.pacing && typeof goal.pacing === 'object' ? goal.pacing : null;
    var expected = pacing ? toNumber(pacing.expected_to_date) : null;
    var paceStatus = pacing && typeof pacing.pace_status === 'string' ? pacing.pace_status : null;
    return {
      available: true,
      fillPct: round1(clamp(attainment, 0, 100)),
      attainmentLabel: view.attainmentLabel,
      band: view.band,
      statusLabel: view.statusLabel,
      target: target,
      paceMarkerPct: expected !== null && target > 0 ? round1(clamp((expected / target) * 100, 0, 100)) : null,
      paceStatus: paceStatus,
      paceLabel: paceStatus ? (PACE_CHIPS[paceStatus] || sentenceCase(paceStatus)) : null,
      met: goal.status === 'green' && attainment >= 100,
    };
  }

  // ── Sparkline ─────────────────────────────────────────────────
  // Stored history only: fewer than two numbers draws nothing (never a fake line).
  function sparkline(snapshots, width, height) {
    if (!Array.isArray(snapshots)) return null;
    var w = width > 0 ? width : 100;
    var h = height > 0 ? height : 24;
    var pad = 2;
    var points = snapshots.map(function (snap) {
      var record = snap || {};
      var raw = record.value_numeric !== undefined ? record.value_numeric : record.value;
      return {
        v: toNumber(raw),
        t: String(record.period_start || record.captured_at || record.computed_at || record.created_at || ''),
      };
    }).filter(function (point) { return point.v !== null; });
    if (points.length < 2) return null;
    points.sort(function (a, b) { return a.t < b.t ? -1 : (a.t > b.t ? 1 : 0); });
    var min = Infinity;
    var max = -Infinity;
    points.forEach(function (point) { min = Math.min(min, point.v); max = Math.max(max, point.v); });
    var coords = points.map(function (point, index) {
      var x = round1((index / (points.length - 1)) * w);
      var y = max === min ? round1(h / 2) : round1(pad + (1 - (point.v - min) / (max - min)) * (h - 2 * pad));
      return { x: x, y: y };
    });
    var first = points[0].v;
    var last = points[points.length - 1].v;
    return {
      points: coords.map(function (c) { return c.x + ',' + c.y; }).join(' '),
      last: coords[coords.length - 1],
      trend: last > first ? 'up' : (last < first ? 'down' : 'flat'),
    };
  }

  // ── Count-up ──────────────────────────────────────────────────
  function isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  // "$549,420" -> { prefix: '$', number: 549420, decimals: 0, grouped: true, suffix: '' }, or null.
  function splitFormatted(text) {
    if (typeof text !== 'string' || !text) return null;
    var first = -1;
    var last = -1;
    for (var i = 0; i < text.length; i += 1) {
      if (isDigit(text.charAt(i))) { if (first === -1) first = i; last = i; }
    }
    if (first === -1) return null;
    var middle = text.substring(first, last + 1);
    var dot = -1;
    for (var j = 0; j < middle.length; j += 1) {
      var ch = middle.charAt(j);
      if (ch === '.') {
        if (dot !== -1) return null;
        dot = j;
      } else if (ch === ',') {
        if (dot !== -1) return null;
      } else if (!isDigit(ch)) {
        return null;
      }
    }
    var number = Number(middle.split(',').join(''));
    if (!isFinite(number)) return null;
    return {
      prefix: text.substring(0, first),
      number: number,
      decimals: dot === -1 ? 0 : middle.length - dot - 1,
      grouped: middle.indexOf(',') !== -1,
      suffix: text.substring(last + 1),
    };
  }

  function formatTween(parts, value) {
    return parts.prefix + Number(value).toLocaleString('en-US', {
      minimumFractionDigits: parts.decimals,
      maximumFractionDigits: parts.decimals,
      useGrouping: parts.grouped,
    }) + parts.suffix;
  }

  function easeOut(t) {
    var p = clamp(t, 0, 1);
    return 1 - Math.pow(1 - p, 3);
  }

  // metadata.unassigned = { won, lost, decided } (Team Member Conversion):
  // decided records nobody owns, as a muted footnote; '' when none.
  function unassignedNote(card) {
    var u = card && card.metadata && card.metadata.unassigned;
    if (!u || typeof u !== 'object' || !(toNumber(u.decided) > 0)) return '';
    var won = toNumber(u.won) || 0;
    var lost = toNumber(u.lost) || 0;
    return 'Not assigned to anyone: ' + won.toLocaleString('en-US') + ' won, ' + lost.toLocaleString('en-US') + ' lost';
  }

  return {
    unassignedNote: unassignedNote,
    secondLine: secondLine,
    listHasNoTotal: listHasNoTotal,
    listBars: listBars,
    listValueFormat: listValueFormat,
    comparisonArrow: comparisonArrow,
    goalProgress: goalProgress,
    sparkline: sparkline,
    splitFormatted: splitFormatted,
    formatTween: formatTween,
    easeOut: easeOut,
  };
});
