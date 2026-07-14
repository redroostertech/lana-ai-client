/* ==========================================================================
   Account - Cloud relay section controller

   Wires the Cloud relay card on account.html to the relay settings API:
     - loads the masked configuration state (GET /api/v1/settings/relay)
     - Test connection: server-side probe via POST /api/v1/settings/relay/test
     - Save: persists via PUT /api/v1/settings/relay
     - Disconnect: DELETE /api/v1/settings/relay

   All decision logic lives in js/relay/relay-settings-state.js (pure,
   unit-tested); this file only moves values between the DOM and the API.

   FUTURE (automated minting): the "Sign in to LANA" primary action slots
   into #cr-signin-slot ABOVE the manual group; on success it saves with
   source 'cloud_signin' server-side and this controller just reloads state.

   No regex. No classes. No top-level const/let.
   ========================================================================== */

(function () {
  'use strict';

  var dom = {};
  var state = { settings: null };

  function cacheDom() {
    dom.statusBadge   = document.getElementById('cr-status-badge');
    dom.statusText    = document.getElementById('cr-status-text');
    dom.baseUrlInput  = document.getElementById('cr-base-url');
    dom.tokenInput    = document.getElementById('cr-token');
    dom.testBtn       = document.getElementById('cr-test-btn');
    dom.saveBtn       = document.getElementById('cr-save-btn');
    dom.disconnectBtn = document.getElementById('cr-disconnect-btn');
    dom.signinSlot    = document.getElementById('cr-signin-slot');
  }

  function relayState() {
    return window.LanaRelayState;
  }

  function relayApi() {
    return window.LanaRelayApi;
  }

  // The desktop cloud sign-in bridge (LANA One only). Absent in the stock build,
  // in which case the automated "connect" action is simply not offered.
  function cloudAuth() {
    return (window.electronAPI && window.electronAPI.cloudAuth &&
      typeof window.electronAPI.cloudAuth.ensureRelay === 'function')
      ? window.electronAPI.cloudAuth
      : null;
  }

  var signinBusy = false;

  function toast() {
    return (window.Lex && window.Lex.Toast) || null;
  }

  function inputValue(el) {
    if (!el) return '';
    if (typeof el.value === 'string') return el.value;
    return el.getAttribute('value') || '';
  }

  function setStatus(label, color, detail) {
    if (dom.statusBadge) {
      dom.statusBadge.setAttribute('label', label);
      dom.statusBadge.setAttribute('color', color);
    }
    if (dom.statusText) dom.statusText.textContent = detail || '';
  }

  // Automated relay connect: use the signed-in LANA account to mint + deliver a
  // relay token via the main process (window.electronAPI.cloudAuth.ensureRelay),
  // so the user never copies a token. The token NEVER touches the renderer; we
  // only ever receive { ok }. Reloads the server-side state on success.
  function doSignInConnect() {
    var ca = cloudAuth();
    if (!ca || signinBusy) return;
    signinBusy = true;
    setBusy(document.getElementById('cr-signin-btn'), true);
    Promise.resolve(ca.ensureRelay(true)).then(function (res) {
      var t = toast();
      if (res && res.ok) {
        if (t) t.success('Cloud relay connected');
        loadSettings();
      } else if (t) {
        t.error('Could not connect automatically. Try again or paste a token below.');
      }
    }).catch(function () {
      var t2 = toast();
      if (t2) t2.error('Could not connect automatically. Try again or paste a token below.');
    }).finally(function () {
      signinBusy = false;
      setBusy(document.getElementById('cr-signin-btn'), false);
    });
  }

  // Offer the one-click "connect with your LANA account" action ABOVE the manual
  // group, but only when the cloud bridge exists AND we are not already connected
  // via sign-in (the status badge already conveys that state).
  function renderSigninSlot(view) {
    var slot = dom.signinSlot;
    if (!slot) return;
    var viaSignin = !!(state.settings && state.settings.source === 'cloud_signin' && view.configured);
    if (!cloudAuth() || viaSignin) {
      slot.innerHTML = '';
      return;
    }
    slot.innerHTML =
      '<lex-btn id="cr-signin-btn" variant="primary" size="sm" leading-icon="log-in">' +
      'Connect with your LANA account</lex-btn>' +
      '<lex-text variant="secondary" size="body-sm" tag="p" style="margin-top:0.4rem">' +
      'Sets up cloud access automatically from your signed-in account. No token to copy.' +
      '</lex-text>';
    var btn = document.getElementById('cr-signin-btn');
    if (btn) {
      btn.addEventListener('click', doSignInConnect);
      // A competing re-render (lex-refresh / post-connect reload) must not visually
      // re-enable a button whose mint is still in flight.
      if (signinBusy) setBusy(btn, true);
    }
  }

  function render() {
    var view = relayState().deriveView(state.settings);
    setStatus(view.statusLabel, view.statusColor, view.statusDetail);
    renderSigninSlot(view);

    if (dom.baseUrlInput && !inputValue(dom.baseUrlInput)) {
      dom.baseUrlInput.setAttribute('value', view.baseUrl);
    }
    if (dom.tokenInput) {
      dom.tokenInput.setAttribute('placeholder', view.tokenPlaceholder);
    }
    if (dom.disconnectBtn) {
      dom.disconnectBtn.style.display = view.canDisconnect ? '' : 'none';
    }
  }

  function loadSettings() {
    relayApi().getSettings().then(function (result) {
      state.settings = result.data || null;
      render();
    }).catch(function () {
      setStatus('Unavailable', 'gray', 'Could not load the relay settings.');
    });
  }

  function currentInput() {
    return {
      baseUrl: inputValue(dom.baseUrlInput),
      token: inputValue(dom.tokenInput),
      tokenSet: !!(state.settings && state.settings.token_set)
    };
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) {
      btn.setAttribute('disabled', 'true');
    } else {
      btn.removeAttribute('disabled');
    }
  }

  function doTest() {
    var payload = relayState().buildTestPayload(currentInput());
    setBusy(dom.testBtn, true);
    setStatus('Testing', 'blue', 'Contacting the relay...');

    relayApi().testConnection(payload).then(function (result) {
      var outcome = relayState().mapTestResult(result.data || {});
      setStatus(outcome.label, outcome.color, outcome.detail);
      var t = toast();
      if (t) {
        if (outcome.ok) { t.success('Relay connection OK'); }
        else { t.error(outcome.detail); }
      }
    }).catch(function () {
      setStatus('Error', 'red', 'The connection test failed.');
    }).finally(function () {
      setBusy(dom.testBtn, false);
    });
  }

  function doSave() {
    var check = relayState().validateSaveInput(currentInput());
    if (!check.ok) {
      var t = toast();
      if (t) t.error(check.error);
      setStatus('Check input', 'yellow', check.error);
      return;
    }

    setBusy(dom.saveBtn, true);
    relayApi().saveSettings(check.payload).then(function (result) {
      state.settings = result.data || state.settings;
      // Clear the pasted token from the field: it is saved server-side and
      // never displayed again (only last4 comes back).
      if (dom.tokenInput) dom.tokenInput.setAttribute('value', '');
      render();
      var t2 = toast();
      if (t2) t2.success('Cloud relay saved');
    }).catch(function (err) {
      var msg = (err && err.message) || 'Failed to save relay settings';
      var t3 = toast();
      if (t3) t3.error(msg);
      setStatus('Not saved', 'red', msg);
    }).finally(function () {
      setBusy(dom.saveBtn, false);
    });
  }

  function doDisconnect() {
    function run() {
      setBusy(dom.disconnectBtn, true);
      relayApi().disconnect().then(function () {
        state.settings = null;
        if (dom.tokenInput) dom.tokenInput.setAttribute('value', '');
        loadSettings();
        var t = toast();
        if (t) t.success('Cloud relay disconnected');
      }).catch(function () {
        var t2 = toast();
        if (t2) t2.error('Failed to disconnect');
      }).finally(function () {
        setBusy(dom.disconnectBtn, false);
      });
    }

    if (window.Lex && window.Lex.Modal && typeof window.Lex.Modal.confirm === 'function') {
      window.Lex.Modal.confirm(
        'Disconnect Cloud Relay',
        'Remove the saved relay token from this device? Cloud models will stop working until you connect again.',
        run,
        { confirmText: 'Disconnect', variant: 'danger' }
      );
    } else {
      run();
    }
  }

  function init() {
    cacheDom();
    if (!dom.statusBadge || !relayState() || !relayApi()) return;

    if (dom.testBtn) dom.testBtn.addEventListener('click', doTest);
    if (dom.saveBtn) dom.saveBtn.addEventListener('click', doSave);
    if (dom.disconnectBtn) dom.disconnectBtn.addEventListener('click', doDisconnect);

    document.addEventListener('lex-refresh', function () {
      loadSettings();
    });

    loadSettings();
  }

  init();

})();
