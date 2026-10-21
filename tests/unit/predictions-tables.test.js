const path = require('path');

const SRC = path.join(__dirname, '../../src');

global.window = global;
global.LanaRecordTableKit = require(path.join(SRC, 'insights/js/record-table-kit.js'));
const predictions = require(path.join(SRC, 'insights/js/predictions-tables.js'));

describe('predictions-tables', () => {
  const raw = [
    { matterId: 'm-001', matterName: 'Smith v. Johnson', estimatedCompletion: '2025-02-15', confidence: 0.78, factors: ['Complex discovery', 'Multiple parties'] },
    { matterId: 'm-002', matterName: 'Garcia Family Trust', estimatedCompletion: '2025-01-30', confidence: 0.85, factors: ['Standard process'] }
  ];

  test('rows keep raw values with confidence as a percentage', () => {
    expect(predictions.caseDurationRow(raw[0], 0)).toMatchObject({
      id: 'm-001', matter: 'Smith v. Johnson', matter_id: 'm-001', estimated_completion: '2025-02-15', confidence: 78,
      factors: ['Complex discovery', 'Multiple parties']
    });
    expect(predictions.caseDurationRow({}, 3)).toMatchObject({ id: 'prediction-3', confidence: null, factors: [] });
  });

  test('every column filters; matter links to the workspace', () => {
    const rows = raw.map(predictions.caseDurationRow);
    const spec = predictions.caseDurationSpec(rows);
    const kit = global.LanaRecordTableKit;
    const map = kit.filterOptionsFor(spec, rows);
    expect(Object.keys(map).sort()).toEqual(['confidence', 'estimated_completion', 'factors', 'matter']);
    expect(map.factors.options.map((o) => o.value)).toEqual(['Complex discovery', 'Multiple parties', 'Standard process']);
    expect(map.factors.match(rows[0].factors, ['Multiple parties'])).toBe(true);
    expect(map.factors.match(rows[1].factors, ['Multiple parties'])).toBe(false);
    expect(map.confidence.match(85, ['high'])).toBe(true);
    expect(map.confidence.match(78, ['medium'])).toBe(true);
    expect(kit.renderersFor(spec).matter('Smith v. Johnson', rows[0])).toContain('data-matter-id="m-001"');
    expect(kit.sortOptionsFor(spec).map((o) => o.value)).toEqual(['matter', 'estimated_completion', 'confidence']);
  });
});
