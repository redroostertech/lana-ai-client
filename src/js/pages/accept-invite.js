/* accept-invite.js - the invitation page (accept-invite.html).

   Opened by lana-ai://accept-invite?token=... (electron-app-links.js) once the
   app is connected to the firm that sent the invitation. Sets the person's
   password through POST /api/v1/auth/accept-invite, then sends them to sign in
   with their email filled in when Chef returns it.

   Rules (LEX-COMPONENT-RULES.md): IIFE, text through textContent only, the
   token is never logged. */

(function () {
  'use strict';

  var Model = window.AppLinkPages;
  var Kit = window.AppLinkPageKit;
  var token = new URLSearchParams(window.location.search).get('token') || '';
  var server = null;
  var signInEmail = '';
  // Accepting an invitation creates the account through Chef's user-creation
  // rule: 8 characters plus upper, lower, number and special character.
  var PASSWORD_POLICY = 'strong';

  function goToSignIn() {
    window.location.replace(Model.signInPage(signInEmail));
  }

  function refreshRules() {
    Kit.renderRules('aiRules', Model.passwordRules(Kit.fieldValue('aiPassword'), Kit.fieldValue('aiConfirm'), PASSWORD_POLICY));
  }

  function submit() {
    var password = Kit.fieldValue('aiPassword');
    if (!Model.passwordReady(password, Kit.fieldValue('aiConfirm'), PASSWORD_POLICY)) {
      refreshRules();
      Kit.showError('aiError', 'Your password needs to meet every rule above.');
      return;
    }
    var body = { token: token, password: password };
    var first = Kit.fieldValue('aiFirstName').trim();
    var last = Kit.fieldValue('aiLastName').trim();
    if (first) body.first_name = first;
    if (last) body.last_name = last;

    Kit.showError('aiError', '');
    Kit.show('aiErrorSignIn', false);
    Kit.setBusy('aiSubmit', true);
    Kit.postPublic(server, '/api/v1/auth/accept-invite', body).then(function (response) {
      signInEmail = Model.emailFromResponse(response);
      Kit.show('aiFormView', false);
      Kit.show('aiDoneView', true);
    }).catch(function (error) {
      var problem = Model.setPasswordProblem(error, 'invite');
      Kit.showError('aiError', problem.message);
      // Already used, or the email already has an account: sign in instead.
      Kit.show('aiErrorSignIn', problem.signIn);
    }).then(function () {
      Kit.setBusy('aiSubmit', false);
    });
  }

  function start() {
    Kit.watchTheme();
    document.getElementById('aiSignIn').addEventListener('click', goToSignIn);
    document.getElementById('aiInvalidSignIn').addEventListener('click', goToSignIn);
    document.getElementById('aiErrorSignIn').addEventListener('click', goToSignIn);
    if (!token) {
      Kit.show('aiFormView', false);
      Kit.show('aiInvalidView', true);
      return;
    }
    refreshRules();
    ['aiPassword', 'aiConfirm'].forEach(function (id) {
      document.getElementById(id).addEventListener('lex-input', refreshRules);
    });
    document.getElementById('aiForm').addEventListener('lex-submit', submit);
    Kit.savedServer().then(function (saved) {
      server = saved;
      Kit.textInto('aiHeading', { tag: 'h1', size: 'h4', weight: 'semibold' },
        'Set your password to join ' + Model.firmName(saved));
    });
  }

  start();
})();
