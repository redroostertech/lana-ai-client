/**
 * Firm Handbook structured item view models: the type choices, the work
 * hours grid and the follow-up rule form to and from the API's data. (Reading
 * an item shows the server's words; nothing here rebuilds them.) Each
 * refusal has an accepted control.
 */

const M = require('../../src/js/firm-handbook/firm-handbook-structured.models');

const TYPES = {
  types: [
    { kind: 'text', label: 'Text', cardinality: 'many', structured: false },
    { kind: 'work_hours', label: 'Work hours', cardinality: 'one', structured: true, description: 'The days and times your firm works.' },
    {
      kind: 'followup_rule', label: 'Follow-up rule', cardinality: 'many', structured: true,
      options: {
        match_fields: [
          { value: 'event_type', label: 'LANA event type', source: 'lana' },
          { value: 'calendar_id', label: 'LANA calendar', source: 'lana' },
          { value: 'appointment_type', label: 'Appointment type from a connected app', source: 'connector' }
        ],
        sources: [{ value: 'lana', label: 'LANA calendar' }, { value: 'leadly', label: 'Leadly' }]
      }
    }
  ]
};

describe('type choices', () => {
  test('a one-per-firm type that exists is offered disabled with a reason; others stay open', () => {
    const open = M.typeChoices(TYPES, []);
    expect(open.map((c) => [c.value, c.disabled])).toEqual([['text', false], ['work_hours', false], ['followup_rule', false]]);
    const taken = M.typeChoices(TYPES, [{ kind: 'work_hours' }, { kind: 'followup_rule' }]);
    expect(taken.find((c) => c.value === 'work_hours')).toMatchObject({ disabled: true, reason: expect.stringContaining('already has work hours') });
    expect(taken.find((c) => c.value === 'followup_rule').disabled).toBe(false);
  });

  test('without the type list only Text is offered', () => {
    expect(M.typeChoices(null, []).map((c) => c.value)).toEqual(['text']);
  });
});

describe('work hours', () => {
  const rowsWith = (overrides) => M.toWorkHoursRows(null).map((row) => ({ ...row, ...(overrides[row.day] || {}) }));

  test('a blank grid starts Monday to Friday 8 to 6 and builds the API data', () => {
    const built = M.buildWorkHoursData(M.toWorkHoursRows(null));
    expect(built.valid).toBe(true);
    expect(built.data.days.monday).toEqual({ start: '08:00', end: '18:00' });
    expect(built.data.days.saturday).toBeNull();
    expect(Object.keys(built.data.days)).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
  });

  test('stored data round-trips through the grid', () => {
    const data = { days: { monday: { start: '09:00', end: '17:30' }, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: { start: '10:00', end: '12:00' }, sunday: null } };
    expect(M.buildWorkHoursData(M.toWorkHoursRows(data))).toEqual({ valid: true, message: '', data });
  });

  test.each([
    ['an end before the start', { monday: { end: '07:00' } }, 'On Monday, the end time must be after the start time.'],
    ['a missing time', { tuesday: { start: '' } }, 'Add a start and an end time for Tuesday.']
  ])('refuses %s (control: a closed day with the same times is fine)', (_name, override, message) => {
    expect(M.buildWorkHoursData(rowsWith(override))).toEqual({ valid: false, message });
    const day = Object.keys(override)[0];
    expect(M.buildWorkHoursData(rowsWith({ [day]: { ...override[day], open: false } })).valid).toBe(true);
  });

  test('refuses a week with no working day', () => {
    const closed = M.toWorkHoursRows(null).map((row) => ({ ...row, open: false }));
    expect(M.buildWorkHoursData(closed)).toEqual({ valid: false, message: M.MESSAGES.noWorkingDay });
  });

});

describe('follow-up rule', () => {
  const form = (overrides) => ({ ...M.toRuleForm(null), matchValue: 'consultation', label: 'Consultation', taskTitle: 'Send the letter', ...overrides });

  test('a LANA event type rule builds data with source lana and no payment defaults', () => {
    expect(M.buildRuleData(form())).toEqual({
      valid: true, message: '',
      data: { source: 'lana', match_field: 'event_type', match_value: 'consultation', label: 'Consultation',
        task_title: 'Send the letter', create_payment_proposal: false, payment_defaults: {} }
    });
  });

  test('a connected app rule needs its app (control: with it, it builds)', () => {
    expect(M.buildRuleData(form({ matchField: 'appointment_type' }))).toEqual({ valid: false, message: M.MESSAGES.ruleSource });
    expect(M.buildRuleData(form({ matchField: 'appointment_type', source: 'leadly' })).data).toMatchObject({ source: 'leadly', match_field: 'appointment_type' });
  });

  test('a payment review carries its defaults; bad numbers are refused', () => {
    const built = M.buildRuleData(form({ paymentReview: true, paymentType: 'retainer', amount: '1500', dueInDays: '7' }));
    expect(built.data).toMatchObject({ create_payment_proposal: true, payment_defaults: { payment_type: 'retainer', amount: 1500, due_in_days: 7 } });
    expect(M.buildRuleData(form({ paymentReview: true, amount: 'lots' }))).toEqual({ valid: false, message: M.MESSAGES.amount });
    expect(M.buildRuleData(form({ paymentReview: true, dueInDays: '2.5' }))).toEqual({ valid: false, message: M.MESSAGES.dueDays });
    // Defaults typed while the review is off are not sent.
    expect(M.buildRuleData(form({ paymentReview: false, amount: '99' })).data.payment_defaults).toEqual({});
  });

  test.each([
    ['matchValue', M.MESSAGES.ruleValue], ['label', M.MESSAGES.ruleLabel], ['taskTitle', M.MESSAGES.ruleTask]
  ])('a blank %s is refused', (field, message) => {
    expect(M.buildRuleData(form({ [field]: '  ' }))).toEqual({ valid: false, message });
  });

  test('stored data round-trips through the form, and a stored app not in the list is kept as a choice', () => {
    const data = { source: 'oldcrm', match_field: 'appointment_type', match_value: 'Intake', label: 'Intake', task_title: 'Call back',
      create_payment_proposal: true, payment_defaults: { amount: 250, due_in_days: 0 } };
    expect(M.buildRuleData(M.toRuleForm(data)).data).toEqual(data);
    const type = M.findType(TYPES, 'followup_rule');
    expect(M.sourceOptions(type, 'oldcrm')).toEqual([{ value: 'leadly', label: 'Leadly' }, { value: 'oldcrm', label: 'oldcrm' }]);
  });


  test('suggested title and evidence lines', () => {
    expect(M.suggestedRuleTitle(' Consultation ')).toBe('Follow-up rule: Consultation');
    expect(M.suggestedRuleTitle('')).toBe('');
    expect(M.evidenceLines({ evidence: { meetings: 4, window_days: 180, followed_by_payment: 3, handbook_items: [{ id: 'h', title: 'Fees' }] } })).toEqual([
      '4 meetings of this type in the last 180 days', '3 followed by a payment on the same matter', 'Named in the handbook item "Fees"'
    ]);
    expect(M.evidenceLines(null)).toEqual([]);
  });
});
