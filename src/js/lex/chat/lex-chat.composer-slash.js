/* ==========================================================================
   Lex Chat Composer — /slash-command helpers
   Pure-JS, dependency-free helpers used by lex-chat.composer.js to power
   the /command autocomplete typeahead. Kept separate so they are
   unit-testable without spinning up the Lex / DOM layer (same pattern as
   lex-chat.composer-mentions.js).

   The command registry itself lives in js/services/slash-commands.service.js
   (window.SlashCommandsService). These helpers only handle trigger
   detection, token replacement, and dropdown state.

   Exports (browser):
     window.Lex.Chat.SlashHelpers = { ... }

   Exports (Node / Jest):
     module.exports = { ... }
   ========================================================================== */

(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Trigger detection
  //
  // Unlike @-mentions (valid after any whitespace), a slash command is only
  // valid as the very first thing in the message: the `/` must be at index 0.
  // Anything else — `re-read /etc/hosts`, `due 06/12` — is ordinary text.
  //
  // The active token runs from the `/` up to (but not including) the caret
  // and may only contain command-name characters (letters, digits, `-`).
  // A space ends the token: once the user is typing arguments the dropdown
  // stays closed.
  // ---------------------------------------------------------------------------

  function detectSlashTrigger(value, caret) {
    if (typeof value !== 'string') return null;
    if (typeof caret !== 'number' || caret < 1 || caret > value.length) return null;
    if (value[0] !== '/') return null;
    for (let i = 1; i < caret; i++) {
      if (!/[A-Za-z0-9\-]/.test(value[i])) return null;
    }
    return { prefix: value.substring(0, caret) };
  }

  /**
   * Replace the active /token in `value` (index 0 up to `caret`) with the
   * chosen command + trailing space. Returns the new value and caret so the
   * composer can re-set both.
   */
  function applyCommandToValue(value, caret, command) {
    if (!command) return { value: value, caret: caret };
    const after = value.substring(caret);
    const insertion = command + ' ';
    return {
      value: insertion + after,
      caret: insertion.length,
    };
  }

  /**
   * True when the message's first whitespace-delimited token exactly matches
   * a registered command name. Used at send time to decide whether the
   * message should be intercepted locally instead of hitting the backend —
   * unmatched leading-slash text (`/etc/hosts is missing`) passes through
   * as a normal message.
   */
  function isExactCommand(content, commandNames) {
    if (typeof content !== 'string' || !Array.isArray(commandNames)) return false;
    const first = content.trim().split(/\s+/)[0];
    if (!first || first[0] !== '/') return false;
    return commandNames.indexOf(first.toLowerCase()) !== -1;
  }

  // ---------------------------------------------------------------------------
  // Dropdown state machine
  //
  // Simpler than the mention reducer: the command registry is local and
  // synchronous, so there is no pending/debounce state — OPENED and
  // PREFIX_CHANGED carry their filtered results directly.
  // ---------------------------------------------------------------------------

  function initialState() {
    return {
      open: false,
      prefix: '',
      results: [],
      activeIndex: 0,
    };
  }

  function reduce(state, action) {
    if (!state) state = initialState();
    if (!action || !action.type) return state;

    switch (action.type) {
      case 'OPENED': {
        return Object.assign({}, initialState(), {
          open: true,
          prefix: typeof action.prefix === 'string' ? action.prefix : '',
          results: Array.isArray(action.results) ? action.results : [],
        });
      }
      case 'PREFIX_CHANGED': {
        if (!state.open) return state;
        const results = Array.isArray(action.results) ? action.results : [];
        return Object.assign({}, state, {
          prefix: typeof action.prefix === 'string' ? action.prefix : '',
          results: results,
          activeIndex: results.length > 0 ? Math.min(state.activeIndex, results.length - 1) : 0,
        });
      }
      case 'MOVE_DOWN': {
        if (!state.open || state.results.length === 0) return state;
        return Object.assign({}, state, {
          activeIndex: (state.activeIndex + 1) % state.results.length,
        });
      }
      case 'MOVE_UP': {
        if (!state.open || state.results.length === 0) return state;
        return Object.assign({}, state, {
          activeIndex: (state.activeIndex - 1 + state.results.length) % state.results.length,
        });
      }
      case 'CLOSED':
      case 'DISMISSED':
        return initialState();
      default:
        return state;
    }
  }

  const api = {
    detectSlashTrigger: detectSlashTrigger,
    applyCommandToValue: applyCommandToValue,
    isExactCommand: isExactCommand,
    initialState: initialState,
    reduce: reduce,
  };

  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = api;
  } else {
    root.Lex = root.Lex || {};
    root.Lex.Chat = root.Lex.Chat || {};
    root.Lex.Chat.SlashHelpers = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
