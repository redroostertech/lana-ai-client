/**
 * LANA Briefs' first-run walkthrough pages for <lex-walkthrough>, ported from the
 * standalone app (walkthrough/Walkthrough.tsx). Copy and pictures only; no DOM. The page
 * (src/briefs/app.js) shows it once per person (the host remembers) and from the gear
 * menu; tests/unit/briefs/briefs-walkthrough.test.js covers it.
 *
 * The pictures are trusted markup built here: LANA brand animations (<lex-brand-mark>)
 * and line icons, arriving with the shared motion classes (css/lex-motion.css).
 */
(function (global) {
  'use strict';

  /** The phone, something between, this computer: each arrives in turn. */
  function devices(icon, deviceNoun, middle) {
    return `<div class="briefs-tour-devices">
        <div class="briefs-tour-device lex-entrance">${icon('smartphone')}<span>Your phone</span></div>
        <div class="lex-entrance lex-entrance-step-1">${middle}</div>
        <div class="briefs-tour-device lex-entrance lex-entrance-step-2">${icon('laptop')}<span>This ${deviceNoun}</span></div>
      </div>`;
  }

  /**
   * The five pages. `icon(name)` returns an icon's SVG markup; `deviceNoun` is how copy
   * names this device ("computer").
   */
  function pages(icon, deviceNoun) {
    const noun = deviceNoun || 'computer';
    return [
      {
        id: 'welcome',
        eyebrow: 'Welcome to Briefs',
        title: 'Your meetings, ',
        accent: 'kept close',
        detail: `Record on your phone. Read the notes, ask questions and act on them here on your ${noun}.`,
        illustration: '<lex-brand-mark class="lex-pop" animation="idle" size="160"></lex-brand-mark>',
      },
      {
        id: 'privacy',
        eyebrow: 'Private by design',
        title: 'Recordings stay ',
        accent: 'with you',
        detail: `Recordings stay on your phone and this ${noun}. Nothing goes to a cloud.`,
        illustration: devices(icon, noun, `<div class="briefs-tour-privacy">
            <div class="briefs-tour-privacy-line"><span></span>${icon('lock')}<span></span></div>
            <span class="briefs-tour-privacy-caption">No cloud in between</span>
          </div>`),
      },
      {
        id: 'pairing',
        eyebrow: 'Pair your phone',
        title: 'One scan, then it ',
        accent: 'finds you',
        detail: `Scan one code to pair. After that, the phone finds this ${noun} on its own when you are in the room.`,
        illustration: devices(icon, noun, '<lex-brand-mark animation="sync" size="120"></lex-brand-mark>'),
      },
      {
        id: 'review',
        eyebrow: 'You stay in charge',
        title: 'LANA proposes, ',
        accent: 'you confirm',
        detail: 'Notes, tasks and email drafts from a meeting wait for your review. Nothing runs until you confirm it with one click.',
        illustration: `<div class="briefs-tour-card lex-rise">
            <div class="briefs-tour-card-top"><span class="briefs-tour-eyebrow">Proposed action</span><span class="briefs-tour-pill"><span class="briefs-tour-pill-dot"></span>Clio</span></div>
            <span class="briefs-tour-card-title">${icon('file-text')}Add note to Acme Logistics</span>
            <p class="briefs-tour-card-detail">Vendor contract review, from Tuesday's intake.</p>
            <span class="briefs-tour-card-confirm">${icon('check')}Confirm</span>
          </div>`,
      },
      {
        id: 'ready',
        eyebrow: 'All set',
        title: 'You are ',
        accent: 'ready',
        detail: 'Pair a phone now, or later from the phone icon at the top of Briefs.',
        illustration: '<lex-brand-mark animation="success" size="160"></lex-brand-mark>',
        actions: [{ id: 'pair', label: 'Pair a phone', icon: 'smartphone', variant: 'primary' }],
      },
    ];
  }

  const api = { pages };
  global.BriefsWalkthrough = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
