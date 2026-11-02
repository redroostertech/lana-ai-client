/*
 * MatterAiPolicyModel - pure view model for a matter's AI policy card.
 *
 * Reads the backend answer of GET /api/v1/matters/:matter_id/ai-policy
 * ({ ai_policy, can_change, options: [{ value, label, description }] }) and
 * maps it to what the card shows. The backend is the source of truth for the
 * value, the options and who may change it (matter admins and organization
 * admins); this module only reads them. A value it does not know is shown as
 * the strictest choice, never as "Any".
 *
 * No DOM, no network. Loaded as a browser global (window.MatterAiPolicyModel)
 * and as a CommonJS module for Jest.
 */
(function (global) {
  'use strict';

  var STRICTEST = 'never_leave_firm';

  // Badge colors by value (lex-badge color names); any unknown value falls to the strictest.
  var BADGE_COLORS = { any: 'gray', local_only: 'yellow', never_leave_firm: 'red' };

  var READ_ONLY_NOTE = 'Only a matter admin or an organization admin can change this.';

  function optionsOf(data) {
    var options = data && Array.isArray(data.options) ? data.options : [];
    return options
      .filter(function (option) { return option && typeof option.value === 'string' && typeof option.label === 'string'; })
      .map(function (option) {
        return { value: option.value, label: option.label, description: typeof option.description === 'string' ? option.description : '' };
      });
  }

  /**
   * @param {Object|null} data - the GET answer's data
   * @returns {{ value: string, label: string, description: string, badgeColor: string, editable: boolean,
   *   options: Array<{value: string, label: string, description: string}>, note: string|null, known: boolean }}
   */
  function viewModel(data) {
    var options = optionsOf(data);
    var raw = data && typeof data.ai_policy === 'string' ? data.ai_policy : null;
    var match = options.filter(function (option) { return option.value === raw; })[0] || null;
    var shown = match || options.filter(function (option) { return option.value === STRICTEST; })[0]
      || { value: STRICTEST, label: 'Never leave the firm', description: '' };
    var editable = Boolean(data && data.can_change === true) && options.length > 0;
    return {
      value: shown.value,
      label: shown.label,
      description: shown.description,
      badgeColor: BADGE_COLORS[shown.value] || BADGE_COLORS[STRICTEST],
      editable: editable,
      options: options,
      note: editable ? null : READ_ONLY_NOTE,
      known: Boolean(match)
    };
  }

  /** The PUT body for a choice, or null when the choice is not one of the offered options. */
  function changeBody(model, value) {
    if (!model || !model.editable) { return null; }
    var offered = model.options.some(function (option) { return option.value === value; });
    if (!offered || value === model.value) { return null; }
    return { ai_policy: value };
  }

  var api = { viewModel: viewModel, changeBody: changeBody, READ_ONLY_NOTE: READ_ONLY_NOTE };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  global.MatterAiPolicyModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
