/**
 * <lex-onboarding> (the first-run tour after sign-in) follows the shared theme
 * (lex.theme.js) instead of always drawing light, and changes live.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function setup(dark) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  const listeners = [];
  const media = {
    matches: dark,
    addEventListener: (type, fn) => listeners.push(fn),
    removeEventListener: () => {},
    set(value) { this.matches = value; listeners.slice().forEach((fn) => fn({ matches: value })); }
  };
  w.matchMedia = (query) => (query.includes('color-scheme') ? media : { matches: true, addEventListener() {}, removeEventListener() {} });
  w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
  w.Element.prototype.getAnimations = () => [];
  w.eval(read('js/lex/lex.theme.js'));
  ['js/lex/lex.core.js', 'js/onboarding/onboarding-flow.js', 'js/onboarding/onboarding-state.js', 'js/lex/components/foundation/lex-onboarding.js'].forEach((rel) => w.eval(read(rel)));
  const el = w.document.createElement('lex-onboarding');
  el.setup({ store: { load: () => ({}), save() {} }, state: w.LanaOnboardingFlow.normalize({}), decision: 'show', firstName: 'Michael', steps: [] });
  w.document.body.appendChild(el);
  return { el, media };
}

describe('lex-onboarding theme', () => {
  test('is light on a light computer and dark on a dark one', () => {
    expect(setup(false).el.getAttribute('theme')).toBe('light');
    expect(setup(true).el.getAttribute('theme')).toBe('dark');
  });

  test('follows the computer live', () => {
    const { el, media } = setup(true);
    media.set(false);
    expect(el.getAttribute('theme')).toBe('light');
  });
});
