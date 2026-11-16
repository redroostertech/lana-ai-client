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

  // ── Set-aside parts (always left out) ─────────────────
  // A part LANA or the person set aside (a phone call, another matter) never appears in an
  // export: its transcript lines and anything citing them are left out, and one line says so.

  const SET_ASIDE_REASONS = { phone_call: 'phone call', side_conversation: 'side conversation', logistics: 'meeting setup', other_matter: 'another matter' };

  function setAsideParts(record) {
    return (record.setAside || []).filter((part) => part && Number.isFinite(part.start) && Number.isFinite(part.end)).slice().sort((a, b) => a.start - b.start);
  }

  /** "Set aside: 21:58 to 26:09 (phone call)". */
  function setAsideLine(part) {
    return `Set aside: ${M.clock(part.start)} to ${M.clock(part.end)} (${SET_ASIDE_REASONS[part.reason] || 'not part of the meeting'})`;
  }

  /** More than half of [start, end] lies in a set-aside part (a whole transcript line). */
  function lineSetAside(record, start, end) {
    const length = Math.max(end - start, 0.01);
    return setAsideParts(record).some((part) => Math.min(end, part.end) - Math.max(start, part.start) >= length / 2);
  }

  /** Any overlap over half a second (a cited span or an action's evidence). */
  function citesSetAside(record, start, end) {
    return setAsideParts(record).some((part) => Math.min(end, part.end) - Math.max(start, part.start) > 0.5);
  }

  /** The transcript in order with each set-aside part as one placeholder: [{ segment } | { part }]. */
  function transcriptRows(record) {
    const parts = setAsideParts(record);
    const shown = new Set();
    const rows = [];
    for (const segment of record.transcript || []) {
      const part = parts.find((item) => {
        const length = Math.max(segment.end - segment.start, 0.01);
        return Math.min(segment.end, item.end) - Math.max(segment.start, item.start) >= length / 2;
      });
      if (part === undefined) {
        rows.push({ segment });
      } else if (!shown.has(part)) {
        shown.add(part);
        rows.push({ part });
      }
    }
    return rows;
  }

  function pointsOf(record, kind) {
    return (record.keyPoints || []).filter((point) => point.kind === kind && String(point.text || '').trim() !== ''
      && !(point.sources || []).some((span) => citesSetAside(record, span.start, span.end)));
  }

  /** Actions not citing a set-aside part. The view gives the first and last quote times, so each is checked on its own. */
  function actionsOf(record) {
    const inside = (time) => setAsideParts(record).some((part) => time >= part.start && time < part.end);
    return (record.actions || []).filter((action) => {
      const start = Number.isFinite(action.start) ? action.start : action.at;
      const end = Number.isFinite(action.end) ? action.end : start;
      return !inside(start) && !inside(end);
    }).sort((a, b) => a.at - b.at);
  }

  // ── Attribution: cited ranges, owners and due dates ───

  /** "Cited 29:52 to 30:54" (first source start to last source end); "Cited about" when approximate. */
  function citedText(sources, approximate) {
    const spans = (sources || []).filter((span) => span && Number.isFinite(span.start));
    if (spans.length === 0) return '';
    const start = Math.min(...spans.map((span) => span.start));
    const end = Math.max(...spans.map((span) => (Number.isFinite(span.end) ? span.end : span.start)));
    return `Cited ${approximate ? 'about ' : ''}${M.clock(start)} to ${M.clock(end)}`;
  }

  /** The speaker's name for a label like S2; any other text as written. */
  function personName(record, who) {
    const value = String(who == null ? '' : who).trim();
    if (value === '') return '';
    const speaker = (record.speakers || []).find((item) => item.id === value);
    return speaker && String(speaker.name).trim() ? speaker.name : value;
  }

  /** "Wednesday, November 11, 2026" from YYYY-MM-DD, or "". */
  function dueDay(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!match) return '';
    const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(day);
  }

  /** "Owner: Omar Haddad. Due: Wednesday, November 11, 2026 (tonight)." or "Owner: not said. No date given." */
  function ownerDueText(record, action) {
    const owner = personName(record, action.owner);
    const day = dueDay(action.dueDate);
    const spoken = String(action.dueText || '').trim();
    let due;
    if (day && spoken) due = `Due: ${day} (${spoken}).`;
    else if (day) due = `Due: ${day}.`;
    else if (spoken) due = `Due: ${spoken}.`;
    else due = 'No date given.';
    return `Owner: ${owner || 'not said'}. ${due}`;
  }

  /** A key point's line under its text: the cited range, and who decided for a decision. */
  function pointMeta(record, point) {
    const cited = citedText(point.sources, point.precision === 'approximate');
    const decided = point.kind === 'decision' && point.decidedBy ? ` Decided by ${personName(record, point.decidedBy)}.` : '';
    return cited ? `${cited}.${decided}` : decided.trim();
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
      : transcriptRows(record).map((row) => (row.part
        ? setAsideLine(row.part)
        : `[${M.clock(row.segment.start)}] ${speakerName(record, row.segment.speaker)}: ${String(row.segment.text || '').trim()}`));
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
${record.speakersNamed === false ? '  <p class="ex-notice">Speakers have no names yet, so notes say S1, S2 and so on.</p>\n' : ''}</header>`;
  }

  function transcriptSection(record) {
    const transcript = record.transcript || [];
    if (transcript.length === 0) return '<section class="ex-section"><h2 class="ex-h2">Transcript</h2><p class="ex-empty">No transcript yet.</p></section>';
    let previous = null;
    const turns = transcriptRows(record).map((row) => {
      if (row.part) {
        previous = null;
        return `<p class="ex-set-aside">${escape(setAsideLine(row.part))}</p>`;
      }
      const segment = row.segment;
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
    const meta = pointMeta(record, point);
    return meta ? `<span class="ex-point-source">${escape(meta)}</span>` : '';
  }

  function tablesSection(record) {
    // A table citing a set-aside part is left out whole: its rows carry no times of their own.
    const tables = (record.tables || []).filter((table) => (table.rows || []).length > 0 && (table.columns || []).length > 0
      && !(table.sources || []).some((span) => citesSetAside(record, span.start, span.end)));
    if (tables.length === 0) return '';
    return `<section class="ex-section"><h2 class="ex-h2">Tables</h2>
  ${tables.map((table) => `<h3 class="ex-h3">${escape(table.title)}</h3>
  <table class="ex-table"><thead><tr>${table.columns.map((column) => `<th>${escape(column)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((row) => `<tr>${table.columns.map((_, index) => `<td>${escape(row[index] == null ? '' : row[index])}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('\n  ')}
</section>`;
  }

  function pointsSections(record) {
    const groups = GROUPS.map((group) => {
      const points = pointsOf(record, group.kind);
      if (points.length === 0) return '';
      return `<section class="ex-section"><h2 class="ex-h2">${group.title}</h2>
  <ul class="ex-points">${points.map((point) => `<li class="ex-point is-${escape(point.kind)}"><span class="ex-point-text">${escape(point.text)}</span>${sourceLine(record, point)}</li>`).join('')}</ul>
</section>`;
    }).filter(Boolean);
    const tables = tablesSection(record);
    const sections = tables ? groups.concat([tables]) : groups;
    if (groups.length > 0) return sections.join('\n');
    const why = (record.transcript || []).length === 0 ? 'No notes yet. LANA writes them once the transcript is ready.' : 'No AI notes came with this meeting.';
    return `<section class="ex-section"><h2 class="ex-h2">Key points</h2><p class="ex-empty">${why}</p></section>${tables ? `\n${tables}` : ''}`;
  }

  function actionsSection(record) {
    const actions = actionsOf(record);
    if (actions.length === 0) return '<section class="ex-section"><h2 class="ex-h2">Actions</h2><p class="ex-empty">No actions on this meeting.</p></section>';
    return `<section class="ex-section"><h2 class="ex-h2">Actions</h2>
  <ul class="ex-points">${actions.map((action) => {
    const start = Number.isFinite(action.start) ? action.start : action.at;
    const end = Number.isFinite(action.end) ? action.end : start;
    const cited = citedText([{ start, end }], false);
    return `<li class="ex-point is-action"><span class="ex-point-text">${escape(action.title)}</span><span class="ex-point-owner">${escape(ownerDueText(record, action))}</span><span class="ex-point-source">${escape(`${action.confirmed ? 'Confirmed' : 'Proposed'}. ${cited}.`)}</span></li>`;
  }).join('')}</ul>
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
    setAsideLine, ownerDueText, pointMeta, citedText, transcriptRows,
    transcriptText, transcriptHtml, notesHtml, meetingHtml,
    exportRequest, savedMessage, revealLabel,
  };
  global.BriefsExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
