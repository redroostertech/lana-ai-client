'use strict';

/**
 * Card visuals (pure): which of the 15 visuals a declared card draws, the
 * fallback when its rows cannot carry it, and each visual's data mapping.
 */

const path = require('path');
const V = require(path.join(__dirname, '../../src/js/shared/card-visuals.js'));

const TODAY = '2026-11-24';

describe('visualFor', () => {
  test('the saved visual wins when it is one of the vocabulary', () => {
    expect(V.visualFor({ kind: 'group', visual: 'donut' })).toBe('donut');
    expect(V.VOCABULARY).toHaveLength(15);
  });
  test('without one (or an unknown one), the kind decides', () => {
    expect([['headline'], ['number'], ['goal'], ['breakdown'], ['pair'], ['worklist']].map(([kind]) => V.visualFor({ kind })))
      .toEqual(['hero', 'stat', 'ring', 'columns', 'compare', 'worklist']);
    expect(V.visualFor({ kind: 'group', chart: 'funnel' })).toBe('funnel');
    expect(V.visualFor({ kind: 'group', chart: 'bars' })).toBe('ranked_bars');
    expect(V.visualFor({ kind: 'number', visual: 'sparkles' })).toBe('stat');
  });
});

describe('row fields', () => {
  test('dateField: the first field ending in _at, _date, date, scheduled or hearing that has a value', () => {
    expect(V.dateField([{ name: 'A', created_at: null, meeting_date: '2026-11-30' }])).toBe('meeting_date');
    expect(V.dateField([{ name: 'A', next_hearing: '2026-12-01' }])).toBe('next_hearing');
    expect(V.dateField([{ name: 'A', status: 'x' }])).toBe(null);
    expect(V.dateField([])).toBe(null);
  });
  test('ageField: a numeric days or age field', () => {
    expect(V.ageField([{ stage: 'x', days_in_stage: 45 }])).toBe('days_in_stage');
    expect(V.ageField([{ age: '12' }])).toBe('age');
    expect(V.ageField([{ stage: 'x' }])).toBe(null);
  });
});

describe('chooseRowsVisual: timeline and aging fall back when the rows cannot carry them', () => {
  const dated = [{ name: 'Signing', meeting_date: '2026-11-26' }, { name: 'Design', meeting_date: '2026-12-03' }, { name: 'Late', meeting_date: '2027-02-01' }];
  test('timeline with dates in the next 14 days', () => {
    const choice = V.chooseRowsVisual('timeline', dated, 'worklist', TODAY);
    expect(choice.visual).toBe('timeline');
    expect(choice.model.dots.map((d) => [d.dayIndex, d.label])).toEqual([[2, 'Signing'], [9, 'Design']]);
    expect(choice.model.dots[0].pct).toBeCloseTo((2.5 / 14) * 100, 1);
  });
  test('timeline without dates, or none in the window, uses the fallback', () => {
    expect(V.chooseRowsVisual('timeline', [{ name: 'A' }], 'worklist', TODAY).visual).toBe('worklist');
    expect(V.chooseRowsVisual('timeline', [dated[2]], 'columns', TODAY).visual).toBe('columns');
    expect(V.chooseRowsVisual('timeline', [], undefined, TODAY).visual).toBe('worklist');
  });
  test('aging from a days field or from a date', () => {
    const byDays = V.chooseRowsVisual('aging', [{ days_in_stage: 10 }, { days_in_stage: 45 }, { days_in_stage: 75 }, { days_in_stage: 200 }, { days_in_stage: 20 }], 'worklist', TODAY);
    expect(byDays.visual).toBe('aging');
    expect(byDays.model.buckets.map((b) => [b.label, b.count])).toEqual([['0 to 30 days', 2], ['31 to 60 days', 1], ['61 to 90 days', 1], ['Over 90 days', 1]]);
    expect(byDays.model.buckets[0].pct).toBe(100);
    const byDate = V.chooseRowsVisual('aging', [{ stage_started_at: '2026-11-01' }, { stage_started_at: '2026-06-01' }], 'worklist', TODAY);
    expect(byDate.model.buckets.map((b) => b.count)).toEqual([1, 0, 0, 1]);
  });
  test('aging without ages falls back to a worklist sorted oldest first', () => {
    const choice = V.chooseRowsVisual('aging', [{ name: 'B' }], 'worklist', TODAY);
    expect(choice).toMatchObject({ visual: 'worklist', sort: 'oldest_first' });
  });
  test('other visuals pass straight through', () => {
    expect(V.chooseRowsVisual('worklist', dated, null, TODAY).visual).toBe('worklist');
  });
});

describe('gaugeModel', () => {
  test('a percent becomes a needle angle from -90 to 90', () => {
    expect(V.gaugeModel(75)).toEqual({ pct: 75, angle: 45 });
    expect(V.gaugeModel(0).angle).toBe(-90);
    expect(V.gaugeModel(140)).toEqual({ pct: 100, angle: 90 });
    expect(V.gaugeModel(null)).toBe(null);
  });
});

describe('donutModel', () => {
  test('slices as share of the total with running offsets; zero rows drop out', () => {
    const m = V.donutModel([{ label: 'A', value: 50, key: 'k.a' }, { label: 'B', value: 30 }, { label: 'C', value: 20 }, { label: 'D', value: 0 }]);
    expect(m.total).toBe(100);
    expect(m.slices.map((s) => [s.label, s.pct, s.offset])).toEqual([['A', 50, 0], ['B', 30, 50], ['C', 20, 80]]);
    expect(m.slices[0].key).toBe('k.a');
  });
  test('nothing to share is null', () => {
    expect(V.donutModel([{ label: 'A', value: 0 }])).toBe(null);
    expect(V.donutModel([])).toBe(null);
  });
});

describe('rankedModel', () => {
  test('high to low, scaled to the largest; waiting rows last', () => {
    const m = V.rankedModel([{ label: 'B', value: 35 }, { label: 'W', value: null, waiting: true }, { label: 'A', value: 42 }]);
    expect(m.map((r) => [r.label, r.pct])).toEqual([['A', 100], ['B', 83.3], ['W', 0]]);
  });
});

describe('stackedModel', () => {
  test('parts as percent of the whole, rounded labels', () => {
    expect(V.stackedModel([{ label: 'Fully funded', value: 12 }, { label: 'Not fully funded', value: 4 }]).parts.map((p) => [p.label, p.pct, p.offset]))
      .toEqual([['Fully funded', 75, 0], ['Not fully funded', 25, 75]]);
    expect(V.stackedModel([{ label: 'A', value: 0 }])).toBe(null);
  });
});

describe('bulletModel', () => {
  test('actual against the goal with the gap', () => {
    expect(V.bulletModel(60, 80)).toEqual({ actualPct: 75, goalPct: 100, gap: 20, over: false });
    expect(V.bulletModel(100, 80)).toEqual({ actualPct: 100, goalPct: 80, gap: -20, over: true });
    expect(V.bulletModel(5, null)).toBe(null);
  });
});

describe('pairedSeries', () => {
  test('two lists merged by label: first list order, then labels only in the second', () => {
    const rows = V.pairedSeries(
      [{ service_label: 'Estate Planning', value: 21 }, { service_label: 'Probate', value: 3 }],
      [{ service_label: 'Probate', value: 2 }, { service_label: 'Guardianship', value: 1 }]);
    expect(rows).toEqual([
      { label: 'Estate Planning', value: 21, second: null },
      { label: 'Probate', value: 3, second: 2 },
      { label: 'Guardianship', value: null, second: 1 },
    ]);
  });
});

describe('compareModel', () => {
  test('the second as a share of the first for the ratio bar', () => {
    expect(V.compareModel(20, 5)).toEqual({ ratioPct: 25 });
    expect(V.compareModel(0, 5)).toEqual({ ratioPct: null });
    expect(V.compareModel(4, 6)).toEqual({ ratioPct: 100 });
  });
});

describe('sortRows and initials', () => {
  test('oldest first by the date field; other sorts keep the server order', () => {
    const rows = [{ n: 1, due_date: '2026-03-01' }, { n: 2, due_date: '2026-01-01' }, { n: 3, due_date: null }];
    expect(V.sortRows(rows, 'oldest_due_first').map((r) => r.n)).toEqual([2, 1, 3]);
    expect(V.sortRows(rows, 'oldest_first').map((r) => r.n)).toEqual([2, 1, 3]);
    expect(V.sortRows(rows, undefined).map((r) => r.n)).toEqual([1, 2, 3]);
  });
  test('initials from a name', () => {
    expect(V.initials('Team member A')).toBe('TA');
    expect(V.initials('Ana')).toBe('A');
    expect(V.initials('')).toBe('');
  });
});

describe('extraKeys', () => {
  test('visual options that name metrics add their keys to the request', () => {
    expect(V.extraKeys({ detail: ['finance.net_revenue'], chips: ['a.b'], metric_keys_override: ['c.d'], headline_keys: ['e.f'], centre_key: 'g.h', badge_key: 'i.j' }))
      .toEqual(['finance.net_revenue', 'a.b', 'c.d', 'e.f', 'g.h', 'i.j']);
    expect(V.extraKeys({})).toEqual([]);
  });
});

describe('shortLabels', () => {
  test('words every label starts or ends with are dropped, so bars read apart', () => {
    expect(V.shortLabels(['Upcoming Will Design Meetings', 'Upcoming Will Signing Meetings', 'Upcoming Trust Design Meetings']))
      .toEqual(['Will Design', 'Will Signing', 'Trust Design']);
    expect(V.shortLabels(['Website Leads', 'Referral Leads'])).toEqual(['Website', 'Referral']);
  });
  test('labels that would become empty, or a single label, stay whole', () => {
    expect(V.shortLabels(['Leads', 'Leads'])).toEqual(['Leads', 'Leads']);
    expect(V.shortLabels(['Total Active Cases'])).toEqual(['Total Active Cases']);
    expect(V.shortLabels(['Estate Planning', 'Probate'])).toEqual(['Estate Planning', 'Probate']);
  });
});
