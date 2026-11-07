/**
 * <lex-walkthrough>: pages forward and back with LANA's push motion, arrow keys and
 * Return move, Escape skips, page actions end it with their id, and it removes itself.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const LEX = ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/components/foundation/lex-btn.js', 'js/lex/components/layout/lex-walkthrough.js']
  .map((rel) => fs.readFileSync(path.join(SRC, rel), 'utf8'));

let window;
let document;
const tick = () => new Promise((resolve) => window.setTimeout(resolve, 0));
const PAGES = [
  { id: 'a', eyebrow: 'Welcome', title: 'One, ', accent: 'first', detail: 'First <b>page</b>' },
  { id: 'b', eyebrow: 'Middle', title: 'Two, ', accent: 'second', detail: 'Second page' },
  { id: 'c', eyebrow: 'End', title: 'Three, ', accent: 'last', detail: 'Last page', actions: [{ id: 'pair', label: 'Pair a phone', variant: 'primary' }] },
];

async function open() {
  const dom = new JSDOM('<!doctype html><body><button id="before">x</button></body>', { url: 'http://localhost/briefs/index.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  window = dom.window;
  document = window.document;
  LEX.forEach((code) => window.eval(code));
  const tour = document.createElement('lex-walkthrough');
  tour.brand = 'BRIEFS.';
  tour.pages = PAGES;
  const done = [];
  tour.addEventListener('lex-walkthrough-done', (event) => done.push(event.detail.action));
  document.body.appendChild(tour);
  await tick();
  return { tour, done };
}

const headline = () => document.querySelector('.lex-walkthrough-headline').textContent;
const key = (k) => document.querySelector('.lex-walkthrough').dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('lex-walkthrough', () => {
  test('renders the first page as text, with Skip and no Back', async () => {
    await open();
    expect(headline()).toBe('One, first.');
    expect(document.querySelector('.lex-walkthrough-detail').innerHTML).toBe('First &lt;b&gt;page&lt;/b&gt;');
    expect(document.querySelector('[data-walkthrough="skip"]')).not.toBeNull();
    expect(document.querySelector('[data-walkthrough="back"]').classList.contains('is-hidden')).toBe(true);
    expect(document.querySelector('.lex-walkthrough-page').classList.contains('lex-push')).toBe(true);
    expect(document.querySelector('.lex-walkthrough-dots').getAttribute('aria-label')).toBe('Page 1 of 3');
  });

  test('arrows page forward and back, pushing from the side it came from', async () => {
    await open();
    key('ArrowRight');
    await tick();
    expect(headline()).toBe('Two, second.');
    key('ArrowLeft');
    await tick();
    expect(headline()).toBe('One, first.');
    expect(document.querySelector('.lex-walkthrough-page').classList.contains('lex-push-back')).toBe(true);
  });

  test('the last page offers its actions and Finish; an action ends it with its id', async () => {
    const { done } = await open();
    key('Enter');
    await tick();
    key('Enter');
    await tick();
    expect(headline()).toBe('Three, last.');
    expect(document.querySelector('[data-walkthrough="skip"]')).toBeNull();
    expect(document.querySelector('[data-walkthrough="next"]').textContent).toContain('Finish');
    document.querySelector('[data-walkthrough-action="pair"] button').click();
    expect(done).toEqual(['pair']);
    expect(document.querySelector('lex-walkthrough')).toBeNull();
  });

  test('Escape skips; Finish ends with null', async () => {
    let opened = await open();
    key('Escape');
    expect(opened.done).toEqual(['skip']);
    expect(document.querySelector('lex-walkthrough')).toBeNull();

    opened = await open();
    opened.tour.page = 2;
    await tick();
    document.querySelector('[data-walkthrough="next"] button').click();
    expect(opened.done).toEqual([null]);
  });
});
