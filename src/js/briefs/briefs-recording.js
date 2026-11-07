/**
 * LANA Briefs "New meeting" rules (ported from the standalone NewMeetingScreen): when
 * Start can run, which panel shows for the recording's phase, the progress steps after
 * Stop, and the meters. Plain functions; the page renders with them.
 */
(function (global) {
  'use strict';

  const LIVE = ['starting', 'recording', 'paused'];
  const PROCESSING = ['importing', 'saving', 'transcribing', 'writingNotes'];
  /** Readings kept for each meter. */
  const METER_BARS = 48;

  function isLive(view) {
    return Boolean(view) && LIVE.includes(view.phase);
  }

  function isProcessing(view) {
    return Boolean(view) && PROCESSING.includes(view.phase);
  }

  /** "setup", "live" or "progress": which part of New meeting shows. */
  function panelFor(view) {
    if (isLive(view)) return 'live';
    if (isProcessing(view) || (view && view.phase === 'done' && view.message !== null)) return 'progress';
    return 'setup';
  }

  /** The names typed, comma separated, trimmed, blanks dropped. */
  function participants(text) {
    return String(text || '').split(',').map((name) => name.trim()).filter((name) => name !== '');
  }

  /** Why Start (and Import) cannot run yet, or null when they can. */
  function missingReason(form, transcriptionReady) {
    if (!form.confirmed) return 'Confirm consent to start recording.';
    if (form.consent === 'allPartiesConfirmed' && participants(form.people).length === 0) return 'Add the people who confirmed.';
    if (!transcriptionReady) return 'LANA transcription is needed to record. Download it in Settings.';
    return null;
  }

  /** The request Start and Import send. */
  function request(form) {
    return {
      title: String(form.title || ''),
      consent: form.consent === 'allPartiesConfirmed' ? 'allPartiesConfirmed' : 'announced',
      participants: participants(form.people),
      jurisdictionNote: String(form.jurisdiction || ''),
    };
  }

  /** The three steps after Stop or Import, each "done", "active" or "waiting", with progress on the active one. */
  function progressSteps(view) {
    const phase = view.phase;
    const reading = phase === 'importing' || phase === 'saving';
    return [
      { title: phase === 'importing' ? 'Reading the recording' : 'Saving the recording', state: reading ? 'active' : 'done', progress: phase === 'importing' ? view.progress : null },
      { title: 'Transcribing and telling the speakers apart', state: phase === 'transcribing' ? 'active' : (phase === 'writingNotes' || phase === 'done') ? 'done' : 'waiting', progress: phase === 'transcribing' ? view.progress : null },
      { title: 'Writing key points, decisions, open questions and actions', state: phase === 'writingNotes' ? 'active' : phase === 'done' ? 'done' : 'waiting', progress: phase === 'writingNotes' ? view.progress : null },
    ];
  }

  /** Keeps the last METER_BARS readings. */
  function pushLevel(levels, value) {
    const next = levels.concat([Math.max(0, Math.min(1, Number(value) || 0))]);
    return next.length > METER_BARS ? next.slice(next.length - METER_BARS) : next;
  }

  /** "Off", "Hearing sound" or "Quiet". */
  function meterStatus(levels, off) {
    if (off) return 'Off';
    return levels.slice(-6).some((level) => level > 0.15) ? 'Hearing sound' : 'Quiet';
  }

  /** What the live panel says it is doing. */
  function liveState(view) {
    if (view.phase === 'starting') return 'Opening the microphone and the meeting audio';
    return view.phase === 'recording' ? 'Recording' : 'Paused';
  }

  /** Notes about the microphone and meeting audio access, with which can open settings. */
  function permissionNotes(permissions) {
    if (!permissions) return [];
    const notes = [];
    if (permissions.microphone === 'denied') {
      notes.push({ kind: 'microphone', tone: 'warning', text: 'LANA cannot use the microphone. Allow LANA in System Settings, Privacy and Security, Microphone.', canOpen: true });
    }
    if (permissions.meetingAudio === 'denied') {
      notes.push({ kind: 'meetingAudio', tone: 'warning', text: 'To record the other people in a call, allow LANA in System Settings, Privacy and Security, Screen and System Audio Recording, then quit and reopen LANA. Without it only your microphone is recorded.', canOpen: true });
    } else if (permissions.meetingAudio === 'notDetermined') {
      notes.push({ kind: 'meetingAudio', tone: 'info', text: 'When you start, this computer asks to let LANA record the meeting audio. Allow it so the other people in the call are recorded too. LANA keeps only the sound, never the screen.', canOpen: false });
    }
    return notes;
  }

  const api = { METER_BARS, isLive, isProcessing, panelFor, participants, missingReason, request, progressSteps, pushLevel, meterStatus, liveState, permissionNotes };
  global.BriefsRecording = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
