/**
 * Settings V2 > General > Location: turning approximate location on or off for this computer,
 * through window.electronAPI.location (electron-preload.js, electron-location.js). The words
 * and the reading's shape are LanaLocationPermission (src/js/location-permission.model.js).
 * Nothing is sent to a server here.
 */
(function () {
  'use strict';

  var M = window.LanaLocationPermission;

  function el(id) {
    return document.getElementById(id);
  }

  function boot() {
    var section = el('sv2-section-location');
    var badge = el('sv2-location-badge');
    var action = el('sv2-location-action');
    var off = el('sv2-location-off');
    var note = el('sv2-location-note');
    var settings = el('sv2-location-settings');
    var api = window.electronAPI && window.electronAPI.location;
    if (!section || !badge || !action || !off || !note || !M || !api) return;
    section.hidden = false;
    var busy = false;
    // Whether this computer has a location settings page LANA can open (main process decides).
    var settingsAvailable = false;

    function render(status) {
      var view = M.permissionView(status);
      badge.setAttribute('label', view.label);
      badge.setAttribute('color', view.color);
      action.label = view.actionLabel;
      action.hidden = !view.action || view.action === 'turn_off';
      action.disabled = busy;
      off.hidden = !view.canTurnOff;
      off.disabled = busy;
      if (settings) {
        settings.hidden = !(view.canOpenSettings && settingsAvailable);
        settings.disabled = busy;
      }
      note.textContent = view.note;
    }

    function read() {
      render(null);
      return api.getApproximate().then(function (reading) {
        render(reading && reading.status);
      }).catch(function () {
        render('unavailable');
      });
    }

    function choose(allowed) {
      busy = true;
      render(null);
      return api.setChoice(allowed).then(function (result) {
        if (!result || result.success !== true) throw new Error(result && result.error);
        busy = false;
        return allowed ? read() : render('prompt');
      }).catch(function (error) {
        busy = false;
        render('unavailable');
        if (window.Lex && Lex.Toast && typeof Lex.Toast.error === 'function') {
          Lex.Toast.error((error && error.message) || 'LANA could not save your location setting.');
        }
      });
    }

    action.addEventListener('click', function () { if (!busy) choose(true); });
    off.addEventListener('click', function () { if (!busy) choose(false); });
    if (settings && typeof api.openSystemSettings === 'function') {
      settings.addEventListener('click', function () {
        api.openSystemSettings().then(function (result) {
          if (!result || result.success !== true) throw new Error(result && result.error);
        }).catch(function (error) {
          if (window.Lex && Lex.Toast && typeof Lex.Toast.error === 'function') {
            Lex.Toast.error((error && error.message) || 'LANA could not open your computer\'s location settings.');
          }
        });
      });
    }

    render(null);
    // Learn whether "Open Settings" can work before the first real status is drawn.
    var system = typeof api.system === 'function' ? api.system() : Promise.resolve(null);
    system.then(function (result) {
      settingsAvailable = Boolean(result && result.success === true && result.settingsAvailable);
    }).catch(function () { settingsAvailable = false; }).then(function () {
      return api.getChoice();
    }).then(function (result) {
      if (result && result.success === true && result.allowed) return read();
      render('prompt');
    }).catch(function () { render('prompt'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
