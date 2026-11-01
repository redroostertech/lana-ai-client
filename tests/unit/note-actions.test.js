'use strict';

const A = require('../../src/js/shared/note-actions.js');

const about = (kind, id) => ({ id: 'l-' + id, link_type: 'about', source: { kind: 'matter_note', id: 'n1' }, target: { kind, id } });
const fact = (links) => ({ note_id: 'n1', label: 'fact', links });

// The makeup view's note_actions as backend phase 7b declares them.
const RECORD = {
  id: 'record_evidence', label: 'Record as evidence', form: 'provider.record_observation', subject: 'matter_note:{note_id}',
  applies_to: { labels: ['fact'], about_kinds: ['matter_asset', 'assurance_record'] },
};
const OTHER = { id: 'other', label: 'Other', form: 'provider.other', subject: 'matter_note:{note_id}', applies_to: { labels: ['open_question'], about_kinds: ['contact'] } };

describe('actionsFor', () => {
  test('a note with an applying label and an about link of an applying kind gets the action', () => {
    expect(A.actionsFor(fact([about('matter_asset', 'a1')]), [RECORD, OTHER])).toEqual([RECORD]);
    expect(A.actionsFor(fact([about('assurance_record', 't1')]), [RECORD])).toEqual([RECORD]);
  });
  test('control: another label, another kind, a cites link, or no note actions offer nothing', () => {
    expect(A.actionsFor({ ...fact([about('matter_asset', 'a1')]), label: 'open_question' }, [RECORD])).toEqual([]);
    expect(A.actionsFor(fact([about('contact', 'c1')]), [RECORD])).toEqual([]);
    expect(A.actionsFor(fact([{ ...about('matter_asset', 'a1'), link_type: 'cites' }]), [RECORD])).toEqual([]);
    expect(A.actionsFor(fact([about('matter_asset', 'a1')]), undefined)).toEqual([]);
    expect(A.actionsFor(null, [RECORD])).toEqual([]);
  });
  test('a link written from the other side counts by its far end', () => {
    const reverse = { id: 'l9', link_type: 'about', source: { kind: 'assurance_record', id: 't1' }, target: { kind: 'matter_note', id: 'n1' } };
    expect(A.actionsFor(fact([reverse]), [RECORD])).toEqual([RECORD]);
  });
});

test('subjectFor puts the note id in the declared subject', () => {
  expect(A.subjectFor(RECORD, 'n1')).toBe('matter_note:n1');
});

describe('candidateChoice', () => {
  const refusal = (status, details) => Object.assign(new Error('This note is about 2 targets.'), {
    status, code: 'ASSURANCE_NOTE_TARGET_AMBIGUOUS', data: { error: { code: 'ASSURANCE_NOTE_TARGET_AMBIGUOUS', message: 'x', details } },
  });

  test('offers only the server candidates, with their labels', () => {
    const choice = A.candidateChoice(refusal(422, { candidates: [
      { subject: 'matter_note:n1:t1', label: 'House: owner' }, { subject: 'matter_note:n1:t2', label: 'House: shares' }] }));
    expect(choice.choices).toEqual([{ value: 'matter_note:n1:t1', label: 'House: owner' }, { value: 'matter_note:n1:t2', label: 'House: shares' }]);
    expect(choice.message).toBe(A.MESSAGES.choose);
  });
  test('control: no candidates, another status, or no error offers no choice', () => {
    expect(A.candidateChoice(refusal(422, {}))).toBeNull();
    expect(A.candidateChoice(refusal(422, { candidates: [{ label: 'no subject' }] }))).toBeNull();
    expect(A.candidateChoice(refusal(403, { candidates: [{ subject: 'matter_note:n1:t1', label: 'x' }] }))).toBeNull();
    expect(A.candidateChoice(null)).toBeNull();
  });
});
