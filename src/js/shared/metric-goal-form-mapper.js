/*
 * metric-goal-form-mapper.js
 *
 * Pure, side-effect-free helpers for the Metric Catalog goal editor. Two jobs:
 *
 *   1. indexGoals(goals) -> map keyed by metric_key then target_period, so the
 *      catalog can answer "does this metric have a goal, and what are its
 *      weekly/monthly values" without re-scanning the array per row. A metric
 *      may carry both a weekly and a monthly goal; both are retained.
 *
 *   2. buildGoalPayload(form) -> { ok, payload, errors } turning the editor's
 *      raw field values into the PUT body the backend expects
 *      (LANA-AI/docs/METRIC_GOALS_DESIGN.md sections 4-6). target_value is
 *      required and numeric; the threshold fields are optional numbers and are
 *      only included when supplied. Validation lives here so it is unit-testable
 *      without the DOM.
 *
 * Contract: pure. No fetch, no DOM, no globals.
 */
(function (global) {
  'use strict';

  var TARGET_TYPES = ['static', 'rolling_average', 'growth_rate'];
  var TARGET_PERIODS = ['weekly', 'monthly'];

  // Build metric_key -> { weekly?: goal, monthly?: goal }. Unknown periods are
  // still stored under their own key so nothing is silently dropped.
  function indexGoals(goals) {
    var index = {};
    if (!Array.isArray(goals)) return index;
    for (var i = 0; i < goals.length; i++) {
      var goal = goals[i];
      if (!goal || !goal.metric_key) continue;
      var key = goal.metric_key;
      var period = goal.target_period || 'monthly';
      if (!index[key]) index[key] = {};
      index[key][period] = goal;
    }
    return index;
  }

  // Pull the goal for a specific metric + period out of an index, or null.
  function getGoal(index, metricKey, period) {
    if (!index || !index[metricKey]) return null;
    return index[metricKey][period] || null;
  }

  // True when the metric has a goal for any period. Drives the read-only pill.
  function hasAnyGoal(index, metricKey) {
    if (!index || !index[metricKey]) return false;
    return Object.keys(index[metricKey]).length > 0;
  }

  function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === '';
  }

  // Parse an optional numeric field. Returns { ok, value } where value is the
  // parsed number, or null when the field was left blank (a valid "not set").
  function parseOptionalNumber(value) {
    if (isBlank(value)) return { ok: true, value: null };
    var num = Number(value);
    if (!isFinite(num)) return { ok: false, value: null };
    return { ok: true, value: num };
  }

  // Map the editor's raw field values to the PUT payload, validating as we go.
  // form: { target_value, target_type, target_period, green_threshold,
  //         red_threshold, notes }
  function buildGoalPayload(form) {
    var f = form || {};
    var errors = {};

    var targetType = TARGET_TYPES.indexOf(f.target_type) !== -1 ? f.target_type : 'static';
    var targetPeriod = TARGET_PERIODS.indexOf(f.target_period) !== -1 ? f.target_period : 'monthly';

    // target_value: required, numeric. For rolling_average it is the window N
    // (how many recent periods to average), so it must be an integer >= 1.
    if (isBlank(f.target_value)) {
      errors.target_value = 'Target value is required';
    } else {
      var tv = Number(f.target_value);
      if (!isFinite(tv)) {
        errors.target_value = 'Target value must be a number';
      } else if (targetType === 'rolling_average' && (!Number.isInteger(tv) || tv < 1)) {
        errors.target_value = 'Periods to average must be a whole number of 1 or more';
      }
    }

    var green = parseOptionalNumber(f.green_threshold);
    if (!green.ok) errors.green_threshold = 'Green threshold must be a number';
    var red = parseOptionalNumber(f.red_threshold);
    if (!red.ok) errors.red_threshold = 'Red threshold must be a number';

    if (Object.keys(errors).length > 0) {
      return { ok: false, payload: null, errors: errors };
    }

    var payload = {
      target_value: Number(f.target_value),
      target_type: targetType,
      target_period: targetPeriod
    };
    if (green.value !== null) payload.green_threshold = green.value;
    if (red.value !== null) payload.red_threshold = red.value;
    if (!isBlank(f.notes)) payload.notes = String(f.notes).trim();

    return { ok: true, payload: payload, errors: {} };
  }

  var api = {
    TARGET_TYPES: TARGET_TYPES,
    TARGET_PERIODS: TARGET_PERIODS,
    indexGoals: indexGoals,
    getGoal: getGoal,
    hasAnyGoal: hasAnyGoal,
    buildGoalPayload: buildGoalPayload
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.MetricGoalFormMapper = api;
  }
})(typeof window !== 'undefined' ? window : this);
