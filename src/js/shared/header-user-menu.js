/*
 * HeaderUserMenu - the one implementation of the V1 page header's account menu
 * (gear button -> Settings / Sign out).
 *
 * Eleven pages used to carry their own copy of the markup plus their own
 * toggle/outside-click/logout wiring, and two of them (relevance-labeling,
 * search-analytics) carried the markup with no wiring at all. Pages now hold
 * only a placeholder and this module renders and wires it:
 *
 *   <div class="relative" id="userMenu" data-header-user-menu
 *        data-settings-href="../settings-v2.html" data-login-href="../login.html"></div>
 *   <script src="../js/shared/header-user-menu.js"></script>
 *
 * Placeholders are mounted on DOMContentLoaded (or immediately if the DOM is
 * ready). HeaderUserMenu.mount(el, opts) mounts one explicitly; it is
 * idempotent. The rendered ids (#userDropdown, #logoutBtn) are unchanged.
 *
 * lex-dropdown-btn is the lex command-menu component, but it cannot host this
 * menu yet: it has no icon-only trigger, always opens left-aligned (this menu
 * sits at the right edge of the header), and its items cannot be links or
 * carry a danger style. Once it can, swap the render below for it.
 */
(function (global) {
  'use strict';

  var GEAR_SVG = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>' +
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>';

  function escapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render(settingsHref) {
    return '<button type="button" class="flex items-center gap-2 text-gray-700 hover:text-gray-900 p-1" title="Settings"' +
      ' aria-label="Account menu" aria-haspopup="menu" aria-expanded="false" aria-controls="userDropdown" data-user-menu-trigger>' +
      GEAR_SVG + '</button>' +
      '<div id="userDropdown" role="menu" class="hidden absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">' +
      '<a href="' + escapeAttr(settingsHref) + '" role="menuitem" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Settings</a>' +
      '<hr class="my-1" role="separator">' +
      '<button type="button" id="logoutBtn" role="menuitem" class="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100">Sign out</button>' +
      '</div>';
  }

  function defaultLogout(loginHref) {
    var go = function () { global.location.href = loginHref; };
    var api = global.api;
    if (api && typeof api.logout === 'function') {
      return Promise.resolve().then(function () { return api.logout(); }).then(go, go);
    }
    go();
    return Promise.resolve();
  }

  /**
   * Render and wire the menu into `container` (default #userMenu).
   * opts: settingsHref, loginHref, onLogout(). Data attributes on the
   * container (data-settings-href, data-login-href) are used when opts omit them.
   * Returns { open, close, isOpen, destroy } or null when there is no container.
   */
  function mount(container, opts) {
    var doc = global.document;
    var el = container || doc.getElementById('userMenu');
    if (!el) return null;
    if (el.__headerUserMenu) return el.__headerUserMenu;
    opts = opts || {};
    var settingsHref = opts.settingsHref || el.getAttribute('data-settings-href') || 'settings-v2.html';
    var loginHref = opts.loginHref || el.getAttribute('data-login-href') || 'login.html';

    el.innerHTML = render(settingsHref);
    var trigger = el.querySelector('[data-user-menu-trigger]');
    var dropdown = el.querySelector('#userDropdown');
    var logoutBtn = el.querySelector('#logoutBtn');

    function items() {
      return Array.prototype.slice.call(dropdown.querySelectorAll('[role="menuitem"]'));
    }
    function isOpen() { return !dropdown.classList.contains('hidden'); }
    function open() {
      dropdown.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
    }
    function close(restoreFocus) {
      if (!isOpen()) return;
      dropdown.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    }

    function onTriggerClick(e) {
      e.stopPropagation();
      if (isOpen()) { close(false); return; }
      open();
    }
    function onTriggerKeydown(e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        open();
        var list = items();
        if (list[0]) list[0].focus();
      }
    }
    function onDropdownKeydown(e) {
      var list = items();
      var idx = list.indexOf(doc.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
        if (next < 0) next = list.length - 1;
        if (next >= list.length) next = 0;
        if (list[next]) list[next].focus();
      }
    }
    function onDocClick(e) {
      if (!el.contains(e.target)) close(false);
    }
    function onDocKeydown(e) {
      if (e.key === 'Escape' && isOpen()) close(true);
    }
    function onLogout() {
      close(false);
      if (typeof opts.onLogout === 'function') return opts.onLogout();
      return defaultLogout(loginHref);
    }

    trigger.addEventListener('click', onTriggerClick);
    trigger.addEventListener('keydown', onTriggerKeydown);
    dropdown.addEventListener('keydown', onDropdownKeydown);
    logoutBtn.addEventListener('click', onLogout);
    doc.addEventListener('click', onDocClick);
    doc.addEventListener('keydown', onDocKeydown);

    var handle = {
      open: open,
      close: function () { close(false); },
      isOpen: isOpen,
      destroy: function () {
        doc.removeEventListener('click', onDocClick);
        doc.removeEventListener('keydown', onDocKeydown);
        el.innerHTML = '';
        el.__headerUserMenu = null;
      }
    };
    el.__headerUserMenu = handle;
    return handle;
  }

  function mountAll() {
    var nodes = global.document.querySelectorAll('[data-header-user-menu]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  var HeaderUserMenu = { mount: mount, mountAll: mountAll };
  global.HeaderUserMenu = HeaderUserMenu;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeaderUserMenu;
  }

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', mountAll);
    } else {
      mountAll();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
