'use strict';

/** Export on the meeting page (src/js/briefs/briefs-export.js): menu, file names, text and HTML. */
const X = require('../../../src/js/briefs/briefs-export');

function record(overrides = {}) {
  return {
    id: 'meeting_01',
    title: 'Annapolis',
    startedAt: '2026-11-10T14:05:00',
    durationSeconds: 42 * 60,
    speakers: [{ id: 's1', name: 'Ana Ruiz' }, { id: 's2', name: 'Ben <Ops>' }],
    transcript: [
      { speaker: 's1', start: 4, end: 9, text: 'We close on Friday.' },
      { speaker: 's1', start: 9, end: 12, text: 'Then the deed goes out.' },
      { speaker: 's2', start: 75, end: 80, text: 'Fees & costs <TBD>' },
      { speaker: '', start: 3725, end: 3730, text: 'All agree.' },
    ],
    keyPoints: [
      { id: 'k1', kind: 'summary', text: 'Closing set for Friday', sources: [{ start: 4, end: 12, speaker: 's1' }], precision: 'exact' },
      { id: 'k2', kind: 'decision', text: 'Use the revised trust', sources: [{ start: 75, end: 80, speaker: 's2' }], precision: 'approximate' },
      { id: 'k3', kind: 'openQuestion', text: 'Who signs for the estate?', sources: [], precision: 'exact' },
    ],
    gaps: [],
    userNotes: [],
    clips: [],
    actions: [{ id: 'a1', title: 'Send the deed', at: 9, confirmed: true }, { id: 'a2', title: 'Call the bank', at: 2, confirmed: false }],
    consent: 'announced',
    attestationMethod: 'qr',
    hasAudio: true,
    ...overrides,
  };
}

const notes = [
  { id: 'n2', text: 'Later thought\nCheck the county rules', createdAt: '2026-11-10T16:00:00', anchor: null },
  { id: 'n1', text: 'Deed\n\nFriday <noon>', createdAt: '2026-11-10T14:10:00', anchor: 65 },
  { id: 'n3', text: '   ', createdAt: '2026-11-10T14:11:00', anchor: 70 },
];

describe('menu', () => {
  test('lists the five exports in order, with audio only while it is kept', () => {
    expect(X.menuOptions(record()).map((item) => item.value)).toEqual(['transcriptPdf', 'transcriptText', 'notesPdf', 'meetingPdf', 'audio']);
    expect(X.menuOptions(record({ hasAudio: false })).map((item) => item.value)).not.toContain('audio');
    expect(X.menuOptions(record())[0]).toEqual(expect.objectContaining({ label: 'Transcript (PDF)', icon: 'file-text' }));
    const audio = (options) => options.find((item) => item.value === 'audio');
    expect(audio(X.menuOptions(record())).description).toBe('The original recording');
    expect(audio(X.menuOptions(record({ setAside: [{ start: 60, end: 120, reason: 'phone_call' }] }))).description).toBe('Set-aside parts are cut from this audio.');
  });
});

describe('file names', () => {
  test('title, local date and kind, without an extension', () => {
    expect(X.fileStem(record(), 'transcriptPdf')).toBe('Annapolis 2026-11-10 Transcript');
    expect(X.fileStem(record(), 'notesPdf')).toBe('Annapolis 2026-11-10 Notes');
    expect(X.fileStem(record(), 'meetingPdf')).toBe('Annapolis 2026-11-10 Meeting');
    expect(X.fileStem(record(), 'audio')).toBe('Annapolis 2026-11-10 Audio');
  });

  test('unsafe characters, empty titles, missing dates and long titles', () => {
    expect(X.fileStem(record({ title: 'Smith / Jones: "Intake"?' }), 'transcriptText')).toBe('Smith Jones Intake 2026-11-10 Transcript');
    expect(X.fileStem(record({ title: '   ' }), 'transcriptText')).toBe('Untitled meeting 2026-11-10 Transcript');
    expect(X.fileStem(record({ title: '../..', startedAt: 'not a date' }), 'transcriptText')).toBe('Meeting Transcript');
    expect(X.safeName('a'.repeat(200))).toHaveLength(80);
  });
});

describe('plain text transcript', () => {
  test('a header, then one line per transcript line with time and speaker', () => {
    const text = X.transcriptText(record());
    expect(text.split('\n').slice(0, 4)).toEqual(['Annapolis', 'Tuesday, November 10, 2026 at 2:05 PM', 'Length: 42 min', 'Speakers: Ana Ruiz, Ben <Ops>']);
    expect(text).toContain('[0:04] Ana Ruiz: We close on Friday.\n\n[0:09] Ana Ruiz: Then the deed goes out.');
    expect(text).toContain('[1:15] Ben <Ops>: Fees & costs <TBD>');
    expect(text).toContain('[1:02:05] Several speakers: All agree.');
  });

  test('no transcript and no speakers', () => {
    const text = X.transcriptText(record({ transcript: [], speakers: [] }));
    expect(text).not.toContain('Speakers:');
    expect(text).toContain('No transcript yet.');
  });
});

describe('PDF bodies', () => {
  test('transcript: header facts, speaker labels once per turn, times, everything escaped', () => {
    const html = X.transcriptHtml(record());
    expect(html).toContain('<h1 class="ex-title">Annapolis</h1>');
    expect(html).toContain('<dt>Length</dt><dd>42 min</dd>');
    expect(html).toContain('<dd>Ana Ruiz, Ben &lt;Ops&gt;</dd>');
    expect(html.match(/class="ex-speaker">Ana Ruiz</g)).toHaveLength(1);
    expect(html).toContain('ex-turn is-continued');
    expect(html).toContain('<span class="ex-time">1:02:05</span><span class="ex-speaker">Several speakers</span>');
    expect(html).toContain('Fees &amp; costs &lt;TBD&gt;');
    expect(html).not.toMatch(/<TBD>|<Ops>|style=/);
  });

  test('notes and key points: groups in order, sources, notes in meeting order without empty ones', () => {
    const html = X.notesHtml(record(), notes);
    const order = ['Key points', 'Decisions', 'Open questions', 'Your notes'].map((title) => html.indexOf(`<h2 class="ex-h2">${title}</h2>`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('Cited 0:04 to 0:12');
    expect(html).toContain('Cited about 1:15 to 1:20');
    expect(html).not.toContain('Ana Ruiz, 0:04');
    expect(html.indexOf('Deed')).toBeLessThan(html.indexOf('Later thought'));
    expect(html).toContain('<p class="ex-note-when">At 1:05</p>');
    expect(html).toContain('Friday &lt;noon&gt;');
    expect(html).toContain('Added after the meeting, 4:00 PM');
    expect(html.match(/class="ex-note"/g)).toHaveLength(2);
    expect(html).not.toContain('Transcript</h2>');
  });

  test('notes empty cases: no notes and no key points', () => {
    const html = X.notesHtml(record({ keyPoints: [] }), []);
    expect(html).toContain('No AI notes came with this meeting.');
    expect(html).toContain('No notes on this meeting.');
    expect(X.notesHtml(record({ keyPoints: [], transcript: [] }), [])).toContain('No notes yet.');
  });

  test('full meeting: points, actions by time, notes, then the transcript on a new page', () => {
    const html = X.meetingHtml(record(), notes);
    const at = (text) => html.indexOf(text);
    expect(at('<h2 class="ex-h2">Key points</h2>')).toBeLessThan(at('<h2 class="ex-h2">Actions</h2>'));
    expect(at('<h2 class="ex-h2">Actions</h2>')).toBeLessThan(at('<h2 class="ex-h2">Your notes</h2>'));
    expect(at('<h2 class="ex-h2">Your notes</h2>')).toBeLessThan(at('ex-page-break'));
    expect(at('ex-page-break')).toBeLessThan(at('<h2 class="ex-h2">Transcript</h2>'));
    expect(at('Call the bank')).toBeLessThan(at('Send the deed'));
    expect(html).toContain('Confirmed. Cited 0:09');
    expect(html).toContain('Proposed. Cited 0:02');
    expect(html).toContain('Owner: not said. No date given.');
    expect(X.meetingHtml(record({ actions: [], transcript: [] }), [])).toEqual(expect.stringContaining('No actions on this meeting.'));
    expect(X.meetingHtml(record({ transcript: [] }), [])).toContain('No transcript yet.');
  });
});

describe('the request the host saves', () => {
  test('text and PDFs carry their content; audio carries none', () => {
    const text = X.exportRequest(record(), notes, 'transcriptText');
    expect(text).toEqual({ meetingID: 'meeting_01', kind: 'transcriptText', fileName: 'Annapolis 2026-11-10 Transcript', title: 'Annapolis', content: X.transcriptText(record()) });
    expect(X.exportRequest(record(), notes, 'meetingPdf').content).toBe(X.meetingHtml(record(), notes));
    expect(X.exportRequest(record(), notes, 'notesPdf').content).toBe(X.notesHtml(record(), notes));
    expect(X.exportRequest(record(), notes, 'transcriptPdf').content).toBe(X.transcriptHtml(record()));
    const audio = X.exportRequest(record(), notes, 'audio');
    expect(audio).toEqual({ meetingID: 'meeting_01', kind: 'audio', fileName: 'Annapolis 2026-11-10 Audio', title: 'Annapolis' });
    expect(() => X.exportRequest(record(), notes, 'docx')).toThrow();
  });

  test('toast copy and the platform neutral reveal button', () => {
    expect(X.savedMessage('transcriptPdf', 1)).toBe('Transcript saved on this computer.');
    expect(X.savedMessage('notesPdf', 1)).toBe('Notes saved on this computer.');
    expect(X.savedMessage('audio', 1)).toBe('Audio saved.');
    expect(X.savedMessage('audio', 3)).toBe('Audio saved as 3 files.');
    expect(X.revealLabel('mac')).toBe('Show in Finder');
    expect(X.revealLabel('windows')).toBe('Show in folder');
    expect(X.revealLabel('linux')).toBe('Show in folder');
  });
});

// Briefs notes fixes (plan step 2 to 4). Synthetic meeting text only.
describe('owners, due dates, cited ranges and who decided', () => {
  const fixed = () => record({
    speakers: [{ id: 'S1', name: 'Dana Reyes' }, { id: 'S2', name: 'Omar Haddad' }, { id: 'S3', name: 'S3' }],
    transcript: [
      { speaker: 'S1', start: 0, end: 10, text: 'We go over the onboarding schedule.', setAsidePart: null },
      { speaker: 'S2', start: 10, end: 20, text: 'I will send the revised schedule tonight.', setAsidePart: null },
      { speaker: 'S1', start: 1318, end: 1330, text: 'Sorry, I have to take this call.', setAsidePart: 0 },
      { speaker: 'S3', start: 1330, end: 1569, text: 'Calling about the plumber visit on Saturday.', setAsidePart: 0 },
      { speaker: 'S1', start: 1792, end: 1854, text: 'The setup fee is 1,200 dollars.', setAsidePart: null },
    ],
    keyPoints: [
      { id: 'k1', kind: 'decision', text: 'The setup fee is 1,200 dollars.', sources: [{ start: 1792, end: 1820, speaker: 'S1' }, { start: 1840, end: 1854, speaker: 'S1' }], precision: 'exact', decidedBy: 'S1' },
      { id: 'k3', kind: 'summary', text: 'The onboarding schedule was reviewed.', sources: [{ start: 0, end: 10, speaker: 'S1' }], precision: 'exact', decidedBy: null },
    ],
    actions: [
      { id: 'a1', title: 'Send the revised schedule', at: 10, start: 10, end: 20, confirmed: false, owner: 'Omar Haddad', dueDate: '2026-11-11', dueText: 'tonight' },
      { id: 'a2', title: 'Map the payment timeline', at: 1792, start: 1792, end: 1854, confirmed: false, owner: null, dueDate: null, dueText: 'next month' },
    ],
    setAside: [{ start: 1318, end: 1569, reason: 'phone_call', speakers: ['S1', 'S3'] }],
    tables: [{ title: 'Fees', columns: ['Item', 'Amount'], rows: [['Setup fee', '1,200 dollars'], ['Monthly <fee>', '300']], sources: [{ start: 1792, end: 1854, speaker: 'S1' }] }],
    speakersNamed: true,
  });

  test('actions print "Owner: X. Due: Y" and the cited range, never a quoted speaker as author', () => {
    const html = X.meetingHtml(fixed(), []);
    expect(html).toContain('Owner: Omar Haddad. Due: Wednesday, November 11, 2026 (tonight).');
    expect(html).toContain('Owner: not said. Due: next month.');
    expect(html).toContain('Proposed. Cited 0:10 to 0:20.');
  });

  test('key points print the cited range from first to last source, and Decided by for decisions', () => {
    const html = X.notesHtml(fixed(), []);
    expect(html).toContain('Cited 29:52 to 30:54. Decided by Dana Reyes.');
    expect(html).toContain('Cited 0:00 to 0:10.');
    expect(html).not.toContain('Dana Reyes, 29:52');
  });

  test('set-aside parts: the lines the visible view marks are left out, with one placeholder line', () => {
    const html = X.meetingHtml(fixed(), []);
    for (const text of [html, X.transcriptText(fixed()), X.transcriptHtml(fixed()), X.notesHtml(fixed(), [])]) {
      expect(text).not.toContain('plumber');
      expect(text).not.toContain('take this call');
    }
    expect(html).toContain('Set aside: 21:58 to 26:09 (phone call)');
    expect(X.transcriptText(fixed())).toContain('Set aside: 21:58 to 26:09 (phone call)');
    expect(html.match(/Set aside: /g)).toHaveLength(1);
    expect(X.setAsideLine({ start: 60, end: 125, reason: 'other_matter' })).toBe('Set aside: 1:00 to 2:05 (another matter)');
    expect(X.setAsideLine({ start: 60, end: 125, reason: 'logistics' })).toBe('Set aside: 1:00 to 2:05 (meeting setup)');
    expect(X.setAsideLine({ start: 60, end: 125, reason: 'side_conversation' })).toBe('Set aside: 1:00 to 2:05 (side conversation)');
  });

  test('prints the actions and tables the visible view sends, in time order', () => {
    const record = fixed();
    record.actions = [{ id: 'a4', title: 'Compare both plans', at: 10, start: 10, end: 1854, confirmed: false, owner: null, dueDate: null, dueText: null }];
    expect(X.meetingHtml(record, [])).toContain('Compare both plans');
  });

  test('tables render as tables, escaped', () => {
    const html = X.notesHtml(fixed(), []);
    expect(html).toContain('<table class="ex-table">');
    expect(html).toContain('<th>Item</th><th>Amount</th>');
    expect(html).toContain('<td>Monthly &lt;fee&gt;</td><td>300</td>');
    expect(X.meetingHtml(fixed(), [])).toContain('<h3 class="ex-h3">Fees</h3>');
  });

  test('unnamed speakers are said plainly', () => {
    const html = X.meetingHtml(record({ speakersNamed: false, unnamedSpeakers: ['S3'] }), []);
    expect(html).toContain('<p class="ex-notice">1 speaker has no name yet (S3).</p>');
    expect(X.meetingHtml(record({ speakersNamed: false, unnamedSpeakers: ['S2', 'S3'] }), [])).toContain('2 speakers have no names yet (S2, S3).');
    expect(X.meetingHtml(fixed(), [])).not.toContain('no name');
    expect(X.meetingHtml(record({ speakersNamed: true, unnamedSpeakers: [] }), [])).not.toContain('no name');
  });

  test('no dashes or emoji in what the export adds', () => {
    const html = X.meetingHtml(fixed(), []);
    expect(html).not.toMatch(/[\u2013\u2014]/u);
    expect(html).not.toContain('|');
  });
});

describe('two speaker labels given the same name are one person', () => {
  const same = () => record({
    speakers: [{ id: 'S1', name: 'Dana Reyes' }, { id: 'S2', name: 'Omar Haddad' }, { id: 'S5', name: 'Dana Reyes' }],
    transcript: [
      { speaker: 'S1', start: 0, end: 5, text: 'First line.' },
      { speaker: 'S5', start: 5, end: 9, text: 'Same person, other label.' },
      { speaker: 'S2', start: 10, end: 14, text: 'Reply.' },
    ],
    keyPoints: [{ id: 'k1', kind: 'decision', text: 'Use the revised plan', sources: [{ start: 5, end: 9, speaker: 'S5' }], precision: 'exact', decidedBy: 'S5' }],
    actions: [{ id: 'a1', title: 'Send it', at: 5, start: 5, end: 9, confirmed: false, owner: 'S5', dueDate: null, dueText: null }],
    unnamedSpeakers: [],
  });
  test('the header lists the name once, the transcript runs on, and decided by and owner use the name', () => {
    const html = X.meetingHtml(same(), []);
    expect(html).toContain('<dd>Dana Reyes, Omar Haddad</dd>');
    expect(html.match(/class="ex-speaker">Dana Reyes</g)).toHaveLength(1);
    expect(html).toContain('Decided by Dana Reyes.');
    expect(html).toContain('Owner: Dana Reyes.');
    expect(X.transcriptText(same())).toContain('Speakers: Dana Reyes, Omar Haddad');
  });
});
