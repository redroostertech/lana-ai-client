/**
 * LANA Briefs in the LANA client: the meetings list and the meeting pane.
 * Data comes from window.lanaBriefs (the preload bridge to the Briefs host);
 * the page only renders and adapts. Meetings refresh when Briefs says one
 * arrived or changed. No transcript text is logged.
 */
(function () {
  'use strict';

  const state = { meetings: [], query: '', selectedId: null, available: true };
  const els = {};

  function bridge() {
    return window.lanaBriefs || null;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 60) return `${total} sec`;
    const minutes = Math.round(total / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
  }

  function formatWhen(iso) {
    return window.Lex && Lex.Utils && Lex.Utils.formatDateTime ? Lex.Utils.formatDateTime(iso) : String(iso || '');
  }

  function escape(text) {
    return window.Lex && Lex.Utils ? Lex.Utils.escapeHtml(String(text == null ? '' : text)) : String(text == null ? '' : text);
  }

  function visibleMeetings() {
    const query = state.query.trim().toLowerCase();
    if (!query) return state.meetings;
    return state.meetings.filter((meeting) => String(meeting.title || '').toLowerCase().includes(query));
  }

  function renderList() {
    const meetings = visibleMeetings();
    if (state.meetings.length === 0) {
      els.list.innerHTML = '<p class="briefs-list-note">No meetings yet. Meetings from your phone show up here.</p>';
      return;
    }
    if (meetings.length === 0) {
      els.list.innerHTML = '<p class="briefs-list-note">No meetings match your search.</p>';
      return;
    }
    els.list.innerHTML = meetings.map((meeting) => {
      const selected = meeting.id === state.selectedId;
      const unread = Number(meeting.unreadActions) || 0;
      const badge = unread > 0 ? `<lex-badge variant="info" size="sm">${unread}</lex-badge>` : '';
      return `<button type="button" class="briefs-row" role="option" aria-selected="${selected}" data-meeting-id="${escape(meeting.id)}">
          <span>
            <span class="briefs-row-title">${escape(meeting.title || 'Untitled meeting')}</span>
            <span class="briefs-row-meta">${escape(formatWhen(meeting.startedAt))} · ${escape(formatDuration(meeting.durationSeconds))}</span>
          </span>
          ${badge}
        </button>`;
    }).join('');
  }

  function renderDetail() {
    const meeting = state.meetings.find((item) => item.id === state.selectedId) || null;
    els.detailEmpty.classList.toggle('hidden', meeting !== null);
    els.detailMeeting.classList.toggle('hidden', meeting === null);
    if (!meeting) return;
    els.detailWhen.textContent = formatWhen(meeting.startedAt);
    els.detailTitle.textContent = meeting.title || 'Untitled meeting';
    els.detailMeta.textContent = formatDuration(meeting.durationSeconds);
  }

  function renderAvailability() {
    byId('briefs-unavailable').classList.toggle('hidden', state.available);
    document.querySelector('.briefs-workspace').classList.toggle('hidden', !state.available);
  }

  async function loadMeetings() {
    const api = bridge();
    if (!api) {
      state.available = false;
      renderAvailability();
      return;
    }
    try {
      const result = await api.meetings.list();
      state.available = true;
      state.meetings = result && result.ok ? result.value : [];
      if (state.selectedId && !state.meetings.some((meeting) => meeting.id === state.selectedId)) state.selectedId = null;
    } catch (_) {
      // Briefs is not running (signed out, or not on for the firm).
      state.available = false;
    }
    renderAvailability();
    renderList();
    renderDetail();
  }

  function select(id) {
    state.selectedId = id;
    renderList();
    renderDetail();
  }

  function init() {
    els.list = byId('briefs-list');
    els.search = byId('briefs-search');
    els.detailEmpty = byId('briefs-detail-empty');
    els.detailMeeting = byId('briefs-detail-meeting');
    els.detailWhen = byId('briefs-detail-when');
    els.detailTitle = byId('briefs-detail-title');
    els.detailMeta = byId('briefs-detail-meta');
    if (!els.list) return;

    els.list.addEventListener('click', (event) => {
      const row = event.target.closest('[data-meeting-id]');
      if (row) select(row.dataset.meetingId);
    });
    els.search.addEventListener('lex-input', (event) => {
      state.query = (event.detail && event.detail.value) || '';
      renderList();
    });
    // The shell's Refresh reloads the list here instead of the whole page.
    document.addEventListener('lex-refresh', (event) => {
      event.preventDefault();
      loadMeetings();
    });
    const api = bridge();
    if (api && typeof api.onEvent === 'function') {
      api.onEvent((event) => {
        if (event && (event.type === 'meetingReceived' || event.type === 'meetingChanged' || event.type === 'inbox')) loadMeetings();
      });
    }
    loadMeetings();
  }

  if (window.LexRouter && typeof window.LexRouter.registerPageInit === 'function') {
    window.LexRouter.registerPageInit('briefs/index.html', init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
