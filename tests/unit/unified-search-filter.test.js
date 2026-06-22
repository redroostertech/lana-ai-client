'use strict';

const {
  entityTypeOf,
  computeTypeFacets,
  filterResultsByType,
  resolveActiveSelection
} = require('../../src/js/unified-search-filter');

const sample = [
  { entity_type: 'task', title: 'a' },
  { entity_type: 'task', title: 'b' },
  { entity_type: 'conversation_message', title: 'c' },
  { source_type: 'participant', title: 'd' }, // entity_type missing, falls back to source_type
  { entity_type: 'task', title: 'e' }
];

describe('entityTypeOf', () => {
  test('prefers entity_type, falls back to source_type', () => {
    expect(entityTypeOf({ entity_type: 'task', source_type: 'x' })).toBe('task');
    expect(entityTypeOf({ source_type: 'participant' })).toBe('participant');
  });
  test('returns empty string for missing/odd input', () => {
    expect(entityTypeOf({})).toBe('');
    expect(entityTypeOf(null)).toBe('');
    expect(entityTypeOf(undefined)).toBe('');
  });
});

describe('computeTypeFacets', () => {
  test('counts each type across the FULL set', () => {
    const { total, facets } = computeTypeFacets(sample);
    expect(total).toBe(5);
    const byType = Object.fromEntries(facets.map((f) => [f.type, f.count]));
    expect(byType).toEqual({ task: 3, conversation_message: 1, participant: 1 });
  });

  test('orders by count desc, then label asc for ties', () => {
    const { facets } = computeTypeFacets(sample);
    expect(facets.map((f) => f.type)).toEqual(['task', 'conversation_message', 'participant']);
    // tie at count 1: conversation_message vs participant -> label asc
    // labels: "conversation message" < "participant"
  });

  test('honors a custom label function', () => {
    const labelFn = (t) => (t === 'conversation_message' ? 'Message' : t);
    const { facets } = computeTypeFacets(sample, labelFn);
    const msg = facets.find((f) => f.type === 'conversation_message');
    expect(msg.label).toBe('Message');
  });

  test('default label converts underscores to spaces', () => {
    const { facets } = computeTypeFacets([{ entity_type: 'conversation_message' }]);
    expect(facets[0].label).toBe('conversation message');
  });

  test('skips results with no resolvable type', () => {
    const { total, facets } = computeTypeFacets([{ title: 'x' }, { entity_type: 'task' }]);
    expect(total).toBe(2); // total reflects all rows
    expect(facets).toHaveLength(1); // but only typed rows produce facets
    expect(facets[0]).toMatchObject({ type: 'task', count: 1 });
  });

  test('handles empty / non-array input', () => {
    expect(computeTypeFacets([])).toEqual({ total: 0, facets: [] });
    expect(computeTypeFacets(null)).toEqual({ total: 0, facets: [] });
    expect(computeTypeFacets(undefined)).toEqual({ total: 0, facets: [] });
  });
});

describe('filterResultsByType', () => {
  test('null/empty/"all" returns every result', () => {
    expect(filterResultsByType(sample, null)).toHaveLength(5);
    expect(filterResultsByType(sample, '')).toHaveLength(5);
    expect(filterResultsByType(sample, 'all')).toHaveLength(5);
  });

  test('filters to a single type, including source_type fallback', () => {
    expect(filterResultsByType(sample, 'task')).toHaveLength(3);
    expect(filterResultsByType(sample, 'participant')).toHaveLength(1);
    expect(filterResultsByType(sample, 'conversation_message')).toHaveLength(1);
  });

  test('unknown type returns an empty array', () => {
    expect(filterResultsByType(sample, 'matter')).toEqual([]);
  });

  test('never mutates the input and returns a fresh array for "all"', () => {
    const copy = sample.slice();
    const out = filterResultsByType(sample, 'all');
    expect(out).not.toBe(sample);
    expect(sample).toEqual(copy);
  });

  test('handles empty / non-array input', () => {
    expect(filterResultsByType([], 'task')).toEqual([]);
    expect(filterResultsByType(null, 'task')).toEqual([]);
  });
});

describe('resolveActiveSelection', () => {
  // Stable identity for these fixtures: the title is unique per row.
  const keyOf = (r) => r.title;
  const list = [
    { entity_type: 'task', title: 'a' },
    { entity_type: 'conversation_message', title: 'c' },
    { entity_type: 'task', title: 'e' }
  ];

  test('fresh query (autoSelect) always lands on the first row, not preserved', () => {
    expect(resolveActiveSelection(list, 'c', keyOf, true)).toEqual({ index: 0, preserved: false });
  });

  test('filter toggle preserves a still-present selection at its new index', () => {
    // selection "c" survives the (notional) filter and sits at index 1
    expect(resolveActiveSelection(list, 'c', keyOf, false)).toEqual({ index: 1, preserved: true });
  });

  test('filter toggle that removed the selection falls back to the first row', () => {
    const onlyMessages = [{ entity_type: 'conversation_message', title: 'c' }];
    // previously selected "e" is no longer in the filtered set
    expect(resolveActiveSelection(onlyMessages, 'e', keyOf, false)).toEqual({ index: 0, preserved: false });
  });

  test('no prior selection falls back to the first row', () => {
    expect(resolveActiveSelection(list, '', keyOf, false)).toEqual({ index: 0, preserved: false });
  });

  test('handles empty / non-array input', () => {
    expect(resolveActiveSelection([], 'c', keyOf, false)).toEqual({ index: 0, preserved: false });
    expect(resolveActiveSelection(null, 'c', keyOf, false)).toEqual({ index: 0, preserved: false });
  });
});
