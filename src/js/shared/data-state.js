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

  function render(item) {
    if (!isProblem(item)) return '';
    var state = item.data_state;
    return '<div class="lex-data-state lex-data-state--' + state.replace(/_/g, '-') + '" role="status">'
      + '<p class="lex-data-state__title">' + escapeHtml(TITLES[state]) + '</p>'
      + (item.data_state_reason ? '<p class="lex-data-state__reason">' + escapeHtml(item.data_state_reason) + '</p>' : '')
      + '</div>';
  }

  // Display label for a backend enum value ("monthly" -> "Monthly",
  // "in_review" -> "In review").
  function label(value) {
    var text = String(value === null || value === undefined ? '' : value).replace(/[_-]+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : EMPTY_VALUE;
  }

  global.DataState = { EMPTY_VALUE: EMPTY_VALUE, TITLES: TITLES, isProblem: isProblem, fromApiError: fromApiError, render: render, label: label, escapeHtml: escapeHtml };
})(window);
