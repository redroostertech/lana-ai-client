'use strict';

const V = require('../../src/js/shared/form-values.js');

describe('form-values', () => {
  test.each([['0.01', 1], ['33.33', 3333], ['100', 10000], ['50.5', 5050]])('basisPoints(%s) is exact', (input, expected) => {
    expect(V.basisPoints(input)).toBe(expected);
  });

  test.each(['', '-1', '5.555', '1e2', '3.', '.5', 'Infinity', '1.2.3'])('basisPoints rejects %s', (input) => {
    expect(() => V.basisPoints(input)).toThrow('two decimal places');
  });

  test('money converts to and from integer minor units', () => {
    expect(V.minorUnits('1234.5')).toBe(123450);
    expect(V.minorUnits('0.07')).toBe(7);
    expect(V.amountText(123450)).toBe('1234.50');
    expect(() => V.minorUnits('12.345')).toThrow('amount');
    expect(V.percentText(3333)).toBe('33.33');
  });

  test('calendarDate accepts real dates only', () => {
    expect(V.calendarDate('2026-02-28')).toBe('2026-02-28');
    ['2026-02-30', '2026-13-01', '26-01-01', '2026-01-01T00:00', ''].forEach((value) => {
      expect(() => V.calendarDate(value)).toThrow('valid date');
    });
  });

  test('instant needs an explicit valid date and time and round-trips through localInput', () => {
    const iso = V.instant('2026-10-30T09:30');
    expect(iso.endsWith('Z')).toBe(true);
    expect(V.localInput(iso)).toBe('2026-10-30T09:30');
    expect(() => V.instant('2026-02-30T09:30')).toThrow('valid date');
    expect(() => V.instant('2026-10-30')).toThrow();
    expect(V.localInput('nonsense')).toBe('');
  });

  test('wholeNumber and humanize', () => {
    expect(V.wholeNumber('3')).toBe(3);
    ['0', '-1', '1.5', 'x', ''].forEach((value) => expect(() => V.wholeNumber(value)).toThrow());
    expect(V.humanize('trust_title')).toBe('Trust title');
  });
});
