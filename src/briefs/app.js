/**
 * LANA Briefs in the LANA client: the meetings list and the meeting page.
 *
 * Data comes from window.lanaBriefs (the preload bridge to the Briefs host); the rules
 * (picking lines, clips, the audio timeline) live in src/js/briefs/briefs-meeting.js and
 * the audio player in src/js/briefs/briefs-replay.js. This file renders and wires events.
 * Every edit (title, speaker names, lines, clips, drafts) goes through the shared record,
 * so it syncs to the phone. Nothing here logs transcript text, names or notes.
 */
(function () {
  'use strict';

  const M = window.BriefsMeeting;
  const S = M.selection;
  const R = window.BriefsRecording;
  const B = window.BriefsShare;
  /** How copy names this device (platform neutral). */
  const DEVICE_NOUN = 'computer';

  const KIND_ORDER = ['summary', 'decision', 'openQuestion'];
  const GROUP_TITLE = { summary: 'Key points', decision: 'Decisions', openQuestion: 'Open questions' };
  const CLIP_ACTIONS = {
    highlight: { icon: 'highlighter', title: 'Highlight', hint: 'Save these lines as a clip' },
    unhighlight: { icon: 'trash-2', title: 'Unhighlight', hint: 'Remove this clip' },
    note: { icon: 'file-text', title: 'Note', hint: 'Add a note on these lines' },
    action: { icon: 'list-checks', title: 'Action', hint: 'LANA drafts an action from these lines' },
    decision: { icon: 'scale', title: 'Decision', hint: 'LANA drafts a decision from these lines' },
    correct: { icon: 'edit-3', title: 'Correct line', hint: 'Correct this line in place' },
    play: { icon: 'play', title: 'Play', hint: 'Play these lines' },
  };

  const state = {
    meetings: [],
    selectedId: null,
    available: true,
    record: null,
    drafts: [],
    asked: new Set(),
    selection: null,
    drafting: null,
    correcting: null,
    editingTitle: false,
    editingSpeaker: null,
    selectedPoint: null,
    panel: 'keyPoints',
    followAlong: true,
    current: null,
    loadToken: 0,
    // The person's notes on the open meeting (saved through the shared record).
    notes: [],
    notesDirty: false,
    noteSave: 'idle',
    openNoteId: null,
    // The meeting as a record shared with the phone: paired phones and Needs review.
    shared: null,
    shareOpen: false,
    shareNotice: null,
    mergeEdit: null,
    // New meeting (record here or import a recording).
    mode: 'meeting',
    recording: null,
    models: null,
    permissions: null,
    form: { title: '', consent: 'announced', people: '', jurisdiction: '', confirmed: false },
    levels: { mic: [], meeting: [] },
    scratch: [],
    draft: '',
    busy: false,
    newError: null,
  };
  const els = {};
  let player = null;
  let drag = null;
  let noteTimer = null;
  /** Edits save about a second after typing stops. */
  const NOTE_SAVE_MS = 1000;
  /** Window listeners and the bridge subscription outlive a page visit: bound once. */
  let globalsBound = false;

  // ── Helpers ───────────────────────────────────────────

  /** The page is on screen (the shell swaps pages in place). */
  function onPage() {
    return Boolean(els.list && document.contains(els.list));
  }

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

  function speakerName(id) {
    if (!id) return 'Several speakers';
    const speaker = (state.record.speakers || []).find((item) => item.id === id);
    return speaker ? speaker.name : id;
  }

  function showError(message) {
    els.error.textContent = message || '';
    els.error.classList.toggle('hidden', !message);
  }

  /** The value, or null with the error shown above the transcript. */
  function outcome(result) {
    if (result && result.ok) {
      showError(null);
      return result.value;
    }
    showError((result && result.error && result.error.message) || 'That did not work. Try again.');
    return null;
  }

  async function call(fn) {
    try {
      return outcome(await fn());
    } catch (_) {
      return outcome(null);
    }
  }

  // ── Meetings (listed in the sidebar by lex-app) ───────

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
    } catch (_) {
      // Briefs is not running (signed out, or not on for the firm).
      state.available = false;
    }
    if (state.selectedId && !state.meetings.some((meeting) => meeting.id === state.selectedId)) closeMeeting();
    renderAvailability();
    els.detailEmpty.setAttribute('message', state.meetings.length === 0 ? 'No meetings yet' : 'Choose a meeting');
    // Open the meeting the sidebar link named, or the newest one.
    if (state.mode === 'meeting' && state.selectedId === null && state.meetings.length > 0) {
      const wanted = new URLSearchParams(window.location.search).get('meeting');
      const found = state.meetings.find((meeting) => meeting.id === wanted);
      select((found || state.meetings[0]).id);
    }
  }

  // ── Meeting ───────────────────────────────────────────

  function closeMeeting() {
    state.selectedId = null;
    state.record = null;
    if (player) player.close();
    player = null;
    els.detailEmpty.classList.remove('hidden');
    els.detailMeeting.classList.add('hidden');
  }

  function resetMeetingState() {
    state.selection = null;
    state.drafting = null;
    state.correcting = null;
    state.editingTitle = false;
    state.editingSpeaker = null;
    state.selectedPoint = null;
    state.asked = new Set();
    state.drafts = [];
    state.current = null;
    state.shared = null;
    state.mergeEdit = null;
    closeShare(false);
  }

  /** Loads the meeting. `refresh` keeps the page state (a change from the phone or an edit). */
  async function loadMeeting(id, refresh) {
    const api = bridge();
    const token = ++state.loadToken;
    let result;
    try {
      result = await api.meetings.get(id);
    } catch (_) {
      result = null;
    }
    if (token !== state.loadToken || state.selectedId !== id) return;
    if (!result || !result.ok) {
      if (!refresh) closeMeeting();
      return;
    }
    const opening = !refresh || state.record === null;
    state.record = result.value;
    takeSavedNotes(opening);
    if (opening) {
      resetMeetingState();
      if (player) player.close();
      player = new window.BriefsReplay(api, state.record.durationSeconds);
      player.subscribe(onPlayback);
      player.open(id, state.record.hasAudio);
    } else if (state.selection && S.last(state.selection) >= state.record.transcript.length) {
      state.selection = null;
    }
    loadDrafts(id);
    loadShared(id);
    els.detailEmpty.classList.add('hidden');
    els.detailMeeting.classList.remove('hidden');
    renderMeeting();
  }

  async function loadDrafts(id) {
    try {
      const result = await bridge().records.drafts(id);
      if (result && result.ok && state.selectedId === id) {
        state.drafts = result.value;
        renderSide();
      }
    } catch (_) {
      // Drafts show once the host answers.
    }
  }

  function select(id) {
    if (state.mode === 'new') leaveNew();
    if (id === state.selectedId) return;
    flushNotes();
    closeNoteEditor(false);
    state.selectedId = id;
    state.record = null;
    markSidebar(id);
    loadMeeting(id, false);
  }

  /** Marks the meeting in the sidebar and in the address, so a reload opens it again. */
  function markSidebar(id) {
    const shell = document.querySelector('lex-app');
    if (shell) shell.activeNavId = `briefs-meeting-${id}`;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('new');
      url.searchParams.set('meeting', id);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch (_) {
      // The address stays as it was.
    }
  }

  /** A meeting picked in the sidebar opens here without reloading the page. */
  function onSidebarNav(event) {
    const id = event.detail && event.detail.id;
    if (!onPage() || typeof id !== 'string') return;
    if (id === 'briefs-new') {
      event.stopImmediatePropagation();
      showNew();
      return;
    }
    if (id.indexOf('briefs-meeting-') !== 0) return;
    event.stopImmediatePropagation();
    const meetingID = id.slice('briefs-meeting-'.length);
    if (state.meetings.some((meeting) => meeting.id === meetingID)) select(meetingID);
  }

  function renderMeeting() {
    renderHeader();
    renderShare();
    renderReview();
    renderReplay();
    renderTranscript();
    renderClipBar();
    renderSide();
  }

  function renderHeader() {
    const record = state.record;
    els.when.textContent = Lex.Utils.formatDateTime(record.startedAt);
    els.facts.textContent = M.facts(record);
    if (state.editingTitle) {
      els.title.innerHTML = inlineEdit(record.title, 'Meeting title', 'title', false);
      focusInlineEdit(els.title);
    } else {
      els.title.innerHTML = `<button type="button" class="briefs-editable briefs-title-button" data-edit-title title="Rename this meeting">${escape(record.title || 'Untitled meeting')}</button>`;
    }
  }

  // ── Share (Send to phone) and Needs review ────────────
  // The shared record (records.state) lists the paired phones and the changes both the
  // phone and this computer made to the same thing. The rules are in briefs-share.js.

  async function loadShared(id) {
    let result;
    try {
      result = await bridge().records.state(id);
    } catch (_) {
      result = null;
    }
    if (state.selectedId !== id) return;
    if (result && result.ok) {
      state.shared = result.value;
      if (state.mergeEdit && !state.shared.conflicts.some((item) => item.unit === state.mergeEdit.unit)) state.mergeEdit = null;
    }
    renderShare();
    renderReview();
  }

  function renderShare() {
    const view = state.shared;
    els.share.classList.toggle('hidden', view === null);
    const toggle = els.shareButton.querySelector('button');
    if (toggle) {
      toggle.setAttribute('aria-haspopup', 'dialog');
      toggle.setAttribute('aria-expanded', String(state.shareOpen));
      toggle.setAttribute('aria-controls', 'briefs-share-popover');
    }
    els.sharePopover.classList.toggle('hidden', view === null || !state.shareOpen);
    if (view === null || !state.shareOpen) {
      els.sharePopover.innerHTML = '';
      return;
    }
    const rows = view.phones.length === 0
      ? '<p class="briefs-share-empty">No phone paired yet. Pair one in LANA Briefs on your phone.</p>'
      : `<ul class="briefs-share-rows">${view.phones.map((phone) => phoneRowHtml(phone)).join('')}</ul>`;
    const footnote = B.shareFootnote(view.phones);
    const notice = state.shareNotice;
    els.sharePopover.innerHTML = `
      <section class="briefs-share-section" aria-labelledby="briefs-share-heading">
        <h3 id="briefs-share-heading" class="briefs-overline">Phones</h3>
        ${rows}
        ${footnote === null ? '' : `<p class="briefs-share-note">${escape(footnote)}</p>`}
        ${notice === null ? '' : `<p class="briefs-share-note${notice.tone === 'quiet' ? '' : ` is-${notice.tone}`}" role="status">${escape(notice.text)}</p>`}
      </section>`;
  }

  function phoneRowHtml(phone) {
    const row = B.phoneRow(phone);
    let control;
    if (row.action === 'send') {
      control = `<lex-btn variant="secondary" size="sm" data-share-item data-share-send="${escape(phone.id)}">Send</lex-btn>`;
    } else if (row.action === 'cancel') {
      control = `<lex-btn variant="ghost" size="sm" data-share-item data-share-cancel="${escape(phone.id)}">Cancel send</lex-btn>`;
    } else {
      control = `<span class="briefs-share-sent" tabindex="-1" data-share-item aria-label="Sent to ${escape(row.title)}. ${escape(row.status)}">${icon('check')}Sent</span>`;
    }
    return `<li class="briefs-share-row" data-share-row="${escape(phone.id)}">
        <span class="briefs-share-phone" aria-hidden="true">${icon('smartphone')}</span>
        <span class="briefs-share-text"><span class="briefs-share-name">${escape(row.title)}</span><span class="briefs-share-status">${escape(row.status)}</span></span>
        ${control}
      </li>`;
  }

  /** A lex-btn draws its own <button>: focus goes there. */
  function focusControl(node) {
    if (!node) return;
    const inner = node.querySelector && node.querySelector('button');
    (inner || node).focus();
  }

  function shareItems() {
    return Array.from(els.sharePopover.querySelectorAll('[data-share-item]'));
  }

  function openShare() {
    state.shareOpen = true;
    state.shareNotice = null;
    renderShare();
    focusControl(shareItems()[0]);
  }

  function closeShare(refocus) {
    if (!state.shareOpen) return;
    state.shareOpen = false;
    state.shareNotice = null;
    if (els.share) renderShare();
    if (refocus && els.shareButton) focusControl(els.shareButton);
  }

  /** Send and Cancel send swap the row's control: focus stays on the row. */
  function refocusRow(phoneID) {
    focusControl(els.sharePopover.querySelector(`[data-share-row="${CSS.escape(phoneID)}"] [data-share-item]`));
  }

  async function sendToPhone(phoneID) {
    const id = state.selectedId;
    state.shareNotice = null;
    let result;
    try {
      result = await bridge().records.sendToPhone(id, phoneID);
    } catch (_) {
      result = null;
    }
    if (state.selectedId !== id) return;
    if (result && result.ok) state.shared = result.value;
    else state.shareNotice = { text: (result && result.error && result.error.message) || 'LANA could not send it. Try again.', tone: 'error' };
    renderShare();
    refocusRow(phoneID);
  }

  async function cancelSend(phoneID) {
    const id = state.selectedId;
    state.shareNotice = null;
    let result;
    try {
      result = await bridge().records.cancelSend(id, phoneID);
    } catch (_) {
      result = null;
    }
    if (state.selectedId !== id) return;
    if (!result || !result.ok) {
      state.shareNotice = { text: (result && result.error && result.error.message) || 'LANA could not cancel it. Try again.', tone: 'error' };
    } else {
      state.shared = result.value.record;
      const updated = state.shared.phones.find((item) => item.id === phoneID);
      state.shareNotice = updated ? B.cancelSendNotice(result.value.status, updated) : null;
    }
    renderShare();
    refocusRow(phoneID);
  }

  function onShareKey(event) {
    if (!state.shareOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeShare(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const list = shareItems();
    if (list.length === 0) return;
    event.preventDefault();
    const at = list.indexOf(document.activeElement && document.activeElement.closest('[data-share-item]'));
    const step = event.key === 'ArrowDown' ? 1 : -1;
    focusControl(list[(at + step + list.length) % list.length]);
  }

  function renderReview() {
    const view = state.shared;
    const conflicts = view ? view.conflicts : [];
    els.review.classList.toggle('hidden', conflicts.length === 0);
    if (conflicts.length === 0) {
      els.review.innerHTML = '';
      return;
    }
    els.review.innerHTML = `
      <p class="briefs-overline briefs-review-overline">Needs review</p>
      <p class="briefs-review-lead">${escape(B.reviewLead(conflicts.length, DEVICE_NOUN))}</p>
      ${conflicts.map((conflict) => conflictHtml(conflict)).join('')}`;
    const field = els.review.querySelector('[data-merge-field]');
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }

  function conflictHtml(conflict) {
    const unit = escape(conflict.unit);
    const editing = state.mergeEdit !== null && state.mergeEdit.unit === conflict.unit;
    const choices = editing
      ? `<div class="briefs-review-edit">
          <textarea class="briefs-review-field" rows="2" data-merge-field aria-label="Merged version">${escape(state.mergeEdit.text)}</textarea>
          <div class="briefs-review-choices">
            <lex-btn variant="primary" size="sm" data-merge-keep="${unit}" ${state.mergeEdit.text.trim() === '' ? 'disabled' : ''}>Keep this</lex-btn>
            <lex-btn variant="ghost" size="sm" data-merge-cancel>Cancel</lex-btn>
          </div>
        </div>`
      : `<div class="briefs-review-choices">
          <lex-btn variant="secondary" size="sm" data-resolve="${unit}" data-choice="phone" ${conflict.phoneAllowed ? '' : 'disabled'}>Keep your phone's</lex-btn>
          <lex-btn variant="secondary" size="sm" data-resolve="${unit}" data-choice="desktop">Keep this ${DEVICE_NOUN}'s</lex-btn>
          ${conflict.editable ? `<lex-btn variant="ghost" size="sm" leading-icon="edit-3" data-merge-edit="${unit}">Edit</lex-btn>` : ''}
        </div>`;
    return `<div class="briefs-review-conflict">
        <span class="briefs-review-label">${escape(conflict.label)}</span>
        <div class="briefs-review-versions">
          <div class="briefs-review-version"><p class="briefs-overline">On your phone</p><p class="briefs-review-text">${escape(B.versionText(conflict.phone))}</p></div>
          <div class="briefs-review-version"><p class="briefs-overline">On this ${DEVICE_NOUN}</p><p class="briefs-review-text">${escape(B.versionText(conflict.desktop))}</p></div>
        </div>
        ${choices}
        ${conflict.phoneAllowed ? '' : `<p class="briefs-review-hint">This action already ran or was dismissed on this ${DEVICE_NOUN}, so only this version can be kept.</p>`}
      </div>`;
  }

  /** Keeps one version (or a merged edit). The choice syncs to the phone. */
  async function resolveConflict(unit, choice) {
    const id = state.selectedId;
    state.mergeEdit = null;
    const view = await call(() => bridge().records.resolve(id, unit, choice));
    if (state.selectedId !== id) return;
    if (view !== null) {
      state.shared = view;
      // The kept version changes the meeting itself (a title, a line, a note).
      loadMeeting(id, true);
    }
    renderReview();
  }

  /** Clicks in the Share popover and Needs review. True when handled. */
  function onShareOrReviewClick(target) {
    if (target.closest('#briefs-share-button')) {
      if (state.shareOpen) closeShare(false);
      else openShare();
      return true;
    }
    const send = target.closest('[data-share-send]');
    if (send) {
      sendToPhone(send.dataset.shareSend);
      return true;
    }
    const cancel = target.closest('[data-share-cancel]');
    if (cancel) {
      cancelSend(cancel.dataset.shareCancel);
      return true;
    }
    if (target.closest('.briefs-share-popover')) return true;
    const resolve = target.closest('[data-resolve]');
    if (resolve) {
      if (!resolve.hasAttribute('disabled')) resolveConflict(resolve.dataset.resolve, { kind: resolve.dataset.choice });
      return true;
    }
    const edit = target.closest('[data-merge-edit]');
    if (edit) {
      const conflict = state.shared.conflicts.find((item) => item.unit === edit.dataset.mergeEdit);
      if (conflict) {
        state.mergeEdit = { unit: conflict.unit, text: B.mergeStart(conflict) };
        renderReview();
      }
      return true;
    }
    const keep = target.closest('[data-merge-keep]');
    if (keep) {
      if (state.mergeEdit && state.mergeEdit.text.trim() !== '') resolveConflict(state.mergeEdit.unit, { kind: 'edited', text: state.mergeEdit.text });
      return true;
    }
    if (target.closest('[data-merge-cancel]')) {
      state.mergeEdit = null;
      renderReview();
      return true;
    }
    return target.closest('#briefs-review') !== null;
  }

  function bindReview() {
    els.review.addEventListener('input', (event) => {
      if (!event.target.matches('[data-merge-field]') || state.mergeEdit === null) return;
      state.mergeEdit.text = event.target.value;
      const keep = els.review.querySelector('[data-merge-keep]');
      if (keep) setDisabled(keep, state.mergeEdit.text.trim() === '');
    });
    els.review.addEventListener('keydown', (event) => {
      if (!event.target.matches('[data-merge-field]')) return;
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        state.mergeEdit = null;
        renderReview();
      } else if (event.key === 'Enter' && !event.shiftKey && state.mergeEdit && state.mergeEdit.text.trim() !== '') {
        event.preventDefault();
        resolveConflict(state.mergeEdit.unit, { kind: 'edited', text: state.mergeEdit.text });
      }
    });
    els.sharePopover.addEventListener('keydown', onShareKey);
    els.shareButton.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.shareOpen) {
        event.preventDefault();
        closeShare(true);
      }
    });
  }

  // ── Inline edit ───────────────────────────────────────

  function inlineEdit(value, label, kind, multiline) {
    const field = multiline
      ? `<textarea class="briefs-inline-field" rows="2" aria-label="${escape(label)}">${escape(value)}</textarea>`
      : `<input class="briefs-inline-field" type="text" aria-label="${escape(label)}" value="${escape(value)}">`;
    return `<span class="briefs-inline" data-inline="${kind}" data-original="${escape(value)}">${field}
        <button type="button" class="briefs-icon-btn" data-inline-save aria-label="Save">${icon('check')}</button>
        <button type="button" class="briefs-icon-btn" data-inline-cancel aria-label="Cancel">${icon('x')}</button>
      </span>`;
  }

  function focusInlineEdit(container) {
    const field = container.querySelector('.briefs-inline-field');
    if (field) {
      field.focus();
      field.select();
    }
  }

  /** Saves or cancels the inline edit holding `node`. Empty or unchanged saves nothing. */
  function finishInline(node, save) {
    const box = node.closest('[data-inline]');
    if (!box) return;
    const kind = box.dataset.inline;
    const field = box.querySelector('.briefs-inline-field');
    const text = save ? field.value.trim() : '';
    const changed = save && text !== '' && text !== box.dataset.original.trim();
    const id = state.selectedId;
    if (kind === 'title') {
      state.editingTitle = false;
      if (changed) {
        state.record.title = text;
        call(() => bridge().records.rename(id, text));
      }
      renderHeader();
    } else if (kind === 'speaker') {
      const speakerID = box.dataset.speaker;
      state.editingSpeaker = null;
      if (changed) {
        const speaker = state.record.speakers.find((item) => item.id === speakerID);
        if (speaker) speaker.name = text;
        call(() => bridge().records.renameSpeaker(id, speakerID, text));
      }
      renderTranscript();
      els.facts.textContent = M.facts(state.record);
    } else if (kind === 'line') {
      const index = state.correcting;
      state.correcting = null;
      if (changed && state.record.transcript[index]) {
        state.record.transcript[index].text = text;
        call(() => bridge().records.correctLine(id, index, text));
      }
      renderTranscript();
    }
  }

  // ── Replay bar ────────────────────────────────────────

  function blockedReason(snapshot) {
    switch (snapshot.state) {
      case 'ready': return null;
      case 'noAudio': return 'The audio was removed by the retention setting. The transcript stays.';
      case 'unavailable': return 'LANA could not open this meeting\'s audio.';
      default: return 'Opening the audio';
    }
  }

  function renderReplay() {
    els.replay.innerHTML = `
      <div class="briefs-replay-controls">
        <button type="button" class="briefs-replay-play" data-replay="toggle"></button>
        <button type="button" class="briefs-icon-btn" data-replay="back" aria-label="Back ${M.SKIP_SECONDS} seconds" title="Back ${M.SKIP_SECONDS} seconds">${icon('rotate-ccw')}</button>
        <button type="button" class="briefs-icon-btn" data-replay="forward" aria-label="Forward ${M.SKIP_SECONDS} seconds" title="Forward ${M.SKIP_SECONDS} seconds">${icon('redo-2')}</button>
        <span class="briefs-replay-time"></span>
        <span class="briefs-replay-status"></span>
        <span class="briefs-replay-spacer"></span>
        <button type="button" class="briefs-replay-chip" data-replay="speed"></button>
        <button type="button" class="briefs-replay-chip" data-replay="follow" title="Keep the spoken line in view while playing">${icon('check')}Follow</button>
      </div>
      <div class="briefs-track" role="slider" tabindex="0" aria-label="Timeline" aria-valuemin="0">
        <div class="briefs-track-lane briefs-track-above"></div>
        <div class="briefs-track-line"><span class="briefs-track-knob"></span></div>
        <div class="briefs-track-lane briefs-track-below"></div>
      </div>
      <ul class="briefs-legend" aria-label="Timeline key">
        <li><span class="briefs-swatch is-summary"></span>Key point</li>
        <li><span class="briefs-swatch is-decision"></span>Decision</li>
        <li><span class="briefs-swatch is-openQuestion"></span>Open question</li>
        ${state.record.keyPoints.some((point) => point.precision === 'approximate') ? '<li><span class="briefs-swatch is-summary is-soft"></span>Approximate</li>' : ''}
        <li><span class="briefs-swatch is-note"></span>Your note</li>
        <li><span class="briefs-swatch is-action"></span>Action</li>
        <li><span class="briefs-swatch is-clip is-soft"></span>Clip</li>
      </ul>`;
    renderTicks();
    onPlayback(player ? player.snapshot : null);
  }

  function trackTotal(snapshot) {
    return Math.max(snapshot ? snapshot.duration : 0, state.record.durationSeconds || 0, 1);
  }

  /** Places a tick on the track. Position is data, set as a custom property. */
  function tick(lane, className, start, end, total, label) {
    const node = document.createElement('span');
    node.className = className;
    node.title = label;
    node.style.setProperty('--at', `${(start / total) * 100}%`);
    if (end > start) node.style.setProperty('--span', `${((end - start) / total) * 100}%`);
    lane.appendChild(node);
  }

  function renderTicks() {
    const record = state.record;
    const total = trackTotal(player && player.snapshot);
    const above = els.replay.querySelector('.briefs-track-above');
    const below = els.replay.querySelector('.briefs-track-below');
    above.innerHTML = '';
    below.innerHTML = '';
    record.keyPoints.forEach((point) => {
      point.sources.forEach((span) => {
        const kind = `briefs-tick is-${point.kind}`;
        if (point.precision === 'approximate') tick(above, `${kind} is-range is-soft`, span.start, span.end, total, point.text);
        else tick(above, kind, span.start, span.start, total, `${point.text} (${speakerName(span.speaker)} ${M.clock(span.start)})`);
      });
    });
    state.notes.filter((note) => note.anchor !== null && note.text.trim() !== '').forEach((note) => tick(below, 'briefs-tick is-note', note.anchor, note.anchor, total, 'Your note'));
    (record.actions || []).forEach((action) => tick(below, 'briefs-tick is-action', action.at, action.at, total, action.title || 'Action'));
    record.clips.forEach((clip) => tick(below, 'briefs-tick is-clip is-range', clip.start, clip.end, total, `Clip ${M.clock(clip.start)} to ${M.clock(clip.end)}`));
    const span = selectionSpan();
    if (span) tick(below, 'briefs-tick is-selected is-range', span.start, span.end, total, 'The lines you picked');
  }

  /** Updates what changes while audio plays: controls, the playhead, the spoken turn. */
  function onPlayback(snapshot) {
    if (!onPage()) {
      // Left the page while the audio played.
      if (player) player.close();
      player = null;
      return;
    }
    if (!state.record || !snapshot) return;
    const blocked = blockedReason(snapshot);
    const ready = blocked === null;
    const total = trackTotal(snapshot);
    const position = Math.min(snapshot.position, total);
    const play = els.replay.querySelector('[data-replay="toggle"]');
    if (!play) return;
    play.innerHTML = icon(snapshot.isPlaying ? 'pause' : 'play');
    play.setAttribute('aria-label', snapshot.isPlaying ? 'Pause' : 'Play');
    play.title = blocked || (snapshot.isPlaying ? 'Pause' : 'Play');
    els.replay.querySelectorAll('[data-replay="toggle"],[data-replay="back"],[data-replay="forward"],[data-replay="speed"]').forEach((button) => {
      button.setAttribute('aria-disabled', String(!ready));
    });
    els.replay.querySelector('[data-replay="speed"]').textContent = `${snapshot.speed}x`;
    const follow = els.replay.querySelector('[data-replay="follow"]');
    follow.classList.toggle('is-on', state.followAlong);
    follow.setAttribute('aria-pressed', String(state.followAlong));
    const timeText = `${M.clock(position)} / ${M.clock(total)}`;
    els.replay.querySelector('.briefs-replay-time').textContent = timeText;
    els.replay.querySelector('.briefs-replay-status').textContent = blocked && snapshot.state !== 'loading' && snapshot.state !== 'idle' ? blocked : '';
    const track = els.replay.querySelector('.briefs-track');
    track.classList.toggle('is-seekable', ready);
    track.setAttribute('aria-valuemax', String(Math.round(total)));
    track.setAttribute('aria-valuenow', String(Math.round(position)));
    track.setAttribute('aria-valuetext', timeText);
    track.style.setProperty('--playhead', `${(position / total) * 100}%`);
    markCurrentTurn(snapshot);
    markPlayingButtons(snapshot);
    // "Note at 5:36" follows the playhead.
    const noteAt = els.side.querySelector('[data-note-at]');
    if (noteAt) {
      noteAt.textContent = `Note at ${M.clock(position)}`;
      if (ready) noteAt.removeAttribute('disabled');
      else noteAt.setAttribute('disabled', '');
    }
  }

  function markCurrentTurn(snapshot) {
    const ready = snapshot.state === 'ready';
    const current = ready && (snapshot.isPlaying || snapshot.position > 0) ? M.currentTurn(state.record.transcript, snapshot.position) : null;
    if (current === state.current) return;
    const previous = els.turns.querySelector('.briefs-turn.is-current');
    if (previous) previous.classList.remove('is-current');
    state.current = current;
    if (current === null) return;
    const line = els.turns.querySelector(`[data-turn="${current}"]`);
    if (!line) return;
    line.classList.add('is-current');
    if (state.followAlong && snapshot.isPlaying) reveal(line, false, 'smooth');
  }

  function markPlayingButtons(snapshot) {
    document.querySelectorAll('[data-clip-key]').forEach((button) => {
      const playing = snapshot.isPlaying && snapshot.clipKey === button.dataset.clipKey;
      if (button.dataset.playing === String(playing)) return;
      button.dataset.playing = String(playing);
      const iconNode = button.querySelector('.briefs-play-icon');
      if (iconNode) iconNode.innerHTML = icon(playing ? 'square' : 'play');
    });
  }

  // ── Transcript ────────────────────────────────────────

  /** Scrolls only the transcript so the line shows. */
  function reveal(line, always, behavior) {
    const pane = els.turns;
    const margin = 32;
    const top = line.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    if (always || top < margin || top > pane.clientHeight - line.clientHeight - margin) {
      pane.scrollTo({ top: pane.scrollTop + top - margin, behavior: behavior || 'auto' });
    }
  }

  function highlightedLines() {
    const point = state.record.keyPoints.find((item) => item.id === state.selectedPoint);
    return new Set(point ? M.spanLineIndices(point.sources, state.record.transcript) : []);
  }

  function renderTranscript() {
    const record = state.record;
    const positions = M.clipPositions(record.clips, record.transcript);
    const highlighted = highlightedLines();
    const selection = state.selection;
    if (record.transcript.length === 0) {
      els.turns.innerHTML = '<li class="briefs-list-note">No transcript yet.</li>';
      return;
    }
    els.turns.innerHTML = record.transcript.map((segment, index) => {
      const clip = positions.get(index);
      const selected = S.contains(selection, index);
      const classes = ['briefs-turn'];
      if (clip) classes.push('is-clipped', `clip-${clip}`);
      if (selected) classes.push('is-selected');
      if (selected && index === S.first(selection)) classes.push('is-selection-first');
      if (selected && index === S.last(selection)) classes.push('is-selection-last');
      if (highlighted.has(index)) classes.push('is-highlighted');
      if (state.current === index) classes.push('is-current');
      const speaker = state.editingSpeaker === index
        ? inlineEdit(speakerName(segment.speaker), 'Speaker name', 'speaker', false).replace('data-inline="speaker"', `data-inline="speaker" data-speaker="${escape(segment.speaker)}"`)
        : `<button type="button" class="briefs-editable briefs-turn-speaker" data-edit-speaker="${index}" title="Rename this speaker everywhere">${escape(speakerName(segment.speaker))}</button>`;
      const text = state.correcting === index
        ? inlineEdit(segment.text, 'Corrected line', 'line', true)
        : `<p class="briefs-turn-text">${escape(segment.text)}</p>`;
      return `<li class="${classes.join(' ')}" data-turn="${index}" role="option" aria-selected="${selected}" aria-label="${escape(speakerName(segment.speaker))} at ${M.clock(segment.start)}${clip ? ', clipped' : ''}">
          <div class="briefs-turn-head">
            ${speaker}
            <span class="briefs-turn-time">${M.clock(segment.start)}</span>
            <button type="button" class="briefs-icon-btn briefs-turn-play" data-play-turn="${index}" data-clip-key="turn-${index}" aria-label="Play this turn"><span class="briefs-play-icon">${icon('play')}</span></button>
          </div>
          ${text}
        </li>`;
    }).join('');
    const editing = els.turns.querySelector('[data-inline]');
    if (editing) {
      focusInlineEdit(editing);
      reveal(editing.closest('.briefs-turn'), true);
    }
    if (player) {
      state.current = null;
      markCurrentTurn(player.snapshot);
      markPlayingButtons(player.snapshot);
    }
  }

  function setSelection(next) {
    state.selection = next;
    if (next !== null) state.correcting = null;
    renderTranscript();
    renderClipBar();
    if (player) renderTicks();
    if (next !== null) {
      const line = els.turns.querySelector(`[data-turn="${next.focus}"]`);
      if (line) reveal(line, false);
    }
  }

  function selectionSpan() {
    const selection = state.selection;
    if (selection === null) return null;
    const transcript = state.record.transcript;
    return { start: transcript[S.first(selection)].start, end: transcript[S.last(selection)].end };
  }

  // ── Clip bar ──────────────────────────────────────────

  function renderClipBar() {
    const selection = state.selection;
    els.clipbar.classList.toggle('hidden', selection === null);
    if (selection === null) {
      els.clipbar.innerHTML = '';
      return;
    }
    const span = selectionSpan();
    const isClip = selection.clipID !== null;
    const single = S.count(selection) === 1;
    const canPlay = player !== null && player.ready;
    const summary = M.clipSummary(S.count(selection), M.clock(span.start), M.clock(span.end));
    const actions = [isClip ? 'unhighlight' : 'highlight', 'note', 'action', 'decision'].concat(single ? ['correct'] : [], ['play']);
    const body = state.drafting !== null
      ? `<div class="briefs-clipbar-drafting" role="status"><lex-spinner size="sm"></lex-spinner><span>${state.drafting === 'action' ? 'LANA is drafting the action' : 'LANA is drafting the decision'}</span></div>`
      : `<div class="briefs-clipbar-actions">${actions.map((action) => {
          const label = CLIP_ACTIONS[action];
          const disabled = action === 'play' && !canPlay;
          return `<button type="button" class="briefs-clipbar-action" data-clip-action="${action}" title="${disabled ? 'The audio cannot play' : label.hint}" aria-label="${label.hint}" aria-disabled="${disabled}">${icon(label.icon)}<span>${label.title}</span></button>`;
        }).join('')}</div>`;
    els.clipbar.innerHTML = `
      <div class="briefs-clipbar-head">
        <div class="briefs-clipbar-what">
          <span class="briefs-clipbar-summary">${escape(summary)}</span>
          <span class="briefs-clipbar-hint">${isClip ? 'A saved clip.' : 'Shift click or drag to add lines. Esc to clear.'}</span>
        </div>
        <button type="button" class="briefs-icon-btn" data-clip-close aria-label="Clear the selection">${icon('x')}</button>
      </div>
      ${body}`;
  }

  /** LANA drafts it in the background; it lands in the inbox. Nothing here waits for the model. */
  async function startDraft(kind, firstLine, lastLine, questionID) {
    const id = state.selectedId;
    const made = await call(() => bridge().records.requestDraft(id, kind, firstLine, lastLine, questionID));
    if (made !== null) {
      state.drafts = state.drafts.filter((item) => item.id !== made.id).concat([made]);
      Lex.Toast.info(kind === 'action' ? 'Drafting an action. It will be in your inbox.' : 'Drafting a decision. It will be in your inbox.');
    }
    return made;
  }

  async function clipAction(action) {
    const selection = state.selection;
    if (selection === null) return;
    const id = state.selectedId;
    const firstLine = S.first(selection);
    const lastLine = S.last(selection);
    switch (action) {
      case 'highlight':
        setSelection(null);
        await call(() => bridge().records.saveClip(id, firstLine, lastLine));
        return;
      case 'unhighlight':
        setSelection(null);
        if (selection.clipID !== null) await call(() => bridge().records.removeClip(id, selection.clipID));
        return;
      case 'note': {
        setSelection(null);
        const clip = await call(() => bridge().records.saveClip(id, firstLine, lastLine));
        if (clip !== null) openNote(addNote(clip.start).id);
        return;
      }
      case 'action':
      case 'decision':
        state.drafting = action;
        renderClipBar();
        await startDraft(action, firstLine, lastLine);
        state.drafting = null;
        setSelection(null);
        renderSide();
        return;
      case 'correct':
        state.selection = null;
        state.correcting = firstLine;
        renderTranscript();
        renderClipBar();
        return;
      case 'play':
        if (player && player.ready) player.playFrom(state.record.transcript[firstLine].start);
        return;
      default:
    }
  }

  // ── Key points and notes ──────────────────────────────

  function renderSide() {
    if (!state.record) return;
    const noteCount = state.notes.filter((note) => note.text.trim() !== '').length;
    els.sideTabs.setAttribute('tabs', JSON.stringify([
      { id: 'keyPoints', label: 'Key points' },
      { id: 'notes', label: noteCount > 0 ? `Notes (${noteCount})` : 'Notes' },
    ]));
    els.sideTabs.setAttribute('active', state.panel);
    els.side.innerHTML = state.panel === 'keyPoints' ? keyPointsHtml() : notesHtml();
    if (player) markPlayingButtons(player.snapshot);
  }

  function sourceTitle(span, point) {
    const range = `${M.clock(span.start)} to ${M.clock(span.end)}`;
    if (point.precision === 'approximate') return `Approximate, ${range}`;
    return `${speakerName(span.speaker)} ${range}`;
  }

  function questionHtml(point) {
    switch (M.questionStep(point, state.record, state.drafts, state.asked)) {
      case 'available':
        return `<lex-btn variant="secondary" size="sm" leading-icon="list-checks" data-question="${escape(point.id)}" aria-label="Make an action: LANA drafts it in your inbox">Make an action</lex-btn>`;
      case 'drafting':
        return '<span class="briefs-question-step" aria-busy="true"><lex-spinner size="sm"></lex-spinner>Drafting in your inbox</span>';
      case 'ready':
        return `<span class="briefs-question-step is-ready">${icon('list-checks')}Action ready in your inbox</span>`;
      case 'made':
        return `<span class="briefs-question-step">${icon('check')}Action made</span>`;
      default:
        return '';
    }
  }

  function keyPointsHtml() {
    const record = state.record;
    if (record.keyPoints.length === 0 && record.gaps.length === 0) {
      return `<section class="briefs-points-group"><p class="briefs-overline">Key points</p><p class="briefs-list-note">${record.transcript.length === 0 ? 'No notes yet. LANA writes them once the transcript is ready.' : 'No AI notes came with this meeting. The transcript is complete.'}</p></section>`;
    }
    const groups = KIND_ORDER.map((kind) => {
      const points = record.keyPoints.filter((point) => point.kind === kind);
      if (points.length === 0) return '';
      return `<section class="briefs-points-group" aria-label="${GROUP_TITLE[kind]}">
          <p class="briefs-overline">${GROUP_TITLE[kind]}</p>
          ${points.map((point) => `<div class="briefs-point is-${point.kind}${point.id === state.selectedPoint ? ' is-selected' : ''}">
              <button type="button" class="briefs-point-text" data-point="${escape(point.id)}" aria-pressed="${point.id === state.selectedPoint}" title="Show where this came from">${escape(point.text)}</button>
              <div class="briefs-point-sources">${point.sources.map((span, index) => {
                const title = sourceTitle(span, point);
                return `<button type="button" class="briefs-source${point.precision === 'approximate' ? ' is-approximate' : ''}" data-source="${escape(point.id)}" data-source-index="${index}" data-clip-key="source-${escape(point.id)}-${index}" aria-label="Play ${escape(title)}"><span class="briefs-play-icon">${icon('play')}</span><span>${escape(title)}</span></button>`;
              }).join('')}</div>
              ${point.kind === 'openQuestion' ? `<div class="briefs-point-question">${questionHtml(point)}</div>` : ''}
            </div>`).join('')}
        </section>`;
    }).join('');
    const gaps = record.gaps.length === 0 ? '' : `<section class="briefs-points-group" aria-label="Not summarized">
        <p class="briefs-overline">Not summarized</p>
        ${record.gaps.map((gap) => `<button type="button" class="briefs-gap" data-seek="${gap.start}">${icon('alert-triangle')}<span><span class="briefs-gap-title">Not summarized, ${M.clock(gap.start)} to ${M.clock(gap.end)}</span><span class="briefs-gap-reason">${gap.reason === 'refused' ? 'The model declined this passage. The transcript has it.' : 'The model failed on this passage. The transcript has it.'}</span></span></button>`).join('')}
      </section>`;
    return groups + gaps;
  }

  function notesHtml() {
    const canAnchor = player !== null && player.ready;
    const position = player ? player.snapshot.position : 0;
    const shown = state.notes.filter((note) => note.text.trim() !== '');
    const buttons = `<div class="briefs-notes-buttons">
        <lex-btn variant="secondary" size="sm" leading-icon="file-text" data-note-new>New note</lex-btn>
        <lex-btn variant="ghost" size="sm" leading-icon="clock" data-note-at ${canAnchor ? '' : 'disabled'} aria-label="New note at the current time, ${M.clock(position)}">Note at ${M.clock(position)}</lex-btn>
      </div>`;
    const status = state.noteSave === 'error' ? '<p class="briefs-notes-status">Your notes could not be saved. LANA will try again as you type.</p>' : '';
    if (shown.length === 0) {
      return `${buttons}${status}<p class="briefs-list-note">Notes you type on your phone during the meeting appear here. Write your own on this computer, or clip lines in the transcript and add a note.</p>`;
    }
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${buttons}${status}<ul class="briefs-notes">${shown.map((note) => {
      const clip = M.clipForNote(note, state.record.clips);
      const preview = M.notePreview(note.text);
      const when = note.anchor === null ? time.format(new Date(note.createdAt)) : M.clock(note.anchor);
      const origin = clip !== null
        ? `<span class="briefs-note-row-clip">${icon('highlighter')}Clip ${M.clock(clip.start)} to ${M.clock(clip.end)}</span>`
        : note.anchor === null ? '<span class="briefs-note-row-clip">Added after the meeting</span>' : '';
      return `<li><button type="button" class="briefs-note-row" data-note-open="${escape(note.id)}">
          <span class="briefs-note-row-title">${escape(M.noteTitle(note.text))}</span>
          <span class="briefs-note-row-line"><span class="briefs-note-row-time">${escape(when)}</span><span class="briefs-note-row-preview">${escape(preview === '' ? 'No additional text' : preview)}</span></span>
          ${origin}
        </button></li>`;
    }).join('')}</ul>`;
  }

  // ── Notes: saved through the shared record, so they sync to the phone ──

  /** The record was (re)loaded: take its notes unless edits are waiting to save. */
  function takeSavedNotes(opening) {
    const saved = state.record.userNotes || [];
    if (opening) {
      state.notes = M.orderNotes(saved);
      state.notesDirty = false;
      state.noteSave = 'idle';
      return;
    }
    if (state.notesDirty) return;
    // A note just started and still empty is not saved yet: keep it.
    const fresh = state.notes.filter((note) => note.text === '' && !saved.some((item) => item.id === note.id));
    state.notes = M.orderNotes(saved.concat(fresh));
  }

  function addNote(anchor) {
    const note = { id: `note-${Date.now().toString(36)}`, text: '', createdAt: new Date().toISOString(), anchor: anchor === null ? null : Math.max(0, anchor) };
    state.notes = M.orderNotes(state.notes.concat([note]));
    return note;
  }

  function notesChanged() {
    state.notesDirty = true;
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(() => persistNotes(), NOTE_SAVE_MS);
  }

  async function persistNotes() {
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = null;
    const meetingID = state.selectedId;
    if (!meetingID || !state.notesDirty) return;
    state.notesDirty = false;
    state.noteSave = 'saving';
    renderNoteStatus();
    let ok = false;
    try {
      const result = await bridge().userNotes.save(meetingID, state.notes.filter((note) => note.text.trim().length > 0));
      ok = Boolean(result && result.ok);
    } catch (_) {
      ok = false;
    }
    if (state.selectedId !== meetingID) return;
    state.noteSave = ok ? 'saved' : 'error';
    if (!ok) state.notesDirty = true;
    renderNoteStatus();
    if (state.openNoteId === null) renderSide();
  }

  /** Leaving a meeting saves its pending note edits now. */
  function flushNotes() {
    if (!state.notesDirty || !state.selectedId) return;
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = null;
    state.notesDirty = false;
    bridge().userNotes.save(state.selectedId, state.notes.filter((note) => note.text.trim().length > 0)).catch(() => {});
  }

  function renderNoteStatus() {
    if (!els.noteStatus) return;
    const text = state.noteSave === 'saving' ? 'Saving' : state.noteSave === 'saved' ? 'Saved on this computer' : state.noteSave === 'error' ? 'Your notes could not be saved. LANA will try again as you type.' : '';
    els.noteStatus.textContent = text;
    els.noteStatus.classList.toggle('is-error', state.noteSave === 'error');
  }

  function growField(field) {
    field.style.height = '0px';
    field.style.height = `${field.scrollHeight}px`;
  }

  /** Opens one note full size over the meeting, like Notes.app. */
  function openNote(id) {
    const note = state.notes.find((item) => item.id === id);
    if (!note) return;
    state.openNoteId = id;
    const parts = M.splitNote(note.text);
    const created = new Date(note.createdAt);
    els.noteDate.textContent = `${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(created)} at ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(created)}`;
    const clip = M.clipForNote(note, state.record.clips);
    els.noteMoment.classList.toggle('hidden', note.anchor === null);
    if (note.anchor !== null) {
      els.noteMoment.textContent = clip !== null ? `From the clip at ${M.clock(clip.start)} to ${M.clock(clip.end)}` : `At ${M.clock(note.anchor)} in the meeting`;
      els.noteMoment.title = `Play from ${M.clock(note.anchor)}`;
    }
    els.noteTitle.value = parts.title;
    els.noteBody.value = parts.body;
    els.noteBody.placeholder = parts.title === '' ? '' : 'Write your note';
    state.noteSave = 'idle';
    renderNoteStatus();
    els.detailMeeting.classList.add('hidden');
    els.noteEditor.classList.remove('hidden');
    growField(els.noteTitle);
    growField(els.noteBody);
    // A new note starts on the title; an existing one at the end of what is written.
    const field = note.text === '' || parts.body === '' ? els.noteTitle : els.noteBody;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }

  /** Back to the meeting. An empty note is dropped; pending edits save now. */
  function closeNoteEditor(show) {
    if (state.openNoteId === null) return;
    const note = state.notes.find((item) => item.id === state.openNoteId);
    if (note && note.text.trim() === '') state.notes = state.notes.filter((item) => item.id !== note.id);
    state.openNoteId = null;
    els.noteEditor.classList.add('hidden');
    if (show) {
      els.detailMeeting.classList.remove('hidden');
      if (state.notesDirty) persistNotes();
      renderSide();
      if (player) renderTicks();
    }
  }

  function noteTextChanged() {
    const id = state.openNoteId;
    if (id === null) return;
    const title = els.noteTitle.value.replace(/\n/g, ' ');
    if (title !== els.noteTitle.value) els.noteTitle.value = title;
    const text = M.limitNote(M.joinNote(title, els.noteBody.value));
    state.notes = state.notes.map((note) => (note.id === id ? Object.assign({}, note, { text }) : note));
    els.noteBody.placeholder = title === '' ? '' : 'Write your note';
    growField(els.noteTitle);
    growField(els.noteBody);
    notesChanged();
  }

  function bindNoteEditor() {
    els.noteBack.addEventListener('click', () => closeNoteEditor(true));
    els.noteDone.addEventListener('click', () => closeNoteEditor(true));
    els.noteDelete.addEventListener('click', () => {
      const id = state.openNoteId;
      if (id === null) return;
      state.notes = state.notes.filter((note) => note.id !== id);
      notesChanged();
      closeNoteEditor(true);
    });
    els.noteMoment.addEventListener('click', () => {
      const note = state.notes.find((item) => item.id === state.openNoteId);
      if (note && note.anchor !== null && player && player.ready) player.playFrom(note.anchor);
    });
    els.noteTitle.addEventListener('input', noteTextChanged);
    els.noteBody.addEventListener('input', noteTextChanged);
    els.noteTitle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        els.noteBody.focus();
        els.noteBody.setSelectionRange(0, 0);
      }
    });
    els.noteBody.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && els.noteBody.selectionStart === 0 && els.noteBody.selectionEnd === 0) {
        event.preventDefault();
        els.noteTitle.focus();
        els.noteTitle.setSelectionRange(els.noteTitle.value.length, els.noteTitle.value.length);
      }
    });
    els.noteScroll.addEventListener('click', (event) => {
      if (event.target === els.noteScroll) els.noteBody.focus();
    });
    els.noteEditor.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeNoteEditor(true);
      }
    });
  }

  async function draftFromQuestion(pointID) {
    const point = state.record.keyPoints.find((item) => item.id === pointID);
    const lines = point ? M.spanLines(point.sources, state.record.transcript) : null;
    if (lines === null || state.asked.has(pointID)) return;
    state.asked.add(pointID);
    renderSide();
    await startDraft('action', lines.first, lines.last, pointID);
    state.asked.delete(pointID);
    renderSide();
  }


  // ── New meeting: record here or import a recording ────

  function setAddress(params) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('meeting');
      url.searchParams.delete('new');
      Object.keys(params).forEach((key) => url.searchParams.set(key, params[key]));
      window.history.replaceState(window.history.state, '', url.toString());
    } catch (_) {
      // The address stays as it was.
    }
  }

  /** Shows New meeting in the content area (the sidebar's New meeting button). */
  function showNew() {
    if (!onPage()) return;
    flushNotes();
    closeNoteEditor(false);
    state.mode = 'new';
    if (player) player.pause();
    state.selectedId = null;
    state.record = null;
    els.detailEmpty.classList.add('hidden');
    els.detailMeeting.classList.add('hidden');
    els.newView.classList.remove('hidden');
    const shell = document.querySelector('lex-app');
    if (shell) shell.activeNavId = 'briefs-new';
    setAddress({ new: '1' });
    refreshRecording();
    renderNew();
  }

  function leaveNew() {
    state.mode = 'meeting';
    els.newView.classList.add('hidden');
  }

  async function refreshRecording() {
    const api = bridge();
    if (!api) return;
    try {
      const [view, models, permissions] = await Promise.all([api.recording.state(), api.models.status(), api.recording.permissions()]);
      state.recording = view;
      state.models = models;
      state.permissions = permissions;
    } catch (_) {
      // Shown once Briefs answers.
    }
    renderNew();
  }

  function transcriptionReady() {
    return Boolean(state.models && state.models.transcription && state.models.transcription.state && state.models.transcription.state.kind === 'ready');
  }

  function setDisabled(element, disabled) {
    if (disabled) element.setAttribute('disabled', '');
    else element.removeAttribute('disabled');
  }

  function renderNew() {
    if (state.mode !== 'new') return;
    const view = state.recording;
    // A finished recording opens its meeting.
    if (view && view.phase === 'done' && view.message === null && view.meetingID) {
      const id = view.meetingID;
      state.recording = null;
      bridge().recording.dismiss().catch(() => {});
      loadMeetings().then(() => select(id));
      return;
    }
    const panel = R.panelFor(view);
    els.newSetup.classList.toggle('hidden', panel !== 'setup');
    els.newLive.classList.toggle('hidden', panel !== 'live');
    els.newProgress.classList.toggle('hidden', panel !== 'progress');
    if (panel === 'setup') renderSetup(view);
    else if (panel === 'live') renderLive(view);
    else renderProgress(view);
  }

  function renderSetup(view) {
    els.newOverline.textContent = 'New meeting';
    els.newTitle.textContent = 'Record a meeting here';
    els.newSubtitle.textContent = 'Audio, transcript and notes stay on this computer.';
    const transcription = state.models && state.models.transcription;
    const needsModel = Boolean(transcription) && !transcriptionReady();
    els.newModel.classList.toggle('hidden', !needsModel);
    if (needsModel) {
      els.newModel.textContent = transcription.state.kind === 'downloading'
        ? `${transcription.title} is downloading (${Math.round((transcription.state.progress || 0) * 100)}%). You can record once it is ready.`
        : `${transcription.title} is needed to record. Download it in Settings.`;
    }
    const allConfirmed = state.form.consent === 'allPartiesConfirmed';
    els.newPeople.setAttribute('label', allConfirmed ? 'Who confirmed' : 'Who is in the meeting');
    els.newPeople.setAttribute('help', allConfirmed ? '' : 'Optional.');
    els.newPermissions.innerHTML = R.permissionNotes(state.permissions).map((note) => `<div class="briefs-new-permission">
        <p class="briefs-new-note${note.tone === 'warning' ? ' is-warning' : ''}">${escape(note.text)}</p>
        ${note.canOpen ? `<lex-btn variant="ghost" size="sm" data-open-privacy="${note.kind}">Open System Settings</lex-btn>` : ''}
      </div>`).join('');
    const failure = view && view.phase === 'failed' ? view.message : null;
    const error = state.newError || failure;
    els.newError.textContent = error || '';
    els.newError.classList.toggle('hidden', !error);
    const missing = R.missingReason(state.form, transcriptionReady());
    setDisabled(els.newStart, missing !== null || state.busy);
    setDisabled(els.newImport, missing !== null || state.busy);
    if (state.busy) els.newStart.setAttribute('loading', 'true');
    else els.newStart.removeAttribute('loading');
    els.newHint.textContent = missing || '';
  }

  function renderLive(view) {
    els.newOverline.textContent = view.phase === 'starting' ? 'Starting' : view.phase === 'recording' ? 'Recording' : 'Paused';
    els.newTitle.textContent = view.title || 'New meeting';
    els.newSubtitle.textContent = 'Audio, transcript and notes stay on this computer.';
    els.liveTime.textContent = M.clock(view.elapsedSeconds);
    els.liveState.textContent = R.liveState(view);
    els.livePulse.classList.toggle('is-on', view.phase === 'recording');
    els.livePause.classList.toggle('hidden', view.phase !== 'recording');
    els.liveResume.classList.toggle('hidden', view.phase !== 'paused');
    setDisabled(els.liveStop, view.phase === 'starting');
    els.liveMessage.textContent = view.message || '';
    els.liveMessage.classList.toggle('hidden', !view.message);
    renderMeters();
    setDisabled(els.liveAdd, state.draft.trim() === '');
    els.liveNotes.innerHTML = state.scratch.map((note) => `<li class="briefs-note"><span class="briefs-note-at">${M.clock(note.anchor)}</span><p class="briefs-note-text">${escape(note.text)}</p></li>`).join('');
  }

  /** One bar per reading; the height is data, set as a custom property. */
  function renderMeterBars(container, levels) {
    if (container.children.length !== R.METER_BARS) {
      container.innerHTML = '<span class="briefs-meter-bar"></span>'.repeat(R.METER_BARS);
    }
    const offset = R.METER_BARS - levels.length;
    Array.prototype.forEach.call(container.children, (bar, index) => {
      const level = index >= offset ? levels[index - offset] : 0;
      bar.style.setProperty('--level', String(level));
    });
  }

  function renderMeters() {
    const view = state.recording;
    if (!view || els.newLive.classList.contains('hidden')) return;
    const meetingOff = view.meetingAudio === 'off';
    renderMeterBars(els.meterMic, state.levels.mic);
    renderMeterBars(els.meterMeeting, meetingOff ? [] : state.levels.meeting);
    els.meterMeeting.classList.toggle('is-off', meetingOff);
    els.meterMicStatus.textContent = R.meterStatus(state.levels.mic, false);
    els.meterMeetingStatus.textContent = R.meterStatus(state.levels.meeting, meetingOff);
  }

  function renderProgress(view) {
    els.newOverline.textContent = 'Writing notes';
    els.newTitle.textContent = view.title || 'New meeting';
    els.newSubtitle.textContent = `${M.clock(view.elapsedSeconds)} recorded. You can open other pages; LANA keeps working.`;
    els.progressSteps.innerHTML = R.progressSteps(view).map((step) => {
      const mark = step.state === 'done' ? icon('check') : step.state === 'active' ? '<lex-spinner size="sm"></lex-spinner>' : icon('clock');
      const bar = step.progress === null ? '' : `<span class="briefs-progress-bar"><span class="briefs-progress-fill" data-progress="${step.progress}"></span></span>`;
      return `<li class="briefs-progress-step is-${step.state}"><span class="briefs-progress-mark" aria-hidden="true">${mark}</span><span class="briefs-progress-text"><span>${escape(step.title)}</span>${bar}</span></li>`;
    }).join('');
    els.progressSteps.querySelectorAll('[data-progress]').forEach((fill) => fill.style.setProperty('--progress', fill.dataset.progress));
    els.progressMessage.textContent = view.message || '';
    els.progressMessage.classList.toggle('hidden', !view.message);
    els.progressOpen.classList.toggle('hidden', !(view.message && view.meetingID));
  }

  async function startRecording() {
    if (R.missingReason(state.form, transcriptionReady()) !== null || state.busy) return;
    state.busy = true;
    state.newError = null;
    renderNew();
    try {
      const result = await bridge().recording.start(R.request(state.form));
      if (!result.ok) state.newError = result.error.message;
      else state.recording = result.value;
    } catch (_) {
      state.newError = 'LANA could not start recording. Try again.';
    }
    state.busy = false;
    state.scratch = [];
    state.levels = { mic: [], meeting: [] };
    renderNew();
  }

  async function importFile(file) {
    state.busy = true;
    state.newError = null;
    renderNew();
    try {
      const bytes = await file.arrayBuffer();
      const result = await bridge().importRecording(bytes, R.request(state.form));
      if (!result.ok) state.newError = result.error.message;
    } catch (_) {
      state.newError = 'LANA could not read that file. Pick an audio recording: m4a, mp3, wav or caf.';
    }
    state.busy = false;
    renderNew();
  }

  function addScratchNote() {
    const text = state.draft.trim();
    if (text === '' || !state.recording) return;
    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    state.scratch = state.scratch.concat([{ id, text, anchor: state.recording.elapsedSeconds }]);
    state.draft = '';
    els.liveDraft.value = '';
    bridge().recording.saveNotes(state.scratch).catch(() => {});
    renderNew();
  }

  function bindNew() {
    const fieldValue = (event) => (event.detail && event.detail.value) || '';
    els.newName.addEventListener('lex-input', (event) => { state.form.title = fieldValue(event); });
    els.newPeople.addEventListener('lex-input', (event) => { state.form.people = fieldValue(event); renderNew(); });
    els.newJurisdiction.addEventListener('lex-input', (event) => { state.form.jurisdiction = fieldValue(event); });
    els.newConsent.addEventListener('lex-change', (event) => { state.form.consent = fieldValue(event) || 'announced'; renderNew(); });
    els.newConfirm.addEventListener('lex-change', (event) => { state.form.confirmed = Boolean(event.detail && event.detail.value); renderNew(); });
    els.newStart.addEventListener('click', () => { if (!els.newStart.hasAttribute('disabled')) startRecording(); });
    els.newImport.addEventListener('click', () => { if (!els.newImport.hasAttribute('disabled')) els.newFile.click(); });
    els.newFile.addEventListener('change', () => {
      const file = els.newFile.files && els.newFile.files[0];
      els.newFile.value = '';
      if (file) importFile(file);
    });
    els.newPermissions.addEventListener('click', (event) => {
      const button = event.target.closest('[data-open-privacy]');
      if (button) bridge().recording.openPrivacySettings(button.dataset.openPrivacy).catch(() => {});
    });
    els.livePause.addEventListener('click', () => bridge().recording.pause().catch(() => {}));
    els.liveResume.addEventListener('click', () => bridge().recording.resume().catch(() => {}));
    els.liveStop.addEventListener('click', () => { if (!els.liveStop.hasAttribute('disabled')) bridge().recording.stop().catch(() => {}); });
    els.liveDraft.addEventListener('lex-input', (event) => {
      state.draft = fieldValue(event);
      setDisabled(els.liveAdd, state.draft.trim() === '');
    });
    els.liveDraft.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addScratchNote();
      }
    });
    els.liveAdd.addEventListener('click', () => { if (!els.liveAdd.hasAttribute('disabled')) addScratchNote(); });
    els.progressOpen.addEventListener('click', () => {
      const view = state.recording;
      if (!view || !view.meetingID) return;
      const id = view.meetingID;
      bridge().recording.dismiss().catch(() => {});
      state.recording = null;
      loadMeetings().then(() => select(id));
    });
  }

  // ── Events ────────────────────────────────────────────

  function onTurnsMouseDown(event) {
    const line = event.target.closest('[data-turn]');
    if (!line || event.button !== 0) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      // Shift or Command click adds lines; it must not stretch a text selection instead.
      if (!event.target.closest('[data-inline]')) {
        event.preventDefault();
        window.getSelection().removeAllRanges();
      }
      return;
    }
    if (event.target.closest('button, [data-inline]')) return;
    drag = { start: Number(line.dataset.turn), moved: false };
  }

  function onTurnsMouseOver(event) {
    if (!drag || (event.buttons & 1) === 0) return;
    const line = event.target.closest('[data-turn]');
    if (!line) return;
    const index = Number(line.dataset.turn);
    if (index === drag.start && !drag.moved) return;
    drag.moved = true;
    els.turns.classList.add('is-dragging');
    window.getSelection().removeAllRanges();
    const next = S.extendTo(index, { anchor: drag.start, focus: drag.start, clipID: null }, state.record.clips, state.record.transcript);
    if (!state.selection || next.focus !== state.selection.focus || next.anchor !== state.selection.anchor) setSelection(next);
  }

  function onTurnsClick(event) {
    const record = state.record;
    const speaker = event.target.closest('[data-edit-speaker]');
    if (speaker) {
      state.editingSpeaker = Number(speaker.dataset.editSpeaker);
      renderTranscript();
      return;
    }
    const play = event.target.closest('[data-play-turn]');
    if (play) {
      const segment = record.transcript[Number(play.dataset.playTurn)];
      if (player && segment) player.playClip(play.dataset.clipKey, segment.start, segment.end);
      return;
    }
    if (event.target.closest('[data-inline]')) return;
    const line = event.target.closest('[data-turn]');
    if (!line || (drag && drag.moved)) return;
    // Text picked inside a line stays selectable for copying.
    if (window.getSelection().isCollapsed === false) return;
    els.turns.focus({ preventScroll: true });
    const index = Number(line.dataset.turn);
    if (event.shiftKey || event.metaKey || event.ctrlKey) setSelection(S.extendTo(index, state.selection, record.clips, record.transcript));
    else setSelection(S.tapLine(index, state.selection, record.clips, record.transcript));
  }

  function onTurnsKey(event) {
    if (event.target !== els.turns || !state.record) return;
    const total = state.record.transcript.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSelection(event.shiftKey ? S.extendBy(delta, state.selection, total, state.record.clips, state.record.transcript) : S.moveBy(delta, state.selection, total));
    }
  }

  function onInlineKey(event) {
    if (!event.target.classList.contains('briefs-inline-field')) return;
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      finishInline(event.target, false);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      finishInline(event.target, true);
    }
  }

  function onDetailClick(event) {
    const target = event.target;
    if (onShareOrReviewClick(target)) return;
    if (target.closest('[data-inline-save]')) return finishInline(target, true);
    if (target.closest('[data-inline-cancel]')) return finishInline(target, false);
    if (target.closest('[data-edit-title]')) {
      state.editingTitle = true;
      renderHeader();
      return;
    }
    const replay = target.closest('[data-replay]');
    if (replay && player) {
      const what = replay.dataset.replay;
      if (what === 'follow') {
        state.followAlong = !state.followAlong;
        onPlayback(player.snapshot);
        return;
      }
      if (!player.ready) return;
      if (what === 'toggle') player.toggle();
      else if (what === 'back') player.skip(-M.SKIP_SECONDS);
      else if (what === 'forward') player.skip(M.SKIP_SECONDS);
      else if (what === 'speed') player.setSpeed(M.nextSpeed(player.snapshot.speed));
      return;
    }
    const track = target.closest('.briefs-track');
    if (track && player && player.ready) {
      const box = track.getBoundingClientRect();
      player.seek(((event.clientX - box.left) / Math.max(box.width, 1)) * trackTotal(player.snapshot));
      return;
    }
    const action = target.closest('[data-clip-action]');
    if (action) {
      if (action.getAttribute('aria-disabled') !== 'true') clipAction(action.dataset.clipAction);
      return;
    }
    if (target.closest('[data-clip-close]')) return setSelection(null);
    const point = target.closest('[data-point]');
    if (point) {
      state.selectedPoint = state.selectedPoint === point.dataset.point ? null : point.dataset.point;
      renderSide();
      renderTranscript();
      const first = els.turns.querySelector('.briefs-turn.is-highlighted');
      if (first) reveal(first, true, 'smooth');
      return;
    }
    const source = target.closest('[data-source]');
    if (source && player) {
      const found = state.record.keyPoints.find((item) => item.id === source.dataset.source);
      const span = found && found.sources[Number(source.dataset.sourceIndex)];
      if (span) player.playClip(source.dataset.clipKey, span.start, span.end);
      return;
    }
    if (target.closest('[data-note-new]')) return openNote(addNote(null).id);
    const noteAt = target.closest('[data-note-at]');
    if (noteAt) {
      if (!noteAt.hasAttribute('disabled') && player && player.ready) openNote(addNote(player.snapshot.position).id);
      return;
    }
    const noteRow = target.closest('[data-note-open]');
    if (noteRow) return openNote(noteRow.dataset.noteOpen);
    const question = target.closest('[data-question]');
    if (question) return draftFromQuestion(question.dataset.question);
    const seek = target.closest('[data-seek]');
    if (seek && player && player.ready) player.seek(Number(seek.dataset.seek));
  }

  function onTrackKey(event) {
    if (!event.target.classList.contains('briefs-track') || !player || !player.ready) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      player.skip(event.key === 'ArrowRight' ? 5 : -5);
    } else if (event.key === ' ') {
      event.preventDefault();
      player.toggle();
    }
  }

  function onBriefsEvent(event) {
    if (!event || !onPage()) return;
    if (event.type === 'recording') {
      state.recording = event.view;
      renderNew();
      return;
    }
    if (event.type === 'recordingLevels') {
      state.levels = { mic: R.pushLevel(state.levels.mic, event.mic), meeting: R.pushLevel(state.levels.meeting, event.meeting) };
      renderMeters();
      return;
    }
    if (event.type === 'models') {
      state.models = event.status;
      renderNew();
      return;
    }
    if (event.type === 'meetingReceived' || event.type === 'inbox') loadMeetings();
    if (event.type === 'recordsChanged' && event.meetingID === state.selectedId) loadShared(state.selectedId);
    if (event.type === 'meetingChanged') {
      loadMeetings();
      if (event.meetingID === state.selectedId) loadMeeting(state.selectedId, true);
    }
  }

  function init() {
    els.list = byId('briefs-detail');
    if (!els.list) return;
    if (player) player.close();
    player = null;
    state.selectedId = null;
    state.record = null;
    els.detail = byId('briefs-detail');
    els.detailEmpty = byId('briefs-detail-empty');
    els.detailMeeting = byId('briefs-detail-meeting');
    els.when = byId('briefs-detail-when');
    els.title = byId('briefs-detail-title');
    els.facts = byId('briefs-detail-meta');
    els.replay = byId('briefs-replay');
    els.error = byId('briefs-meeting-error');
    els.share = byId('briefs-share');
    els.shareButton = byId('briefs-share-button');
    els.sharePopover = byId('briefs-share-popover');
    els.review = byId('briefs-review');
    els.turns = byId('briefs-turns');
    els.clipbar = byId('briefs-clipbar');
    els.sideTabs = byId('briefs-side-tabs');
    els.side = byId('briefs-side-panel');
    els.noteEditor = byId('briefs-note-editor');
    els.noteBack = byId('briefs-note-back');
    els.noteDone = byId('briefs-note-done');
    els.noteDelete = byId('briefs-note-delete');
    els.noteStatus = byId('briefs-note-status');
    els.noteScroll = byId('briefs-note-scroll');
    els.noteDate = byId('briefs-note-date');
    els.noteMoment = byId('briefs-note-moment');
    els.noteTitle = byId('briefs-note-title');
    els.noteBody = byId('briefs-note-body');
    els.newView = byId('briefs-new');
    els.newOverline = byId('briefs-new-overline');
    els.newTitle = byId('briefs-new-title');
    els.newSubtitle = byId('briefs-new-subtitle');
    els.newSetup = byId('briefs-new-setup');
    els.newModel = byId('briefs-new-model');
    els.newName = byId('briefs-new-name');
    els.newConsent = byId('briefs-new-consent');
    els.newPeople = byId('briefs-new-people');
    els.newJurisdiction = byId('briefs-new-jurisdiction');
    els.newConfirm = byId('briefs-new-confirm');
    els.newPermissions = byId('briefs-new-permissions');
    els.newError = byId('briefs-new-error');
    els.newImport = byId('briefs-new-import');
    els.newStart = byId('briefs-new-start');
    els.newHint = byId('briefs-new-hint');
    els.newFile = byId('briefs-new-file');
    els.newLive = byId('briefs-new-live');
    els.livePulse = byId('briefs-live-pulse');
    els.liveTime = byId('briefs-live-time');
    els.liveState = byId('briefs-live-state');
    els.meterMic = byId('briefs-meter-mic');
    els.meterMeeting = byId('briefs-meter-meeting');
    els.meterMicStatus = byId('briefs-meter-mic-status');
    els.meterMeetingStatus = byId('briefs-meter-meeting-status');
    els.liveMessage = byId('briefs-live-message');
    els.livePause = byId('briefs-live-pause');
    els.liveResume = byId('briefs-live-resume');
    els.liveStop = byId('briefs-live-stop');
    els.liveDraft = byId('briefs-live-draft');
    els.liveAdd = byId('briefs-live-add');
    els.liveNotes = byId('briefs-live-notes');
    els.newProgress = byId('briefs-new-progress');
    els.progressSteps = byId('briefs-progress-steps');
    els.progressMessage = byId('briefs-progress-message');
    els.progressOpen = byId('briefs-progress-open');
    state.mode = 'meeting';
    state.openNoteId = null;
    bindNew();
    bindNoteEditor();
    bindReview();
    // The sidebar's New meeting button calls this on this page (elsewhere it opens the page).
    window.briefsNewMeeting = showNew;

    els.detail.addEventListener('click', onDetailClick);
    els.detail.addEventListener('keydown', onInlineKey);
    els.detail.addEventListener('keydown', onTrackKey);
    els.turns.addEventListener('mousedown', onTurnsMouseDown);
    els.turns.addEventListener('mouseover', onTurnsMouseOver);
    els.turns.addEventListener('click', onTurnsClick);
    els.turns.addEventListener('keydown', onTurnsKey);
    els.sideTabs.addEventListener('tab-change', (event) => {
      state.panel = event.detail.tab;
      renderSide();
    });
    if (!globalsBound) {
      globalsBound = true;
      // Capture, so it runs before the shell turns the click into a page load.
      document.addEventListener('sidebar-nav-click', onSidebarNav, true);
      // A click anywhere outside Share closes it, leaving focus where the click put it.
      document.addEventListener('pointerdown', (event) => {
        if (!onPage() || !state.shareOpen) return;
        if (!els.share.contains(event.target)) closeShare(false);
      });
      window.addEventListener('mouseup', () => {
        if (!onPage()) return;
        els.turns.classList.remove('is-dragging');
        // The click after a drag reads `moved` first.
        setTimeout(() => { drag = null; }, 0);
      });
      // Escape puts the picked lines down, wherever focus is on the page.
      window.addEventListener('keydown', (event) => {
        if (onPage() && event.key === 'Escape' && !event.defaultPrevented && state.selection !== null) setSelection(null);
      });
      // The shell's Refresh reloads Briefs here instead of the whole page.
      document.addEventListener('lex-refresh', (event) => {
        if (!onPage()) return;
        event.preventDefault();
        loadMeetings();
        if (state.selectedId) loadMeeting(state.selectedId, true);
      });
      const api = bridge();
      if (api && typeof api.onEvent === 'function') api.onEvent(onBriefsEvent);
    }
    // New meeting opens from its sidebar link, and while a recording is live or being written up.
    if (new URLSearchParams(window.location.search).get('new') === '1') showNew();
    loadMeetings();
    const api = bridge();
    if (api && state.mode !== 'new') {
      api.recording.state().then((view) => {
        if (onPage() && state.mode !== 'new' && (R.isLive(view) || R.isProcessing(view))) showNew();
      }, () => {});
    }
  }

  if (window.LexRouter && typeof window.LexRouter.registerPageInit === 'function') {
    window.LexRouter.registerPageInit('briefs/index.html', init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
