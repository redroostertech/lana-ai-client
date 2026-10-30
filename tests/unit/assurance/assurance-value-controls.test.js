'use strict';
const { basisPoints, valueFromFields } = require('../../../src/js/services/assurance-value-controls');
const contacts = [{ id: 'one', label: 'First contact' }, { id: 'two', label: 'Second contact' }];
test.each([['0.01', 1], ['33.33', 3333], ['100', 10000], ['50.5', 5050]])('converts %s percent exactly to integer basis points', (input, expected) => {
  expect(basisPoints(input)).toBe(expected);
});
test.each(['', '-1', '5.555', '1e2', '3.', 'Infinity'])('rejects unrepresentable percentage %s', input => { expect(() => basisPoints(input)).toThrow(); });
test('serializes only contact identities present in the authoritative lookup', () => {
  expect(valueFromFields('reference', { selected: 'one' }, contacts)).toEqual({ kind: 'reference', value: { kind: 'contact', id: 'one' } });
  expect(valueFromFields('reference_set', { selected: ['one', 'two'] }, contacts).value).toHaveLength(2);
  expect(() => valueFromFields('reference', { selected: 'invented' }, contacts)).toThrow('available matter');
});
test('maps allocation rows while leaving eligibility and total validation to the server', () => {
  expect(valueFromFields('allocations', { allocations: [{ contactId: 'one', percent: '33.33' }, { contactId: 'two', percent: '66.67' }] }, contacts)).toEqual({ kind: 'allocations', value: [
    { beneficiary: { kind: 'contact', id: 'one' }, share_basis_points: 3333 }, { beneficiary: { kind: 'contact', id: 'two' }, share_basis_points: 6667 }
  ] });
  expect(() => valueFromFields('text', { selected: 'one' }, contacts)).toThrow('not available');
});
