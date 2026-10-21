/*
 * HeaderUserMenu - the one implementation of the V1 page header's account menu
 * (gear button -> Settings / Sign out).
 *
 * Pages hold only a placeholder and this module renders a lex-dropdown-btn
 * into it and wires Sign out:
 *
 *   <div class="relative" id="userMenu" data-header-user-menu
 *        data-settings-href="../settings-v2.html" data-login-href="../login.html"></div>
 *   <script src="../js/shared/header-user-menu.js"></script>
 *
 * The page must also load js/lex/lex.core.js, js/lex/lex.icons.js and
 * js/lex/components/form/lex-dropdown-btn.js (icons before the dropdown).
 * lex-dropdown-btn owns the menu: icon-only trigger, right-aligned menu,
 * keyboard (ArrowDown/Enter/Space, arrows, Home/End, Escape returns focus,
 * Tab closes), outside-click close and menu/menuitem ARIA.
 *
 * Placeholders are mounted on DOMContentLoaded (or immediately if the DOM is
 * ready). HeaderUserMenu.mount(el, opts) mounts one explicitly; it is
 * idempotent. The rendered button is #userMenuButton.
 */
(function (global) {
  'use strict';

  var LOGOUT_VALUE = 'logout';

  function menuOptions(settingsHref) {
    return [
      { value: 'settings', label: 'Settings', icon: 'settings', href: settingsHref },
      { divider: true },
      { value: LOGOUT_VALUE, label: 'Sign out', icon: 'log-out', danger: true }
    ];
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
   * Returns { button, open, close, isOpen, destroy } or null when there is no container.
   */
  function mount(container, opts) {
    var doc = global.document;
    var el = container || doc.getElementById('userMenu');
    if (!el) return null;
    if (el.__headerUserMenu) return el.__headerUserMenu;
    opts = opts || {};
    var settingsHref = opts.settingsHref || el.getAttribute('data-settings-href') || 'settings-v2.html';
    var loginHref = opts.loginHref || el.getAttribute('data-login-href') || 'login.html';

    var button = doc.createElement('lex-dropdown-btn');
    button.id = 'userMenuButton';
    button.setAttribute('icon', 'settings');
    button.setAttribute('icon-only', '');
    button.setAttribute('align', 'end');
    button.setAttribute('variant', 'ghost');
    button.setAttribute('button-label', 'Account menu');
    button.setAttribute('aria-label', 'Account menu');
    button.setAttribute('title', 'Settings');
    button.setAttribute('options', JSON.stringify(menuOptions(settingsHref)));
    el.innerHTML = '';
    el.appendChild(button);

    function onSelect(e) {
      if (!e.detail || e.detail.value !== LOGOUT_VALUE) return;
      if (typeof opts.onLogout === 'function') return opts.onLogout();
      return defaultLogout(loginHref);
    }
    button.addEventListener('lex-select', onSelect);

    function trigger() { return button.querySelector('[data-action="toggle"]'); }
    function isOpen() { return !!button.querySelector('.lex-ddbtn-dropdown--open'); }
    function toggleTo(want) {
      var t = trigger();
      if (t && isOpen() !== want) t.click();
    }

    var handle = {
      button: button,
      open: function () { toggleTo(true); },
      close: function () { toggleTo(false); },
      isOpen: isOpen,
      destroy: function () {
        button.removeEventListener('lex-select', onSelect);
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

  var HeaderUserMenu = { mount: mount, mountAll: mountAll, LOGOUT_VALUE: LOGOUT_VALUE };
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
