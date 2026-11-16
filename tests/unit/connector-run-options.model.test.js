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

describe('catalogPaths', () => {
  const sourceId = '61fc519c-e119-4283-9e3b-12bcc806e444';

  test('a viewer with a connection asks for the catalog by that connection first, then by type', () => {
    expect(model.catalogPaths('leadly', sourceId)).toEqual([
      `/api/v1/integrations/connectors/catalog/${sourceId}`,
      '/api/v1/integrations/connectors/catalog/leadly'
    ]);
  });

  test.each([
    ['no connection', null],
    ['a slug in place of a connection id', 'leadly'],
    ['something that is not a uuid', 'abc-123']
  ])('%s: by type only', (_name, id) => {
    expect(model.catalogPaths('leadly', id)).toEqual(['/api/v1/integrations/connectors/catalog/leadly']);
  });

  test('the type is URL-encoded', () => {
    expect(model.catalogPaths('a b', null)).toEqual(['/api/v1/integrations/connectors/catalog/a%20b']);
  });
});
