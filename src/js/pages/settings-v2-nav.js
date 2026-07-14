/**
 * settings-v2-nav.js
 *
 * Left in-page section navigation for settings-v2.html. Turns the single
 * scrolling page into tabbed sections (Profile, General, Personalization,
 * Plan & billing, Usage, Data controls) driven by a vertical nav rail.
 *
 * Responsibilities:
 *   - Inject the nav icons from Lex.Icons (never emoji glyphs).
 *   - Activate one panel at a time; keep the others hidden.
 *   - Read location.hash on load and activate the matching section
 *     (the account menu deep-links to #profile / #personalization / #billing).
 *   - Update location.hash when the user picks a section, and react to
 *     back/forward hash changes.
 *
 * This only toggles the panel-level `.is-active` class. Section-level
 * visibility (personalization reveal, Electron-only VPN / connected apps,
 * conditional preferences) is still owned by settings-v2.js and
 * settings-personalization.js via the separate `sv2-hidden` class, so the
 * two mechanisms never fight.
 *
 * No regex. IIFE. String methods only.
 */
(function () {
  'use strict';

  // Section id (also the URL hash) → nav icon name in Lex.Icons.
  var SECTIONS = [
    { id: 'profile',        icon: 'user' },
    { id: 'general',        icon: 'settings' },
    { id: 'personalization', icon: 'wand-2' },
    { id: 'billing',        icon: 'sparkles' },
    { id: 'usage',          icon: 'bar-chart-2' },
    { id: 'data-controls',  icon: 'shield' }
  ];

  var DEFAULT_SECTION = 'profile';

  function validSection(id) {
    if (!id) return null;
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].id === id) return id;
    }
    return null;
  }

  // "#billing" → "billing"; unknown / empty → default.
  function sectionFromHash() {
    var raw = (window.location.hash || '').replace('#', '');
    return validSection(raw) || DEFAULT_SECTION;
  }

  function tabEl(id)   { return document.getElementById('sv2-tab-' + id); }
  function panelEl(id) { return document.getElementById('sv2-panel-' + id); }

  function injectIcons() {
    if (!window.Lex || !window.Lex.Icons) return;
    for (var i = 0; i < SECTIONS.length; i++) {
      var tab = tabEl(SECTIONS[i].id);
      if (!tab) continue;
      var slot = tab.querySelector('.sv2-nav-icon');
      if (!slot || slot.innerHTML) continue;
      if (typeof Lex.Icons.has === 'function' && !Lex.Icons.has(SECTIONS[i].icon)) continue;
      try {
        slot.innerHTML = Lex.Icons.get({ name: SECTIONS[i].icon, size: 'small' });
      } catch (e) { /* icon optional; label still renders */ }
    }
  }

  // Show one panel, hide the rest, and sync tab aria/roving-tabindex state.
  function activate(id, opts) {
    var target = validSection(id) || DEFAULT_SECTION;
    for (var i = 0; i < SECTIONS.length; i++) {
      var sid = SECTIONS[i].id;
      var isActive = sid === target;
      var panel = panelEl(sid);
      var tab = tabEl(sid);
      if (panel) panel.classList.toggle('is-active', isActive);
      if (tab) {
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
      }
    }

    if (opts && opts.updateHash && ('#' + target) !== window.location.hash) {
      // replaceState keeps the section switch out of the browser history stack.
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', '#' + target);
      } else {
        window.location.hash = target;
      }
    }

    if (opts && opts.focusTab) {
      var t = tabEl(target);
      if (t) t.focus();
    }
  }

  function onTabClick(e) {
    var btn = e.currentTarget;
    if (!btn) return;
    activate(btn.getAttribute('data-section'), { updateHash: true });
  }

  // Arrow-key roving focus across the tablist (WAI-ARIA tabs pattern).
  function onTabKeydown(e) {
    var key = e.key;
    var idx = -1;
    for (var i = 0; i < SECTIONS.length; i++) {
      if (e.currentTarget === tabEl(SECTIONS[i].id)) { idx = i; break; }
    }
    if (idx === -1) return;

    var next = -1;
    if (key === 'ArrowDown' || key === 'ArrowRight') next = (idx + 1) % SECTIONS.length;
    else if (key === 'ArrowUp' || key === 'ArrowLeft') next = (idx - 1 + SECTIONS.length) % SECTIONS.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = SECTIONS.length - 1;
    else return;

    e.preventDefault();
    activate(SECTIONS[next].id, { updateHash: true, focusTab: true });
  }

  function onHashChange() {
    // External hash change (deep link / back-forward); do not rewrite it.
    activate(sectionFromHash(), { updateHash: false });
  }

  function boot() {
    // Bail cleanly if the nav markup is not present (e.g. an older template).
    if (!document.getElementById('sv2-tab-profile')) return;

    injectIcons();

    for (var i = 0; i < SECTIONS.length; i++) {
      var tab = tabEl(SECTIONS[i].id);
      if (!tab) continue;
      tab.addEventListener('click', onTabClick);
      tab.addEventListener('keydown', onTabKeydown);
    }

    window.addEventListener('hashchange', onHashChange);

    // Initial section comes from the hash (account-menu deep links), else Profile.
    activate(sectionFromHash(), { updateHash: false });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
