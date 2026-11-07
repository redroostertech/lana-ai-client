'use strict';

/** The meeting page's rules (src/js/briefs/briefs-meeting.js), ported from the standalone Briefs app. */
const M = require('../../../src/js/briefs/briefs-meeting');

const line = (start, end, speaker = 's1') => ({ speaker, start, end, text: 'x' });
const transcript = [line(0, 4), line(4, 9), line(9, 15), line(15, 20), line(20, 30)];
const { first, last, count, contains, tapLine, extendTo, moveBy, extendBy } = M.selection;

describe('time', () => {
  test('clock and duration', () => {
    expect(M.clock(65)).toBe('1:05');
    expect(M.clock(3725)).toBe('1:02:05');
    expect(M.clock(-3)).toBe('0:00');
    expect(M.duration(10)).toBe('1 min');
    expect(M.duration(42 * 60)).toBe('42 min');
    expect(M.duration(65 * 60)).toBe('1 hr 5 min');
    expect(M.duration(120 * 60)).toBe('2 hr');
  });
});

describe('clips', () => {
  test('a line belongs to a clip when it starts inside it', () => {
    expect(M.clipLineIndices({ id: 'c', start: 4, end: 15 }, transcript)).toEqual([1, 2]);
    expect(M.clipLineIndices({ id: 'c', start: 3.995, end: 9 }, transcript)).toEqual([1]);
  });

  test('clips draw as blocks: sharing a line merges, a skipped line splits', () => {
    const positions = M.clipPositions([{ id: 'a', start: 0, end: 9 }, { id: 'b', start: 4, end: 15 }, { id: 'c', start: 20, end: 30 }], transcript);
    expect([...positions.entries()]).toEqual([[0, 'first'], [1, 'middle'], [2, 'last'], [4, 'single']]);
  });
});

describe('picking lines', () => {
  const clips = [{ id: 'clip', start: 9, end: 20 }];

  test('a click picks a line; the same click again puts it down', () => {
    const picked = tapLine(0, null, clips, transcript);
    expect(picked).toEqual({ anchor: 0, focus: 0, clipID: null });
    expect(tapLine(0, picked, clips, transcript)).toBeNull();
  });

  test('a click inside a saved clip picks the whole clip; again puts it down', () => {
    const picked = tapLine(3, null, clips, transcript);
    expect(picked).toEqual({ anchor: 2, focus: 3, clipID: 'clip' });
    expect(tapLine(2, picked, clips, transcript)).toBeNull();
  });

  test('shift click stretches from the anchor and finds a clip covering exactly those lines', () => {
    const start = tapLine(2, null, [], transcript);
    const stretched = extendTo(3, start, clips, transcript);
    expect(stretched).toEqual({ anchor: 2, focus: 3, clipID: 'clip' });
    expect([first(stretched), last(stretched), count(stretched)]).toEqual([2, 3, 2]);
    expect(contains(stretched, 3)).toBe(true);
    expect(contains(stretched, 4)).toBe(false);
    expect(extendTo(4, start, clips, transcript).clipID).toBeNull();
  });

  test('arrow keys move and stretch inside the transcript', () => {
    expect(moveBy(1, null, 5)).toEqual({ anchor: 0, focus: 0, clipID: null });
    expect(moveBy(-1, null, 5)).toEqual({ anchor: 4, focus: 4, clipID: null });
    expect(moveBy(1, { anchor: 4, focus: 4, clipID: null }, 5).focus).toBe(4);
    expect(moveBy(1, null, 0)).toBeNull();
    expect(extendBy(1, { anchor: 1, focus: 1, clipID: null }, 5, [], transcript)).toEqual({ anchor: 1, focus: 2, clipID: null });
  });

  test('clip summary', () => {
    expect(M.clipSummary(1, '0:04', '0:04')).toBe('1 line, 0:04');
    expect(M.clipSummary(2, '0:04', '0:15')).toBe('2 lines, 0:04 to 0:15');
  });
});

describe('audio timeline', () => {
  const timeline = M.makeTimeline([10, NaN, 5]);

  test('parts join on one timeline', () => {
    expect(timeline).toEqual({ durations: [10, 0, 5], offsets: [0, 10, 10], duration: 15 });
    expect(M.locate(timeline, 12)).toEqual({ part: 2, time: 2 });
    expect(M.locate(timeline, 99)).toEqual({ part: 2, time: 5 });
    expect(M.locate(M.makeTimeline([]), 1)).toBeNull();
    expect(M.clampTime(timeline, -1)).toBe(0);
  });

  test('the turn under the playhead, with a grace after it ends', () => {
    expect(M.currentTurn(transcript, 5)).toBe(1);
    expect(M.currentTurn([line(0, 4), line(10, 12)], 4.5)).toBe(0);
    expect(M.currentTurn([line(0, 4), line(10, 12)], 6)).toBeNull();
  });

  test('speeds cycle', () => {
    expect(M.nextSpeed(1)).toBe(1.25);
    expect(M.nextSpeed(2)).toBe(1);
  });
});

describe('key points', () => {
  const question = { id: 'q', kind: 'openQuestion', sources: [{ start: 5, end: 10, speaker: 's1' }] };
  const record = (actions) => ({ transcript, actions });

  test('source lines: overlapping lines, and the line a zero-length span falls in', () => {
    expect(M.spanLineIndices(question.sources, transcript)).toEqual([1, 2]);
    expect(M.spanLines([{ start: 16, end: 16, speaker: null }], transcript)).toEqual({ first: 3, last: 3 });
    expect(M.spanLines([{ start: 99, end: 100, speaker: null }], transcript)).toBeNull();
  });

  test('an open question moves from available to drafting, ready and made', () => {
    expect(M.questionStep({ ...question, sources: [] }, record([]), [], new Set())).toBe('none');
    expect(M.questionStep(question, record([]), [], new Set())).toBe('available');
    expect(M.questionStep(question, record([]), [], new Set(['q']))).toBe('drafting');
    expect(M.questionStep(question, record([]), [{ questionID: 'q', state: { kind: 'drafting' } }], new Set())).toBe('drafting');
    expect(M.questionStep(question, record([{ at: 4, confirmed: false }]), [], new Set())).toBe('ready');
    expect(M.questionStep(question, record([{ at: 4, confirmed: true }]), [], new Set())).toBe('made');
  });
});

test('the facts line', () => {
  const text = M.facts({ durationSeconds: 120, speakers: [{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Ben' }], attestationMethod: 'acoustic', consent: 'announced' });
  expect(text).toBe('2 min. Ana, Ben. Verified by tone. Recording announced.');
  expect(M.attestationText('recordedHere')).toBe('Recorded on this computer');
});

describe('the person\'s notes', () => {
  const note = (id, anchor, createdAt, text = 'x') => ({ id, anchor, createdAt, text });

  test('title, body and preview like Notes.app', () => {
    expect(M.splitNote('Title\nline one\nline two')).toEqual({ title: 'Title', body: 'line one\nline two' });
    expect(M.joinNote('Title', '')).toBe('Title');
    expect(M.joinNote('Title', 'body')).toBe('Title\nbody');
    expect(M.noteTitle('\n  \nFirst\nSecond')).toBe('First');
    expect(M.noteTitle('')).toBe('New note');
    expect(M.notePreview('First\n\nSecond line')).toBe('Second line');
    expect(M.notePreview('Only')).toBe('');
    expect(M.notePreview(`T\n${'a'.repeat(130)}`)).toMatch(/^a{120}\.\.\.$/);
  });

  test('a note made from a clip sits at its start', () => {
    expect(M.clipForNote(note('n', 9.005, ''), [{ id: 'c', start: 9, end: 15 }])).toEqual({ id: 'c', start: 9, end: 15 });
    expect(M.clipForNote(note('n', null, ''), [{ id: 'c', start: 9, end: 15 }])).toBeNull();
  });

  test('notes in the recording come first by time, then later notes by creation', () => {
    const ordered = M.orderNotes([note('late2', null, '2026-11-02'), note('at30', 30, '2026-11-01'), note('late1', null, '2026-11-01'), note('at5', 5, '2026-11-01')]);
    expect(ordered.map((item) => item.id)).toEqual(['at5', 'at30', 'late1', 'late2']);
  });

  test('a note is cut at 10,000 characters as the person sees them', () => {
    expect(M.limitNote('a'.repeat(10005))).toHaveLength(10000);
    expect(M.limitNote('short')).toBe('short');
  });
});
