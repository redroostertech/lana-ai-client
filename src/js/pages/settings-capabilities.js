/**
 * Settings > Capabilities > AI: this computer, its chat model, and what LANA set up by itself
 * (first-launch plan, section 7, phase E). Draws what settings-capabilities.model.js
 * (window.LanaCapabilities) returns and passes clicks on. Calls go to the main process through
 * window.electronAPI.firstLaunch (electron-preload.js), the same calls the first-launch screen
 * uses plus getCapabilities, getServers and switchChat. The page never sees a file path.
 *
 * The "Set up by LANA" rows use window.LanaAiRow (settings-ai-models.js). Speech and Voice come
 * from settings-briefs.js while Briefs runs; until then this file shows them from the plan.
 */
(function () {
  'use strict';

  var POLL_MS = 3000;
  var M = window.LanaCapabilities;
  var api = window.electronAPI && window.electronAPI.firstLaunch;
  var controller = null;
  var lastPlan = null;

  function el(id) { return document.getElementById(id); }
  function show(node, visible) { if (node) {node.hidden = !visible;} }
  function text(node, value) { if (node) {node.textContent = value || '';} }

  function briefsShowsSpeech() {
    var box = el('sv2-briefs-models');
    return Boolean(box && box.childElementCount);
  }

  function setBadge(node, label, tone) {
    if (!node) {return;}
    show(node, Boolean(label));
    if (!label) {return;}
    node.setAttribute('label', label);
    node.setAttribute('color', tone || 'gray');
  }

  function setButton(node, visible, disabled) {
    if (!node) {return;}
    show(node, visible);
    if (disabled) {node.setAttribute('disabled', '');}
    else {node.removeAttribute('disabled');}
  }

  function renderComputer(facts) {
    var box = el('sv2-cap-computer');
    box.innerHTML = '';
    facts.forEach(function (fact) {
      var label = document.createElement('dt');
      label.textContent = fact.label;
      var value = document.createElement('dd');
      value.textContent = fact.value;
      box.appendChild(label);
      box.appendChild(value);
    });
  }

  function renderChat(chat, state) {
    text(el('sv2-cap-chat-name'), chat.name);
    text(el('sv2-cap-chat-detail'), chat.detail);
    setBadge(el('sv2-cap-chat-badge'), chat.badge, chat.tone);
    var note = el('sv2-cap-chat-note');
    text(note, chat.note);
    show(note, Boolean(chat.note));
    var setupRunning = Boolean(state.view.progress);
    setButton(el('sv2-cap-change'), chat.canChange && !state.chooserOpen, state.busy || setupRunning);
  }

  function renderChooser(state) {
    var box = el('sv2-cap-chooser');
    show(box, state.chooserOpen);
    if (!state.chooserOpen) {return;}
    var radio = el('sv2-cap-choices');
    radio.options = state.view.choices;
    radio.value = state.selectedId || '';
    setButton(el('sv2-cap-switch'), true, !state.canSwitch);
    setButton(el('sv2-cap-cancel'), true, state.busy);
  }

  function renderProgress(progress) {
    var box = el('sv2-cap-progress');
    show(box, Boolean(progress));
    if (!progress) {return;}
    box.setAttribute('data-tone', progress.tone);
    text(el('sv2-cap-progress-heading'), progress.heading);
    text(el('sv2-cap-progress-bytes'), progress.bytes);
    var bar = el('sv2-cap-progress-bar');
    bar.setAttribute('value', String(progress.percent));
    bar.setAttribute('color', progress.tone === 'danger' ? 'danger' : 'accent');
    text(el('sv2-cap-progress-current'), progress.current);
    show(el('sv2-cap-progress-current'), Boolean(progress.current));
    var error = el('sv2-cap-progress-error');
    text(error, progress.error);
    show(error, Boolean(progress.error));
    setButton(el('sv2-cap-pause'), progress.canPause, false);
    setButton(el('sv2-cap-resume'), progress.canResume, false);
    setButton(el('sv2-cap-retry'), progress.canRetry, false);
  }

  /** The setup offer: Continue was never pressed (first-launch screen skipped or never shown). */
  function renderSetup(setup, state) {
    var box = el('sv2-cap-setup');
    show(box, Boolean(setup));
    if (!setup) {return;}
    text(el('sv2-cap-setup-text'), setup.text);
    var button = el('sv2-cap-setup-start');
    button.setAttribute('label', setup.label);
    setButton(button, true, state.busy);
  }

  function renderRows(rows) {
    var box = el('sv2-ai-local-rows');
    if (!box || !window.LanaAiRow) {return;}
    box.innerHTML = '';
    rows.forEach(function (row) { box.appendChild(window.LanaAiRow.create(row)); });
    show(el('sv2-ai-local'), true);
  }

  function render(state) {
    var section = el('sv2-cap');
    if (!state.view) {
      // Still loading, or this computer could not be read: the rest of the card stays as it is.
      show(section, false);
      return;
    }
    show(section, true);
    renderComputer(state.view.computerFacts);
    renderChat(state.view.chat, state);
    renderChooser(state);
    renderSetup(state.view.setup, state);
    renderProgress(state.view.progress);
    var notice = el('sv2-cap-notice');
    var message = state.error || state.notice;
    text(notice, message);
    notice.setAttribute('data-tone', state.error ? 'danger' : 'good');
    show(notice, Boolean(message));
    renderRows(state.view.rows);
    var plan = controller && controller.state().planView;
    if (plan && plan !== lastPlan) {
      lastPlan = plan;
      // Briefs's Speech and Voice rows take the plan's reasons when they are left out.
      window.dispatchEvent(new CustomEvent('lana-capabilities'));
    }
  }

  function wire() {
    el('sv2-cap-change').addEventListener('click', function () { controller.openChooser(); });
    el('sv2-cap-cancel').addEventListener('click', function () { controller.closeChooser(); });
    el('sv2-cap-switch').addEventListener('click', function () { controller.confirm(); });
    el('sv2-cap-choices').addEventListener('lex-change', function (event) {
      controller.select(event.detail && event.detail.value);
    });
    el('sv2-cap-pause').addEventListener('click', function () { controller.pause(); });
    el('sv2-cap-resume').addEventListener('click', function () { controller.resume(); });
    el('sv2-cap-retry').addEventListener('click', function () { controller.resume(); });
    el('sv2-cap-setup-start').addEventListener('click', function () { controller.setUp(); });
    // Where chat runs before setup finishes is said from the server's own facts, fetched once
    // by settings-ai-models.js for the Cloud group.
    window.addEventListener('lana-server-ai', function (event) { controller.setServerAi(event.detail); });
    window.addEventListener('lana-briefs-models', function () { controller.redraw(); });
    if (typeof api.onStatus === 'function') {api.onStatus(function (status) { controller.onStatus(status); });}
    document.addEventListener('lex-refresh', function () { controller.load(); });
    // Live server states while the page is open and showing.
    setInterval(function () {
      if (!document.hidden && !el('sv2-cap').hidden) {controller.refreshServers();}
    }, POLL_MS);
  }

  function boot() {
    if (!M || !api || typeof api.getCapabilities !== 'function' || !el('sv2-cap')) {return;}
    controller = M.createCapabilitiesController({ api: api, render: render, includeSpeech: function () { return !briefsShowsSpeech(); } });
    wire();
    if (window.LanaAiRow && typeof window.LanaAiRow.serverAi === 'function') {controller.setServerAi(window.LanaAiRow.serverAi());}
    controller.load();
  }

  /** The plan, for settings-briefs.js (the reasons speech or voice is left out). */
  window.LanaCapabilitiesPage = {
    plan: function () {
      var planView = controller && controller.state().planView;
      return planView ? planView.plan : null;
    }
  };

  if (document.readyState === 'loading') {document.addEventListener('DOMContentLoaded', boot);}
  else {boot();}
})();
