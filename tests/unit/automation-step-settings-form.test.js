const path = require('path');

const F = require(path.join(__dirname, '../../src/automation/js/shared/step-settings-form.js'));

// A declaration shaped like any step's: a repeatable group with a select, a
// condition and a boolean, plus top-level multiselect and number fields.
const fields = [
  { key: 'rules', type: 'group_list', item_label: 'label', new_item: { label: '', kind: 'a', when: { color: 'red' }, on: true },
    fields: [
      { key: 'label', type: 'text', required: true },
      { key: 'kind', type: 'select', options: { source: 'kinds' } },
      { key: 'when', type: 'condition', fields: [
        { value: 'color', label: 'Color', options: { source: 'colors' } },
        { value: 'shade', label: 'Shade', options: { source: 'shades', depends_on: 'color' } }
      ] },
      { key: 'on', type: 'boolean', default: true }
    ] },
  { key: 'skip', type: 'multiselect', options: { source: 'colors' } },
  { key: 'limit', type: 'number' }
];
const values = {
  rules: [
    { label: 'First', kind: 'a', when: { any: [{ color: ['red', 'a; b | c'] }, { color: 'blue', shade: 'dark' }] }, on: false },
    { label: 'Second', kind: 'b', when: { color: 'green' }, on: true }
  ],
  skip: ['x'],
  limit: 5
};

describe('step settings form model', () => {
  test('values round-trip through form state unchanged, values with ; and | included', () => {
    const state = F.initialState(fields, values);
    expect(state.rules[0].when.groups).toEqual([
      { rows: [{ field: 'color', values: ['red', 'a; b | c'] }] },
      { rows: [{ field: 'color', values: ['blue'] }, { field: 'shade', values: ['dark'] }] }
    ]);
    expect(F.toValues(fields, state)).toEqual(values);
    expect(F.toValues(fields, F.initialState(fields, F.toValues(fields, state)))).toEqual(values);
  });

  test('add and remove: group items (declared new item), condition groups and rows; edits by path', () => {
    const state = F.initialState(fields, values);
    F.addAt(fields, state, ['rules']);
    expect(state.rules[2]).toEqual({ label: '', kind: 'a', when: { groups: [{ rows: [{ field: 'color', values: ['red'] }] }] }, on: true });
    F.addAt(fields, state, ['rules', 1, 'when']);
    F.addAt(fields, state, ['rules', 1, 'when', 'groups', 0]);
    expect(state.rules[1].when.groups.map((g) => g.rows.length)).toEqual([2, 1]);
    F.setAt(state, ['rules', 1, 'when', 'groups', 1, 'rows', 0, 'field'], 'color');
    F.setAt(state, ['rules', 1, 'when', 'groups', 1, 'rows', 0, 'values'], ['blue']);
    F.removeAt(state, ['rules', 1, 'when', 'groups', 0, 'rows', 1]);
    expect(F.toValues(fields, state).rules[1].when).toEqual({ any: [{ color: 'green' }, { color: 'blue' }] });
    F.removeAt(state, ['rules', 0]);
    expect(F.toValues(fields, state).rules.map((r) => r.label)).toEqual(['Second', '']);
  });

  test('required fields and empty conditions are named (control: a filled form has none)', () => {
    const state = F.initialState(fields, values);
    expect(F.requiredErrors(fields, state)).toEqual([]);
    state.rules[0].label = '';
    state.rules[1].when = { groups: [{ rows: [{ field: 'color', values: [] }] }] };
    const errors = F.requiredErrors(fields, state);
    expect(errors.join(' | ')).toMatch(/label is required/);
    expect(errors.join(' | ')).toMatch(/Second: when needs at least one row/);
  });

  test('asks for each option list once, a dependent field with its group\'s values', () => {
    const state = F.initialState(fields, values);
    const requests = F.optionRequests(fields, state).map((r) => [r.source, r.depends]);
    expect(requests).toEqual([['kinds', []], ['colors', []], ['shades', ['blue']]]);
  });
});
