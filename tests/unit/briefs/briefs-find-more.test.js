'use strict';

/** Find more notes on the meeting page (src/js/briefs/briefs-find-more.js). Synthetic text only. */
const F = require('../../../src/js/briefs/briefs-find-more');

const view = (fields) => Object.assign({ meetingID: 'mtg_1', status: 'idle', part: 0, of: 0, suggestions: [], lastRun: null }, fields);
const suggestion = (fields) => Object.assign({ id: 's1', kind: 'summary', text: 'The retainer is 2,500 dollars.', owner: null, dueDate: null, dueText: null, decidedBy: null, start: 6, end: 12 }, fields);

describe('the Find more notes pill', () => {
  test('shows on a meeting with a transcript, hidden while notes are written or a run is going', () => {
    expect(F.canFindMore(view({}), { hasTranscript: true, writingNotes: false })).toBe(true);
    expect(F.canFindMore(view({}), { hasTranscript: false, writingNotes: false })).toBe(false);
    expect(F.canFindMore(view({}), { hasTranscript: true, writingNotes: true })).toBe(false);
    expect(F.canFindMore(view({ status: 'running' }), { hasTranscript: true, writingNotes: false })).toBe(false);
    expect(F.canFindMore(null, { hasTranscript: true, writingNotes: false })).toBe(true);
  });

  test('labels the run again after a run', () => {
    expect(F.pillLabel(view({}))).toBe('Find more notes');
    expect(F.pillLabel(view({ status: 'ready', lastRun: { at: '2026-11-16T15:00:00.000Z', found: 2 } }))).toBe('Find more notes again');
  });
});

describe('progress and results', () => {
  test('says which part LANA is reading', () => {
    expect(F.progressText(view({ status: 'running', part: 2, of: 5 }))).toBe('Finding more notes, part 2 of 5');
    expect(F.progressText(view({ status: 'running', part: 0, of: 0 }))).toBe('Finding more notes');
    expect(F.progressText(view({ status: 'ready' }))).toBeNull();
  });

  test('heads the list with how many are waiting, and says when nothing new was found', () => {
    expect(F.resultHeading(view({ status: 'ready', suggestions: [suggestion({}), suggestion({ id: 's2' })], lastRun: { at: 'x', found: 2 } }))).toBe('LANA found 2 more');
    expect(F.resultHeading(view({ status: 'ready', suggestions: [suggestion({})], lastRun: { at: 'x', found: 3 } }))).toBe('LANA found 1 more');
    expect(F.resultHeading(view({ status: 'ready', suggestions: [], lastRun: { at: 'x', found: 0 } }))).toBe('LANA did not find anything new.');
    expect(F.resultHeading(view({ status: 'ready', suggestions: [], lastRun: { at: 'x', found: 2 } }))).toBeNull();
    expect(F.resultHeading(view({ status: 'idle' }))).toBeNull();
    expect(F.resultHeading(view({ status: 'failed' }))).toBe('LANA could not finish reading this meeting. Try again.');
    expect(F.resultHeading(view({ status: 'unavailable' }))).toBe('The LANA model is needed to find more notes. Get it in Settings, Ask.');
  });

  test('names each kind and a task owner and due words', () => {
    expect(F.kindLabel('summary')).toBe('Key point');
    expect(F.kindLabel('decision')).toBe('Decision');
    expect(F.kindLabel('openQuestion')).toBe('Question');
    expect(F.kindLabel('task')).toBe('Task');
    expect(F.taskFacts(suggestion({ kind: 'task', owner: 'Omar Haddad', dueText: 'by Friday', dueDate: '2026-11-20' }))).toBe('Omar Haddad, by Friday');
    expect(F.taskFacts(suggestion({ kind: 'task', owner: null, dueDate: '2026-11-20' }))).toBe('Due 2026-11-20');
    expect(F.taskFacts(suggestion({ kind: 'summary', owner: 'x' }))).toBe('');
  });

  test('the notice when a run finishes', () => {
    expect(F.doneNotice(view({ status: 'ready', suggestions: [suggestion({})], lastRun: { at: 'x', found: 1 } }), 'Intake')).toEqual({ kind: 'success', text: 'LANA found 1 more note for Intake.' });
    expect(F.doneNotice(view({ status: 'ready', suggestions: [], lastRun: { at: 'x', found: 3 } }), 'Intake')).toEqual({ kind: 'success', text: 'LANA found 3 more notes for Intake.' });
    expect(F.doneNotice(view({ status: 'ready', lastRun: { at: 'x', found: 0 } }), 'Intake')).toEqual({ kind: 'info', text: 'LANA did not find anything new in Intake.' });
    expect(F.doneNotice(view({ status: 'failed' }), '')).toEqual({ kind: 'error', text: 'LANA could not finish finding more notes for this meeting.' });
    expect(F.doneNotice(view({ status: 'running' }), 'Intake')).toBeNull();
  });

  test('knows when a run just finished', () => {
    expect(F.justFinished(view({ status: 'running' }), view({ status: 'ready' }))).toBe(true);
    expect(F.justFinished(null, view({ status: 'ready' }))).toBe(false);
    expect(F.justFinished(view({ status: 'ready' }), view({ status: 'ready' }))).toBe(false);
  });
});
