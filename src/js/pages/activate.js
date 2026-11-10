/* activate.js - account activation (activate.html).

   Opened from sign in ("Activate here", the code typed in) or by
   lana-ai://activate?code=... (electron-app-links.js, the code filled in, once
   the app is connected to the firm). Sets the password through
   POST /api/v1/auth/activate { activation_code, password }, then sends the
   person to sign in.

   With no firm saved on this computer and none named by the link, the
   Organization ID from the email is asked for first and the firm is found
   through discovery (js/shared/org-discovery.js) before the code is sent.
   The decisions live in js/shared/activate-flow.js.

   Rules (LEX-COMPONENT-RULES.md): IIFE, text through textContent only, the
   code is never logged. */

(function () {
  'use strict';

  var Model = window.AppLinkPages;
  var Kit = window.AppLinkPageKit;
  var Flow = window.ActivateFlow;
  var Discovery = window.LanaOrgDiscovery;
  var query = new URLSearchParams(window.location.search);
  var codeFromLink = query.get('code') || '';
  var linkOrg = query.get('org') || '';
  var linkDomain = query.get('domain') || '';
  var server = null;
  var askOrg = false;

  function normalizeEnabledApps(apps) {
    var catalog = window.LanaClientApps;
    if (catalog && typeof catalog.normalizeEnabledAppList === 'function') return catalog.normalizeEnabledAppList(apps || []);
    return Array.isArray(apps) ? apps : [];
  }

  function resolveOrganization(orgId) {
    return Discovery.resolveOrganization(orgId, linkDomain || Discovery.generateServerUrl(orgId), {
      fetch: function (url, init) { return fetch(url, init); },
      normalizeEnabledApps: normalizeEnabledApps
    }).then(Kit.preparePin);
  }

  function showHeading() {
    Kit.textInto('acHeading', { tag: 'h1', size: 'h4', weight: 'semibold' },
      'Activate your account at ' + Model.firmName(askOrg ? null : server));
  }

  function showOrgField(visible) {
    askOrg = visible;
    Kit.show('acOrgField', visible);
    var org = document.getElementById('acOrg');
    if (visible) org.setAttribute('required', ''); else org.removeAttribute('required');
    Kit.show('acOtherOrg', !visible);
    if (!codeFromLink) {
      Kit.show('acIntroCode', !visible);
      Kit.show('acIntroOrg', visible);
    }
    showHeading();
  }

  function showOrgFailure(error, orgId) {
    var failure = Discovery.describeFailure(error, orgId);
    Kit.textInto('acOrgFailureTitle', { tag: 'div', size: 'body-sm', weight: 'semibold', variant: 'danger', icon: 'alert-circle' }, failure.title);
    Kit.textInto('acOrgFailureDetail', { tag: 'div', size: 'body-sm', variant: 'secondary' }, failure.detail);
    Kit.textInto('acOrgFailureSupport', { tag: 'div', size: 'caption', variant: 'secondary' }, failure.support);
    Kit.show('acOrgFailure', true);
  }

  function goToSignIn() {
    window.location.replace(Model.signInPage(''));
  }

  function refreshRules() {
    Kit.renderRules('acRules', Model.passwordRules(Kit.fieldValue('acPassword'), Kit.fieldValue('acConfirm')));
  }

  function submit() {
    var code = (codeFromLink || Kit.fieldValue('acCode')).trim();
    var password = Kit.fieldValue('acPassword');
    // The typed Organization ID, or the link's when no firm is saved here.
    var orgId = askOrg ? Flow.normalizeOrgId(Kit.fieldValue('acOrg')) : (server ? '' : Flow.normalizeOrgId(linkOrg));
    Kit.show('acOrgFailure', false);
    if (askOrg && !orgId) {
      Kit.showError('acError', 'Enter the Organization ID from your email.');
      return;
    }
    if (!code) {
      Kit.showError('acError', 'Enter the activation code from your email.');
      return;
    }
    if (!Model.passwordReady(password, Kit.fieldValue('acConfirm'))) {
      refreshRules();
      Kit.showError('acError', 'Your password needs to meet both rules above.');
      return;
    }
    Kit.showError('acError', '');
    Kit.setBusy('acSubmit', true);
    Flow.submitActivation({ orgId: orgId, savedServer: server, code: code, password: password }, {
      resolveOrganization: resolveOrganization,
      activate: function (firm, body) { return Kit.postPublic(firm, '/api/v1/auth/activate', body); },
      saveServer: Kit.saveFirm
    }).then(function (result) {
      if (result.ok) {
        Kit.show('acFormView', false);
        Kit.show('acDoneView', true);
      } else if (result.stage === 'discovery') {
        showOrgFailure(result.error, orgId);
      } else {
        Kit.showError('acError', Model.setPasswordError(result.error, 'activate'));
      }
    }).then(function () {
      Kit.setBusy('acSubmit', false);
    });
  }

  function start() {
    Kit.watchTheme();
    if (codeFromLink) {
      // The code came in the link: nothing to type, so the field is not shown.
      Kit.show('acCodeField', false);
      Kit.show('acIntroCode', false);
      Kit.show('acIntroLink', true);
    }
    refreshRules();
    ['acPassword', 'acConfirm'].forEach(function (id) {
      document.getElementById(id).addEventListener('lex-input', refreshRules);
    });
    document.getElementById('acForm').addEventListener('lex-submit', submit);
    document.getElementById('acSignIn').addEventListener('click', goToSignIn);
    document.getElementById('acBack').addEventListener('click', goToSignIn);
    document.getElementById('acOtherOrg').addEventListener('click', function () { showOrgField(true); });
    document.getElementById('acRetry').addEventListener('click', function () {
      document.getElementById('acForm').requestSubmit();
    });
    Kit.savedServer().then(function (saved) {
      server = saved;
      showOrgField(Flow.needsOrgField({ linkOrg: linkOrg, linkDomain: linkDomain, savedServer: saved }));
    });
  }

  start();
})();
