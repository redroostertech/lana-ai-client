/* mfa-setup.js - required two-step sign in setup (mfa-setup.html).

   Sign in (login.html) sends a user here when Chef answers
   state: 'mfa_enrollment_required'; auth-guard.js does too on a 403
   MFA_ENROLLMENT_REQUIRED. Until enrollment is done Chef refuses every other
   call, and api.js holds off token refresh, the activity listener and session
   tracking. Setup, QR code and verify: js/shared/mfa-enrollment.js.

   After the code is verified the backup codes are shown once, then Continue
   opens a waiting app link (a share link, a signature request) or the dashboard.

   Rules (LEX-COMPONENT-RULES.md): IIFE, text through textContent only, the
   secret and codes are never logged. */

(function () {
  'use strict';

  var Kit = window.AppLinkPageKit;
  var Enrollment = window.LanaMfaEnrollment;
  var backupCodes = [];

  function toast(kind, message) {
    if (window.Lex && Lex.Toast && typeof Lex.Toast[kind] === 'function') Lex.Toast[kind](message);
  }

  function goToSignIn() {
    window.location.replace('login.html');
  }

  function showSetup(setup) {
    var qr = document.getElementById('mfaQr');
    if (setup.qrCode) qr.src = setup.qrCode;
    Kit.show('mfaQr', Boolean(setup.qrCode));
    document.getElementById('mfaSecret').textContent = Enrollment.groupSecret(setup.secret);
    backupCodes = setup.backupCodes;
    Kit.show('mfaLoading', false);
    Kit.show('mfaSetupFailed', false);
    Kit.show('mfaKey', true);
    Kit.show('mfaForm', true);
  }

  function showSetupFailed(message) {
    Kit.show('mfaLoading', false);
    Kit.textInto('mfaSetupFailedText', { tag: 'div', size: 'body-sm', variant: 'danger', icon: 'alert-circle' }, message);
    Kit.show('mfaSetupFailed', true);
  }

  function beginSetup() {
    Kit.show('mfaSetupFailed', false);
    Kit.show('mfaLoading', true);
    Enrollment.start(api).then(showSetup, function (error) {
      showSetupFailed(Enrollment.setupErrorMessage(error));
    });
  }

  function showBackupCodes() {
    var list = document.getElementById('mfaBackupCodes');
    list.textContent = '';
    backupCodes.forEach(function (code) {
      var item = document.createElement('div');
      item.className = 'mfa-code';
      item.textContent = code;
      list.appendChild(item);
    });
    Kit.show('mfaBackupCodes', backupCodes.length > 0);
    Kit.show('mfaCopyCodes', backupCodes.length > 0);
    Kit.show('mfaSetupView', false);
    Kit.show('mfaCodesView', true);
  }

  function submit() {
    var code = Kit.fieldValue('mfaCode');
    var problem = Enrollment.codeError(code);
    if (problem) {
      Kit.showError('mfaError', problem);
      return;
    }
    Kit.showError('mfaError', '');
    Kit.setBusy('mfaVerify', true);
    Enrollment.verify(api, code).then(function (outcome) {
      Kit.setBusy('mfaVerify', false);
      if (!outcome.ok) {
        Kit.showError('mfaError', outcome.message);
        return;
      }
      showBackupCodes();
    });
  }

  function copyCodes() {
    var text = Enrollment.backupCodesText(backupCodes);
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
    navigator.clipboard.writeText(text).then(function () {
      toast('success', 'Backup codes copied');
    }, function () {
      toast('error', 'Could not copy. Select the codes and copy them instead.');
    });
  }

  /** Enrollment is done: start what sign in held off, then go on as sign in would. */
  function continueToApp() {
    Kit.setBusy('mfaContinue', true);
    Promise.resolve(api.completeMfaEnrollment()).catch(function () { return null; }).then(function () {
      var links = window.electronAPI && window.electronAPI.appLinks;
      if (!links || typeof links.takePending !== 'function') return null;
      return links.takePending('signed-in').catch(function () { return null; });
    }).then(function (next) {
      window.location.replace(next && next.page ? next.page : 'dashboard.html');
    });
  }

  function signOut() {
    Kit.setBusy('mfaSignOut', true);
    Promise.resolve(api.logout()).catch(function () { return null; }).then(goToSignIn);
  }

  function start() {
    Kit.watchTheme();
    if (!api.token) {
      goToSignIn();
      return;
    }
    document.getElementById('mfaForm').addEventListener('lex-submit', submit);
    document.getElementById('mfaRetry').addEventListener('click', beginSetup);
    document.getElementById('mfaSignOut').addEventListener('click', signOut);
    document.getElementById('mfaCopyCodes').addEventListener('click', copyCodes);
    document.getElementById('mfaContinue').addEventListener('click', continueToApp);
    beginSetup();
  }

  start();
})();
