/**
 * LANA Briefs Dashboard: the dashboard Briefs opens on. A banner (New meeting, the
 * walkthrough), a live recording strip, the last seven days, actions waiting for the
 * person, recent meetings, and the phone's status. Data comes from window.lanaBriefs;
 * the rules are in src/js/briefs/briefs-dashboard.js. Nothing here logs titles or names.
 */
(function () {
  'use strict';

  const H = window.BriefsDashboard;
  const M = window.BriefsMeeting;
  const R = window.BriefsRecording;
  const Phones = window.BriefsPhonesUI;

  const els = {};
  let globalsBound = false;
  let unsubscribe = null;
  let loadToken = 0;

  function bridge() {
    return window.lanaBriefs || null;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function escape(text) {
    return Lex.Utils.escapeHtml(String(text == null ? '' : text));
  }

  function icon(name) {
    return Lex.Icons && Lex.Icons.has(name) ? String(Lex.Icons[name].small) : '';
  }

  function onPage() {
    return Boolean(els.body && document.contains(els.body));
  }

  /** Opens a Briefs page in the shell without a full reload. */
  function go(route) {
    if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') Lex.Nav.go(route);
    else window.location.href = route.replace(/^briefs\//, './');
  }

  // ── Load ──────────────────────────────────────────────

  async function load() {
    const api = bridge();
    if (!api) {
      showAvailable(false);
      return;
    }
    const token = ++loadToken;
    const settle = (work) => Promise.resolve().then(work).catch(() => null);
    const [meetings, actions, recording] = await Promise.all([
      settle(() => api.meetings.list()),
      settle(() => api.inbox.list()),
      settle(() => api.recording.state()),
    ]);
    if (token !== loadToken || !onPage()) return;
    if (!meetings || !meetings.ok) {
      showAvailable(false);
      return;
    }
    showAvailable(true);
    render(meetings.value, actions && actions.ok ? actions.value : [], recording);
  }

  function showAvailable(available) {
    els.unavailable.classList.toggle('hidden', available);
    els.body.classList.toggle('hidden', !available);
  }

  // ── Render ────────────────────────────────────────────

  function render(meetings, actions, recording) {
    const stats = H.weekStats(meetings, actions, Date.now());
    els.banner.setAttribute('subtitle', H.bannerSubtitle(stats, meetings.length));
    renderLive(recording);
    els.metricMeetings.setAttribute('value', String(stats.meetings));
    els.metricRecorded.setAttribute('value', H.recordedText(stats.minutes));
    els.metricWaiting.setAttribute('value', String(stats.waiting));
    els.metricWaiting.setAttribute('status', stats.waiting > 0 ? 'yellow' : 'gray');
    els.metricOpen.setAttribute('value', String(stats.openItems));
    renderAttention(H.attention(actions));
    renderRecent(H.recentMeetings(meetings), meetings.length);
  }

  /** A recording under way or being written up: a strip that opens it. */
  function renderLive(view) {
    const live = R.isLive(view);
    const writing = R.isProcessing(view);
    els.live.classList.toggle('hidden', !live && !writing);
    if (!live && !writing) return;
    els.live.classList.toggle('is-writing', writing);
    els.liveTitle.textContent = live ? `Recording now: ${view.title || 'New meeting'}` : `Writing notes: ${view.title || 'New meeting'}`;
    els.liveDetail.textContent = live ? `${M.clock(view.elapsedSeconds)} recorded` : 'LANA is transcribing and writing the notes.';
  }

  function renderAttention(items) {
    if (items.length === 0) {
      els.attention.innerHTML = `<li class="briefs-dashboard-empty">${icon('check')}<span>Nothing is waiting. Actions LANA drafts from your meetings appear here for you to confirm.</span></li>`;
      return;
    }
    els.attention.innerHTML = items.map((item, index) => `<li class="lex-entrance lex-entrance-step-${Math.min(index + 1, 5)}">
        <button type="button" class="briefs-dashboard-row" data-action-id="${escape(item.id)}">
          <span class="briefs-dashboard-row-icon is-${item.tone}" aria-hidden="true">${icon(item.kind === 'email' ? 'mail' : item.kind === 'task' ? 'list-checks' : 'file-text')}</span>
          <span class="briefs-dashboard-row-text">
            <span class="briefs-dashboard-row-title">${escape(item.title)}</span>
            <span class="briefs-dashboard-row-detail">${escape(item.kindText)} for ${escape(item.destination)}. From ${escape(item.meetingTitle || 'a meeting')}.</span>
          </span>
          <span class="briefs-dashboard-pill is-${item.tone}">${escape(item.statusText)}</span>
        </button>
      </li>`).join('');
  }

  function renderRecent(items, total) {
    if (total === 0) {
      els.recent.innerHTML = `<li class="briefs-dashboard-empty is-large">
          <lex-brand-mark animation="idle" size="96"></lex-brand-mark>
          <span>No meetings yet. Record one here with New meeting, or send one from LANA Briefs on your phone.</span>
        </li>`;
      return;
    }
    const now = Date.now();
    els.recent.innerHTML = items.map((meeting, index) => {
      const unread = Number(meeting.unreadActions) || 0;
      const open = Number(meeting.openIntents) || 0;
      const facts = [M.duration(meeting.durationSeconds), M.attestationText(meeting.attestationMethod)].filter(Boolean).join('. ');
      return `<li class="lex-entrance lex-entrance-step-${Math.min(index + 1, 5)}">
          <button type="button" class="briefs-dashboard-row" data-meeting="${escape(meeting.id)}">
            <span class="briefs-dashboard-row-icon" aria-hidden="true">${icon('file-text')}</span>
            <span class="briefs-dashboard-row-text">
              <span class="briefs-dashboard-row-title">${escape(meeting.title || 'Untitled meeting')}</span>
              <span class="briefs-dashboard-row-detail">${escape(H.whenText(meeting.startedAt, now))}. ${escape(facts)}.</span>
            </span>
            ${open > 0 ? `<span class="briefs-dashboard-pill">${open} open</span>` : ''}
            ${unread > 0 ? `<span class="briefs-dashboard-count" aria-label="${unread} unread actions">${unread}</span>` : ''}
          </button>
        </li>`;
    }).join('');
  }

  /** The phone panel mirrors the top bar's status card. */
  function renderPhone(card) {
    if (!onPage()) return;
    const rows = card.rows.map((row) => `<dt>${escape(row.label)}</dt><dd>${escape(row.value)}</dd>`).join('');
    els.phoneBody.innerHTML = `
      <p class="briefs-dashboard-phone-status is-${card.tone}"><span class="briefs-dashboard-phone-icon">${icon(card.icon)}</span>${escape(card.label)}</p>
      <p class="briefs-dashboard-phone-summary">${escape(card.summary)}</p>
      ${rows ? `<dl class="briefs-dashboard-phone-rows">${rows}</dl>` : ''}
      ${card.action ? `<lex-btn variant="${card.action === 'Pair a phone' ? 'primary' : 'secondary'}" size="sm" leading-icon="smartphone" data-dashboard="phones">${escape(card.action)}</lex-btn>` : ''}`;
    els.banner.setAttribute('status', card.tone === 'good' ? 'connected' : 'warning');
  }

  // ── Events ────────────────────────────────────────────

  function onClick(event) {
    const target = event.target;
    const action = target.closest('[data-action-id]');
    if (action) {
      // Review it, pick the matter, confirm: nothing reaches LANA before that.
      window.BriefsActionUI.open(action.dataset.actionId, load);
      return;
    }
    const meeting = target.closest('[data-meeting]');
    if (meeting) {
      go(`briefs/index.html?meeting=${encodeURIComponent(meeting.dataset.meeting)}`);
      return;
    }
    const control = target.closest('[data-dashboard]');
    if (!control) return;
    const what = control.dataset.dashboard;
    if (what === 'new' || what === 'live') {
      event.preventDefault();
      go('briefs/index.html?new=1');
    } else if (what === 'walkthrough') {
      Phones.showWalkthrough();
    } else if (what === 'phones') {
      Phones.openPhones();
    }
  }

  function onBriefsEvent(event) {
    if (!event || !onPage()) return;
    if (event.type === 'recording') renderLive(event.view);
    if (['meetingReceived', 'meetingChanged', 'inbox', 'recordsChanged'].includes(event.type)) load();
    if (event.type === 'recording' && event.view && event.view.phase === 'done') load();
  }

  function init() {
    els.body = document.querySelector('.briefs-dashboard-body');
    if (!els.body) return;
    els.unavailable = byId('briefs-unavailable');
    els.banner = byId('briefs-dashboard-banner');
    els.live = byId('briefs-dashboard-live');
    els.liveTitle = byId('briefs-dashboard-live-title');
    els.liveDetail = byId('briefs-dashboard-live-detail');
    els.metricMeetings = byId('briefs-dashboard-metric-meetings');
    els.metricRecorded = byId('briefs-dashboard-metric-recorded');
    els.metricWaiting = byId('briefs-dashboard-metric-waiting');
    els.metricOpen = byId('briefs-dashboard-metric-open');
    els.attention = byId('briefs-dashboard-attention');
    els.recent = byId('briefs-dashboard-recent');
    els.phoneBody = byId('briefs-dashboard-phone-body');
    document.querySelector('.briefs-dashboard').addEventListener('click', onClick);
    if (unsubscribe) unsubscribe();
    unsubscribe = Phones.subscribe(renderPhone);
    if (!globalsBound) {
      globalsBound = true;
      const api = bridge();
      if (api && typeof api.onEvent === 'function') api.onEvent(onBriefsEvent);
      // The shell's Refresh reloads the Dashboard in place.
      document.addEventListener('lex-refresh', (event) => {
        if (!onPage()) return;
        event.preventDefault();
        load();
        Phones.refresh();
      });
    }
    Phones.attach(document.querySelector('.briefs-dashboard'));
    window.BriefsActionUI.attach(document.querySelector('.briefs-dashboard'));
    load();
  }

  if (window.LexRouter && typeof window.LexRouter.registerPageInit === 'function') {
    window.LexRouter.registerPageInit('briefs/dashboard.html', init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
