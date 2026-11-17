'use strict';

/**
 * The time zone choices both Settings time zone fields use (js/shared/time-zone-options.js).
 */
const Z = require('../../src/js/shared/time-zone-options.js');

describe('time zone options', () => {
  test('lists every zone this computer knows, grouped by region, America first', () => {
    const options = Z.buildOptions();
    expect(options.length).toBe(Intl.supportedValuesOf('timeZone').length);
    expect(options[0].group).toBe('America');
    expect(options.find((o) => o.value === 'America/New_York')).toEqual(
      expect.objectContaining({ group: 'America', label: expect.stringContaining('New York') }));
  });

  test('keeps a saved zone the list does not have', () => {
    const real = Intl.supportedValuesOf;
    Intl.supportedValuesOf = () => ['UTC'];
    try {
      expect(Z.buildOptions('America/Indiana/Knox').map((o) => o.value)).toEqual(expect.arrayContaining(['UTC', 'America/Indiana/Knox']));
    } finally {
      Intl.supportedValuesOf = real;
    }
  });

  test('uses the short list when the computer cannot list zones', () => {
    const real = Intl.supportedValuesOf;
    Intl.supportedValuesOf = undefined;
    try {
      expect(Z.zones()).toEqual(Z.FALLBACK_ZONES);
      expect(Z.buildOptions().map((o) => o.value)).toContain('Europe/London');
    } finally {
      Intl.supportedValuesOf = real;
    }
  });

  test('labels a zone by its name and city', () => {
    expect(Z.cityLabel('America/Los_Angeles')).toBe('Los Angeles');
    expect(Z.optionLabel('America/New_York')).toMatch(/ - New York$/);
  });
});
