/**
 * settings-personalization.js
 *
 * Wires the LANA One "Personalization" section of settings-v2.html to
 * GET/PATCH /api/v1/users/me/personalization. Edition-gated: it only activates
 * in the LANA One edition, and even then fails safe (leaves the section hidden)
 * if the endpoint is unavailable — so this is inert in the stock org build.
 */
(function () {
  'use strict';

  var TEXT_FIELDS = ['nickname', 'occupation', 'custom_instructions', 'role', 'represents', 'goals', 'about'];
  var LIST_FIELDS = ['practice_areas', 'jurisdictions', 'typical_tasks'];

  function el(id) { return document.getElementById(id); }
  // Field ids are sv2-pz-<name-with-dashes>, e.g. custom_instructions -> sv2-pz-custom-instructions.
  function fieldEl(name) { return el('sv2-pz-' + name.replace(/_/g, '-')); }

  function populate(p) {
    if (!p) return;
    var style = el('sv2-pz-base-style');
    if (style) style.value = p.base_style || 'default';
    TEXT_FIELDS.forEach(function (f) {
      var e = fieldEl(f);
      if (e) e.value = p[f] || '';
    });
    LIST_FIELDS.forEach(function (f) {
      var e = fieldEl(f);
      if (e) e.value = Array.isArray(p[f]) ? p[f].join(', ') : '';
    });
  }

  function collect() {
    var body = {};
    var style = el('sv2-pz-base-style');
    if (style) body.base_style = style.value || 'default';
    // Text and list fields are sent as-is; the backend trims, caps, and splits
    // comma-separated list fields into arrays.
    TEXT_FIELDS.concat(LIST_FIELDS).forEach(function (f) {
      var e = fieldEl(f);
      if (e) body[f] = e.value || '';
    });
    return body;
  }

  function setStatus(msg, isErr) {
    var s = el('sv2-pz-status');
    if (!s) return;
    s.textContent = msg || '';
    s.setAttribute('variant', isErr ? 'danger' : 'tertiary');
  }

  function save(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var api = window.api;
    if (!api || typeof api.updatePersonalization !== 'function') return;
    setStatus('Saving...');
    api.updatePersonalization(collect()).then(function (res) {
      if (res && res.personalization) populate(res.personalization);
      setStatus('Saved');
      setTimeout(function () { setStatus(''); }, 2500);
    }).catch(function () {
      setStatus('Could not save. Please try again.', true);
    });
  }

  function activate() {
    var section = el('sv2-section-personalization');
    var api = window.api;
    if (!section || !api || typeof api.getPersonalization !== 'function') return;
    api.getPersonalization().then(function (res) {
      populate(res && res.personalization);
      section.classList.remove('sv2-hidden');
      // lex-form emits a custom 'lex-submit' event when its type=submit button is
      // pressed (see settings-v2.js password form). Bind that single handler.
      var form = el('sv2-personalization-form');
      if (form) form.addEventListener('lex-submit', save);
    }).catch(function () {
      // Endpoint unavailable (org edition / not adopted) — leave section hidden.
    });
  }

  function boot() {
    // Edition gate: LANA One only. activate() itself fails safe on a 404.
    if (!window.electronAPI || typeof window.electronAPI.getConfig !== 'function') return;
    Promise.resolve(window.electronAPI.getConfig()).then(function (cfg) {
      if (cfg && cfg.isLanaOne === true) activate();
    }).catch(function () { /* inert on failure */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
