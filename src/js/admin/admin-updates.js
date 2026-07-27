/**
 * Backend Updates — Standalone Page Controller (admin/updates.html)
 *
 * Surfaces backend-update availability for THIS deployment and lets a
 * system_admin / org_admin apply it. For a CLOUD box, apply relays a re-provision
 * (the pod restarts → the client is briefly disconnected → it reconnects on the
 * new version); for ON-PREM the box self-updates in place. The controller tolerates
 * the reconnect window by polling status until the box reports the target version.
 *
 * Backend contract:
 *   GET  /api/v1/system/update/status  -> { data: { update_available, current_version,
 *          latest_version, mandatory, release_notes, delivery_mode, can_apply } }
 *   POST /api/v1/system/update/apply   -> 202 { data: { started, mode, target_version } }
 *
 * All state is scoped inside the IIFE.
 */

(function () {
  'use strict';

  var POLL_MS = 6000;              // reconnect poll cadence
  var MAX_WAIT_MS = 12 * 60 * 1000; // give up confirming after ~12 min
  var _applying = false;

  // -------------------------------------------------------------------------
  // DOM helpers (mirror admin-health.js)
  // -------------------------------------------------------------------------
  function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text == null ? '' : String(text); }
  function setKv(id, value) { var el = document.getElementById(id); if (el) el.setAttribute('value', (value == null || value === '') ? '--' : String(value)); }
  function show(id) { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
  function hide(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function toast(kind, msg) {
    if (typeof Lex !== 'undefined' && Lex.Toast && typeof Lex.Toast[kind] === 'function') Lex.Toast[kind](msg);
  }

  function injectBadge(containerId, label, color) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var badge = document.createElement('lex-badge');
    badge.setAttribute('label', String(label).toUpperCase());
    badge.setAttribute('color', color);
    badge.setAttribute('size', 'lg');
    el.innerHTML = '';
    el.appendChild(badge);
  }

  function prettyDelivery(mode) {
    if (mode === 'cloud') return 'Cloud (re-provision)';
    if (mode === 'onprem') return 'On-prem (in place)';
    return 'Unknown';
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  function renderStatus(data) {
    var available = !!data.update_available;

    setKv('kvCurrentVersion', data.current_version || 'Unknown');
    setKv('kvLatestVersion', data.latest_version || (available ? '--' : (data.current_version || '--')));
    setKv('kvUpdateStatus', available ? 'Update available' : 'Up to date');
    setKv('kvDeliveryMode', prettyDelivery(data.delivery_mode));

    injectBadge('updateStatusBadge', available ? 'Update available' : 'Up to date', available ? 'yellow' : 'green');

    var notes = (data.release_notes && String(data.release_notes).trim()) || '';
    var notesEl = document.getElementById('releaseNotes');
    if (notesEl) {
      if (notes) notesEl.innerHTML = Lex.Markdown.toHtml(notes);
      else notesEl.textContent = 'No release notes available.';
    }

    if (available && data.mandatory) show('mandatoryBanner'); else hide('mandatoryBanner');

    // The Apply CTA is ALWAYS visible; it's disabled unless an update is
    // available AND this user can apply it (so an up-to-date box shows a clear,
    // greyed-out "Apply Update" rather than nothing).
    var applyBtn = document.getElementById('applyBtn');
    if (applyBtn) {
      var actionable = available && data.can_apply && !_applying;
      if (actionable) applyBtn.removeAttribute('disabled');
      else applyBtn.setAttribute('disabled', 'true');

      if (available && data.can_apply) {
        setText('applyHint', data.delivery_mode === 'cloud'
          ? 'The backend will restart; you may be briefly disconnected while it updates.'
          : 'The backend will apply the update and restart briefly.');
      } else if (available && !data.can_apply) {
        setText('applyHint', 'A system administrator can apply this update.');
      } else {
        setText('applyHint', 'This deployment is on the latest version.');
      }
    }
  }

  function loadStatus() {
    return api.getSystemUpdateStatus().then(function (resp) {
      var data = (resp && resp.data) || {};
      renderStatus(data);
      var when = (typeof Lex !== 'undefined' && Lex.Utils && Lex.Utils.formatDateTime)
        ? Lex.Utils.formatDateTime(new Date()) : new Date().toLocaleString();
      setText('lastUpdatedText', 'Updated: ' + when);
      return data;
    }).catch(function (err) {
      if (err && (err.status === 401 || err.status === 403)) {
        toast('error', 'You do not have access to backend updates.');
      } else {
        toast('error', 'Failed to load update status');
      }
      return null;
    });
  }

  // -------------------------------------------------------------------------
  // Progress card
  // -------------------------------------------------------------------------
  function setProgress(state, message) {
    show('progressCard');
    var spinner = document.getElementById('progressSpinner');
    if (spinner) spinner.classList.toggle('hidden', state !== 'working');
    injectBadge('progressBadge',
      state === 'done' ? 'Done' : (state === 'failed' ? 'Failed' : 'Updating'),
      state === 'done' ? 'green' : (state === 'failed' ? 'red' : 'blue'));
    setText('progressMessage', message);
  }

  // Poll status until the box reports targetVersion. Unreachable / transient
  // errors during a cloud re-provision are EXPECTED — swallow them and keep waiting.
  function waitForVersion(targetVersion) {
    var deadline = Date.now() + MAX_WAIT_MS;
    function attempt() {
      return api.getSystemUpdateStatus().then(function (resp) {
        var d = (resp && resp.data) || {};
        return d.current_version === targetVersion && !d.update_available;
      }).catch(function () {
        return false; // pod recreating → not reachable yet
      }).then(function (done) {
        if (done) return true;
        if (Date.now() > deadline) return false;
        setProgress('working', 'Applying update and reconnecting to the backend…');
        return sleep(POLL_MS).then(attempt);
      });
    }
    return attempt();
  }

  // -------------------------------------------------------------------------
  // Apply
  // -------------------------------------------------------------------------
  function onApply() {
    if (_applying) return;
    loadStatus().then(function (data) {
      if (!data || !data.update_available) { toast('info', 'No update is available.'); return; }
      var target = data.latest_version;
      var cloud = data.delivery_mode === 'cloud';
      var body = cloud
        ? ('This will re-provision the backend onto version ' + target + '. The backend will restart and you may be briefly disconnected while it updates. Continue?')
        : ('This will apply backend version ' + target + '. The backend will restart briefly. Continue?');

      // Lex.Modal.confirm(title, message, onConfirm, options) — positional; the
      // apply runs from the onConfirm callback (Cancel simply closes the modal).
      Lex.Modal.confirm('Apply backend update?', body, function () {
        _applying = true;
        var applyBtn = document.getElementById('applyBtn');
        if (applyBtn) { applyBtn.setAttribute('loading', ''); applyBtn.setAttribute('disabled', 'true'); }
        setProgress('working', 'Requesting update…');

        api.applySystemUpdate().then(function () {
          setProgress('working', cloud
            ? 'The control plane is re-provisioning the backend. Reconnecting…'
            : 'The backend is applying the update. Reconnecting…');
          return waitForVersion(target);
        }).then(function (ok) {
          if (ok === undefined) return; // apply threw; handled in catch
          if (ok) {
            setProgress('done', 'Backend updated to ' + target + '.');
            toast('success', 'Backend updated to ' + target);
          } else {
            setProgress('failed', 'The update did not confirm within the expected time. Refresh to check, or contact support if it persists.');
            toast('error', 'Update did not confirm in time');
          }
          loadStatus();
        }).catch(function (err) {
          var status = err && err.status;
          var msg = (err && err.data && err.data.error) || (err && err.message) || 'Update failed to start';
          if (status === 409) {
            // already in progress (or already latest) — reflect reality by polling
            setProgress('working', 'An update is already in progress. Reconnecting…');
            waitForVersion(target).then(function (ok) {
              setProgress(ok ? 'done' : 'failed', ok ? ('Backend updated to ' + target + '.') : msg);
              loadStatus();
            });
          } else {
            setProgress('failed', msg);
            toast('error', msg);
            loadStatus();
          }
        }).then(function () {
          _applying = false;
          if (applyBtn) applyBtn.removeAttribute('loading');
        });
      }, { confirmText: 'Apply Update' });
    });
  }

  // -------------------------------------------------------------------------
  // Client app self-update (Electron only)
  //
  // Mirrors the backend card above, but the "server" is the Electron main
  // process: check via electronAPI.checkUpdates(), install via
  // electronAPI.installUpdate() (which downloads then quits + relaunches the
  // app — there is no post-install state to render). View-state derivation
  // lives in client-app-update-state.js so it stays unit-testable.
  // -------------------------------------------------------------------------
  var _appChecking = false;
  var _appInstalling = false;
  var _lastAppCheck = null;

  function appUpdatesSupported() {
    return typeof window !== 'undefined'
      && window.electronAPI
      && typeof window.electronAPI.checkUpdates === 'function'
      && typeof window.electronAPI.installUpdate === 'function';
  }

  function renderAppState(state, currentVersion) {
    if (!state.visible) return;
    show('clientAppCard');
    setKv('kvAppCurrentVersion', currentVersion || 'Unknown');
    setKv('kvAppLatestVersion', state.latestVersion || '--');
    setKv('kvAppUpdateStatus', state.statusLabel);
    setText('appUpdateHint', state.hint);

    var installBtn = document.getElementById('installAppUpdateBtn');
    if (installBtn) {
      if (state.canInstall && !_appInstalling) installBtn.removeAttribute('disabled');
      else installBtn.setAttribute('disabled', 'true');
    }
  }

  function loadAppVersion() {
    if (typeof window.electronAPI.getVersion !== 'function') return Promise.resolve(null);
    return window.electronAPI.getVersion().then(function (v) {
      return v ? String(v).replace(/^v/, '') : null;
    }).catch(function () { return null; });
  }

  function onCheckAppUpdates(currentVersion) {
    if (_appChecking) return;
    _appChecking = true;
    var checkBtn = document.getElementById('checkAppUpdateBtn');
    if (checkBtn) checkBtn.setAttribute('loading', '');

    window.electronAPI.checkUpdates(null).then(function (result) {
      _lastAppCheck = result;
      var state = ClientAppUpdateState.fromCheckResult({
        supported: true, currentVersion: currentVersion, result: result
      });
      renderAppState(state, currentVersion);
      setKv('kvAppChannel', (result && result.updateInfo && result.updateInfo.channel) || '--');
      if (state.statusLabel === 'Check failed') toast('error', state.hint);
    }).then(function () {
      _appChecking = false;
      if (checkBtn) checkBtn.removeAttribute('loading');
    });
  }

  function onInstallAppUpdate(currentVersion) {
    if (_appInstalling) return;
    var info = (_lastAppCheck && _lastAppCheck.updateInfo) || {};
    if (!info.updateAvailable) { toast('info', 'No app update is available.'); return; }

    var target = info.version || 'the latest version';
    Lex.Modal.confirm(
      'Install app update?',
      'The app will download version ' + target + ', then restart to install it. Continue?',
      function () {
        _appInstalling = true;
        var installBtn = document.getElementById('installAppUpdateBtn');
        if (installBtn) { installBtn.setAttribute('loading', ''); installBtn.setAttribute('disabled', 'true'); }
        setText('appUpdateHint', 'Downloading update… the app will restart on its own to finish.');

        window.electronAPI.installUpdate(null).then(function (res) {
          // On success the app quits and relaunches — this code only runs on failure.
          if (res && res.success === false) {
            _appInstalling = false;
            if (installBtn) installBtn.removeAttribute('loading');
            var state = ClientAppUpdateState.fromCheckResult({
              supported: true, currentVersion: currentVersion, result: _lastAppCheck
            });
            renderAppState(state, currentVersion);
            toast('error', res.error || 'The update failed to install.');
          }
        });
      },
      { confirmText: 'Download & Install' }
    );
  }

  function initClientAppSection() {
    if (!appUpdatesSupported()) return; // browser tab — card stays hidden

    loadAppVersion().then(function (currentVersion) {
      renderAppState(ClientAppUpdateState.fromCheckResult({ supported: true, currentVersion: currentVersion }), currentVersion);

      var checkBtn = document.getElementById('checkAppUpdateBtn');
      if (checkBtn) checkBtn.addEventListener('click', function () { onCheckAppUpdates(currentVersion); });
      var installBtn = document.getElementById('installAppUpdateBtn');
      if (installBtn) installBtn.addEventListener('click', function () { onInstallAppUpdate(currentVersion); });

      // Startup checks in the main process broadcast on this channel; reuse
      // the result so the card reflects reality without a manual click.
      if (typeof window.electronAPI.onUpdateAvailable === 'function') {
        window.electronAPI.onUpdateAvailable(function (updateInfo) {
          _lastAppCheck = { success: true, updateInfo: updateInfo || {} };
          var state = ClientAppUpdateState.fromCheckResult({
            supported: true, currentVersion: currentVersion, result: _lastAppCheck
          });
          renderAppState(state, currentVersion);
          setKv('kvAppChannel', (updateInfo && updateInfo.channel) || '--');
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Wiring + boot
  // -------------------------------------------------------------------------
  function setupButtons() {
    var applyBtn = document.getElementById('applyBtn');
    if (applyBtn) applyBtn.addEventListener('click', onApply);
    var refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { loadStatus(); });
  }

  function init() {
    setupButtons();
    loadStatus();
    initClientAppSection();
  }

  init();

})();
