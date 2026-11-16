/**
 * Settings > General > Appearance: Light, Dark or System for every LANA window on this
 * computer. The control reads and writes the shared theme (js/lex/lex.theme.js,
 * window.LexTheme), which saves the setting in the main process (electron-appearance.js);
 * a change made in another window or in LANA Briefs moves the control too.
 */
(function (global) {
  'use strict';

  var CHOICES = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];

  /** The line under "Theme": what the current choice means. */
  function noteFor(preference, theme) {
    if (preference === 'system') return 'Follows your computer, which is set to ' + theme + ' now.';
    return 'Always ' + preference + ', whatever your computer is set to.';
  }

  function start(doc) {
    var themes = global.LexTheme;
    var control = doc.getElementById('sv2-appearance-theme');
    var note = doc.getElementById('sv2-appearance-note');
    if (!control) return null;
    var section = doc.getElementById('sv2-section-appearance');
    if (!themes) {
      if (section) section.hidden = true;
      return null;
    }

    control.options = CHOICES;
    function show() {
      if (control.value !== themes.preference()) control.value = themes.preference();
      if (note) note.textContent = noteFor(themes.preference(), themes.current());
    }
    show();
    control.addEventListener('lex-change', function (event) {
      var value = event.detail && event.detail.value;
      if (typeof value === 'string' && value !== themes.preference()) themes.setPreference(value);
    });
    return themes.subscribe(show);
  }

  global.LanaSettingsAppearance = { CHOICES: CHOICES, noteFor: noteFor, start: start };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', function () { start(global.document); });
    } else {
      start(global.document);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
