/**
 * First-launch setup screen (first-launch.html): a <lex-walkthrough> tour, the same look and
 * motion as the app walkthroughs. The words and state come from first-launch.model.js, the
 * pages from first-launch.pages.js; this file draws them and passes clicks on. Calls go to the
 * main process through window.electronAPI.firstLaunch (electron-preload.js). Follows the
 * computer's light or dark setting.
 */
(function () {
  'use strict';

  var model = window.LanaFirstLaunch;
  var tourPages = window.LanaFirstLaunchPages;
  var api = window.electronAPI && window.electronAPI.firstLaunch;

  function $(id) { return document.getElementById(id); }
  function show(el, visible) { if (el) {el.hidden = !visible;} }
  function text(el, value) { if (el) {el.textContent = value || '';} }
  function icon(name) {
    var Icons = window.Lex && window.Lex.Icons;
    return Icons && Icons.has && Icons.has(name) ? String(Icons[name].small) : '';
  }

  function goToSignIn() {
    window.location.href = 'login.html';
  }

  if (!model || !tourPages || !api) {
    // Outside the app (no api) there is nothing to set up; a missing module is a packaging bug.
    if (api) {console.error('[first-launch] the setup page is missing a script; going to sign in');}
    goToSignIn();
    return;
  }

  // Light or dark, as the computer is set. The brand marks pick their file when they start,
  // so they are told the theme and play again when it changes.
  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function theme() { return dark && dark.matches ? 'dark' : 'light'; }
  function syncMarks() {
    document.querySelectorAll('lex-brand-mark').forEach(function (mark) {
      if (mark.variant !== theme()) {mark.variant = theme();}
    });
  }
  function applyTheme() {
    document.documentElement.setAttribute('data-lex-theme', theme());
    syncMarks();
  }
  applyTheme();
  if (dark && dark.addEventListener) {dark.addEventListener('change', applyTheme);}

  var tour = null;
  var last = null;
  var choicesOpen = false;

  // ---- Filling each page ---------------------------------------------------------------

  function fillWelcome(state) {
    var rows = $('fl-computer-rows');
    if (rows && state.choice) {
      rows.textContent = '';
      state.choice.computerFacts.forEach(function (fact) {
        var row = document.createElement('div');
        row.className = 'app-tour-row';
        var label = document.createElement('span');
        label.className = 'app-tour-row-label';
        label.textContent = fact.label;
        var value = document.createElement('span');
        value.className = 'app-tour-row-value';
        value.textContent = fact.value;
        row.appendChild(label);
        row.appendChild(value);
        rows.appendChild(row);
      });
    }
  }

  function fillFound(state) {
    var radio = $('fl-found-choice');
    if (!radio || !state.found) {return;}
    radio.options = state.found.options;
    radio.value = state.useExisting ? 'use' : 'download';
  }

  function fillChat(state) {
    var view = state.choice;
    if (!view) {return;}
    var chat = view.chat;
    if (!chat.cloud && $('fl-chat-name')) {
      text($('fl-chat-name'), chat.name);
      show($('fl-chat-recommended'), chat.recommended);
      var fit = $('fl-chat-fit');
      text(fit, chat.fitText);
      fit.className = 'app-tour-pill' + (chat.fitTone === 'good' ? '' : ' app-tour-pill--amber');
      text($('fl-chat-remembers'), chat.remembers);
      text($('fl-chat-where'), chat.where);
      text($('fl-chat-size'), chat.size + ' download');
      show($('fl-chat-note'), Boolean(chat.note));
      text($('fl-chat-note'), chat.note);
      var toggle = $('fl-choose-toggle');
      show(toggle, view.choices.length > 1);
      toggle.trailingIcon = choicesOpen ? 'chevron-up' : 'chevron-down';
      show($('fl-choices'), choicesOpen && view.choices.length > 1);
      var list = $('fl-choice-list');
      list.options = view.choices;
      list.value = view.selectedId || '';
      list.disabled = Boolean(state.busy);
    }
    var extras = $('fl-extras');
    if (extras) {
      extras.textContent = '';
      view.extras.forEach(function (line) {
        var row = document.createElement('div');
        row.className = 'app-tour-row' + (line.included ? '' : ' fl-extra--off');
        var mark = document.createElement('span');
        mark.className = line.included ? 'app-tour-check' : 'app-tour-check fl-check--off';
        mark.innerHTML = icon(line.included ? 'check' : 'cloud');
        var label = document.createElement('span');
        label.className = 'app-tour-row-label';
        label.textContent = line.title;
        var value = document.createElement('span');
        value.className = 'app-tour-row-value';
        value.textContent = line.text;
        row.appendChild(mark);
        row.appendChild(label);
        row.appendChild(value);
        extras.appendChild(row);
      });
    }
    text($('fl-disk'), view.disk);
    show($('fl-choose-error'), Boolean(state.error));
    text($('fl-choose-error'), state.error);
  }

  function fillProgress(state) {
    var view = state.progress;
    if (!$('fl-progress-card')) {return;}
    text($('fl-progress-heading'), view.heading);
    $('fl-progress-card').setAttribute('data-tone', view.tone);
    var bar = $('fl-progress-bar');
    bar.value = view.percent;
    bar.color = view.tone === 'danger' ? 'danger' : view.tone === 'good' ? 'success' : 'accent';
    text($('fl-progress-current'), view.current);
    text($('fl-progress-bytes'), view.bytes);
    var message = view.error || state.error;
    show($('fl-progress-error'), Boolean(message));
    text($('fl-progress-error'), message);
    show($('fl-pause'), view.canPause);
    show($('fl-resume'), view.canResume);
    show($('fl-retry'), view.canRetry);
    text($('fl-progress-note'), view.note);
    var mark = $('fl-mark');
    if (mark && mark.animation !== view.mark) {mark.animation = view.mark;}
    applyHeader(view.header);
  }

  /** The walkthrough page's eyebrow, headline and line, for the current setup state. */
  function applyHeader(header) {
    if (!tour || !header) {return;}
    var eyebrow = tour.querySelector('.lex-walkthrough-eyebrow');
    var headline = tour.querySelector('.lex-walkthrough-headline');
    var detail = tour.querySelector('.lex-walkthrough-detail');
    if (eyebrow) {eyebrow.textContent = header.eyebrow;}
    if (headline) {
      headline.textContent = header.title;
      var accent = document.createElement('em');
      accent.textContent = header.accent;
      headline.appendChild(accent);
      headline.appendChild(document.createTextNode('.'));
    }
    if (detail) {
      detail.textContent = header.detail;
      detail.hidden = !header.detail;
    }
  }

  function fill() {
    if (!tour || !last) {return;}
    var page = (tour.pages || [])[tour.page];
    var id = page && page.id;
    if (id === 'welcome') {fillWelcome(last);}
    else if (id === 'found') {fillFound(last);}
    else if (id === 'chat') {fillChat(last);}
    else if (id === 'progress') {fillProgress(last);}
    syncMarks();
  }

  // ---- The tour ------------------------------------------------------------------------

  function pageIndex(id) {
    return (tour.pages || []).findIndex(function (p) { return p.id === id; });
  }

  function buildPages(state, accepted) {
    return tourPages.pages({ choice: state.choice, found: state.found, accepted: accepted });
  }

  function openTour(state, accepted) {
    show($('fl-loading'), false);
    show($('fl-load-error'), false);
    tour = document.createElement('lex-walkthrough');
    // The app walkthroughs' look; setup cannot be skipped (Michael, 2026-11-09).
    tour.className = tourPages.TOUR.className;
    tour.brand = tourPages.TOUR.brand;
    tour.skippable = tourPages.TOUR.skippable;
    tour.keyboardNav = tourPages.TOUR.keyboardNav;
    tour.pages = buildPages(state, accepted);
    tour.addEventListener('lex-walkthrough-page', fill);
    tour.addEventListener('lex-walkthrough-next', onNext);
    tour.addEventListener('lex-walkthrough-done', goToSignIn);
    tour.addEventListener('lex-change', onChange);
    tour.addEventListener('click', onClick);
    document.body.appendChild(tour);
  }

  function onNext(event) {
    var page = tour.pages[tour.page];
    if (!page) {return;}
    if (page.id === 'chat') {
      event.preventDefault();
      controller.proceed().then(function () {
        if (controller.state().mode === 'progress') {tour.page = pageIndex('progress');}
      });
    }
  }

  function onChange(event) {
    var target = event.target;
    if (target.id === 'fl-choice-list') {controller.pick(event.detail.value);}
    else if (target.id === 'fl-found-choice') {controller.setUseExisting(event.detail.value === 'use');}
  }

  function onClick(event) {
    var button = event.target.closest && event.target.closest('lex-btn');
    if (!button) {return;}
    if (button.id === 'fl-found-next') {tour.next();}
    else if (button.id === 'fl-choose-toggle') {
      choicesOpen = !choicesOpen;
      fill();
    } else if (button.id === 'fl-pause') {controller.pause();}
    else if (button.id === 'fl-resume' || button.id === 'fl-retry') {controller.resume();}
  }

  function render(state) {
    last = state;
    if (state.mode === 'loading') {
      show($('fl-loading'), !state.error);
      show($('fl-load-error'), Boolean(state.error));
      text($('fl-load-error-text'), state.error);
      return;
    }
    // The tour opens once the search for files already here is done, so its first page can
    // say what was found (the loading screen covers the wait; later launches are instant).
    if (!tour && (state.mode === 'progress' || !state.looking)) {openTour(state, state.mode === 'progress');}
    if (!tour) {return;}
    fill();
  }

  var controller = model.createFirstLaunchController({ api: api, render: render });
  api.onStatus(controller.onStatus);
  $('fl-load-retry').addEventListener('click', function () { controller.load(); });
  $('fl-load-skip').addEventListener('click', goToSignIn);
  controller.load();
})();
