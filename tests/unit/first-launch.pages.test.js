/**
 * The first-launch tour pages (src/js/first-launch.pages.js): which pages show, in what order,
 * the cloud wording, and that the progress page cannot go back.
 */

const { pages, TOUR } = require('../../src/js/first-launch.pages');

const local = { chat: { cloud: false } };
const cloud = { chat: { cloud: true, text: 'This computer is too small to run LANA\'s chat. LANA will use the cloud instead.' } };

test('welcome, chat, progress; the found page only when something was found', () => {
  expect(pages({ choice: local, found: null }).map((p) => p.id)).toEqual(['welcome', 'chat', 'progress']);
  expect(pages({ choice: local, found: { text: 'Found Qwen3.5 9B already on this computer. Use it? Saves 5.2 GB.' } }).map((p) => p.id)).toEqual(['welcome', 'found', 'chat', 'progress']);
});

test('after Continue only the progress page shows, with no way back and a sign-in button', () => {
  const list = pages({ choice: local, accepted: true });
  expect(list.map((p) => p.id)).toEqual(['progress']);
  expect(list[0]).toMatchObject({ back: false, nextLabel: 'Go to sign in', nextVariant: 'primary' });
});

test('the cloud chat page says chat runs in the cloud and still offers Continue, with no chooser', () => {
  const chat = pages({ choice: cloud }).find((p) => p.id === 'chat');
  expect(chat.eyebrow + ': ' + chat.title + chat.accent).toBe('Chat: Runs in the cloud');
  expect(chat.nextLabel).toBe('Continue');
  expect(chat.content).not.toMatch(/fl-choice-list/);
});

test('copy is platform neutral, with no dashes', () => {
  const all = JSON.stringify([pages({ choice: local, found: { text: 'x' } }), pages({ choice: cloud })]);
  expect(all).not.toMatch(/\bMac\b|iPhone|Windows|\u2013|\u2014/);
});

test('the setup tour cannot be skipped and uses the app walkthrough look', () => {
  expect(TOUR).toEqual({ className: 'app-tour fl-tour', brand: 'LANA.', skippable: false, keyboardNav: false });
});

test('welcome with files found: says so, with a button to the found step instead of Next', () => {
  const [welcome] = pages({ choice: local, found: { text: 'x' } });
  expect(welcome.content).toMatch(/Found AI files you already have\./);
  expect(welcome.content).toMatch(/id="fl-found-next"/);
  expect(welcome.next).toBe(false);
  const [plain] = pages({ choice: local, found: null });
  expect(plain.content).not.toMatch(/Found AI files/);
  expect(plain.next).toBe(true);
});

describe('where the screen goes when it is done (main names it in ?next=)', () => {
  const { exitFor } = require('../../src/js/first-launch.pages');

  test('a signed-in install goes into the app, with a button that says so', () => {
    expect(exitFor('?next=app')).toEqual({ href: 'dashboard.html', label: 'Open LANA', signedIn: true });
  });

  test('otherwise sign in; anything else in next is ignored', () => {
    const signIn = { href: 'login.html', label: 'Go to sign in', signedIn: false };
    expect(exitFor('')).toEqual(signIn);
    expect(exitFor('?next=login')).toEqual(signIn);
    expect(exitFor('?next=https://evil.example')).toEqual(signIn);
    expect(exitFor(undefined)).toEqual(signIn);
  });

  test('the progress page button follows it', () => {
    const [progress] = pages({ choice: local, accepted: true, exit: exitFor('?next=app') });
    expect(progress.nextLabel).toBe('Open LANA');
  });
});
