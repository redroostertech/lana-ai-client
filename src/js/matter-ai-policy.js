/*
 * MatterAiPolicy - the "AI policy" card in a matter's details panel.
 *
 * Shows where this matter's AI requests may go (any, local AI only, never
 * leave the firm) with a one-line explanation of each choice. Matter admins
 * and organization admins get a Lex radio group to change it; everyone else
 * sees a read-only badge. The backend decides both the value and who may
 * change it (GET/PUT /api/v1/matters/:matter_id/ai-policy) and enforces the
 * policy; this card only shows it and sends the choice.
 *
 * Mapping lives in matter-ai-policy.model.js (tested in Jest); this file is
 * DOM wiring only. Styles: css/matter-ai-policy.css.
 */
(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
      .split('"').join('&quot;').split("'").join('&#39;');
  }

  function attrJson(value) {
    return escapeHtml(JSON.stringify(value));
  }

  function cardHtml(model, options) {
    var dark = Boolean(options && options.dark);
    var html = '<lex-card id="aiPolicyCard" heading="AI policy" variant="flat" padding="compact"' + (dark ? ' bg="dark"' : '') + '>';
    html += '<div class="matter-ai-policy">';
    html += '<div class="matter-ai-policy__current">'
      + '<lex-badge label="' + escapeHtml(model.label) + '" color="' + escapeHtml(model.badgeColor) + '" data-testid="matter-ai-policy-badge"></lex-badge>'
      + '</div>';
    if (model.editable) {
      html += '<lex-radio id="aiPolicyChoice" name="ai_policy" value="' + escapeHtml(model.value) + '" options="' + attrJson(model.options) + '" data-testid="matter-ai-policy-choice"></lex-radio>';
    } else {
      html += '<p class="matter-ai-policy__description">' + escapeHtml(model.description) + '</p>';
      html += '<p class="matter-ai-policy__note" data-testid="matter-ai-policy-note">' + escapeHtml(model.note) + '</p>';
    }
    html += '</div></lex-card>';
    return html;
  }

  function errorMessage(error) {
    if (error && error.status === 403) { return global.MatterAiPolicyModel.READ_ONLY_NOTE; }
    return (error && error.message) || 'The AI policy could not be changed.';
  }

  /**
   * @param {HTMLElement} container
   * @param {string} matterId - the matter code the routes take
   * @param {Object} client - the app's API client (get, put)
   */
  async function render(container, matterId, client) {
    if (!container || !matterId || !client) { return; }
    var data;
    try {
      var answer = await client.get('/api/v1/matters/' + encodeURIComponent(matterId) + '/ai-policy');
      data = answer && answer.data ? answer.data : null;
    } catch (error) {
      container.innerHTML = '';
      return;
    }
    var model = global.MatterAiPolicyModel.viewModel(data);
    var root = global.document && global.document.documentElement;
    container.innerHTML = cardHtml(model, { dark: Boolean(root && root.getAttribute('data-lex-theme') === 'dark') });
    var choice = container.querySelector('#aiPolicyChoice');
    if (!choice) { return; }
    choice.addEventListener('lex-change', async function (event) {
      var body = global.MatterAiPolicyModel.changeBody(model, event.detail && event.detail.value);
      if (!body) { return; }
      try {
        await client.put('/api/v1/matters/' + encodeURIComponent(matterId) + '/ai-policy', body);
        if (global.Lex && global.Lex.Toast) { global.Lex.Toast.success('AI policy updated'); }
      } catch (error) {
        if (global.Lex && global.Lex.Toast) { global.Lex.Toast.error(errorMessage(error)); }
      }
      await render(container, matterId, client);
    });
  }

  var api = { render: render, cardHtml: cardHtml };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  global.MatterAiPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
