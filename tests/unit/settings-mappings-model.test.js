'use strict';

/**
 * Settings > Mappings model (pure): picker options grouped by parent, rows
 * unmapped first, edits to PUT items, "Accept all suggestions" (fills the
 * pickers only), the saved message, the setup banner, and the card caveat.
 */

const path = require('path');
const M = require(path.join(__dirname, '../../src/js/settings-mappings.model.js'));
const fixture = require(path.join(__dirname, '../fixtures/mappings/mappings-sample.json'));

describe('pickerOptions', () => {
  test('governed keys grouped under their parent, parents first, each child marked with its group', () => {
    const options = M.pickerOptions(fixture.vocabularies.matter_service);
    expect(options.slice(0, 4)).toEqual([
      { value: 'estate_planning', label: 'Estate Planning', group: 'Estate Planning' },
      { value: 'will_based_plan', label: 'Will-based plan', group: 'Estate Planning', indent: true },
      { value: 'trust_based_plan', label: 'Trust-based plan', group: 'Estate Planning', indent: true },
      { value: 'probate', label: 'Probate', group: 'Probate' },
    ]);
    expect(options.find((o) => o.value === 'not_a_case')).toEqual({ value: 'not_a_case', label: 'Not a paying matter', group: 'Not a paying matter' });
  });
});

describe('visibleRows', () => {
  const rows = fixture.mappings.matter_service;
  test('unmapped first by record count, then mapped by record count', () => {
    expect(M.visibleRows(rows, 'all').map((r) => r.source_value)).toEqual(['EP - Will', 'Probate Admin', 'Consult only', 'Trust Package', 'Guardianship']);
  });
  test('the status filter', () => {
    expect(M.visibleRows(rows, 'unmapped').map((r) => r.source_value)).toEqual(['EP - Will', 'Probate Admin', 'Consult only']);
    expect(M.visibleRows(rows, 'mapped').map((r) => r.source_value)).toEqual(['Trust Package', 'Guardianship']);
  });
});

describe('edits', () => {
  const rows = fixture.mappings.matter_service;
  test('only changed rows become PUT items', () => {
    const edits = { [M.rowKey(rows[0])]: 'will_based_plan', [M.rowKey(rows[3])]: 'trust_based_plan' };
    // rows[3] is already mapped to trust_based_plan: no change, no item.
    expect(M.pendingItems(rows, edits)).toEqual([{ connector: 'actionstep', source_value: 'EP - Will', canonical_key: 'will_based_plan' }]);
  });
  test('an empty pick is not a save (clearing is its own action)', () => {
    expect(M.pendingItems(rows, { [M.rowKey(rows[0])]: '' })).toEqual([]);
  });
  test('Accept all suggestions only fills pickers of unmapped rows that have a suggestion and no pick yet', () => {
    const edits = M.acceptSuggestions(rows, { [M.rowKey(rows[1])]: 'small_estate' });
    expect(edits).toEqual({ [M.rowKey(rows[0])]: 'will_based_plan', [M.rowKey(rows[1])]: 'small_estate' });
    // Nothing is saved by accepting.
    expect(M.pendingItems(rows, {})).toEqual([]);
  });
  test('the picker value: the pick, else the mapped key, else the suggestion', () => {
    expect(M.pickerValue(rows[0], {})).toBe('will_based_plan');
    expect(M.pickerValue(rows[2], {})).toBe('');
    expect(M.pickerValue(rows[3], {})).toBe('trust_based_plan');
    expect(M.pickerValue(rows[0], { [M.rowKey(rows[0])]: 'probate' })).toBe('probate');
  });
});

describe('messages', () => {
  test('saved', () => {
    expect(M.savedMessage({ saved: 2, records_to_update: 1240 })).toBe('Saved. Updating 1,240 records in the background.');
    expect(M.savedMessage({ saved: 1, records_to_update: 1 })).toBe('Saved. Updating 1 record in the background.');
    expect(M.savedMessage({ saved: 1, records_to_update: 0 })).toBe('Saved.');
  });

  test('the setup banner names both vocabularies, or only those with gaps, or nothing', () => {
    expect(M.bannerText(fixture.summary)).toBe("Finish your setup: 3 case types and 2 appointment types aren't mapped yet (318 records).");
    expect(M.bannerText({ matter_service: { unmapped_records: 42, unmapped_values: 1 }, meeting_type: { unmapped_records: 0, unmapped_values: 0 } }))
      .toBe("Finish your setup: 1 case type isn't mapped yet (42 records).");
    expect(M.bannerText({ matter_service: { unmapped_records: 0, unmapped_values: 0 } })).toBe(null);
    expect(M.bannerText(null)).toBe(null);
  });

  test('the card caveat from mapping_coverage', () => {
    expect(M.coverageCaveat({ mapped: 874, not_mapped: 42 })).toBe('42 matters are not mapped to a service yet');
    expect(M.coverageCaveat({ mapped: 10, not_mapped: 1 })).toBe('1 matter is not mapped to a service yet');
    expect(M.coverageCaveat({ mapped: 10, not_mapped: 0 })).toBe(null);
    expect(M.coverageCaveat(null)).toBe(null);
  });
});
