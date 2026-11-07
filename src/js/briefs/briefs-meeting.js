/**
 * LANA Briefs meeting rules for the meeting page, ported from the standalone app's
 * renderer (transcriptSelection, clippedTranscript, replayTimeline, questionClip, format).
 * Plain functions over the MeetingRecord the Briefs bridge returns; no DOM. The page
 * (src/briefs/app.js) renders with them; tests/unit/briefs-meeting.test.js covers them.
 */
(function (global) {
  'use strict';

  /** Seconds of slack for times that went through rounding. */
  const TOLERANCE = 0.01;
  /** A pause after a turn still counts as that turn, so follow-along does not flicker. */
  const TURN_GRACE_SECONDS = 1;
  const SPEEDS = [1, 1.25, 1.5, 2];
  const SKIP_SECONDS = 15;

  // ── Time ──────────────────────────────────────────────

  /** "1:05" or "1:02:05". */
  function clock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    const pad = (value) => String(value).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
  }

  /** "42 min" or "1 hr 5 min"; at least 1 min. */
  function duration(seconds) {
    const minutes = Math.max(1, Math.round((Number(seconds) || 0) / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
  }

  // ── Clips ─────────────────────────────────────────────

  /** A line belongs to a clip when it starts inside it. */
  function clipLineIndices(clip, transcript) {
    const lines = [];
    transcript.forEach((segment, index) => {
      if (segment.start >= clip.start - TOLERANCE && segment.start < clip.end - TOLERANCE) lines.push(index);
    });
    return lines;
  }

  /**
   * Where each clipped line sits in its block ("single", "first", "middle", "last"), so a
   * run of lines draws as one block. Clips that share a line merge; a block splits where
   * it skips a line.
   */
  function clipPositions(clips, transcript) {
    const groups = clips
      .map((clip) => new Set(clipLineIndices(clip, transcript)))
      .filter((group) => group.size > 0)
      .sort((a, b) => Math.min(...a) - Math.min(...b));
    const merged = [];
    for (const group of groups) {
      const last = merged[merged.length - 1];
      if (last && [...group].some((index) => last.has(index))) group.forEach((index) => last.add(index));
      else merged.push(group);
    }
    const positions = new Map();
    for (const group of merged) {
      const runs = [];
      for (const index of [...group].sort((a, b) => a - b)) {
        const run = runs[runs.length - 1];
        if (run && run[run.length - 1] === index - 1) run.push(index);
        else runs.push([index]);
      }
      for (const run of runs) {
        run.forEach((index, offset) => {
          positions.set(index, run.length === 1 ? 'single' : offset === 0 ? 'first' : offset === run.length - 1 ? 'last' : 'middle');
        });
      }
    }
    return positions;
  }

  // ── Picking lines ─────────────────────────────────────
  // A selection is { anchor, focus, clipID }: where it started, where it was stretched to,
  // and the saved clip it is when the person picked one.

  const first = (selection) => Math.min(selection.anchor, selection.focus);
  const last = (selection) => Math.max(selection.anchor, selection.focus);
  const count = (selection) => last(selection) - first(selection) + 1;
  const contains = (selection, line) => selection !== null && line >= first(selection) && line <= last(selection);

  function clipMatching(from, to, clips, transcript) {
    for (const clip of clips) {
      const lines = clipLineIndices(clip, transcript);
      if (lines.length > 0 && lines[0] === from && lines[lines.length - 1] === to) return clip.id;
    }
    return null;
  }

  /** A plain click on a line. Null puts the selection down. */
  function tapLine(line, current, clips, transcript) {
    if (current !== null && current.anchor === line && current.focus === line) return null;
    const clip = clips.find((item) => clipLineIndices(item, transcript).includes(line));
    if (clip !== undefined) {
      if (current && current.clipID === clip.id) return null;
      const lines = clipLineIndices(clip, transcript);
      return { anchor: lines[0], focus: lines[lines.length - 1], clipID: clip.id };
    }
    return { anchor: line, focus: line, clipID: null };
  }

  /** Shift or Command click, or a drag reaching a line: stretches from the anchor. */
  function extendTo(line, current, clips, transcript) {
    const anchor = current ? current.anchor : line;
    return { anchor, focus: line, clipID: clipMatching(Math.min(anchor, line), Math.max(anchor, line), clips, transcript) };
  }

  function clampLine(line, total) {
    return Math.min(Math.max(line, 0), total - 1);
  }

  /** An arrow key: one line up or down from the focus. */
  function moveBy(delta, current, total) {
    if (total === 0) return null;
    const from = current === null ? (delta > 0 ? -1 : total) : current.focus;
    const line = clampLine(from + delta, total);
    return { anchor: line, focus: line, clipID: null };
  }

  /** Shift and an arrow key: stretches the focus one line. */
  function extendBy(delta, current, total, clips, transcript) {
    if (current === null) return moveBy(delta, current, total);
    return extendTo(clampLine(current.focus + delta, total), current, clips, transcript);
  }

  /** "1 line, 0:04" or "2 lines, 0:04 to 0:15". */
  function clipSummary(lines, start, end) {
    const what = lines === 1 ? '1 line' : `${lines} lines`;
    return start === end ? `${what}, ${start}` : `${what}, ${start} to ${end}`;
  }

  // ── Audio timeline ────────────────────────────────────

  function makeTimeline(durations) {
    const clean = durations.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
    const offsets = [];
    let total = 0;
    for (const value of clean) {
      offsets.push(total);
      total += value;
    }
    return { durations: clean, offsets, duration: total };
  }

  function clampTime(timeline, seconds) {
    if (!Number.isFinite(seconds)) return 0;
    return Math.min(Math.max(seconds, 0), timeline.duration);
  }

  /** The part holding a moment and the time inside it. The very end belongs to the last part. */
  function locate(timeline, seconds) {
    const parts = timeline.durations.length;
    if (parts === 0) return null;
    const target = clampTime(timeline, seconds);
    for (let part = 0; part < parts; part += 1) {
      const start = timeline.offsets[part];
      const length = timeline.durations[part];
      if (target < start + length || part === parts - 1) return { part, time: Math.min(Math.max(target - start, 0), length) };
    }
    return null;
  }

  /** The transcript turn under the playhead, or null. */
  function currentTurn(turns, seconds) {
    let found = -1;
    turns.forEach((turn, index) => {
      if (turn.start <= seconds && (found === -1 || turn.start >= turns[found].start)) found = index;
    });
    const turn = turns[found];
    return turn !== undefined && seconds <= turn.end + TURN_GRACE_SECONDS ? found : null;
  }

  function nextSpeed(speed) {
    const index = SPEEDS.indexOf(speed);
    return SPEEDS[(index + 1) % SPEEDS.length];
  }

  // ── Key points ────────────────────────────────────────

  function touches(line, span) {
    if (span.end <= span.start) return line.start <= span.start && line.end > span.start;
    return line.start < span.end && line.end > span.start;
  }

  /** Every transcript line any of the spans touches, in order. */
  function spanLineIndices(spans, transcript) {
    const lines = [];
    transcript.forEach((line, index) => {
      if (spans.some((span) => touches(line, span))) lines.push(index);
    });
    return lines;
  }

  /** The lines a key point came from, first to last, or null. */
  function spanLines(spans, transcript) {
    const lines = spanLineIndices(spans, transcript);
    return lines.length === 0 ? null : { first: lines[0], last: lines[lines.length - 1] };
  }

  /**
   * Where an open question's action is: "none" (no lines to draft from), "available",
   * "drafting" (LANA has it, or it was just asked for), "ready" (waits in the inbox) or
   * "made" (confirmed). An action made from a clip starts where its first line starts.
   */
  function questionStep(point, record, drafts, asked) {
    const lines = spanLines(point.sources, record.transcript);
    if (lines === null) return 'none';
    if (asked.has(point.id) || drafts.some((draft) => draft.questionID === point.id && draft.state && draft.state.kind !== 'ready')) return 'drafting';
    const start = record.transcript[lines.first].start;
    const made = (record.actions || []).filter((action) => Math.abs(action.at - start) < 0.001);
    if (made.some((action) => action.confirmed)) return 'made';
    return made.length > 0 ? 'ready' : 'available';
  }

  // ── The meeting's facts line ──────────────────────────

  function attestationText(method) {
    switch (method) {
      case 'acoustic': return 'Verified by tone';
      case 'qr': return 'Verified by QR code';
      case 'macApproval': return 'Approved on this computer';
      case 'recordedHere': return 'Recorded on this computer';
      default: return '';
    }
  }

  /** "42 min. Ana, Ben. Verified by tone. Recording announced." */
  function facts(record) {
    return [
      duration(record.durationSeconds),
      (record.speakers || []).map((speaker) => speaker.name).join(', '),
      attestationText(record.attestationMethod),
      record.consent === 'allPartiesConfirmed' ? 'All parties confirmed' : 'Recording announced',
    ].filter(Boolean).join('. ') + '.';
  }

  // ── The person's notes ────────────────────────────────

  const NOTE_PREVIEW = 120;
  /** UserNote.maxLength, in characters as the person sees them. */
  const NOTE_MAX_LENGTH = 10000;

  /** First line is the title, the rest the body (like Notes.app). */
  function splitNote(text) {
    const newline = text.indexOf('\n');
    return newline < 0 ? { title: text, body: '' } : { title: text.slice(0, newline), body: text.slice(newline + 1) };
  }

  function joinNote(title, body) {
    return body === '' ? title : `${title}\n${body}`;
  }

  /** The row title: the first line with text, or "New note". */
  function noteTitle(text) {
    const line = text.split('\n').map((part) => part.trim()).find((part) => part !== '');
    return line === undefined ? 'New note' : line;
  }

  /** The row preview: the next line with text after the title, shortened. */
  function notePreview(text) {
    const lines = text.split('\n').map((part) => part.trim()).filter((part) => part !== '');
    const next = lines[1] || '';
    return next.length > NOTE_PREVIEW ? `${next.slice(0, NOTE_PREVIEW).trimEnd()}...` : next;
  }

  /** The saved clip a note was made from: it sits at the clip's start. */
  function clipForNote(note, clips) {
    if (note.anchor === null || note.anchor === undefined) return null;
    return clips.find((clip) => Math.abs(clip.start - note.anchor) <= TOLERANCE) || null;
  }

  /** Notes typed during the recording in time order, then later ones by creation. */
  function orderNotes(notes) {
    return notes.slice().sort((a, b) => {
      if (a.anchor !== null && b.anchor !== null) return a.anchor === b.anchor ? a.createdAt.localeCompare(b.createdAt) : a.anchor - b.anchor;
      if (a.anchor !== null) return -1;
      if (b.anchor !== null) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  /** Cuts a note to NOTE_MAX_LENGTH characters as the person sees them. */
  function limitNote(text) {
    if (typeof Intl === 'undefined' || !Intl.Segmenter) return text.slice(0, NOTE_MAX_LENGTH);
    const parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text));
    return parts.length <= NOTE_MAX_LENGTH ? text : parts.slice(0, NOTE_MAX_LENGTH).map((part) => part.segment).join('');
  }

  const api = {
    SKIP_SECONDS, SPEEDS,
    clock, duration,
    clipLineIndices, clipPositions,
    selection: { first, last, count, contains, tapLine, extendTo, moveBy, extendBy },
    clipSummary,
    makeTimeline, clampTime, locate, currentTurn, nextSpeed,
    spanLineIndices, spanLines, questionStep,
    attestationText, facts,
    splitNote, joinNote, noteTitle, notePreview, clipForNote, orderNotes, limitNote,
  };
  global.BriefsMeeting = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
