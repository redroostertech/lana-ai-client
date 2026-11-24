/* Data states: the one client renderer for the backend failure model
   (LANA-AI metric-outcome.model.js). Reports, Dashboards, tiles and
   drilldowns show a non-ok result with the same block: a short title from
   the state and the backend's plain reason. Also the shared empty-value
   token used for blank cells (never a dash). */

(function (global) {
  'use strict';

  var EMPTY_VALUE = 'n/a';

  var TITLES = {
    no_data_source: 'No data source',
    not_configured: 'Not set up yet',
    no_goal: 'No goal set',
    insufficient_data: 'Not enough data',
    timeout: 'Took too long',
    invalid_request: 'Check the request',
    engine_error: 'Could not work this out'
  };

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isProblem(item) {
    return !!(item && item.data_state && item.data_state !== 'ok' && TITLES[item.data_state]);
  }

  // The data state a failed API call carries, or null: a 400
  // invalid_request carries it in error.details, other failures on the body.
  function fromApiError(apiError) {
    var body = apiError && apiError.data;
    if (!body) return null;
    var envelope = body.error;
    var details = (envelope && envelope.details) || body.details;
    if (isProblem(details)) return details;
    return isProblem(body) ? body : null;
  }

  // Calm wording for states that mean "not set up yet" rather than "broken".
  // Dashboards ask for it (options.calm) so a tile reads as waiting, never as
  // a failure or a $0. Reports keep the plain titles above.
  var CALM_TITLES = {
    insufficient_data: 'Waiting for setup'
  };
  var GOAL_TITLE = 'Waiting for a goal';
  var CATALOG_PAGE = 'admin/metric-catalog.html';

  // A card that cannot show a number until someone sets its goal: the server
  // sends goal_input (with the message to show), or the literal no_goal state.
  function goalPrompt(item) {
    if (item.goal_input && typeof item.goal_input === 'object') return item.goal_input;
    return item.data_state === 'no_goal' ? {} : null;
  }

  // Where to set the goal a card is waiting on: { label, href } or null.
  // Also used on cards that show numbers but are missing their goal part.
  function goalAction(item) {
    var prompt = item ? goalPrompt(item) : null;
    if (!prompt) return null;
    var goalKey = prompt.metric_key || item.metric_key || item.key || '';
    return goalKey ? { label: 'Open the Metric Catalog', href: CATALOG_PAGE + '?editGoal=' + encodeURIComponent(goalKey) } : null;
  }

  // The one state model: { state, title, reason, waiting, action } or null.
  function view(item, options) {
    if (!isProblem(item)) return null;
    var calm = !!(options && options.calm);
    var state = item.data_state;
    var prompt = calm ? goalPrompt(item) : null;
    if (prompt) {
      return {
        state: state,
        title: GOAL_TITLE,
        reason: prompt.message || item.data_state_reason || '',
        waiting: true,
        action: goalAction(item)
      };
    }
    var calmTitle = calm ? CALM_TITLES[state] : null;
    return {
      state: state,
      title: calmTitle || TITLES[state],
      reason: item.data_state_reason || '',
      waiting: !!calmTitle,
      action: null
    };
  }

  function render(item, options) {
    var model = view(item, options);
    if (!model) return '';
    var calm = !!(options && options.calm);
    if (!calm) {
      return '<div class="lex-data-state lex-data-state--' + model.state.split('_').join('-') + '" role="status">'
        + '<p class="lex-data-state__title">' + escapeHtml(model.title) + '</p>'
        + (model.reason ? '<p class="lex-data-state__reason">' + escapeHtml(model.reason) + '</p>' : '')
        + '</div>';
    }
    // Calm card: the breathing brand mark (static under Reduce Motion) sits
    // beside the words when the page loaded lex-brand-mark.
    return '<div class="lex-data-state lex-data-state--calm lex-data-state--' + (model.waiting ? 'waiting' : model.state.split('_').join('-')) + '" role="status">'
      + (model.waiting ? '<lex-brand-mark class="lex-data-state__mark" animation="idle" size="32"></lex-brand-mark>' : '')
      + '<div class="lex-data-state__body">'
      + '<p class="lex-data-state__title">' + escapeHtml(model.title) + '</p>'
      + (model.reason ? '<p class="lex-data-state__reason">' + escapeHtml(model.reason) + '</p>' : '')
      + (model.action ? '<button type="button" class="lex-data-state__action" data-data-state-action="' + escapeHtml(model.action.href) + '">' + escapeHtml(model.action.label) + '</button>' : '')
      + '</div></div>';
  }

  // Display label for a backend enum value ("monthly" -> "Monthly",
  // "in_review" -> "In review").
  function label(value) {
    var text = String(value === null || value === undefined ? '' : value).replace(/[_-]+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : EMPTY_VALUE;
  }

  global.DataState = { EMPTY_VALUE: EMPTY_VALUE, TITLES: TITLES, isProblem: isProblem, fromApiError: fromApiError, view: view, goalAction: goalAction, render: render, label: label, escapeHtml: escapeHtml };
})(window);
