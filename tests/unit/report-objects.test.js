'use strict';

/**
 * Report objects (js/shared/report-objects.js): the side panel's model for
 * any data object a row points to (GET /api/v1/report-objects/:object/:id,
 * one shape for every object). Only allowlisted fields render; anything
 * that looks like a secret never does.
 */

const path = require('path');
const R = require(path.join(__dirname, '../../src/js/shared/report-objects.js'));
const samples = require(path.join(__dirname, '../fixtures/report-objects/samples.json'));

describe('refs on rows', () => {
  test('row.refs in order; person refs keep user_id', () => {
    const row = { refs: [{ object: 'deal', id: 'd-1' }, { object: 'person', id: 'p-1', user_id: 'u-9' }, { object: 'deal' }, null] };
    expect(R.refsOf(row)).toEqual([{ object: 'deal', id: 'd-1' }, { object: 'person', id: 'p-1', user_id: 'u-9' }]);
    expect(R.primaryRef(row)).toEqual({ object: 'deal', id: 'd-1' });
  });
  test('no refs: nothing to open', () => {
    expect(R.refsOf({ record_id: 'x' })).toEqual([]);
    expect(R.primaryRef({})).toBe(null);
    expect(R.primaryRef(null)).toBe(null);
  });
  test('a ref travels as one attribute value and back', () => {
    const ref = { object: 'person', id: 'p 1', user_id: 'u-9' };
    expect(R.parseRef(R.refAttr(ref))).toEqual(ref);
    expect(R.parseRef('nonsense')).toBe(null);
  });
});

describe('secrets never render', () => {
  test('keys and labels that look like secrets are dropped', () => {
    ['password', 'Password hash', 'reset_token', 'api_key', 'client_secret', 'hash', 'refresh token', 'apiKey'].forEach((k) => expect(R.isSecretKey(k)).toBe(true));
    ['email', 'Amount', 'monkey business', 'role', 'Last signed in'].forEach((k) => expect(R.isSecretKey(k)).toBe(false));
  });
});

describe('panelModel: one shape for every object', () => {
  test('a person: facts, LANA account (allowlisted), linked accounts, activity with its dates and note, links', () => {
    const m = R.panelModel(samples.person);
    expect(m.title).toBe('Avery Stone');
    expect(m.kind).toBe('Person');
    expect(m.facts.map((f) => [f.label, f.text])).toEqual([['Email', 'avery@example.test'], ['Phone', '+1 555 0100'], ['Role', 'Attorney']]);
    expect(m.facts[0].href).toBe('mailto:avery@example.test');
    expect(m.facts[1].href).toBe('tel:+15550100');
    expect(m.account.state).toBe('Invited, not signed in yet');
    expect(m.account.rows.map((r) => r[0])).toEqual(['Role', 'Title', 'Invited', 'Account created', 'Activated', 'Last signed in']);
    expect(m.account.rows.find((r) => r[0] === 'Activated')[1]).toBe('Not yet');
    expect(JSON.stringify(m)).not.toContain('never-show');
    expect(m.linked).toEqual([
      { connection: 'Leadly (Main office)', name: 'Avery S.', email: 'avery@leadly.example', matchedBy: 'Matched by email' },
      { connection: 'ActionStep', name: 'Avery Stone', email: '', matchedBy: 'Matched by name' },
    ]);
    expect(m.activity.map((a) => [a.label, a.text])).toEqual([['Meetings held', '12'], ['Meetings missed', '1'], ['Messages sent', 'Not available yet'], ['Deals owned', '4']]);
    expect(m.activityTitle).toBe('Activity for Nov 1, 2026 to Nov 30, 2026');
    expect(m.activityNote).toBe('Messages show once message history has synced.');
    expect(m.links).toEqual([{ label: 'Smith Estate Plan', ref: { object: 'deal', id: 'd-1' }, kind: 'Deal' }]);
  });

  test('a deal: formatted facts, timeline newest first with actors, details and other people, contributors with what they did', () => {
    const m = R.panelModel(Object.assign({}, samples.deal, { timeline: samples.deal.timeline.slice().reverse() }));
    expect(m.facts.map((f) => [f.label, f.text])).toEqual([['Amount', '$4,500'], ['Stage', 'Won'], ['Won on', 'Nov 3, 2026'], ['Win rate', '42.5%']]);
    expect(m.timeline.map((t) => t.text)).toEqual(['Marked as won', 'Consultation held', 'Lead came in from Referral']);
    expect(m.timeline[2]).toMatchObject({ when: 'Oct 1, 2026', actor: { label: 'Jordan Smith', ref: null }, detail: 'Referred by a past client',
      main: { object: 'contact', id: 'c-1' }, refs: [] });
    expect(m.timeline[1]).toMatchObject({ actor: { label: 'Avery Stone', ref: { object: 'person', id: 'p-1', user_id: 'u-9' } }, byOwner: true,
      others: [{ label: 'Blake Ross', ref: { object: 'person', id: 'p-2' } }], main: { object: 'appointment', id: 'ap-3' } });
    expect(m.timeline[0].actor).toEqual({ label: 'Not recorded', ref: null });
    expect(m.contributors).toEqual([
      { label: 'Avery Stone', ref: { object: 'person', id: 'p-1', user_id: 'u-9' }, did: ['Held meetings: 2', 'Booked meetings: 1'], owner: true, follower: false },
      { label: 'Blake Ross', ref: { object: 'person', id: 'p-2' }, did: ['Booked meetings: 3'], owner: false, follower: true },
    ]);
  });

  test('restricted records: whatever comes renders; missing fields are skipped, never blank', () => {
    const m = R.panelModel(samples.restricted_deal);
    expect(m.title).toBe('J. S. Estate');
    expect(m.facts.map((f) => f.label)).toEqual(['Amount']);
  });

  test('any other object renders the same way', () => {
    const m = R.panelModel(samples.contact);
    expect(m).toMatchObject({ title: 'Jordan Smith', kind: 'Contact', account: null, timeline: [], contributors: [] });
    expect(m.facts.map((f) => f.label)).toEqual(['Email', 'Source']);
  });

  test('every format reads plainly', () => {
    expect(R.formatFact(null, 'text')).toBe('');
    expect(R.formatFact(1234.5, 'number')).toBe('1,234.5');
    expect(R.formatFact('2026-11-03T15:30:00Z', 'datetime')).toContain('Nov 3, 2026');
    expect(R.formatFact('in_review', 'status')).toBe('In review');
    expect(R.formatFact(true, 'text')).toBe('Yes');
  });
});

describe('when the record cannot load', () => {
  test('calm words by status', () => {
    expect(R.errorText({ status: 404 })).toBe('Not found, or you don\'t have access to this record.');
    expect(R.errorText({ status: 403 })).toBe('You don\'t have access to this record.');
    expect(R.errorText({ status: 400 })).toBe('This kind of record can\'t be shown here.');
    expect(R.errorText({ status: 500 })).toBe('This record could not load. Try again in a moment.');
  });
  test('the row\'s own fields stand in, without refs, internal keys or secrets', () => {
    const m = R.rowModel({ refs: [{ object: 'deal', id: 'd-1' }], record_id: 'r', client_name: 'Jordan Smith', amount: 4500, password: 'x', _row_id: 'row-1', deal_id: 'd-1' });
    expect(m.facts.map((f) => [f.label, f.text])).toEqual([['Client', 'Jordan Smith'], ['Amount', '4500']]);
  });
});

describe('live check: deal timeline, person facts, activity dates', () => {
  const deal = {
    object: 'deal', id: 'd-1', title: 'Smith Estate Plan', facts: [], timeline_total: 3, timeline_note: 'Some messages came before the deal was created.',
    timeline: [
      { occurred_at: '2026-09-20T10:00:00Z', label: 'Message received', actor: null, actor_kind: 'client', actor_label: 'Jordan Smith', before_deal: true,
        refs: [{ object: 'message', id: 'm-1' }, { object: 'deal', id: 'd-1' }] },
      { occurred_at: '2026-10-05T16:30:00Z', label: 'Consultation held', actor: { object: 'person', id: 'p-1', user_id: 'u-9', label: 'Avery Stone' }, actor_kind: 'team',
        refs: [{ object: 'appointment', id: 'ap-3' }, { object: 'deal', id: 'd-1' }, { object: 'person', id: 'p-1' }, { object: 'form_fill', id: 'f-1' }, { object: 'contact', id: 'c-1' }] },
      { occurred_at: '2026-11-03T10:00:00Z', label: 'Marked as won', actor: null, actor_kind: 'not_recorded', refs: [] },
    ],
  };
  test('newest first; the label links to its main ref; refs to this deal or the actor are dropped; extras listed', () => {
    const m = R.panelModel(deal);
    expect(m.timeline.map((t) => t.text)).toEqual(['Marked as won', 'Consultation held', 'Message received']);
    expect(m.timeline[1].main).toEqual({ object: 'appointment', id: 'ap-3' });
    expect(m.timeline[1].refs.map((r) => r.label)).toEqual(['Form', 'Contact']);
    expect(m.timeline[2].main).toEqual({ object: 'message', id: 'm-1' });
    expect(m.timeline[2].refs).toEqual([]);
    expect(m.timeline[2].beforeDeal).toBe(true);
    expect(m.timelineNote).toBe('Some messages came before the deal was created.');
    expect(m.timelineTotal).toBe(3);
  });
  test('person facts that repeat the LANA account are hidden when the account section shows', () => {
    const person = { object: 'person', id: 'p-1', title: 'Avery Stone',
      facts: [{ label: 'Email', value: 'a@x.test', format: 'email' }, { label: 'LANA account', value: 'Active', format: 'status' },
        { label: 'LANA role', value: 'Admin', format: 'text' }, { label: 'Last signed in to LANA', value: '2026-11-20T15:00:00Z', format: 'datetime' }],
      lana_account: { state: 'Active', user_id: 'u-1', role: 'Admin', last_signed_in_at: '2026-11-20T15:00:00Z' } };
    expect(R.panelModel(person).facts.map((f) => f.label)).toEqual(['Email']);
  });
  test('activity_period end one day after the requested end is shown as the requested end; an inclusive end is kept', () => {
    const data = { object: 'person', id: 'p', title: 'P', activity: [{ label: 'Meetings held', value: 1, format: 'number' }], activity_period: { period_start: '2026-10-29', period_end: '2026-11-28' } };
    expect(R.panelModel(data, { requestedEnd: '2026-11-27' }).activityTitle).toBe('Activity for Oct 29, 2026 to Nov 27, 2026');
    expect(R.panelModel(Object.assign({}, data, { activity_period: { period_start: '2026-10-29', period_end: '2026-11-27' } }), { requestedEnd: '2026-11-27' }).activityTitle)
      .toBe('Activity for Oct 29, 2026 to Nov 27, 2026');
    expect(R.panelModel(data, {}).activityTitle).toBe('Activity for Oct 29, 2026 to Nov 28, 2026');
  });
});
