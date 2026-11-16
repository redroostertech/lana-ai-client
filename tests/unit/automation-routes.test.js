const path = require('path');

const Routes = require(path.join(__dirname, '../../src/automation/js/shared/automation-routes.js'));

const VIEWS = { home: {}, library: {}, runs: {}, builder: {} };

describe('automation hash routes', () => {
  test.each([
    ['#run/66666666-6666-4666-8666-666666666666', { view: 'runs', runId: '66666666-6666-4666-8666-666666666666' }],
    ['#run/a%20b', { view: 'runs', runId: 'a b' }],
    ['#automation/abc', { view: 'library-detail', automationId: 'abc' }],
    ['#runs', { view: 'runs' }],
    ['#library?x=1', { view: 'library' }],
    ['#run/', null],
    ['#nope', null],
    ['', null]
  ])('%p parses to %p', (hash, route) => {
    expect(Routes.parseAutomationHash(hash, VIEWS)).toEqual(route);
  });

  test('the Runs view links to its open run, and back to the list when none is open', () => {
    expect(Routes.buildAutomationHash('runs', { selectedRunId: 'r 1' }, VIEWS)).toBe('#run/r%201');
    expect(Routes.buildAutomationHash('runs', { selectedRunId: null }, VIEWS)).toBe('#runs');
    expect(Routes.buildAutomationHash('library-detail', { libraryDetail: { automationId: 'a' } }, VIEWS)).toBe('#automation/a');
    expect(Routes.buildAutomationHash('library-detail', {}, VIEWS)).toBe('#library');
    expect(Routes.buildAutomationHash('home', {}, VIEWS)).toBe('#home');
    expect(Routes.buildAutomationHash('unknown', {}, VIEWS)).toBe('#library');
  });
});
