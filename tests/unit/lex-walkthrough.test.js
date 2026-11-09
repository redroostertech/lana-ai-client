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

  test('a page that asks something: content people use, its own Next words, no Back, and a Next that can wait', async () => {
    const { tour } = await open();
    const seen = [];
    tour.addEventListener('lex-walkthrough-page', (event) => seen.push(event.detail.id));
    tour.pages = [
      { id: 'ask', eyebrow: 'Ask', title: 'Pick, ', accent: 'one', detail: 'Choose', content: '<div id="ask-box"><input id="ask-input"></div>', nextLabel: 'Continue' },
      { id: 'wait', eyebrow: 'Wait', title: 'Working, ', accent: 'now', detail: 'Wait', back: false, nextLabel: 'Go to sign in' }
    ];
    await tick();
    expect(seen).toContain('ask');
    const box = document.querySelector('.lex-walkthrough-content #ask-input');
    expect(box).not.toBeNull();
    expect(box.closest('[aria-hidden="true"]')).toBeNull();
    expect(document.querySelector('[data-walkthrough="next"]').textContent).toContain('Continue');

    let hold = true;
    tour.addEventListener('lex-walkthrough-next', (event) => { if (hold) event.preventDefault(); });
    document.querySelector('[data-walkthrough="next"] button').click();
    await tick();
    expect(tour.page).toBe(0);
    hold = false;
    document.querySelector('[data-walkthrough="next"] button').click();
    await tick();
    expect(tour.page).toBe(1);
    expect(seen).toContain('wait');
    expect(document.querySelector('[data-walkthrough="back"]').classList.contains('is-hidden')).toBe(true);
    key('ArrowLeft');
    await tick();
    expect(tour.page).toBe(1);
    expect(document.querySelector('[data-walkthrough="next"]').textContent).toContain('Go to sign in');
    // A last page is Finish in secondary unless it asks for the filled button.
    expect(document.querySelector('[data-walkthrough="next"]').getAttribute('variant')).toBe('secondary');
    tour.pages = tour.pages.map((p) => (p.id === 'wait' ? { ...p, nextVariant: 'primary' } : p));
    await tick();
    expect(document.querySelector('[data-walkthrough="next"]').getAttribute('variant')).toBe('primary');
  });

  test('skippable false (first launch): no Skip, and Escape does nothing; other tours keep Skip', async () => {
    const { tour, done } = await open();
    expect(document.querySelector('[data-walkthrough="skip"]')).not.toBeNull();
    tour.skippable = false;
    await tick();
    expect(document.querySelector('[data-walkthrough="skip"]')).toBeNull();
    key('Escape');
    await tick();
    expect(done).toEqual([]);
    expect(document.querySelector('lex-walkthrough')).not.toBeNull();
  });

  test('keyboardNav false: arrows and Return do not move; other tours keep their keys', async () => {
    const { tour } = await open();
    key('ArrowRight');
    await tick();
    expect(tour.page).toBe(1);
    tour.keyboardNav = false;
    await tick();
    key('ArrowRight');
    key('Enter');
    await tick();
    expect(tour.page).toBe(1);
    key('ArrowLeft');
    await tick();
    expect(tour.page).toBe(1);
    document.querySelector('[data-walkthrough="next"] button').click();
    await tick();
    expect(tour.page).toBe(2);
  });

  test('a page with next false hides Next; tour.next() still moves on', async () => {
    const { tour } = await open();
    tour.pages = [{ id: 'a', eyebrow: 'A', title: 'A', detail: 'a', next: false, content: '<lex-btn id="own">Go</lex-btn>' }, { id: 'b', eyebrow: 'B', title: 'B', detail: 'b' }];
    await tick();
    expect(document.querySelector('[data-walkthrough="next"]').classList.contains('is-hidden')).toBe(true);
    tour.next();
    await tick();
    expect(tour.page).toBe(1);
    expect(document.querySelector('[data-walkthrough="next"]').classList.contains('is-hidden')).toBe(false);
  });
});
