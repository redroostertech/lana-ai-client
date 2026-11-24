/* "Finish your setup" banner: shown on the dashboard pages and Settings when
   some of the firm's case or appointment types are not mapped yet
   (GET /api/v1/mappings/summary), with a link to Settings > Mappings.
   Hidden when everything is mapped or the API is not available (404).
   Words come from js/settings-mappings.model.js. */

(function (global) {
  'use strict';

  var MAPPINGS_PAGE = 'settings-v2.html#mappings';
  var mounted = [];

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
      .split('"').join('&quot;').split("'").join('&#39;');
  }

  async function draw(node) {
    if (!node) return;
    var text = null;
    try {
      var response = await global.api.getMappingSummary();
      var summary = response && response.data !== undefined ? response.data : response;
      text = global.SettingsMappingsModel.bannerText(summary);
    } catch (err) {
      text = null; // Not available yet, or a blip: say nothing.
    }
    node.hidden = !text;
    node.innerHTML = text
      ? '<div class="lana-setup-banner" role="status"><span class="lana-setup-banner__text">' + escapeHtml(text) + '</span>'
        + '<button type="button" class="lana-setup-banner__link" data-setup-link="' + MAPPINGS_PAGE + '">Map them now</button></div>'
      : '';
  }

  async function mount(id) {
    var node = document.getElementById(id);
    if (!node || !global.api || typeof global.api.getMappingSummary !== 'function' || !global.SettingsMappingsModel) return;
    if (mounted.indexOf(id) === -1) {
      mounted.push(id);
      if (node.addEventListener) {
        node.addEventListener('click', function (event) {
          var link = event.target && event.target.closest ? event.target.closest('[data-setup-link]') : null;
          if (!link) return;
          if (global.Lex && global.Lex.Nav) global.Lex.Nav.go(link.getAttribute('data-setup-link'));
        });
      }
    }
    await draw(node);
  }

  function refresh() {
    mounted.forEach(function (id) { draw(document.getElementById(id)); });
  }

  global.LanaSetupBanner = { mount: mount, refresh: refresh };
})(window);
