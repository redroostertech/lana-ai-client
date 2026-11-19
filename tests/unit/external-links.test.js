'use strict';

/**
 * target="_blank" web links on the app's own pages open through the guarded openExternal
 * channel (src/js/shared/external-links.js), so a real click opens them without a question.
 * Third-party frames cannot load the script and still go through window.open, which asks.
 */

const fs = require('fs');
const path = require('path');
const { handleClick } = require('../../src/js/shared/external-links');
const { createExternalOpener } = require('../../electron-external-open');
const { isAllowedExternalUrl } = require('../../src/electron-external-url');

const SRC = path.join(__dirname, '..', '..', 'src');

function link(href, target = '_blank') {
  const a = { href, getAttribute: (n) => (n === 'target' ? target : null) };
  return { closest: (selector) => (target === '_blank' && /target="_blank"/.test(selector) ? a : null) };
}
function click(target, { isTrusted = true } = {}) {
  return { isTrusted, defaultPrevented: false, target, preventDefault() { this.defaultPrevented = true; } };
}

describe('the click handler', () => {
  test('a real click on a _blank web link goes to openExternal, and the default open is stopped', () => {
    const openExternal = jest.fn(async () => true);
    const event = click(link('https://docs.example.com/api'));
    expect(handleClick(event, { electronAPI: { openExternal } })).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://docs.example.com/api');
    expect(event.defaultPrevented).toBe(true);
  });

  test('a same-origin app frame uses the top page\'s API', () => {
    const openExternal = jest.fn(async () => true);
    const frame = { parent: { electronAPI: { openExternal } } };
    expect(handleClick(click(link('mailto:help@firm.test')), frame)).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('mailto:help@firm.test');
  });

  test('a click made by script, a link that is not _blank, an app link or no API: nothing special', () => {
    const openExternal = jest.fn();
    const win = { electronAPI: { openExternal } };
    const synthetic = click(link('https://docs.example.com'), { isTrusted: false });
    expect(handleClick(synthetic, win)).toBe(false);
    expect(synthetic.defaultPrevented).toBe(false);
    expect(handleClick(click(link('https://docs.example.com', '_self')), win)).toBe(false);
    expect(handleClick(click(link('lana-app://app/public_html/help.html')), win)).toBe(false);
    expect(handleClick(click(link('javascript:alert(1)')), win)).toBe(false);
    expect(handleClick(click(link('https://docs.example.com')), {})).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('what the main process then does', () => {
  const APP = 'lana-app://app/public_html/app.html';
  const contents = { id: 1, mainFrame: { url: APP, parent: null }, focusedFrame: { url: APP, parent: null } };
  const opener = (confirm) => createExternalOpener({ shell: { openExternal: jest.fn(async () => {}) }, isAllowed: isAllowedExternalUrl, gestures: { recent: () => true }, confirm, log: () => {} });

  test('an app page link clicked by the person opens with no question', async () => {
    const confirm = jest.fn(async () => false);
    await expect(opener(confirm).open('https://docs.example.com/api', { contents })).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  test('a window.open from a third-party frame still asks (no referrer) or is refused (its referrer)', async () => {
    const confirm = jest.fn(async () => false);
    await expect(opener(confirm).open('https://evil.example', { contents, fromWindowOpen: true, openerUrl: '' })).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    const refused = jest.fn(async () => true);
    await expect(opener(refused).open('https://evil.example', { contents, fromWindowOpen: true, openerUrl: 'https://preview.example/doc' })).resolves.toBe(false);
    expect(refused).not.toHaveBeenCalled();
  });
});

test('every app page loads the script (routed pages also get it from app.html)', () => {
  const pages = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) pages.push(full);
    }
  })(SRC);
  expect(pages.length).toBeGreaterThan(100);
  const missing = pages.filter((file) => {
    const expected = path.relative(path.dirname(file), path.join(SRC, 'js', 'shared', 'external-links.js')).split(path.sep).join('/');
    return !fs.readFileSync(file, 'utf8').includes(`<script src="${expected}"></script>`);
  }).map((file) => path.relative(SRC, file));
  expect(missing).toEqual([]);
});
