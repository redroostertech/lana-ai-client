'use strict';

/**
 * Chart points (js/shared/chart-points.js): a missing or null value is a gap
 * (null), never a 0 bar or a 0 on a line; a real 0 stays 0. Used by the
 * Reports charts and the time series renderer.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require(path.join(__dirname, '../../src/js/shared/chart-points.js'));

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('value', () => {
  test('numbers and numeric strings pass through; real 0 stays 0', () => {
    expect([P.value(12), P.value('3.5'), P.value(0), P.value('0'), P.value(-2)]).toEqual([12, 3.5, 0, 0, -2]);
  });
  test('null, undefined, empty, NaN, Infinity and words are gaps', () => {
    expect([P.value(null), P.value(undefined), P.value(''), P.value('  '), P.value(NaN), P.value(Infinity), P.value('n/a'), P.value({})])
      .toEqual([null, null, null, null, null, null, null, null]);
  });
});

describe('firstValue', () => {
  test('the first value that is not a gap, keeping a real 0', () => {
    expect(P.firstValue(0, 5)).toBe(0);
    expect(P.firstValue(null, '7')).toBe(7);
    expect(P.firstValue(null, undefined)).toBe(null);
  });
});

describe('time series renderer datasets', () => {
  function loadRenderer() {
    const source = read('js/visualizations/renderers/time-series-renderer.js')
      .split('\n').filter((line) => !line.startsWith('import ')).join('\n')
      .replace('export class TimeSeriesRenderer', 'class TimeSeriesRenderer') + '\nthis.TimeSeriesRenderer = TimeSeriesRenderer;';
    const context = { console, ChartPoints: P, ChartTheme: new Proxy({}, { get: () => new Proxy(() => ['#000'], { get: () => () => '#000', apply: () => ['#000'] }) }), sampleData: (d) => d, keyToLabel: (k) => k, destroyChart: () => {}, document: {} };
    context.window = context;
    context.globalThis = context;
    vm.runInNewContext(source, context);
    return context.TimeSeriesRenderer;
  }

  test('null and missing points are gaps (spanGaps off); a real 0 stays 0', () => {
    const R = loadRenderer();
    const series = [
      { date: '2026-01-01', metrics: [{ key: 'avg', value: 10 }] },
      { date: '2026-02-01', metrics: [{ key: 'avg', value: null }] },
      { date: '2026-03-01', metrics: [] },
      { date: '2026-04-01', metrics: [{ key: 'avg', value: 0 }] },
      { date: '2026-05-01', metrics: [{ key: 'avg', value: '4.5' }] },
    ];
    const datasets = new R('c', series, ['avg'])._buildDatasets();
    expect(datasets[0].data).toEqual([10, null, null, 0, 4.5]);
    expect(datasets[0].spanGaps).toBe(false);
  });
});

describe('Reports charts use chart points, not "|| 0"', () => {
  const report = read('js/admin/report.js');
  test('current vs prior, attribution bars and distribution percentages keep gaps', () => {
    expect(report).toContain('ChartPoints.value(m.current)');
    expect(report).toContain('ChartPoints.value(m.prior)');
    expect(report).toContain('ChartPoints.value(row[serie.field])');
    expect(report).toContain('ChartPoints.firstValue(r.count, r.value)');
    expect(report).toContain('ChartPoints.value(item.value)');
    ['parseFloat(m.current) || 0', 'parseFloat(m.prior) || 0', 'parseFloat(row[serie.field]) || 0', 'parseFloat(r.count) || parseFloat(r.value) || 0', 'parseFloat(item.value) || 0']
      .forEach((bad) => expect(report).not.toContain(bad));
  });
  test('the report page loads chart points before the report scripts', () => {
    const html = read('admin/report.html');
    expect(html).toContain('../js/shared/chart-points.js');
    expect(html.indexOf('../js/shared/chart-points.js')).toBeLessThan(html.indexOf('../js/admin/report.js'));
  });
});

test('the router descriptor for the report page loads chart points too', () => {
  const pages = read('js/lex/lex-router.pages.js');
  const entry = pages.slice(pages.indexOf("'admin/report.html': {"), pages.indexOf("'js/admin/report.js'", pages.indexOf("'admin/report.html': {")));
  expect(entry).toContain("'js/shared/chart-points.js'");
});

describe('module reports: over-time and bar charts keep gaps', () => {
  const report = read('js/admin/report.js');
  test('time_series, trend_chart and line_chart visualizations draw through the gap-keeping renderer', () => {
    const trend = report.slice(report.indexOf('function renderTrendChart'), report.indexOf('function renderComparisonChart'));
    expect(trend).toContain('renderTimeSeriesChartForVisualization(canvasId, data.timeSeries, viz.metrics)');
    expect(trend).toContain('new TimeSeriesRenderer(');
    ["case 'time_series':", "case 'trend_chart':", "case 'line_chart': return renderTrendChart("].forEach((s) => expect(report).toContain(s));
  });
  test('a module timeSeries with an empty average bucket keeps the gap', () => {
    const source = read('js/visualizations/renderers/time-series-renderer.js')
      .split('\n').filter((line) => !line.startsWith('import ')).join('\n')
      .replace('export class TimeSeriesRenderer', 'class TimeSeriesRenderer') + '\nthis.TimeSeriesRenderer = TimeSeriesRenderer;';
    const context = { console, ChartPoints: P, ChartTheme: new Proxy({}, { get: () => new Proxy(() => ['#000'], { get: () => () => '#000', apply: () => ['#000'] }) }), sampleData: (d) => d, keyToLabel: (k) => k, destroyChart: () => {}, document: {} };
    context.window = context;
    context.globalThis = context;
    vm.runInNewContext(source, context);
    const moduleSeries = [
      { date: '2026-09-01', metrics: [{ key: 'average_fee', value: 4200 }, { key: 'conversion_rate', value: 31.5 }] },
      { date: '2026-10-01', metrics: [{ key: 'average_fee', value: null }, { key: 'conversion_rate', value: null }] },
      { date: '2026-11-01', metrics: [{ key: 'average_fee', value: 3900 }, { key: 'conversion_rate', value: 0 }] },
    ];
    const datasets = new context.TimeSeriesRenderer('c', moduleSeries, ['average_fee', 'conversion_rate'])._buildDatasets();
    expect(datasets.map((d) => d.data)).toEqual([[4200, null, 3900], [31.5, null, 0]]);
    expect(datasets.every((d) => d.spanGaps === false)).toBe(true);
  });
  test('module horizontal bar charts keep a null bucket as no bar', () => {
    expect(report).toContain('values: chartData.map(function (d) { return window.ChartPoints.value(d.value); })');
    expect(report).not.toContain('return d.value || 0;');
  });
});
