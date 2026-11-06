'use strict';

/** LANA Briefs' walkthrough pages (src/js/briefs/briefs-walkthrough.js). */
const W = require('../../../src/js/briefs/briefs-walkthrough');

const icon = (name) => `<i data-icon="${name}"></i>`;

describe('Briefs walkthrough', () => {
  const pages = W.pages(icon, 'computer');

  test('five pages in the standalone order, ending with Pair a phone', () => {
    expect(pages.map((page) => page.id)).toEqual(['welcome', 'privacy', 'pairing', 'review', 'ready']);
    expect(pages[4].actions).toEqual([{ id: 'pair', label: 'Pair a phone', icon: 'smartphone', variant: 'primary' }]);
    pages.slice(0, 4).forEach((page) => expect(page.actions).toBeUndefined());
  });

  test('copy names the device and has no dashes or emoji', () => {
    expect(pages[0].detail).toContain('here on your computer');
    expect(pages[1].illustration).toContain('This computer');
    pages.forEach((page) => {
      const text = [page.eyebrow, page.title, page.accent, page.detail].join(' ');
      expect(text).not.toMatch(/[–—]|[\u{1F300}-\u{1FAFF}]/u);
    });
  });

  test('pictures use the brand animations and the shared motion classes', () => {
    expect(pages[0].illustration).toContain('animation="idle"');
    expect(pages[2].illustration).toContain('animation="sync"');
    expect(pages[4].illustration).toContain('animation="success"');
    expect(pages[1].illustration).toContain('lex-entrance lex-entrance-step-2');
    expect(pages[1].illustration).toContain('data-icon="lock"');
    expect(pages[3].illustration).toContain('lex-rise');
  });

  test('a missing device noun reads computer', () => {
    expect(W.pages(icon)[0].detail).toContain('your computer');
  });
});
