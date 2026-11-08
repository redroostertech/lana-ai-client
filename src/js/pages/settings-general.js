/**
 * Settings V2 > General: About, Software update, the Date & time clock, Language & region
 * and Legal & regulatory. Facts come from the main process (electron-system-info.js) through
 * window.electronAPI; the text is LanaSettingsGeneral (src/js/settings-general.model.js).
 * The time zone itself stays in settings-v2.js.
 */
(function () {
  'use strict';

  var G = window.LanaSettingsGeneral;
  var CLOCK_MS = 30 * 1000;

  function el(id) {
    return document.getElementById(id);
  }

  function setText(node, text) {
    if (!node) return;
    node.textContent = text || '';
    node.hidden = !text;
  }

  function fillRows(box, rows) {
    while (box.firstChild) box.removeChild(box.firstChild);
    rows.forEach(function (row) {
      var kv = document.createElement('lex-kv');
      kv.setAttribute('label', row.label);
      kv.setAttribute('value', row.value);
      kv.setAttribute('direction', 'horizontal');
      box.appendChild(kv);
    });
  }

  /** The time zone the person chose (the select), else this computer's. */
  function timeZone() {
    var select = el('sv2-timezone-select');
    var chosen = select && (select.value || select.getAttribute('value'));
    if (chosen) return chosen;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (_) {
      return undefined;
    }
  }

  function productName() {
    return (window.lanaBrand && window.lanaBrand.name) || 'LANA AI';
  }

  // ── Date & time ───────────────────────────────────────

  function renderClock() {
    var now = el('sv2-datetime-now');
    if (now) now.textContent = G.nowText(new Date(), timeZone());
  }

  // ── About, Language & region ──────────────────────────

  function renderSystem(info) {
    var about = G.aboutView(info, productName());
    fillRows(el('sv2-about-rows'), about.rows);
    setText(el('sv2-about-warning'), about.warning);
    el('sv2-section-about').hidden = false;

    var language = G.languageView(info.locale);
    fillRows(el('sv2-language-rows'), language.rows);
    setText(el('sv2-language-note'), language.note);
    el('sv2-section-language').hidden = false;
  }

  // ── Software update ───────────────────────────────────

  var updateStatus = null;
  var busy = false;

  function renderUpdate(status) {
    if (status) updateStatus = status;
    var view = G.updateView(updateStatus, timeZone());
    el('sv2-update-version').textContent = view.version;
    setText(el('sv2-update-summary'), busy ? 'Checking for updates' : view.summary);
    setText(el('sv2-update-checked'), view.checked);
    var badge = el('sv2-update-badge');
    badge.setAttribute('label', busy ? 'Checking' : view.badge);
    badge.setAttribute('color', busy ? 'gray' : view.color);
    var button = el('sv2-update-action');
    button.label = view.actionLabel;
    button.setAttribute('variant', view.action === 'install' ? 'primary' : 'secondary');
    button.setAttribute('data-action', view.action);
    if (busy) button.setAttribute('loading', 'true');
    else button.removeAttribute('loading');
    el('sv2-update-notes').hidden = !view.releaseNotes;
    el('sv2-update-notes-text').textContent = view.releaseNotes;
    setText(el('sv2-update-note'), view.note);
    el('sv2-section-update').hidden = false;
  }

  function onUpdateAction() {
    var api = window.electronAPI;
    var button = el('sv2-update-action');
    if (busy || button.hasAttribute('disabled')) return;
    if (button.getAttribute('data-action') === 'install') {
      // The update window takes over from here: it downloads, shows progress and restarts LANA.
      api.installClientUpdate().catch(function () {
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('LANA could not start the update. Try again.');
      });
      return;
    }
    busy = true;
    renderUpdate();
    api.checkForClientUpdates().then(function (result) {
      busy = false;
      if (result && result.success) renderUpdate(result.status);
      else {
        renderUpdate();
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error((result && result.error) || 'LANA could not check for updates. Try again.');
      }
    }).catch(function () {
      busy = false;
      renderUpdate();
    });
  }

  // ── Legal ─────────────────────────────────────────────

  function openLicenses() {
    var route = 'open-source-licenses.html';
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') window.Lex.Nav.go(route);
    else window.location.href = route;
  }

  /** Terms and Privacy open on lanaai.io in the system browser. */
  function openHref(event) {
    var url = event.currentTarget.getAttribute('data-href');
    var api = window.electronAPI;
    if (api && typeof api.openExternal === 'function') api.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  }

  // ── Setup ─────────────────────────────────────────────

  function boot() {
    if (!G || !el('sv2-section-about')) return;

    renderClock();
    setInterval(renderClock, CLOCK_MS);
    var select = el('sv2-timezone-select');
    if (select) {
      select.addEventListener('lex-change', function () {
        // Read after settings-v2.js has applied the new zone.
        setTimeout(function () {
          renderClock();
          if (updateStatus) renderUpdate();
        }, 0);
      });
    }

    var licenses = el('sv2-legal-licenses');
    if (licenses) licenses.addEventListener('click', openLicenses);
    ['sv2-legal-terms', 'sv2-legal-privacy'].forEach(function (id) {
      var link = el(id);
      if (link) link.addEventListener('click', openHref);
    });

    var api = window.electronAPI;
    if (!api || typeof api.getSystemInfo !== 'function') return;

    api.getSystemInfo().then(function (result) {
      if (result && result.success) renderSystem(result.info);
    }).catch(function () { /* About and Language & region stay hidden. */ });

    el('sv2-update-action').addEventListener('click', onUpdateAction);
    api.getUpdateStatus().then(function (result) {
      if (result && result.success) renderUpdate(result.status);
    }).catch(function () { /* Software update stays hidden. */ });
    if (typeof api.onUpdateAvailable === 'function') {
      // A check from elsewhere (startup, the Help menu): refresh the status.
      api.onUpdateAvailable(function () {
        api.getUpdateStatus().then(function (result) {
          if (result && result.success && !busy) renderUpdate(result.status);
        }).catch(function () {});
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
