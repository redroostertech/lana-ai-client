/*
 * MetricGoalCell - the Goal cell on an Insights module card
 * (insights/dashboard.html and insights/module-execution.html).
 *
 * A metric's goal is set in one place, the Metric Catalog goal editor. The
 * backend sends each card its catalog_key (null when the card is not a catalog
 * metric and takes no goal), its target and its goal block. This cell shows
 * the goal and how the value stands against it, and, for the roles that may
 * set goals (Lex.Auth.canEditMetricGoals), links to the catalog editor
 * (admin/metric-catalog.html?editGoal=<catalog key>). There is no override
 * here: a target is never a data override.
 *
 * Pure string building; loaded as a browser global and as CommonJS for Jest.
 */
(function (global) {
  'use strict';

  var CATALOG_PAGE = '../admin/metric-catalog.html';

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // A goal of 0 is a real goal (a lower-is-better metric aiming for none);
  // only a missing goal is "no goal".
  function hasTarget(metric) {
    return !!metric && metric.target !== null && metric.target !== undefined && metric.target !== ''
      && isFinite(Number(metric.target));
  }

  function goalView(goal) {
    var helper = global.MetricGoalComparison;
    return goal && helper && typeof helper.buildGoalView === 'function' ? helper.buildGoalView(goal) : null;
  }

  /**
   * @param {Object} metric - one module metric (catalog_key, target, goal)
   * @param {Object} options
   * @param {string} options.targetDisplay - the formatted target
   * @param {boolean} options.canEdit - Lex.Auth.canEditMetricGoals()
   * @returns {string} HTML for the cell
   */
  function goalCellHtml(metric, options) {
    var opts = options || {};
    var catalogKey = metric && metric.catalog_key ? String(metric.catalog_key) : null;
    var goal = metric ? metric.goal : null;

    var valueText;
    var statusText = '';
    if (!catalogKey) {
      valueText = 'No goal for this card';
    } else if (goal && goal.reason && (goal.target_value_resolved === null || goal.target_value_resolved === undefined)) {
      valueText = 'Not tracked yet';
      statusText = 'A goal cannot be tracked for this metric yet. The Metric Catalog says why.';
    } else if (hasTarget(metric)) {
      valueText = opts.targetDisplay;
      var view = goalView(goal);
      if (view) {
        statusText = view.statusLabel + (view.hasAttainment ? ' (' + view.attainmentLabel + ' of goal)' : '');
      }
    } else {
      valueText = 'No goal set';
    }

    // A number that reads another metric's goal (a gap, a "needed" count)
    // names it in goal_input: the link opens that goal, the one that changes
    // this number, not this card's own.
    var input = metric && metric.goal_input && metric.goal_input.metric_key ? metric.goal_input : null;
    if (input) {
      valueText = 'No goal set';
      statusText = input.message || '';
    }
    var linkKey = input ? input.metric_key : catalogKey;
    var linkText = input ? 'Set the ' + (input.name || 'needed') + ' goal' : (hasTarget(metric) ? 'Edit goal' : 'Set goal');
    var link = '';
    if (linkKey && opts.canEdit) {
      link = '<a class="text-xs text-indigo-600 hover:text-indigo-800 font-medium" data-metric-goal-link'
        + ' href="' + esc(CATALOG_PAGE + '?editGoal=' + encodeURIComponent(linkKey)) + '"'
        + ' title="Set this goal in the Metric Catalog">' + esc(linkText) + '</a>';
    }

    return '<div class="flex items-center justify-between mb-1">'
      + '<p class="text-xs text-gray-500">Goal</p>' + link + '</div>'
      + '<p class="font-semibold text-gray-700" data-metric-goal-value>' + esc(valueText) + '</p>'
      + (statusText ? '<p class="text-xs text-gray-500 mt-1" data-metric-goal-status>' + esc(statusText) + '</p>' : '');
  }

  var api = { goalCellHtml: goalCellHtml };
  global.MetricGoalCell = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
