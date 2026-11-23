/**
 * What Export PDF and Export CSV write for one report figure. A distribution
 * (Opportunity Aging's Aging Status: a count per group) came out as
 * "[object Object],[object Object],[object Object]" (Michael, 2026-11-23).
 */
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

const card = withReportSharedScripts({ DataState: undefined }).ReportMetricCard;

test('a distribution reads as each group and its count, with the total', () => {
  const groups = [{ label: 'red', value: 2, count: 2 }, { label: 'yellow', value: 5, count: 5 }, { label: 'green', value: 11, count: 11 }];
  expect(card.exportValue(groups, groups)).toBe('Red: 2, Yellow: 5, Green: 11 (total 18)');
});

test('an empty distribution and plain values (control: formatted text wins, a raw number stays)', () => {
  expect(card.exportValue([], [])).toBe('n/a');
  expect(card.exportValue('0 days', 0)).toBe('0 days');
  expect(card.exportValue(null, 12)).toBe(12);
  expect(card.exportValue(null, null)).toBe('n/a');
});

test('review: only a real count-per-group list gets group wording; other cells keep their old text or read plainly', () => {
  expect(card.exportValue(null, ['tax', 'estate'])).toBe('tax, estate');
  expect(card.exportValue(null, [3, 4])).toBe('3, 4');
  expect(card.exportValue(null, { city: 'Boston', state: 'MA' })).toBe('city: Boston, state: MA');
  expect(card.exportValue('3 groups', [{ label: 'red', count: 1 }])).toBe('3 groups');
  expect(card.exportValue(null, [{ label: 'red', count: 1 }])).toBe('Red: 1 (total 1)');
});

describe('the exported file is named after the report (Michael, 2026-11-23)', () => {
  test.each([
    ['Expense Summary', 'pdf', 'Expense Summary 2026-11-23.pdf'],
    ['Opportunity Aging', 'csv', 'Opportunity Aging 2026-11-23.csv'],
    ['Fees: Paid / Owed?', 'pdf', 'Fees Paid Owed 2026-11-23.pdf'],
    ['', 'csv', 'Report 2026-11-23.csv']
  ])('%s as %s', (name, ext, expected) => {
    expect(card.exportFileName(name, '2026-11-23', ext)).toBe(expected);
  });
});
