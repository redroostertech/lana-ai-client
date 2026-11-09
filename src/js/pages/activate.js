/* activate.js - account activation (activate.html).

   Opened from sign in ("Activate here", the code typed in) or by
   lana-ai://activate?code=... (electron-app-links.js, the code filled in, once
   the app is connected to the firm). Sets the password through
   POST /api/v1/auth/activate { activation_code, password }, then sends the
   person to sign in.

   Rules (LEX-COMPONENT-RULES.md): IIFE, text through textContent only, the
   code is never logged. */

(function () {
  'use strict';

  var Model = window.AppLinkPages;
  var Kit = window.AppLinkPageKit;
  var codeFromLink = new URLSearchParams(window.location.search).get('code') || '';
  var server = null;

  function goToSignIn() {
    window.location.replace(Model.signInPage(''));
  }

  function refreshRules() {
    Kit.renderRules('acRules', Model.passwordRules(Kit.fieldValue('acPassword'), Kit.fieldValue('acConfirm')));
  }

  function submit() {
    var code = (codeFromLink || Kit.fieldValue('acCode')).trim();
    var password = Kit.fieldValue('acPassword');
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
    Kit.postPublic(server, '/api/v1/auth/activate', { activation_code: code, password: password }).then(function () {
      Kit.show('acFormView', false);
      Kit.show('acDoneView', true);
    }).catch(function (error) {
      Kit.showError('acError', Model.setPasswordError(error, 'activate'));
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
    Kit.savedServer().then(function (saved) {
      server = saved;
      Kit.textInto('acHeading', { tag: 'h1', size: 'h4', weight: 'semibold' },
        'Activate your account at ' + Model.firmName(saved));
    });
  }

  start();
})();
