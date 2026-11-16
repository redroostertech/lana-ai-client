/**
 * The backend now adds a platform "Force full sync" option to every
 * connector's run options. A package with no run block of its own gets only
 * { options: [...] }; the Run tab must keep its default layout (date range,
 * quick ranges, validation harness) and still show the served options.
 */
const model = require('../../src/js/connector-run-options.model');

describe('connector run options model', () => {
  test.each([
    [{}, false],
    [undefined, false],
    [{ options: [{ name: 'force_full_resync' }] }, false],
    [{ options: [], supports_date_range: true }, true],
    [{ sync_title: 'Run' }, true]
  ])('hasPackageRunBehavior(%j) is %s', (run, expected) => {
    expect(model.hasPackageRunBehavior(run)).toBe(expected);
  });

  test('servedOptions returns the options array, or none', () => {
    expect(model.servedOptions({ options: [{ name: 'a' }] })).toEqual([{ name: 'a' }]);
    expect(model.servedOptions({})).toEqual([]);
    expect(model.servedOptions(null)).toEqual([]);
  });
});
