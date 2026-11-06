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

  const KIND_ORDER = ['summary', 'decision', 'openQuestion'];
  const GROUP_TITLE = { summary: 'Key points', decision: 'Decisions', openQuestion: 'Open questions' };
  const CLIP_ACTIONS = {
    highlight: { icon: 'highlighter', title: 'Highlight', hint: 'Save these lines as a clip' },
    unhighlight: { icon: 'trash-2', title: 'Unhighlight', hint: 'Remove this clip' },
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
  };
  const els = {};
  let player = null;
  let drag = null;
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
    if (state.selectedId === null && state.meetings.length > 0) {
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
    if (id === state.selectedId) return;
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
      url.searchParams.set('meeting', id);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch (_) {
      // The address stays as it was.
    }
  }

  /** A meeting picked in the sidebar opens here without reloading the page. */
  function onSidebarNav(event) {
    const id = event.detail && event.detail.id;
    if (!onPage() || typeof id !== 'string' || id.indexOf('briefs-meeting-') !== 0) return;
    event.stopImmediatePropagation();
    const meetingID = id.slice('briefs-meeting-'.length);
    if (state.meetings.some((meeting) => meeting.id === meetingID)) select(meetingID);
  }

  function renderMeeting() {
    renderHeader();
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
      </div>`;
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
    record.userNotes.filter((note) => note.anchor !== null).forEach((note) => tick(below, 'briefs-tick is-note', note.anchor, note.anchor, total, 'Your note'));
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
    const actions = [isClip ? 'unhighlight' : 'highlight', 'action', 'decision'].concat(single ? ['correct'] : [], ['play']);
    const body = state.drafting !== null
      ? `<div class="briefs-clipbar-drafting" role="status"><lex-spinner size="sm"></lex-spinner><span>${state.drafting === 'action' ? 'LANA is drafting the action' : 'LANA is drafting the decision'}</span></div>`
      : `<div class="briefs-clipbar-actions">${actions.map((action) => {
          const label = CLIP_ACTIONS[action];
          const disabled = action === 'play' && !canPlay;
          return `<button type="button" class="briefs-clipbar-action" data-clip-action="${action}" title="${disabled ? 'The audio cannot play' : label.hint}" aria-label="${label.hint}" aria-disabled="${disabled}">${icon(label.icon)}<span>${label.title}</span></button>`;
        }).join('')}</div>`;
    els.clipbar.innerHTML = `
      <div class="briefs-clipbar-head">
        <div>
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
    const noteCount = state.record.userNotes.filter((note) => note.text.trim() !== '').length;
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
    const notes = state.record.userNotes.filter((note) => note.text.trim() !== '');
    if (notes.length === 0) return '<p class="briefs-list-note">No notes on this meeting yet.</p>';
    return `<ul class="briefs-notes">${notes.map((note) => `<li class="briefs-note">
        ${note.anchor !== null ? `<button type="button" class="briefs-note-at" data-seek="${note.anchor}">${M.clock(note.anchor)}</button>` : ''}
        <p class="briefs-note-text">${escape(note.text)}</p>
      </li>`).join('')}</ul>`;
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

  // ── Events ────────────────────────────────────────────

  function onTurnsMouseDown(event) {
    const line = event.target.closest('[data-turn]');
    if (!line || event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
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
    if (event.type === 'meetingReceived' || event.type === 'inbox') loadMeetings();
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
    els.turns = byId('briefs-turns');
    els.clipbar = byId('briefs-clipbar');
    els.sideTabs = byId('briefs-side-tabs');
    els.side = byId('briefs-side-panel');

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
    loadMeetings();
  }

  if (window.LexRouter && typeof window.LexRouter.registerPageInit === 'function') {
    window.LexRouter.registerPageInit('briefs/index.html', init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
