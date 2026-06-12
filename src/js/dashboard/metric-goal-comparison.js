/**
 * Metric Goal + Comparison view-model helpers (pure, no DOM).
 *
 * Maps the optional `goal` and `comparison` blocks the backend metric layer
 * attaches to a metric read (see LANA-AI/docs/METRIC_GOALS_DESIGN.md sections
 * 7 and 11) into display-ready primitives. Both blocks are optional: when the
 * backend returns null, the corresponding builder returns null and consumers
 * render nothing extra (graceful degrade).
 *
 * Pure functions only so they can be unit-tested without a DOM. Renderers
 * (metric-card.widget.js, dashboard-detail.js) own the markup; this module
 * owns the value/label shaping so attainment, pacing, and delta semantics are
 * defined once and never recomputed per surface.
 *
 * No regex anywhere (per Lex rules).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MetricGoalComparison = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // Goal status -> presentation band. 'unknown' and any unexpected value fall
  // back to neutral so an unconfigured/indeterminate goal never shows a
  // misleading green/red.
  var STATUS_BANDS = {
    green: { band: 'green', label: 'On target' },
    yellow: { band: 'yellow', label: 'At risk' },
    red: { band: 'red', label: 'Off target' },
    unknown: { band: 'neutral', label: 'No target signal' },
  };

  var PACE_LABELS = {
    ahead: 'Ahead of pace',
    on_track: 'On pace',
    behind: 'Behind pace',
  };

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function roundTo(value, decimals) {
    var factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  function formatPercent(value, decimals) {
    if (!isFiniteNumber(value)) return null;
    var places = typeof decimals === 'number' ? decimals : 0;
    return roundTo(value, places).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: places,
    }) + '%';
  }

  /**
   * Build the goal view model from a backend `goal` block.
   * @param {Object|null} goal - { target_value_resolved, attainment_pct, delta_to_target, status, pacing, target_type }
   * @returns {Object|null} { band, statusLabel, attainmentPct, attainmentLabel, hasAttainment, pace } or null
   */
  function buildGoalView(goal) {
    if (!goal || typeof goal !== 'object') return null;

    var statusKey = typeof goal.status === 'string' ? goal.status : 'unknown';
    var bandInfo = STATUS_BANDS[statusKey] || STATUS_BANDS.unknown;

    var attainmentPct = isFiniteNumber(goal.attainment_pct) ? goal.attainment_pct : null;
    var attainmentLabel = attainmentPct === null ? null : formatPercent(attainmentPct, 0);

    var pace = null;
    if (goal.pacing && typeof goal.pacing === 'object') {
      var paceStatus = typeof goal.pacing.pace_status === 'string' ? goal.pacing.pace_status : null;
      if (paceStatus) {
        pace = {
          status: paceStatus,
          label: PACE_LABELS[paceStatus] || paceStatus,
        };
      }
    }

    return {
      band: bandInfo.band,
      statusLabel: bandInfo.label,
      attainmentPct: attainmentPct,
      attainmentLabel: attainmentLabel,
      hasAttainment: attainmentLabel !== null,
      pace: pace,
    };
  }

  /**
   * Build the comparison view model from a backend `comparison` block.
   * @param {Object|null} comparison - { previous_value, previous_period, absolute_change, percent_change, direction, source }
   * @returns {Object|null} { direction, deltaLabel, previousValue, hasPrevious } or null
   */
  function buildComparisonView(comparison) {
    if (!comparison || typeof comparison !== 'object') return null;

    var direction = comparison.direction === 'up' || comparison.direction === 'down'
      ? comparison.direction
      : 'flat';

    // percent_change is null when prior is 0 and current is non-zero. Fall back
    // to the absolute change so we always show a magnitude rather than blank.
    var deltaLabel;
    if (isFiniteNumber(comparison.percent_change)) {
      var abs = Math.abs(comparison.percent_change);
      deltaLabel = formatPercent(abs, 1);
    } else if (isFiniteNumber(comparison.absolute_change)) {
      deltaLabel = Math.abs(comparison.absolute_change).toLocaleString('en-US', { maximumFractionDigits: 2 });
    } else {
      deltaLabel = null;
    }

    var previousValue = comparison.previous_value;
    var hasPrevious = isFiniteNumber(previousValue);

    return {
      direction: direction,
      deltaLabel: deltaLabel,
      previousValue: hasPrevious ? previousValue : null,
      hasPrevious: hasPrevious,
    };
  }

  /**
   * Map a period selection to the backend comparison mode. Presets carry a
   * calendar grain (this month vs last month) so they use 'previous_calendar';
   * arbitrary custom ranges use the contiguous equal-length 'previous_period'.
   * @param {boolean} isPreset - true when the period came from a week/month/quarter preset
   * @returns {string} 'previous_calendar' | 'previous_period'
   */
  function resolveCompareMode(isPreset) {
    return isPreset ? 'previous_calendar' : 'previous_period';
  }

  // Map the dashboard grain (compareBy: daily|weekly|monthly|quarterly|yearly) to a
  // backend observation/goal periodType (hourly|daily|weekly|monthly). The backend
  // matches a goal's target_period (weekly/monthly) EXACTLY against periodType, so
  // the dashboard must forward the grain it is viewing at; previously periodType
  // defaulted to daily and never matched a weekly/monthly goal. quarterly/yearly and
  // unknown clamp to 'monthly' (the coarsest goal grain and the dashboard default)
  // so a monthly goal still surfaces.
  function resolveGoalPeriodType(grain) {
    var g = String(grain || '').toLowerCase();
    if (g === 'hourly' || g === 'daily' || g === 'weekly' || g === 'monthly') return g;
    return 'monthly';
  }

  return {
    buildGoalView: buildGoalView,
    buildComparisonView: buildComparisonView,
    resolveCompareMode: resolveCompareMode,
    resolveGoalPeriodType: resolveGoalPeriodType,
  };
});
