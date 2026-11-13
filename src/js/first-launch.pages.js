/**
 * The first-launch setup pages for <lex-walkthrough> (first-launch.html), in the same look as
 * the app walkthroughs (css/app-walkthrough.css) and Briefs. Copy and markup only; no DOM.
 * first-launch.js fills the parts with ids after each page is drawn (lex-walkthrough-page),
 * from first-launch.model.js.
 *
 *   pages({ choice, found, accepted })
 *     choice:   buildChoiceView() result (cloud or a chat model)
 *     found:    buildFoundView() result, or null (no "already on this computer" page)
 *     accepted: Continue was pressed before (only the progress page)
 *     exit:     exitFor() result: where the screen goes when it is done (default sign in)
 *
 *   exitFor(search)
 *     The main process names the way on in ?next= (electron-start-page.js signInPage): 'app'
 *     for an install with a saved, signed-in server, which goes into the app; anything else
 *     goes to sign in.
 */
(function (global) {
  'use strict';

  function welcome(hasFound) {
    return {
      id: 'welcome',
      eyebrow: 'Welcome to LANA',
      title: 'Your AI, on ',
      accent: 'this computer',
      detail: 'LANA checked this computer and picked an AI setup that fits.',
      illustration: '<lex-brand-mark class="lex-pop" animation="idle" size="112"></lex-brand-mark>',
      content: `<div class="app-tour-card fl-card">
          <div class="app-tour-card-head"><span class="app-tour-eyebrow">This computer</span></div>
          <div id="fl-computer-rows"></div>
        </div>${hasFound ? `
        <div class="fl-found-cta">
          <p class="fl-found-line">Found AI files you already have.</p>
          <lex-btn id="fl-found-next" variant="primary" trailing-icon="arrow-right">See what LANA found</lex-btn>
        </div>` : ''}`,
      // With files found, the button above is the way on.
      next: !hasFound
    };
  }

  function found(view) {
    return {
      id: 'found',
      eyebrow: 'Files you have',
      title: 'Use what you ',
      accent: 'have',
      detail: view.text,
      illustration: '<lex-brand-mark class="lex-pop" animation="sync" size="112"></lex-brand-mark>',
      content: `<div class="app-tour-card fl-card">
          <lex-radio id="fl-found-choice" name="found"></lex-radio>
        </div>`
    };
  }

  function chat(choice) {
    const extras = `<div class="app-tour-card fl-card">
        <div class="app-tour-card-head"><span class="app-tour-eyebrow">LANA also sets up, by itself</span></div>
        <div id="fl-extras"></div>
      </div>
      <p id="fl-disk" class="fl-disk"></p>
      <p id="fl-choose-error" class="fl-error" role="alert" hidden></p>`;
    if (choice.chat.cloud) {
      return {
        id: 'chat',
        eyebrow: 'Chat',
        title: 'Runs in ',
        accent: 'the cloud',
        detail: choice.chat.text,
        illustration: '',
        nextLabel: 'Continue',
        content: extras
      };
    }
    return {
      id: 'chat',
      eyebrow: 'Chat',
      title: 'Picked for ',
      accent: 'you',
      detail: 'Most people keep this one.',
      illustration: '',
      nextLabel: 'Continue',
      content: `<div class="app-tour-card fl-card">
          <div class="app-tour-card-head"><span id="fl-chat-name" class="app-tour-title fl-chat-name"></span><span id="fl-chat-recommended" class="app-tour-pill">Recommended</span></div>
          <div class="fl-facts">
            <span id="fl-chat-fit" class="app-tour-pill"></span>
            <span id="fl-chat-remembers"></span>
            <span id="fl-chat-where"></span>
            <span id="fl-chat-size"></span>
          </div>
          <p id="fl-chat-note" class="app-tour-detail" hidden></p>
          <lex-btn id="fl-choose-toggle" variant="ghost" size="sm" trailing-icon="chevron-down">Choose a different model</lex-btn>
          <div id="fl-choices" class="fl-choices" hidden>
            <lex-radio id="fl-choice-list" name="chat-model" label="Chat models for this computer"></lex-radio>
          </div>
        </div>
        ${extras}`
    };
  }

  const SIGN_IN = Object.freeze({ href: 'login.html', label: 'Go to sign in', signedIn: false });
  const OPEN_APP = Object.freeze({ href: 'dashboard.html', label: 'Open LANA', signedIn: true });

  function exitFor(search) {
    const match = /[?&]next=([^&]*)/.exec(String(search || ''));
    return match && match[1] === 'app' ? { ...OPEN_APP } : { ...SIGN_IN };
  }

  function progress(exit) {
    return {
      id: 'progress',
      eyebrow: 'Setting up',
      title: 'Getting LANA ',
      accent: 'ready',
      detail: 'This happens once.',
      illustration: '<lex-brand-mark id="fl-mark" class="lex-pop" animation="spinner" size="96"></lex-brand-mark>',
      back: false,
      nextLabel: (exit || SIGN_IN).label,
      // The one way on from here, so the filled button.
      nextVariant: 'primary',
      content: `<div id="fl-progress-card" class="app-tour-card fl-card">
          <div class="app-tour-card-head"><span id="fl-progress-heading" class="app-tour-title"></span><span id="fl-progress-bytes" class="fl-bytes"></span></div>
          <lex-progress-bar id="fl-progress-bar" size="md"></lex-progress-bar>
          <p id="fl-progress-current" class="app-tour-detail"></p>
          <p id="fl-progress-error" class="fl-error" role="alert" hidden></p>
          <div class="fl-row">
            <lex-btn id="fl-pause" variant="secondary" size="sm" leading-icon="pause" hidden>Pause</lex-btn>
            <lex-btn id="fl-resume" variant="secondary" size="sm" leading-icon="play" hidden>Resume</lex-btn>
            <lex-btn id="fl-retry" variant="secondary" size="sm" leading-icon="refresh-cw" hidden>Try again</lex-btn>
          </div>
        </div>
        <p id="fl-progress-note" class="fl-note"></p>`
    };
  }

  function pages(input) {
    if (input.accepted) {return [progress(input.exit)];}
    const list = [welcome(Boolean(input.found))];
    if (input.found) {list.push(found(input.found));}
    list.push(chat(input.choice), progress(input.exit));
    return list;
  }

  /** The tour itself: the app walkthroughs' look, and no Skip (setup must be finished). */
  // Every move forward is a button: no Skip, and no arrow, Return or Escape keys.
  const TOUR = Object.freeze({ className: 'app-tour fl-tour', brand: 'LANA.', skippable: false, keyboardNav: false });

  const api = { pages, exitFor, TOUR };
  global.LanaFirstLaunchPages = api;
  if (typeof module !== 'undefined' && module.exports) {module.exports = api;}
})(typeof window !== 'undefined' ? window : globalThis);
