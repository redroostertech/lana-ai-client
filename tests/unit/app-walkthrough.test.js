/**
 * App walkthroughs (Agents, Automate, Insights): the pages, and the runner that shows
 * a walkthrough once per person and remembers it in their server preferences.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const W = require('../../src/js/shared/app-walkthrough.js');
const tours = {
  agents: require('../../src/js/walkthroughs/agents-walkthrough.js'),
  automate: require('../../src/js/walkthroughs/automate-walkthrough.js'),
  insights: require('../../src/js/walkthroughs/insights-walkthrough.js')
};

describe('remembering a finished walkthrough', () => {
  test('reads when an app was finished; null or missing means not yet', () => {
    const prefs = { onboarding: { walkthroughs: { agents: '2026-11-08T15:00:00.000Z', insights: null } } };
    expect(W.seenFrom(prefs, 'agents')).toBe('2026-11-08T15:00:00.000Z');
    expect(W.seenFrom(prefs, 'insights')).toBeNull();
    expect(W.seenFrom(prefs, 'automate')).toBeNull();
    expect(W.seenFrom({}, 'agents')).toBeNull();
  });

  test('marking one app keeps the others, because the server replaces the whole group', () => {
    const prefs = { onboarding: { walkthroughs: { agents: '2026-11-01T00:00:00.000Z' } } };
    expect(W.withSeen(prefs, 'insights', '2026-11-08T00:00:00.000Z')).toEqual({
      walkthroughs: { agents: '2026-11-01T00:00:00.000Z', insights: '2026-11-08T00:00:00.000Z' }
    });
    expect(W.withSeen({}, 'automate', 'now')).toEqual({ walkthroughs: { automate: 'now' } });
  });
});

describe('the walkthrough pages', () => {
  const icon = (name) => `<svg data-icon="${name}"></svg>`;
  test.each(Object.keys(tours))('%s: six pages, each with a headline, a sentence and a picture; the last opens the first task', (app) => {
    const pages = tours[app].pages(icon);
    expect(pages).toHaveLength(6);
    pages.forEach((page) => {
      expect(page.eyebrow && page.title && page.accent && page.detail && page.illustration).toBeTruthy();
      expect(page.detail.length).toBeLessThan(170);
    });
    expect(new Set(pages.map((p) => p.id)).size).toBe(6);
    const last = pages[pages.length - 1];
    expect(last.actions).toEqual([expect.objectContaining({ id: 'create', variant: 'primary' })]);
  });
});

describe('showing a walkthrough', () => {
  function boot(preferences) {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(fs.readFileSync(path.join(__dirname, '../../src/js/shared/app-walkthrough.js'), 'utf8'));
    const saved = [];
    w.api = {
      getPreferences: async () => ({ status: 'success', preferences }),
      updatePreferences: async (updates) => { saved.push(updates); return {}; }
    };
    const actions = [];
    w.LanaAppWalkthrough.register('agents', { brand: 'AGENTS.', pages: () => [{ id: 'one' }], onAction: (id) => actions.push(id) });
    return { w, saved, actions };
  }

  test('the first visit shows it; finishing saves it as seen and runs the last page action', async () => {
    const { w, saved, actions } = boot({ onboarding: { walkthroughs: { insights: 'earlier' } } });
    expect(await w.LanaAppWalkthrough.showFirstRun('agents')).toBe(true);
    const tour = w.document.querySelector('lex-walkthrough');
    expect(tour.className).toBe('app-tour app-tour--agents');
    tour.dispatchEvent(new w.CustomEvent('lex-walkthrough-done', { detail: { action: 'create' } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(actions).toEqual(['create']);
    expect(saved).toHaveLength(1);
    expect(saved[0].onboarding.walkthroughs.insights).toBe('earlier');
    expect(typeof saved[0].onboarding.walkthroughs.agents).toBe('string');
  });

  test('skipping also counts as seen, but runs no action', async () => {
    const { w, saved, actions } = boot({});
    w.LanaAppWalkthrough.show('agents');
    w.document.querySelector('lex-walkthrough').dispatchEvent(new w.CustomEvent('lex-walkthrough-done', { detail: { action: 'skip' } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(actions).toEqual([]);
    expect(saved).toHaveLength(1);
  });

  test('waits for the next visit when another tour is already on screen', async () => {
    const { w, saved } = boot({});
    w.document.body.appendChild(w.document.createElement('lex-onboarding'));
    expect(await w.LanaAppWalkthrough.showFirstRun('agents')).toBe(false);
    expect(w.document.querySelector('lex-walkthrough')).toBeNull();
    expect(saved).toHaveLength(0);
  });

  test('not shown again once seen, nor when preferences cannot be read (control: shown when not seen)', async () => {
    expect(await boot({ onboarding: { walkthroughs: { agents: 'earlier' } } }).w.LanaAppWalkthrough.showFirstRun('agents')).toBe(false);
    const offline = boot({});
    offline.w.api.getPreferences = async () => { throw new Error('offline'); };
    expect(await offline.w.LanaAppWalkthrough.showFirstRun('agents')).toBe(false);
    expect(await boot({ onboarding: { walkthroughs: { agents: null } } }).w.LanaAppWalkthrough.showFirstRun('agents')).toBe(true);
  });
});
