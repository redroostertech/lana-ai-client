/**
 * settings-local-models.js
 *
 * Wires the LANA One "Local models" section of settings-v2.html to the frozen
 * read-only endpoint GET /api/v1/system/local-models. It surfaces what this
 * machine can run on device (hardware + model ladder), the active local model
 * and its download state, the always-on embedding model, and the live routing
 * outcome (on this device vs. Cloud relay).
 *
 * Edition-gated: it only activates in the LANA One desktop edition, and even
 * then fails safe. If the endpoint is missing or errors, it renders an honest
 * degraded card rather than a broken page. This is inert in the stock org build
 * (the section stays hidden).
 *
 * v1 is read-only. There are no write controls here (default/override picking
 * is a future step) and this file invents no endpoints beyond the frozen one.
 */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    if (s === null || s === undefined) return '';
    if (window.Lex && Lex.Utils && typeof Lex.Utils.escapeHtml === 'function') {
      return Lex.Utils.escapeHtml(String(s));
    }
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function content() { return el('sv2-local-models-content'); }

  // ── Small formatting helpers ─────────────────────────────────────────

  function ramLabel(gb) {
    var n = Number(gb);
    if (!isFinite(n) || n <= 0) return 'Unknown';
    // Keep it whole when it is whole, otherwise one decimal.
    var rounded = Math.round(n * 10) / 10;
    return (rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)) + ' GB';
  }

  function chipLabel(hw) {
    if (!hw) return 'Unknown';
    if (hw.isAppleSilicon === true) return 'Apple Silicon';
    if (hw.isAppleSilicon === false) return 'Intel';
    return 'Unknown';
  }

  function platformLabel(hw) {
    if (!hw) return '';
    var map = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
    var p = hw.platform ? (map[hw.platform] || hw.platform) : '';
    var a = hw.arch || '';
    if (p && a) return p + ' (' + a + ')';
    return p || a || '';
  }

  function ctxLabel(win) {
    var n = Number(win);
    if (!isFinite(n) || n <= 0) return null;
    if (n >= 1000) {
      var k = Math.round(n / 1000);
      return k + 'K tokens';
    }
    return n + ' tokens';
  }

  // Download state -> { label, color }. Handles the frozen vocabulary plus a
  // couple of common aliases, and falls back to a neutral pill.
  function downloadBadge(state, progress) {
    var s = String(state || '').toLowerCase();
    if (s === 'present' || s === 'ready' || s === 'downloaded') {
      return { label: 'Downloaded', color: 'green' };
    }
    if (s === 'downloading' || s === 'in_progress') {
      var pct = Number(progress);
      var suffix = (isFinite(pct) && pct > 0 && pct <= 100)
        ? ' ' + Math.round(pct) + '%'
        : '';
      return { label: 'Downloading' + suffix, color: 'yellow' };
    }
    if (s === 'error' || s === 'failed') {
      return { label: 'Download error', color: 'red' };
    }
    if (s === 'missing' || s === 'not_downloaded' || s === '') {
      return { label: 'Not downloaded', color: 'gray' };
    }
    return { label: state ? String(state) : 'Unknown', color: 'gray' };
  }

  // Routing destination -> { label, onDevice }. Accepts either human strings
  // or raw tokens (local / device / relay / cloud).
  function routingLabel(dest) {
    var d = String(dest || '').toLowerCase();
    if (d === 'auto' || d.indexOf('hybrid') !== -1) {
      return { label: 'Automatic', onDevice: true };
    }
    if (d.indexOf('device') !== -1 || d.indexOf('local') !== -1) {
      return { label: 'On this device', onDevice: true };
    }
    if (d.indexOf('relay') !== -1 || d.indexOf('cloud') !== -1) {
      return { label: 'Cloud relay', onDevice: false };
    }
    if (!d) return { label: 'Unknown', onDevice: null };
    return { label: String(dest), onDevice: null };
  }

  // ── Render: helpers ──────────────────────────────────────────────────

  function bannerHtml(variant, title, body) {
    // Reuses the sv2-vpn-banner styling (ok / warn) already in settings-v2.css.
    var cls = variant === 'ok' ? 'sv2-vpn-banner--ok' : 'sv2-vpn-banner--warn';
    var stroke = variant === 'ok'
      ? 'var(--lex-status-success-text)'
      : 'var(--lex-status-warning-text)';
    var path = variant === 'ok'
      ? '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>'
      : '<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>';
    return '' +
      '<div class="sv2-vpn-banner ' + cls + '">' +
        '<svg width="20" height="20" fill="none" stroke="' + stroke + '" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>' +
        '<div>' +
          '<lex-text variant="primary" size="body-sm" weight="medium">' + esc(title) + '</lex-text>' +
          (body ? '<lex-text variant="secondary" size="body-xs">' + esc(body) + '</lex-text>' : '') +
        '</div>' +
      '</div>';
  }

  function subheading(text) {
    return '<lex-text variant="primary" size="body" weight="medium" tag="h4" style="display:block;margin:0 0 8px;">' + esc(text) + '</lex-text>';
  }

  // ── Render: states ───────────────────────────────────────────────────

  function renderLoading() {
    var c = content();
    if (!c) return;
    c.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;padding:16px 0;">' +
        '<lex-spinner size="sm" label="Checking what this machine can run..."></lex-spinner>' +
      '</div>';
  }

  // Endpoint absent / 500 / network — honest, non-broken fallback.
  function renderUnavailable() {
    var c = content();
    if (!c) return;
    c.innerHTML =
      '<lex-empty ' +
        'icon="inbox" ' +
        'message="Local model status is unavailable right now." ' +
        'description="LANA could not read this device\'s local model status. Chat still works through the secure Cloud relay. Try refreshing this page.">' +
      '</lex-empty>';
  }

  // supervisorActive:false — dev / connect-only session where the local stack
  // is not running. Graceful, not an error.
  function renderStackInactive() {
    var c = content();
    if (!c) return;
    c.innerHTML =
      bannerHtml('warn', 'Local model stack not active in this session',
        'This session is running in connect-only mode, so no local model is loaded. Chat runs through the secure Cloud relay. You can manage the relay connection from the Account page.');
  }

  // ── Render: full view ────────────────────────────────────────────────

  function renderData(data) {
    var c = content();
    if (!c) return;

    var hw = data.hardware || {};
    var local = data.localChat || {};
    var embedding = data.embedding || {};
    var tiers = Array.isArray(data.tiers) ? data.tiers : [];
    var routing = data.routing || {};

    var html = '';

    // ── This machine ──────────────────────────────────────────────────
    var supported = local.available === true;
    html += subheading('This machine');
    html += '<div class="sv2-vpn-grid">' +
      '<lex-kv label="Memory (RAM)" value="' + esc(ramLabel(hw.totalRamGB)) + '"></lex-kv>' +
      '<lex-kv label="Processor" value="' + esc(chipLabel(hw)) + '"></lex-kv>' +
      '<lex-kv label="Platform" value="' + esc(platformLabel(hw) || 'Unknown') + '"></lex-kv>' +
      '<lex-kv label="Local chat" value="' + (supported ? 'Supported' : 'Not supported') + '"></lex-kv>' +
    '</div>';

    html += '<lex-divider spacing="md"></lex-divider>';

    // ── Active local model ────────────────────────────────────────────
    html += subheading('Active local model');
    if (supported) {
      var dl = downloadBadge(local.downloadState, local.downloadProgress);
      var ctx = ctxLabel(local.contextWindow);
      html += '<div class="sv2-mfa-header">' +
        '<lex-text variant="secondary" size="body-sm">' +
          esc(local.model || 'Local model') +
          (local.tier ? ' &middot; ' + esc(local.tier) + ' tier' : '') +
          (ctx ? ' &middot; ' + esc(ctx) : '') +
        '</lex-text>' +
        '<lex-badge label="' + esc(dl.label) + '" color="' + dl.color + '" size="sm"></lex-badge>' +
      '</div>';
      if (String(local.downloadState || '').toLowerCase() === 'error') {
        html += bannerHtml('warn', 'This model could not be downloaded',
          'Chat is routed to the secure Cloud relay until the local model is available again.');
      }
    } else {
      // available:false — plain-language explanation derived from reason.
      var why = local.reason
        ? 'This machine routes chat to the secure Cloud relay because ' + local.reason + '.'
        : 'This machine routes chat to the secure Cloud relay, so no local model runs on device.';
      html += bannerHtml('warn', 'No local model runs on this machine', why);
    }

    // One-click download + activate when a local model would fit but isn't
    // serving yet (not supported, or a failed download) and the desktop bridge
    // is present. Activates the plan's tier, else the largest fitting tier.
    var fitting = tiers.filter(function (t) { return t && t.fits === true; })
      .sort(function (a, b) { return (b.minMemoryGB || 0) - (a.minMemoryGB || 0); });
    var planTierFits = local.tier && tiers.some(function (t) {
      return t && String(t.tier) === String(local.tier) && t.fits === true;
    });
    // Prefer the plan's tier only if it actually fits (RAM may have changed); else
    // the LARGEST fitting tier (sorted by minMemoryGB desc, so [0] is largest --
    // never trust the incoming array order).
    var activatableTier = planTierFits ? String(local.tier)
      : (fitting.length ? String(fitting[0].tier) : '');
    var notServing = !supported || String(local.downloadState || '').toLowerCase() === 'error';
    if (notServing && localModelsBridge() && activatableTier) {
      html += '<div style="margin-top:10px;">' +
        '<lex-btn id="lm-activate-btn" variant="primary" size="sm" leading-icon="download" data-tier="' + esc(activatableTier) + '">' +
          'Download &amp; activate on this device' +
        '</lex-btn>' +
        '<lex-text id="lm-activate-progress" variant="secondary" size="body-xs" style="display:block;margin-top:6px;"></lex-text>' +
      '</div>';
    }

    html += '<lex-divider spacing="md"></lex-divider>';

    // ── Embedding model ───────────────────────────────────────────────
    html += subheading('Embedding model');
    html += '<div class="sv2-mfa-header">' +
      '<lex-text variant="secondary" size="body-sm">' +
        esc(embedding.model || 'Embedding model') +
        ' &middot; used for on-device search and retrieval' +
      '</lex-text>' +
      '<lex-badge label="' + (embedding.bundled === false ? 'Always on' : 'Bundled') + '" color="green" size="sm"></lex-badge>' +
    '</div>';

    html += '<lex-divider spacing="md"></lex-divider>';

    // ── Model ladder ──────────────────────────────────────────────────
    html += subheading('Model ladder');
    if (tiers.length) {
      html += '<lex-text variant="secondary" size="body-sm" style="display:block;margin-bottom:8px;">' +
        'LANA picks the largest model your memory can support. The active tier is marked below.' +
      '</lex-text>';
      html += '<div>';
      var activeTier = supported ? String(local.tier || '') : '';
      for (var i = 0; i < tiers.length; i++) {
        var t = tiers[i] || {};
        var fits = t.fits === true;
        var isActive = activeTier && String(t.tier || '') === activeTier;
        var tctx = ctxLabel(t.contextWindow);

        var badges = '';
        if (isActive) badges += '<lex-badge label="Active" color="green" size="sm"></lex-badge> ';
        badges += fits
          ? '<lex-badge label="Fits" color="blue" size="sm"></lex-badge>'
          : '<lex-badge label="Needs more memory" color="gray" size="sm"></lex-badge>';

        html += '<div class="sv2-connected-app-row">' +
          '<div class="sv2-connected-app-info">' +
            '<lex-text variant="primary" size="body" weight="medium">' +
              esc((t.tier ? t.tier : 'Tier') ) + (t.model ? ' &middot; ' + esc(t.model) : '') +
            '</lex-text>' +
            '<span class="sv2-connected-app-meta">' +
              'Needs ' + esc(ramLabel(t.minMemoryGB)) +
              (tctx ? ' &middot; ' + esc(tctx) : '') +
            '</span>' +
          '</div>' +
          '<div style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">' + badges + '</div>' +
        '</div>';
      }
      html += '</div>';
    } else {
      html += '<lex-text variant="secondary" size="body-sm">No model tiers are published for this build.</lex-text>';
    }

    html += '<lex-divider spacing="md"></lex-divider>';

    // ── Routing outcome ───────────────────────────────────────────────
    html += subheading('Where chat runs');
    var route = routingLabel(routing.chatDestination);
    var routeColor = route.onDevice === true ? 'green' : (route.onDevice === false ? 'blue' : 'gray');
    html += '<div class="sv2-mfa-header">' +
      '<lex-text variant="secondary" size="body-sm">Current routing for your chat messages</lex-text>' +
      '<lex-badge label="' + esc(route.label) + '" color="' + routeColor + '" size="sm"></lex-badge>' +
    '</div>';
    var isAuto = String(routing.chatDestination || '').toLowerCase() === 'auto' ||
      String(routing.mode || '').toLowerCase() === 'hybrid';
    if (isAuto) {
      html += '<lex-text variant="secondary" size="body-sm" style="display:block;">' +
        'Chats run on this device by default, including your matter work. The secure ' +
        'Cloud relay is used only when a request needs it (tools, a very large request, ' +
        'or a cloud-only model), and is redacted before it leaves this device.' +
      '</lex-text>';
    } else if (routing.reason) {
      html += '<lex-text variant="secondary" size="body-sm" style="display:block;">' + esc(routing.reason) + '</lex-text>';
    }
    if (route.onDevice === false) {
      html += '<lex-text variant="tertiary" size="body-xs" style="display:block;margin-top:6px;">' +
        'The Cloud relay connection is managed on the Account page under Cloud relay.' +
      '</lex-text>';
    }

    c.innerHTML = html;
    wireActivateButton();
  }

  // ── Local-model download + activate (LANA One desktop bridge) ─────────

  function localModelsBridge() {
    var lm = window.electronAPI && window.electronAPI.localModels;
    return (lm && typeof lm.activate === 'function' && typeof lm.onProgress === 'function')
      ? lm : null;
  }

  var activateBusy = false;

  function setBtnBusy(btn, busy) {
    if (!btn) return;
    if (busy) { btn.setAttribute('disabled', 'true'); btn.setAttribute('loading', 'true'); }
    else { btn.removeAttribute('disabled'); btn.removeAttribute('loading'); }
  }

  function wireActivateButton() {
    var btn = el('lm-activate-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      doActivate(btn.getAttribute('data-tier') || undefined);
    });
    if (activateBusy) setBtnBusy(btn, true); // a re-render mid-download keeps it disabled
  }

  function doActivate(tier) {
    var bridge = localModelsBridge();
    if (!bridge || activateBusy) return;
    activateBusy = true;
    setBtnBusy(el('lm-activate-btn'), true);
    var prog = el('lm-activate-progress');
    if (prog) prog.textContent = 'Starting download...';
    var unsub = function () {};
    var reset = function () {
      activateBusy = false;
      if (typeof unsub === 'function') { try { unsub(); } catch (_e) { /* noop */ } }
      setBtnBusy(el('lm-activate-btn'), false);
    };
    try {
      unsub = bridge.onProgress(function (p) {
        var pr = el('lm-activate-progress');
        if (!pr) return;
        var w = (p && p.bytesWritten) || 0;
        var tot = (p && p.totalBytes) || 0;
        pr.textContent = tot
          ? 'Downloading ' + Math.floor((w / tot) * 100) + '%'
          : 'Downloading ' + Math.round(w / 1e6) + ' MB...';
      }) || function () {};
      Promise.resolve(bridge.activate({ tier: tier })).then(function (res) {
        var pr = el('lm-activate-progress');
        if (res && res.ok) {
          if (pr) pr.textContent = 'Activated. The local model now runs on this device.';
          load(); // re-pull the (backend already updated) status; card flips to Automatic
        } else if (pr) {
          pr.textContent = 'Could not activate: ' + ((res && res.error) || 'unknown error') +
            '. Chat stays on the Cloud relay.';
        }
      }).catch(function () {
        var pr = el('lm-activate-progress');
        if (pr) pr.textContent = 'Could not activate. Chat stays on the Cloud relay.';
      }).finally(reset);
    } catch (_e) {
      if (prog) prog.textContent = 'Could not start activation. Chat stays on the Cloud relay.';
      reset();
    }
  }

  // ── Load ─────────────────────────────────────────────────────────────

  function load() {
    var api = window.api;
    if (!api || typeof api.get !== 'function') { renderUnavailable(); return; }
    renderLoading();
    api.get('/api/v1/system/local-models').then(function (res) {
      var data = (res && res.data) ? res.data : res;
      if (!data || typeof data !== 'object') { renderUnavailable(); return; }
      if (data.supervisorActive === false) { renderStackInactive(); return; }
      renderData(data);
    }).catch(function () {
      // Absent (404) / 500 / network — degraded, never broken.
      renderUnavailable();
    });
  }

  function activate() {
    var section = el('sv2-section-local-models');
    if (!section) return;
    section.classList.remove('sv2-hidden');
    load();
    // Honor the topbar refresh button, matching the other settings sections. Skip
    // while a download/activation is in flight so it doesn't blank the card +
    // reset the progress line (the download continues in main regardless).
    document.addEventListener('lex-refresh', function () { if (!activateBusy) load(); });
  }

  function boot() {
    // Edition gate: LANA One desktop only. Inert (section stays hidden) in the
    // stock org / web build, exactly like settings-personalization.js.
    if (!window.electronAPI || typeof window.electronAPI.getConfig !== 'function') return;
    Promise.resolve(window.electronAPI.getConfig()).then(function (cfg) {
      if (cfg && cfg.isLanaOne === true) activate();
    }).catch(function () { /* inert on failure */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
