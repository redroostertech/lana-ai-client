/**
 * lex-brand-mark once: a header animation that plays one time on load (the
 * Dashboards header uses the Insights "chart"), and under Reduce Motion
 * holds its first frame.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');
const tick = (w) => new Promise((r) => w.setTimeout(r, 20));

function boot(html, { reduce = false } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  w.matchMedia = () => ({ matches: reduce });
  w.LexBrandAnimations = { chart: { light: { v: 'light' }, dark: { v: 'dark' } }, idle: { light: {}, dark: {} } };
  w.lottie = {
    loadAnimation(opts) {
      const listeners = {};
      const item = { opts, stops: [], totalFrames: 60, destroy() {}, addEventListener(name, fn) { listeners[name] = fn; },
        goToAndStop(frame) { item.stops.push(frame); }, fire(name) { if (listeners[name]) listeners[name](); } };
      calls.push(item);
      return item;
    },
  };
  ['lex/lex.core.js', 'lex/components/foundation/lex-brand-mark.js'].forEach((rel) => w.eval(read(rel)));
  w.document.body.innerHTML = html;
  return { w, calls };
}

test('once plays a looping animation a single time', async () => {
  const { w, calls } = boot('<lex-brand-mark animation="chart" size="64" once></lex-brand-mark>');
  await tick(w);
  expect(calls[0].opts.loop).toBe(false);
  expect(calls[0].opts.autoplay).toBe(true);
});

test('without once the chart keeps looping', async () => {
  const { w, calls } = boot('<lex-brand-mark animation="chart" size="64"></lex-brand-mark>');
  await tick(w);
  expect(calls[0].opts.loop).toBe(true);
});

test('once under Reduce Motion holds the first frame', async () => {
  const { w, calls } = boot('<lex-brand-mark animation="chart" size="64" once></lex-brand-mark>', { reduce: true });
  await tick(w);
  expect(calls[0].opts.autoplay).toBe(false);
  calls[0].fire('DOMLoaded');
  expect(calls[0].stops).toEqual([0]);
});

test('the dark variant plays inside the dark theme', async () => {
  const { w, calls } = boot('<div data-lex-theme="dark"><lex-brand-mark animation="chart" once></lex-brand-mark></div>');
  await tick(w);
  expect(calls[0].opts.animationData).toEqual({ v: 'dark' });
});
