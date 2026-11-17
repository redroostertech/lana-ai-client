/**
 * Settings > General > Firm time zone, for organization admins: the zone the firm's reports
 * count days and months in. A searchable <lex-select> of every zone
 * (js/shared/time-zone-options.js), read and saved through GET and PUT
 * /api/v1/organizations/:org_id/settings ({ firm_timezone }). Shown only to admins and only
 * when the read answers: a 403 or an older server leaves it hidden. Words:
 * settings-firm-timezone.model.js (window.LanaSettingsFirmTimezone).
 */
(function () {
  'use strict';

  var M = window.LanaSettingsFirmTimezone;
  var Z = window.LanaTimeZoneOptions;
  var saved = null; // the settings the server last returned

  function el(id) {
    return document.getElementById(id);
  }

  function isAdmin() {
    var auth = window.Lex && window.Lex.Auth;
    return !!(auth && typeof auth.isAdmin === 'function' && auth.isAdmin());
  }

  function readStoredUser() {
    try { return JSON.parse(localStorage.getItem('user') || 'null') || {}; } catch (_) { return {}; }
  }

  function organizationId() {
    var user = (window.api && window.api.user) || readStoredUser();
    return user.organizationId || user.organization_id || user.org_id || null;
  }

  function showError(text) {
    var node = el('sv2-firm-timezone-error');
    node.textContent = text || '';
    node.hidden = !text;
  }

  function render(settings) {
    saved = settings || {};
    var view = M.view(saved);
    var select = el('sv2-firm-timezone-select');
    select.setAttribute('options', JSON.stringify(Z.buildOptions(view.value)));
    if (view.value) select.setAttribute('value', view.value);
    else select.removeAttribute('value');
    el('sv2-firm-timezone-note').textContent = view.note;
  }

  /** Keep the stored user (and the prompt that reads it) in step with the server. */
  function storeOnUser(settings) {
    var next = M.withFirmTimezone(readStoredUser(), settings);
    try { localStorage.setItem('user', JSON.stringify(next)); } catch (_) { /* the profile refreshes it later */ }
    if (window.api && window.api.user) {
      window.api.user.firm_timezone = next.firm_timezone;
      window.api.user.firm_timezone_set = next.firm_timezone_set;
    }
  }

  function save(orgId, zone) {
    if (!zone || zone === M.view(saved).value) return;
    showError('');
    window.api.updateOrganizationSettings(orgId, { firm_timezone: zone }).then(function (response) {
      var settings = (response && response.settings) || {};
      render(settings);
      storeOnUser(settings);
      // The zone is saved: the dashboard prompt asking for it is done for this person.
      if (window.LanaFirmTimezonePrompt) window.LanaFirmTimezonePrompt.markDismissed();
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Firm time zone saved');
    }).catch(function (error) {
      showError((error && error.message) || 'LANA could not save the firm time zone. Try again.');
      render(saved);
    });
  }

  function boot() {
    var section = el('sv2-section-firm-timezone');
    var select = el('sv2-firm-timezone-select');
    if (!section || !select || !M || !Z || !window.api || typeof window.api.getOrganizationSettings !== 'function') return;
    if (!isAdmin()) return;
    var orgId = organizationId();
    if (!orgId) return;

    window.api.getOrganizationSettings(orgId).then(function (response) {
      var settings = response && response.settings;
      if (!settings) return;
      render(settings);
      section.hidden = false;
    }).catch(function () { /* Not an admin here, or an older server: the section stays hidden. */ });

    select.addEventListener('lex-change', function (event) {
      var value = event.detail && event.detail.value;
      save(orgId, value);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
