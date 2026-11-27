/* "Finish your setup" banner: shown on the dashboard pages and Settings when
   some of the firm's case or appointment types are not mapped yet
   (GET /api/v1/mappings/summary), with a link to Settings > Mappings.
   Hidden when everything is mapped, when the feature is off (404, or 422
   NOT_CONFIGURED), or when the summary fails (logged once). The summary is
   asked for once per page and shared with Settings > Mappings.
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

  // Statuses the API layer should not log for this request; real errors
  // are logged once here instead.
  var QUIET = [400, 401, 403, 404, 422, 500, 501, 502, 503, 504];
  var pending = null;
  var logged = false;

  // { available, summary }: one request per page, shared and never retried.
  function summary() {
    if (!pending) {
      pending = global.api.getMappingSummary({ quietStatuses: QUIET }).then(function (response) {
        return { available: true, summary: response && response.data !== undefined ? response.data : response };
      }, function (err) {
        if (!global.SettingsMappingsModel.featureOff(err) && !logged) {
          logged = true;
          console.warn('[Mappings] Could not load the mappings summary:', err && (err.status || err.message));
        }
        return { available: false, summary: null };
      });
    }
    return pending;
  }

  // Settings > Mappings is for admins and org admins (Lex.Auth.isAdmin, the
  // same check the other admin-only settings use).
  function canManageMappings() {
    var auth = global.Lex && global.Lex.Auth;
    return !!(auth && typeof auth.isAdmin === 'function' && auth.isAdmin());
  }

  async function draw(node) {
    if (!node) return;
    // Nobody else sees the banner, and the summary is not asked for.
    if (!canManageMappings()) {
      node.hidden = true;
      node.innerHTML = '';
      return;
    }
    var result = await summary();
    var text = result.available ? global.SettingsMappingsModel.bannerText(result.summary) : null;
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

  // After a save: ask again (only if the feature answered before).
  function refresh() {
    if (!pending) return;
    pending.then(function (result) {
      if (!result.available) return;
      pending = null;
      mounted.forEach(function (id) { draw(document.getElementById(id)); });
    });
  }

  global.LanaSetupBanner = { mount: mount, refresh: refresh, summary: summary, canManageMappings: canManageMappings };
})(window);
