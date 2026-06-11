/*
 * reporting-goal-comparison-mapper.js
 *
 * Pure, side-effect-free mapper that turns a metric's backend-provided `goal`
 * and `comparison` blocks (see LANA-AI/docs/METRIC_GOALS_DESIGN.md, sections 7
 * and 11) into the small view-model the reporting metric card renders.
 *
 * The metric layer now owns attainment and the prior-period value, so the
 * client never recomputes the status band or the prior fetch. When a block is
 * absent (null), the mapper degrades gracefully onto the metric's existing flat
 * fields (status, prior/formattedPrior, target/formattedTarget, change/
 * changeDirection) so older payloads keep rendering.
 *
 * Contract — pure: no fetch, no DOM, no globals. Formatting of the actual
 * numbers stays in the renderer; this module decides which value flows into
 * each slot and what status band / direction applies.
 *
 *   buildGoalComparisonViewModel(metric) -> {
 *     statusColor,          // 'green' | 'yellow' | 'red' | 'gray'
 *     hasGoal,              // boolean — goal block present
 *     targetValue,          // resolved target number (or metric.target fallback)
 *     attainmentPct,        // number | null
 *     hasComparison,        // boolean — comparison block present
 *     priorValue,           // previous-period number (or metric.prior fallback)
 *     percentChange,        // number | null
 *     changeDirection,      // 'up' | 'down' | 'flat'
 *   }
 */
(function (global) {
  'use strict';

  // The metric layer emits 'green' | 'yellow' | 'red' | 'unknown'. The reporting
  // card's color helper speaks 'green' | 'yellow' | 'red' | 'gray', so 'unknown'
  // (and anything unexpected) maps to the neutral 'gray' band.
  function mapGoalStatusToColor(status) {
    if (status === 'green' || status === 'yellow' || status === 'red') return status;
    return 'gray';
  }

  function isNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function buildGoalComparisonViewModel(metric) {
    var m = metric || {};
    var goal = m.goal || null;
    var comparison = m.comparison || null;

    // --- Status band + target (goal block, with flat-field fallback) ---------
    var hasGoal = !!goal;
    var statusColor;
    var targetValue;
    var attainmentPct = null;

    if (hasGoal) {
      statusColor = mapGoalStatusToColor(goal.status);
      targetValue = isNumber(goal.target_value_resolved) ? goal.target_value_resolved : null;
      attainmentPct = isNumber(goal.attainment_pct) ? goal.attainment_pct : null;
    } else {
      // Degrade onto the existing backend-provided flat status/target.
      statusColor = m.status === 'error' ? 'gray' : (m.status || 'gray');
      targetValue = isNumber(m.target) ? m.target : null;
    }

    // --- Prior period (comparison block, with flat-field fallback) -----------
    var hasComparison = !!comparison;
    var priorValue;
    var percentChange = null;
    var changeDirection;

    if (hasComparison) {
      priorValue = isNumber(comparison.previous_value) ? comparison.previous_value : null;
      percentChange = isNumber(comparison.percent_change) ? comparison.percent_change : null;
      changeDirection = comparison.direction || 'flat';
    } else {
      priorValue = isNumber(m.prior) ? m.prior : null;
      changeDirection = m.changeDirection || 'flat';
    }

    return {
      statusColor: statusColor,
      hasGoal: hasGoal,
      targetValue: targetValue,
      attainmentPct: attainmentPct,
      hasComparison: hasComparison,
      priorValue: priorValue,
      percentChange: percentChange,
      changeDirection: changeDirection
    };
  }

  var api = {
    mapGoalStatusToColor: mapGoalStatusToColor,
    buildGoalComparisonViewModel: buildGoalComparisonViewModel
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.ReportingGoalComparisonMapper = api;
  }
})(typeof window !== 'undefined' ? window : this);
