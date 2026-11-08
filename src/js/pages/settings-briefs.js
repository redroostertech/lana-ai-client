/**
 * Settings V2: LANA Briefs (Briefs integration plan, "Settings consolidation").
 *
 * Shown only while Briefs runs for the firm (window.lanaBriefs answers):
 * - Connected devices: paired phones (the Phones dialog from briefs-phones-ui.js), the proximity
 *   check and background updates;
 * - Data controls: how long meeting audio is kept on this computer;
 * - Capabilities: the speech model downloads.
 * Every rule lives in the Briefs host; the text comes from BriefsSettings
 * (src/js/briefs/briefs-settings.js). Nothing here logs names.
 */
(function () {
  'use strict';

  var S = window.BriefsSettings;
  var phones = window.BriefsPhonesUI;

  function bridge() {
    return window.lanaBriefs || null;
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setChecked(toggle, value, disabled) {
    if (!toggle) return;
    if (value) toggle.setAttribute('checked', '');
    else toggle.removeAttribute('checked');
    toggle.checked = Boolean(value);
    if (disabled) toggle.setAttribute('disabled', '');
    else toggle.removeAttribute('disabled');
  }

  function setText(node, text) {
    if (!node) return;
    node.textContent = text || '';
    node.hidden = !text;
  }

  function show(tabId, panelId) {
    var tab = el(tabId);
    var panel = el(panelId);
    if (tab) tab.classList.remove('sv2-hidden');
    if (panel) {
      panel.classList.remove('sv2-hidden');
      panel.setAttribute('data-ungated', '');
    }
  }

  /** Runs a preferences change and shows the host's line, if any, in `messageNode`. */
  function apply(work, messageNode) {
    return Promise.resolve().then(work).then(function (update) {
      if (update && update.preferences) renderPreferences(update.preferences);
      setText(messageNode, update && update.message);
    }).catch(function () {
      setText(messageNode, 'That setting could not be saved. Try again.');
      load();
    });
  }

  // ── Phone ─────────────────────────────────────────────

  function renderCard(card) {
    var badge = el('sv2-phone-badge');
    var manage = el('sv2-phone-manage');
    var rows = el('sv2-phone-rows');
    if (!badge || !card) return;
    badge.setAttribute('label', card.label || 'Checking');
    badge.setAttribute('color', S.badgeColor(card.tone));
    setText(el('sv2-phone-summary'), card.summary);
    if (manage) {
      manage.hidden = !card.action;
      if (card.action) manage.label = card.action;
    }
    while (rows.firstChild) rows.removeChild(rows.firstChild);
    (card.rows || []).forEach(function (row) {
      var kv = document.createElement('lex-kv');
      kv.setAttribute('label', row.label);
      kv.setAttribute('value', row.value);
      kv.setAttribute('direction', 'horizontal');
      rows.appendChild(kv);
    });
  }

  function renderProximity(preferences) {
    var box = el('sv2-phone-proximity');
    if (!box) return;
    var rows = S.proximityRows(preferences);
    if (!box.firstChild) {
      rows.forEach(function (row, index) {
        var line = document.createElement('div');
        line.className = 'sv2-briefs-option' + (index === 0 ? ' sv2-briefs-option-first' : '');
        var copy = document.createElement('div');
        copy.className = 'sv2-briefs-option-copy';
        var name = document.createElement('span');
        name.className = 'sv2-briefs-option-name';
        name.textContent = row.title;
        var detail = document.createElement('span');
        detail.className = 'sv2-briefs-option-description';
        detail.textContent = row.detail;
        copy.appendChild(name);
        copy.appendChild(detail);
        var toggle = document.createElement('lex-toggle');
        toggle.setAttribute('name', 'briefs_' + row.key);
        toggle.setAttribute('aria-label', row.title);
        toggle.setAttribute('data-briefs-handoff', row.key);
        line.appendChild(copy);
        line.appendChild(toggle);
        box.appendChild(line);
      });
    }
    rows.forEach(function (row) {
      setChecked(box.querySelector('[data-briefs-handoff="' + row.key + '"]'), row.checked, row.disabled);
    });
  }

  function renderBackground(preferences) {
    var background = preferences.backgroundUpdates || { enabled: false, leaseHours: 8, leaseHourChoices: [] };
    setChecked(el('sv2-phone-background'), background.enabled, false);
    var lease = el('sv2-phone-lease');
    if (lease) {
      lease.options = S.leaseChoices(background);
      lease.value = String(background.leaseHours);
      // The lease matters only while background updates are on.
      var row = lease.closest('.sv2-briefs-option');
      if (row) row.hidden = !background.enabled;
    }
  }

  // ── Data controls ─────────────────────────────────────

  function renderRetention(preferences) {
    var select = el('sv2-briefs-retention');
    if (!select) return;
    select.options = S.retentionChoices(preferences.retentionDays, preferences.retentionRange);
    select.value = String(preferences.retentionDays);
  }

  function renderPreferences(preferences) {
    if (!preferences) return;
    renderProximity(preferences);
    renderBackground(preferences);
    renderRetention(preferences);
    setText(el('sv2-phone-error'), preferences.listenerError);
  }

  // ── Speech models ─────────────────────────────────────

  function renderModels(status) {
    var box = el('sv2-briefs-models');
    if (!box) return;
    var rows = S.modelRows(status);
    el('sv2-section-briefs-models').hidden = rows.length === 0;
    while (box.firstChild) box.removeChild(box.firstChild);
    rows.forEach(function (row) {
      var item = document.createElement('div');
      item.className = 'sv2-briefs-model';
      var copy = document.createElement('div');
      copy.className = 'sv2-briefs-option-copy';
      var name = document.createElement('span');
      name.className = 'sv2-briefs-option-name';
      name.textContent = row.title;
      var detail = document.createElement('span');
      detail.className = 'sv2-briefs-option-description';
      detail.textContent = row.detail;
      copy.appendChild(name);
      copy.appendChild(detail);
      if (row.progress !== null) {
        var bar = document.createElement('lex-progress-bar');
        bar.className = 'sv2-briefs-model-bar';
        bar.setAttribute('value', String(row.progress));
        bar.setAttribute('size', 'sm');
        copy.appendChild(bar);
      }
      if (row.note) {
        var note = document.createElement('span');
        note.className = 'sv2-briefs-option-description';
        note.textContent = row.note;
        copy.appendChild(note);
      }
      var side = document.createElement('div');
      side.className = 'sv2-briefs-model-side';
      var badge = document.createElement('lex-badge');
      badge.setAttribute('label', row.badge);
      badge.setAttribute('color', row.color);
      side.appendChild(badge);
      if (row.action) {
        var button = document.createElement('lex-btn');
        button.setAttribute('variant', row.action === 'download' ? 'secondary' : 'ghost');
        button.setAttribute('size', 'sm');
        if (row.action === 'download') button.setAttribute('leading-icon', 'download');
        button.setAttribute('data-briefs-model', row.id);
        button.setAttribute('data-briefs-model-action', row.action);
        button.setAttribute('label', row.actionLabel);
        side.appendChild(button);
      }
      item.appendChild(copy);
      item.appendChild(side);
      box.appendChild(item);
    });
  }

  function onModelClick(event) {
    var button = event.target.closest('[data-briefs-model]');
    if (!button || button.hasAttribute('disabled')) return;
    var id = button.getAttribute('data-briefs-model');
    var models = bridge().models;
    var work = button.getAttribute('data-briefs-model-action') === 'download' ? models.download(id) : models.remove(id);
    button.setAttribute('disabled', '');
    Promise.resolve(work).then(renderModels).catch(function () {
      button.removeAttribute('disabled');
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('LANA could not change that download. Try again.');
    });
  }

  // ── Setup ─────────────────────────────────────────────

  function load() {
    var api = bridge();
    return Promise.all([
      api.preferences.get().catch(function () { return null; }),
      api.models.status().catch(function () { return null; }),
    ]).then(function (results) {
      renderPreferences(results[0]);
      renderModels(results[1]);
    });
  }

  function wire() {
    var api = bridge();

    el('sv2-phone-manage').addEventListener('click', function () {
      phones.openPhones();
    });
    phones.subscribe(renderCard);
    phones.attach(el('sv2-section-phone'), { topbar: false, walkthrough: false });

    el('sv2-phone-proximity').addEventListener('lex-change', function (event) {
      var toggle = event.target.closest('[data-briefs-handoff]');
      if (!toggle) return;
      var patch = {};
      patch[toggle.getAttribute('data-briefs-handoff')] = Boolean(event.detail && event.detail.value);
      apply(function () { return api.preferences.setHandoff(patch); }, el('sv2-phone-error'));
    });

    el('sv2-phone-background').addEventListener('lex-change', function (event) {
      var enabled = Boolean(event.detail && event.detail.value);
      apply(function () { return api.preferences.setBackgroundUpdates({ enabled: enabled }); }, el('sv2-phone-background-message'));
    });

    el('sv2-phone-lease').addEventListener('lex-change', function (event) {
      var hours = Number(event.detail && event.detail.value);
      if (!Number.isFinite(hours)) return;
      apply(function () { return api.preferences.setBackgroundUpdates({ leaseHours: hours }); }, el('sv2-phone-background-message'));
    });

    el('sv2-briefs-retention').addEventListener('lex-change', function (event) {
      var days = Number(event.detail && event.detail.value);
      if (!Number.isFinite(days)) return;
      apply(function () { return api.preferences.setRetentionDays(days); }, el('sv2-briefs-retention-message'));
    });

    el('sv2-briefs-models').addEventListener('click', onModelClick);

    if (typeof api.onEvent === 'function') {
      api.onEvent(function (event) {
        if (!event) return;
        if (event.type === 'preferences') renderPreferences(event.preferences);
        if (event.type === 'models') renderModels(event.status);
      });
    }
  }

  function boot() {
    var api = bridge();
    if (!api || !api.preferences || !api.models || !S || !phones || !el('sv2-section-phone')) return;
    // Briefs answers only while it runs for the firm: a refusal means it is off here.
    api.preferences.get().then(function (preferences) {
      if (!preferences) return;
      show('sv2-tab-phone', 'sv2-panel-phone');
      show('sv2-tab-data-controls', 'sv2-panel-data-controls');
      var placeholder = el('sv2-section-data-controls');
      if (placeholder) placeholder.hidden = true;
      el('sv2-section-briefs-data').hidden = false;
      wire();
      renderPreferences(preferences);
      api.models.status().then(renderModels).catch(function () {});
      window.dispatchEvent(new CustomEvent('settings-v2-section-visibility-changed'));
    }).catch(function () { /* Briefs is not on for this firm: its sections stay hidden. */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
