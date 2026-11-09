/* shared-link.js - opening a share link (shared-link.html).

   Opened by lana-ai://shared?token=... (electron-app-links.js) once the person
   is signed in to the firm. Redeems the link with
   POST /api/v1/sharing/links/<token>/redeem { password? }, which answers
   { resource_type, resource_id, permissions }, then opens the item the way the
   app opens it elsewhere (AppLinkPages.sharedResourcePage). Chef decides
   access; this page only shows what Chef said in plain words.

   Rules (LEX-COMPONENT-RULES.md): IIFE, text through textContent only, the
   token is never logged. */

(function () {
  'use strict';

  var Model = window.AppLinkPages;
  var Kit = window.AppLinkPageKit;
  var token = new URLSearchParams(window.location.search).get('token') || '';

  function only(viewId) {
    ['slOpeningView', 'slPasswordView', 'slProblemView'].forEach(function (id) {
      Kit.show(id, id === viewId);
    });
  }

  function problem(message, canRetry) {
    Kit.textInto('slProblem', { tag: 'p', size: 'body-sm', variant: 'secondary' }, message);
    Kit.show('slRetry', Boolean(canRetry));
    only('slProblemView');
  }

  function openResource(redeemed) {
    if (String(redeemed && redeemed.resource_type).toLowerCase() !== 'folder') {
      return Promise.resolve(Model.sharedResourcePage(redeemed, null));
    }
    // A folder opens inside its matter, so the folder's matter is looked up first.
    return api.get('/api/v1/storage/folders/' + encodeURIComponent(redeemed.resource_id)).then(function (response) {
      return Model.sharedResourcePage(redeemed, Model.folderFromResponse(response));
    });
  }

  // Straight to fetch rather than api.post: Chef may answer a password
  // problem with 401, which api.js would take for a signed-out session.
  function redeemRequest(password) {
    var body = password ? { password: password } : {};
    var path = '/api/v1/sharing/links/' + encodeURIComponent(token) + '/redeem';
    return Kit.postJson(api.baseUrl + path, body, api.getHeaders()).catch(function (error) {
      var kind = Model.sharedLinkOutcome(error).kind;
      if (error && error.status === 401 && kind !== 'password-required' && kind !== 'password-wrong') {
        api.showSessionExpiredModal();
      }
      throw error;
    });
  }

  function redeem(password) {
    return redeemRequest(password)
      .then(function (response) {
        var redeemed = response && response.data && response.data.resource_type ? response.data : response;
        return openResource(redeemed);
      })
      .then(function (page) {
        if (!page) {
          problem('LANA cannot open this kind of shared item yet.', false);
          return;
        }
        window.location.replace(page);
      });
  }

  function attempt(password) {
    return redeem(password).catch(function (error) {
      var outcome = Model.sharedLinkOutcome(error);
      if (outcome.kind === 'password-required') {
        Kit.showError('slPasswordError', '');
        only('slPasswordView');
        return;
      }
      if (outcome.kind === 'password-wrong') {
        Kit.showError('slPasswordError', outcome.message);
        only('slPasswordView');
        return;
      }
      problem(outcome.message, outcome.kind === 'other');
    });
  }

  function submitPassword() {
    var password = Kit.fieldValue('slPassword');
    if (!password) {
      Kit.showError('slPasswordError', 'Enter the password for this link.');
      return;
    }
    Kit.setBusy('slSubmit', true);
    attempt(password).then(function () { Kit.setBusy('slSubmit', false); });
  }

  function start() {
    Kit.watchTheme();
    document.getElementById('slHome').addEventListener('click', function () {
      window.location.replace('dashboard.html');
    });
    document.getElementById('slRetry').addEventListener('click', function () {
      only('slOpeningView');
      attempt('');
    });
    document.getElementById('slForm').addEventListener('lex-submit', submitPassword);
    if (!token) {
      problem('This link is incomplete. Open it again from the email.', false);
      return;
    }
    (api._readyPromise || Promise.resolve()).then(function () { return attempt(''); });
  }

  start();
})();
