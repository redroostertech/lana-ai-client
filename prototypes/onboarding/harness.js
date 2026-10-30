/**
 * Stand-ins for the parts of the app the onboarding component talks to:
 * window.api.user, Lex.Auth, Lex.Nav, Lex.Toast and the Ask LANA dock.
 * Onboarding status itself is saved by the real store in localStorage.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  // role=org_admin (default) | admin | member
  const role = params.get('role') || 'org_admin';
  const $ = (id) => document.getElementById(id);
  const STATE_KEY = 'lana.onboarding.harness-user';

  function showState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STATE_KEY));
    } catch (e) {
      saved = null;
    }
    $('saved-state').textContent = saved
      ? `Saved on this device: ${saved.status} / ${saved.scene}${saved.firstStep ? ` / first step: ${saved.firstStep}` : ''}`
      : 'Saved on this device: nothing yet';
  }

  window.api = { user: { id: 'harness-user', firstName: params.get('name') || 'there' } };

  window.Lex.Auth = {
    isAdmin: () => role === 'org_admin' || role === 'admin',
    canAccessAdminPages: () => role === 'org_admin',
  };

  window.Lex.Nav = {
    go(href) {
      $('destination').textContent = `Navigated to ${href}`;
      window.harnessLastNavigation = href;
      showState();
    },
  };

  window.Lex.Toast = {
    info(message) {
      window.harnessLastToast = message;
      showState();
    },
  };

  document.querySelector('lex-lana-dock').openWith = function () {
    $('destination').textContent = 'Opened the Ask LANA dock on this page';
    window.harnessLastNavigation = 'dock';
  };

  window.harnessLaunch = function () {
    const theme = params.get('theme');
    if (theme) {
      // Applied once the element exists; the component defaults to light.
      new MutationObserver((records, observer) => {
        const el = document.querySelector('lex-onboarding');
        if (el) {
          el.setAttribute('theme', theme);
          observer.disconnect();
        }
      }).observe(document.body, { childList: true });
    }
    showState();
    window.Lex.Onboarding.launch();
  };

  $('replay').addEventListener('click', () => window.Lex.Onboarding.launch({ replay: true }));
  $('relaunch').addEventListener('click', () => window.location.reload());
  $('reset').addEventListener('click', () => {
    localStorage.removeItem(STATE_KEY);
    window.location.reload();
  });
})();
