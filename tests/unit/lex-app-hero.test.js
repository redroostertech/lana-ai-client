/**
 * lex-app-hero (the dark welcome banner on app homes) and lex-app-loop (the
 * "How it works" steps under it), plus lex-brand-mark's forced dark variant.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');
const tick = (w) => new Promise((r) => w.setTimeout(r, 20));

function boot(html) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  ['lex/lex.core.js', 'lex/lex.icons.js', 'lex/components/foundation/lex-btn.js',
    'lex/components/foundation/lex-brand-mark.js', 'lex/components/layout/lex-app-hero.js',
    'lex/components/layout/lex-app-loop.js']
    .forEach((rel) => { try { w.eval(read(rel)); } catch (e) { if (!rel.includes('icons')) throw e; } });
  w.document.body.innerHTML = html;
  return w;
}

describe('lex-app-hero', () => {
  test('shows the label, both headline lines, the sentence, the steps and the animation', async () => {
    const w = boot('<lex-app-hero eyebrow="Briefs" heading="Your meetings," accent="kept close." subtitle="Notes appear here." animation="sync" steps="Record, Notes ,Actions,Extra"></lex-app-hero>');
    await tick(w);
    const hero = w.document.querySelector('lex-app-hero');
    const text = (part) => hero.querySelector(`[data-part="${part}"]`).textContent;
    expect([text('eyebrow'), text('heading'), text('accent'), text('subtitle')]).toEqual(['Briefs', 'Your meetings,', 'kept close.', 'Notes appear here.']);
    expect(Array.from(hero.querySelectorAll('.lex-app-hero-step')).map((s) => s.textContent)).toEqual(['Record', 'Notes', 'Actions']);
    const mark = hero.querySelector('lex-brand-mark');
    expect(mark.getAttribute('animation')).toBe('sync');
    expect(mark.getAttribute('variant')).toBe('dark');
  });

  test('changing the subtitle keeps the same action buttons and their click handlers', async () => {
    const w = boot('<lex-app-hero heading="Hi" subtitle="First"><lex-btn id="go" variant="primary">Go</lex-btn></lex-app-hero>');
    await tick(w);
    const hero = w.document.querySelector('lex-app-hero');
    const before = w.document.getElementById('go');
    let clicks = 0;
    before.addEventListener('click', () => { clicks += 1; });
    hero.setAttribute('subtitle', '2 proposed actions are waiting for your review.');
    await tick(w);
    expect(hero.querySelector('[data-part="subtitle"]').textContent).toBe('2 proposed actions are waiting for your review.');
    const after = w.document.getElementById('go');
    expect(after).toBe(before);
    after.click();
    expect(clicks).toBe(1);
    expect(hero.querySelectorAll('#go').length).toBe(1);
  });

  test('text is written as text, and an empty accent line is hidden', async () => {
    const w = boot('<lex-app-hero heading="<img src=x onerror=alert(1)>" steps="<b>Run</b>"></lex-app-hero>');
    await tick(w);
    const hero = w.document.querySelector('lex-app-hero');
    expect(hero.querySelector('img, b')).toBeNull();
    expect(hero.querySelector('[data-part="accent"]').hidden).toBe(true);
  });
});

describe('lex-app-loop', () => {
  test('numbers the steps and says which one was clicked', async () => {
    const steps = JSON.stringify([{ value: 'build', title: 'Build', text: 'Start' }, { value: 'runs', title: 'Run' }]);
    const w = boot(`<lex-app-loop kicker="How it works" heading="Three steps." steps='${steps}'></lex-app-loop>`);
    await tick(w);
    const loop = w.document.querySelector('lex-app-loop');
    expect(Array.from(loop.querySelectorAll('.lex-app-loop-number')).map((n) => n.textContent)).toEqual(['01', '02']);
    const picked = [];
    loop.addEventListener('lex-app-loop-select', (e) => picked.push(e.detail.value));
    loop.querySelectorAll('.lex-app-loop-step')[1].click();
    expect(picked).toEqual(['runs']);
  });

  test('a malformed steps value shows no steps instead of breaking the page', async () => {
    const w = boot('<lex-app-loop heading="Three steps." steps="not json"></lex-app-loop>');
    await tick(w);
    expect(w.document.querySelectorAll('.lex-app-loop-step').length).toBe(0);
    expect(w.document.querySelector('.lex-app-loop-heading').textContent).toBe('Three steps.');
  });
});

describe('lex-brand-mark variant', () => {
  function played(html) {
    const w = boot('');
    const loaded = [];
    w.LexBrandAnimations = { orbit: { light: { nm: 'light' }, dark: { nm: 'dark' } } };
    w.lottie = { loadAnimation: (opts) => { loaded.push(opts.animationData.nm); return { addEventListener() {}, destroy() {} }; } };
    w.document.body.innerHTML = html;
    return tick(w).then(() => loaded);
  }

  test('variant="dark" plays the dark file on a light page; auto follows the page theme (control)', async () => {
    expect(await played('<lex-brand-mark animation="orbit" variant="dark"></lex-brand-mark>')).toEqual(['dark']);
    expect(await played('<lex-brand-mark animation="orbit"></lex-brand-mark>')).toEqual(['light']);
    expect(await played('<div data-lex-theme="dark"><lex-brand-mark animation="orbit"></lex-brand-mark></div>')).toEqual(['dark']);
    expect(await played('<div data-lex-theme="dark"><lex-brand-mark animation="orbit" variant="light"></lex-brand-mark></div>')).toEqual(['light']);
  });
});
