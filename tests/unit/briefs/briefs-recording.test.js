'use strict';

/** New meeting rules (src/js/briefs/briefs-recording.js). */
const R = require('../../../src/js/briefs/briefs-recording');

const view = (phase, extra = {}) => ({ phase, meetingID: null, title: 'Intake', elapsedSeconds: 0, meetingAudio: 'pending', progress: 0, message: null, ...extra });

test('the panel follows the recording phase', () => {
  expect(R.panelFor(null)).toBe('setup');
  expect(R.panelFor(view('idle'))).toBe('setup');
  expect(R.panelFor(view('failed', { message: 'No mic' }))).toBe('setup');
  ['starting', 'recording', 'paused'].forEach((phase) => expect(R.panelFor(view(phase))).toBe('live'));
  ['importing', 'saving', 'transcribing', 'writingNotes'].forEach((phase) => expect(R.panelFor(view(phase))).toBe('progress'));
  expect(R.panelFor(view('done', { message: 'Notes could not be written' }))).toBe('progress');
  expect(R.panelFor(view('done'))).toBe('setup');
});

test('Start waits for consent, the people who confirmed, and transcription', () => {
  const form = { confirmed: false, consent: 'announced', people: '' };
  expect(R.missingReason(form, true)).toBe('Confirm consent to start recording.');
  expect(R.missingReason({ ...form, confirmed: true, consent: 'allPartiesConfirmed' }, true)).toBe('Add the people who confirmed.');
  expect(R.missingReason({ ...form, confirmed: true, consent: 'allPartiesConfirmed', people: ' Ana , ' }, true)).toBeNull();
  expect(R.missingReason({ ...form, confirmed: true }, false)).toMatch(/transcription is needed/);
  expect(R.missingReason({ ...form, confirmed: true }, true)).toBeNull();
});

test('the request trims names and keeps only the two consent kinds', () => {
  expect(R.request({ title: 'Intake', consent: 'allPartiesConfirmed', people: 'Ana, ,Ben ', jurisdiction: 'CA' }))
    .toEqual({ title: 'Intake', consent: 'allPartiesConfirmed', participants: ['Ana', 'Ben'], jurisdictionNote: 'CA' });
  expect(R.request({ consent: 'other' }).consent).toBe('announced');
});

test('progress steps after Stop and Import', () => {
  expect(R.progressSteps(view('importing', { progress: 0.4 })).map((step) => [step.title, step.state, step.progress]))
    .toEqual([['Reading the recording', 'active', 0.4], ['Transcribing and telling the speakers apart', 'waiting', null], ['Writing key points, decisions, open questions and actions', 'waiting', null]]);
  expect(R.progressSteps(view('transcribing', { progress: 0.5 })).map((step) => step.state)).toEqual(['done', 'active', 'waiting']);
  expect(R.progressSteps(view('done')).map((step) => step.state)).toEqual(['done', 'done', 'done']);
});

test('meters keep the last readings and say whether sound is heard', () => {
  let levels = [];
  for (let i = 0; i < 60; i += 1) levels = R.pushLevel(levels, i === 59 ? 2 : 0);
  expect(levels).toHaveLength(R.METER_BARS);
  expect(levels[levels.length - 1]).toBe(1);
  expect(R.meterStatus(levels, false)).toBe('Hearing sound');
  expect(R.meterStatus([0, 0], false)).toBe('Quiet');
  expect(R.meterStatus(levels, true)).toBe('Off');
});

test('permission notes', () => {
  expect(R.permissionNotes(null)).toEqual([]);
  expect(R.permissionNotes({ microphone: 'granted', meetingAudio: 'granted' })).toEqual([]);
  expect(R.permissionNotes({ microphone: 'denied', meetingAudio: 'notDetermined' }).map((note) => [note.kind, note.canOpen])).toEqual([['microphone', true], ['meetingAudio', false]]);
  expect(R.liveState(view('starting'))).toMatch(/Opening/);
});
