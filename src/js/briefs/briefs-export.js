/**
 * LANA Briefs: Export on the meeting page. Plain functions over the MeetingRecord the
 * Briefs bridge returns (meetings.get) and the person's notes; no DOM. They build what
 * each export holds (the plain text, or the HTML body the Briefs host prints to PDF with
 * src/css/briefs-export-print.css), the menu and the file names. The host asks where to
 * save and writes the file on this computer; nothing is uploaded.
 * tests/unit/briefs/briefs-export.test.js covers them.
 */
(function (global) {
  'use strict';

  const M = global.BriefsMeeting || (typeof require === 'function' ? require('./briefs-meeting.js') : null);

  /** The export kinds, in menu order. The host knows the same five (meetingExport.save). */
  const KINDS = ['transcriptPdf', 'transcriptText', 'notesPdf', 'meetingPdf', 'audio'];

  const MENU = {
    transcriptPdf: { label: 'Transcript (PDF)', description: 'Every line, with speakers and times', icon: 'file-text', suffix: 'Transcript' },
    transcriptText: { label: 'Transcript (plain text)', description: 'A .txt file you can paste anywhere', icon: 'file-text', suffix: 'Transcript' },
    notesPdf: { label: 'Notes and key points (PDF)', description: 'Key points, decisions, open questions and your notes', icon: 'list-checks', suffix: 'Notes' },
    meetingPdf: { label: 'Full meeting (PDF)', description: 'Notes, actions and the full transcript', icon: 'book-open', suffix: 'Meeting' },
    audio: { label: 'Audio', description: 'The original recording', icon: 'mic', suffix: 'Audio' },
  };

  const GROUPS = [
    { kind: 'summary', title: 'Key points' },
    { kind: 'decision', title: 'Decisions' },
    { kind: 'openQuestion', title: 'Open questions' },
  ];

  /** Characters no file system takes in a name, control characters, and the path separators. */
  // eslint-disable-next-line no-control-regex
  const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;
  const NAME_LIMIT = 80;

  function escape(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function meetingTitle(record) {
    return String((record && record.title) || '').trim() || 'Untitled meeting';
  }

  function speakerName(record, id) {
    if (!id) return 'Several speakers';
    const speaker = (record.speakers || []).find((item) => item.id === id);
    return speaker && String(speaker.name).trim() ? speaker.name : id;
  }

  function validDate(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /** "2026-11-10" in local time, or "" without a date. */
  function dateStamp(iso) {
    const date = validDate(iso);
    if (date === null) return '';
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /** "Tuesday, November 10, 2026 at 2:05 PM", or "" without a date. */
  function longDate(iso) {
    const date = validDate(iso);
    if (date === null) return '';
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
    return `${day} at ${time}`;
  }

  /** A title made safe for a file name: no separators or reserved characters, not too long. */
  function safeName(text) {
    const cleaned = String(text == null ? '' : text).replace(UNSAFE, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
    const cut = cleaned.slice(0, NAME_LIMIT).replace(/[.\s]+$/, '');
    return cut || 'Meeting';
  }

  /** "Annapolis 2026-11-10 Transcript": the default file name without its extension (the host adds it). */
  function fileStem(record, kind) {
    return [safeName(meetingTitle(record)), dateStamp(record.startedAt), MENU[kind].suffix].filter(Boolean).join(' ');
  }

  /** The Export menu: audio only while the meeting's audio is still on this computer. */
  function menuOptions(record) {
    return KINDS
      .filter((kind) => kind !== 'audio' || Boolean(record && record.hasAudio))
      .map((kind) => ({ value: kind, label: MENU[kind].label, description: MENU[kind].description, icon: MENU[kind].icon }));
  }

  /** The person's notes with text, in meeting order, as { title, body, when }. */
  function noteEntries(notes) {
    const shown = (notes || []).filter((note) => note && String(note.text || '').trim() !== '');
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
    return M.orderNotes(shown).map((note) => {
      const lines = String(note.text).split('\n');
      const titleIndex = lines.findIndex((part) => part.trim() !== '');
      const body = lines.slice(titleIndex + 1).join('\n').trim();
      const created = validDate(note.createdAt);
      const when = note.anchor !== null && note.anchor !== undefined
        ? `At ${M.clock(note.anchor)}`
        : created === null ? 'Added after the meeting' : `Added after the meeting, ${time.format(created)}`;
      return { title: M.noteTitle(note.text), body, when };
    });
  }

  function pointsOf(record, kind) {
    return (record.keyPoints || []).filter((point) => point.kind === kind && String(point.text || '').trim() !== '');
  }

  function speakerList(record) {
    return (record.speakers || []).map((speaker) => String(speaker.name || '').trim()).filter(Boolean);
  }

  // ── Plain text ────────────────────────────────────────

  /** The transcript as plain text: a short header, then "[0:04] Ana: line" per line. */
  function transcriptText(record) {
    const head = [meetingTitle(record), longDate(record.startedAt), `Length: ${M.duration(record.durationSeconds)}`];
    const speakers = speakerList(record);
    if (speakers.length > 0) head.push(`Speakers: ${speakers.join(', ')}`);
    const transcript = record.transcript || [];
    const lines = transcript.length === 0
      ? ['No transcript yet.']
      : transcript.map((segment) => `[${M.clock(segment.start)}] ${speakerName(record, segment.speaker)}: ${String(segment.text || '').trim()}`);
    return `${head.filter(Boolean).join('\n')}\n\n${lines.join('\n\n')}\n`;
  }

  // ── HTML for PDF ──────────────────────────────────────
  // Bodies only: the host wraps them with the print stylesheet, the LANA mark and the page
  // footer (page numbers). Every value is escaped; the classes are in briefs-export-print.css.

  function headerHtml(record, kindLabel) {
    const facts = [
      { term: 'Date', value: longDate(record.startedAt) },
      { term: 'Length', value: M.duration(record.durationSeconds) },
      { term: 'Speakers', value: speakerList(record).join(', ') },
    ].filter((fact) => fact.value);
    return `<header class="ex-head">
  <p class="ex-kind">${escape(kindLabel)}</p>
  <h1 class="ex-title">${escape(meetingTitle(record))}</h1>
  <dl class="ex-facts">${facts.map((fact) => `<div class="ex-fact"><dt>${escape(fact.term)}</dt><dd>${escape(fact.value)}</dd></div>`).join('')}</dl>
</header>`;
  }

  function transcriptSection(record) {
    const transcript = record.transcript || [];
    if (transcript.length === 0) return '<section class="ex-section"><h2 class="ex-h2">Transcript</h2><p class="ex-empty">No transcript yet.</p></section>';
    let previous = null;
    const turns = transcript.map((segment) => {
      const same = segment.speaker === previous;
      previous = segment.speaker;
      return `<div class="ex-turn${same ? ' is-continued' : ''}">
    <div class="ex-turn-meta"><span class="ex-time">${escape(M.clock(segment.start))}</span>${same ? '' : `<span class="ex-speaker">${escape(speakerName(record, segment.speaker))}</span>`}</div>
    <p class="ex-turn-text">${escape(String(segment.text || '').trim())}</p>
  </div>`;
    }).join('\n');
    return `<section class="ex-section ex-transcript"><h2 class="ex-h2">Transcript</h2>\n${turns}\n</section>`;
  }

  function sourceLine(record, point) {
    const span = (point.sources || [])[0];
    if (!span) return '';
    const who = point.precision === 'approximate' || !span.speaker ? 'Around' : `${speakerName(record, span.speaker)},`;
    return `<span class="ex-point-source">${escape(`${who} ${M.clock(span.start)}`)}</span>`;
  }

  function pointsSections(record) {
    const sections = GROUPS.map((group) => {
      const points = pointsOf(record, group.kind);
      if (points.length === 0) return '';
      return `<section class="ex-section"><h2 class="ex-h2">${group.title}</h2>
  <ul class="ex-points">${points.map((point) => `<li class="ex-point is-${escape(point.kind)}"><span class="ex-point-text">${escape(point.text)}</span>${sourceLine(record, point)}</li>`).join('')}</ul>
</section>`;
    }).filter(Boolean);
    if (sections.length > 0) return sections.join('\n');
    const why = (record.transcript || []).length === 0 ? 'No notes yet. LANA writes them once the transcript is ready.' : 'No AI notes came with this meeting.';
    return `<section class="ex-section"><h2 class="ex-h2">Key points</h2><p class="ex-empty">${why}</p></section>`;
  }

  function actionsSection(record) {
    const actions = (record.actions || []).slice().sort((a, b) => a.at - b.at);
    if (actions.length === 0) return '<section class="ex-section"><h2 class="ex-h2">Actions</h2><p class="ex-empty">No actions on this meeting.</p></section>';
    return `<section class="ex-section"><h2 class="ex-h2">Actions</h2>
  <ul class="ex-points">${actions.map((action) => `<li class="ex-point is-action"><span class="ex-point-text">${escape(action.title)}</span><span class="ex-point-source">${escape(`${action.confirmed ? 'Confirmed' : 'Proposed'}, ${M.clock(action.at)}`)}</span></li>`).join('')}</ul>
</section>`;
  }

  function notesSection(notes) {
    const entries = noteEntries(notes);
    if (entries.length === 0) return '<section class="ex-section"><h2 class="ex-h2">Your notes</h2><p class="ex-empty">No notes on this meeting.</p></section>';
    return `<section class="ex-section"><h2 class="ex-h2">Your notes</h2>
  ${entries.map((entry) => `<article class="ex-note"><p class="ex-note-when">${escape(entry.when)}</p><h3 class="ex-note-title">${escape(entry.title)}</h3>${entry.body ? `<p class="ex-note-body">${escape(entry.body)}</p>` : ''}</article>`).join('\n  ')}
</section>`;
  }

  function transcriptHtml(record) {
    return `${headerHtml(record, 'Transcript')}\n${transcriptSection(record)}`;
  }

  function notesHtml(record, notes) {
    return `${headerHtml(record, 'Notes and key points')}\n${pointsSections(record)}\n${notesSection(notes)}`;
  }

  /** Header, key points, decisions, open questions, actions, the person's notes, then the transcript on a new page. */
  function meetingHtml(record, notes) {
    return `${headerHtml(record, 'Meeting')}\n${pointsSections(record)}\n${actionsSection(record)}\n${notesSection(notes)}\n<div class="ex-page-break"></div>\n${transcriptSection(record)}`;
  }

  // ── The request the host saves ────────────────────────

  /**
   * What meetingExport.save takes: { meetingID, kind, fileName, title, content }. content is
   * the text for transcriptText, the HTML body for the PDFs, and absent for audio (the host
   * reads the stored audio itself).
   */
  function exportRequest(record, notes, kind) {
    if (!MENU[kind]) throw new Error(`Unknown export kind ${kind}`);
    const request = { meetingID: record.id, kind, fileName: fileStem(record, kind), title: meetingTitle(record) };
    if (kind === 'transcriptText') request.content = transcriptText(record);
    if (kind === 'transcriptPdf') request.content = transcriptHtml(record);
    if (kind === 'notesPdf') request.content = notesHtml(record, notes);
    if (kind === 'meetingPdf') request.content = meetingHtml(record, notes);
    return request;
  }

  /** The toast after a save. */
  function savedMessage(kind, files) {
    if (kind === 'audio') return files > 1 ? `Audio saved as ${files} files.` : 'Audio saved.';
    const what = { transcriptPdf: 'Transcript', transcriptText: 'Transcript', notesPdf: 'Notes', meetingPdf: 'Meeting' }[kind];
    return `${what} saved on this computer.`;
  }

  /** The toast's button: Finder on a Mac, the folder elsewhere (PlatformInfo.os). */
  function revealLabel(os) {
    return os === 'mac' ? 'Show in Finder' : 'Show in folder';
  }

  const api = {
    KINDS, MENU,
    escape, safeName, dateStamp, longDate, fileStem, menuOptions, noteEntries,
    transcriptText, transcriptHtml, notesHtml, meetingHtml,
    exportRequest, savedMessage, revealLabel,
  };
  global.BriefsExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
