/* ==========================================================================
   Lex Chat Composer — @-mention helpers
   Pure-JS, dependency-free helpers used by lex-chat.composer.js to power
   the @-autocomplete typeahead. Kept separate so they are unit-testable
   without spinning up the Lex / DOM layer.

   Exports (browser):
     window.Lex.Chat.MentionHelpers = { ... }

   Exports (Node / Jest):
     module.exports = { ... }
   ========================================================================== */

(function (root, factory) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Token parser
  //
  // Given a textarea value and a caret position, decide whether the caret is
  // currently inside an active `@`-mention being typed. If yes, return the
  // start index of the `@` and the prefix the user has typed so far so the
  // composer can render an autocomplete dropdown.
  //
  // Rules:
  //   - The `@` must be at position 0 OR immediately after whitespace
  //     (space, tab, newline). This avoids triggering inside email
  //     addresses (`alice@example.com` — the `@` is not after whitespace).
  //   - The token under the caret extends from the `@` up to (but not
  //     including) the caret. It may NOT contain whitespace (a space ends
  //     the mention).
  //   - Token characters are letters, digits, `-`, `_`, `.`. Anything else
  //     ends the active token.
  // ---------------------------------------------------------------------------

  function detectMentionTrigger(value, caret) {
    if (typeof value !== 'string') return null;
    if (typeof caret !== 'number' || caret < 0 || caret > value.length) return null;

    // Walk backwards from caret to find an `@` that begins a token. Stop
    // at any whitespace or token-invalid character.
    let i = caret;
    while (i > 0) {
      const ch = value[i - 1];
      if (ch === '@') {
        // The character BEFORE the `@` must be start-of-input or whitespace.
        if (i - 1 === 0 || /\s/.test(value[i - 2])) {
          return {
            atIndex: i - 1,
            prefix: value.substring(i, caret),
          };
        }
        return null;
      }
      // Allow letters, digits, `-`, `_`, `.` inside the token.
      if (!/[A-Za-z0-9_.\-]/.test(ch)) {
        return null;
      }
      i -= 1;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Token rendering helpers
  // ---------------------------------------------------------------------------

  /**
   * Compose the inline token for a selected mention match.
   *  - users   : `@<username>` (slug-friendly)
   *  - agents  : `@<slug>`
   *  - contacts: `@<slugified label>` (display name slugified to a
   *              whitespace-free token; contacts have no canonical handle).
   *
   * All are prefixed with `@` so the chat backend can later parse the
   * message body and resolve mentions with the same regex.
   */
  function buildMentionToken(match) {
    if (!match || typeof match !== 'object') return '';
    if (match.kind === 'agent') {
      const slug = match.slug || match.label || '';
      return slug ? `@${slug}` : '';
    }
    if (match.kind === 'contact') {
      // Contacts don't have usernames. Slugify the display label so the
      // inserted token is a single @-word and parses cleanly server-side.
      const raw = (match.label
        || (match.email ? String(match.email).split('@')[0] : '')
        || '').trim();
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return slug ? `@${slug}` : '';
    }
    // user
    const handle = match.username
      || (match.email ? String(match.email).split('@')[0] : null)
      || match.label
      || '';
    return handle ? `@${handle}` : '';
  }

  /**
   * Replace the active @-token in `value` (starting at `atIndex`, ending at
   * `caret`) with the rendered mention token + trailing space. Returns the
   * new value and the new caret position so the composer can re-set both.
   */
  function applyMentionToValue(value, atIndex, caret, match) {
    const token = buildMentionToken(match);
    if (!token) return { value, caret };
    const before = value.substring(0, atIndex);
    const after = value.substring(caret);
    const insertion = `${token} `;
    return {
      value: before + insertion + after,
      caret: before.length + insertion.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Dropdown state machine
  //
  // Tiny, deterministic, side-effect-free reducer. The composer wraps it
  // with DOM updates. Test cases drive transitions purely through
  // dispatch() and assert on the returned state.
  //
  // States:
  //   - closed                          (no dropdown)
  //   - open / pending                  (waiting for results, debounced)
  //   - open / results=[]               (no matches → "No matches" hint)
  //   - open / results=[…]              (typeahead)
  //
  // Keyboard navigation lives in the reducer too: the active row index is
  // bounded to [0, results.length-1] and wraps with ArrowUp from row 0.
  // ---------------------------------------------------------------------------

  function initialState() {
    return {
      open: false,
      atIndex: -1,
      prefix: '',
      results: [],
      // Optional sectioned shape from the API. When present, the renderer
      // groups items under labeled headers; keyboard nav still walks the
      // flat `results` array so the active index remains a single number.
      groups: [],
      activeIndex: 0,
      // 'idle' | 'pending' | 'ready'
      status: 'idle',
    };
  }

  function reduce(state, action) {
    if (!state) state = initialState();
    if (!action || !action.type) return state;

    switch (action.type) {
      case 'TRIGGER_OPENED': {
        return Object.assign({}, initialState(), {
          open: true,
          atIndex: typeof action.atIndex === 'number' ? action.atIndex : -1,
          prefix: typeof action.prefix === 'string' ? action.prefix : '',
          status: 'pending',
        });
      }
      case 'PREFIX_CHANGED': {
        if (!state.open) return state;
        return Object.assign({}, state, {
          prefix: typeof action.prefix === 'string' ? action.prefix : '',
          status: 'pending',
        });
      }
      case 'RESULTS_RECEIVED': {
        if (!state.open) return state;
        // Only accept results for the prefix the user is currently typing —
        // a stale debounced response should be dropped.
        if (action.prefix !== undefined && action.prefix !== state.prefix) {
          return state;
        }
        const results = Array.isArray(action.results) ? action.results : [];
        const groups = Array.isArray(action.groups) ? action.groups : [];
        return Object.assign({}, state, {
          results,
          groups,
          status: 'ready',
          activeIndex: results.length > 0 ? Math.min(state.activeIndex, results.length - 1) : 0,
        });
      }
      case 'MOVE_DOWN': {
        if (!state.open || state.results.length === 0) return state;
        const next = (state.activeIndex + 1) % state.results.length;
        return Object.assign({}, state, { activeIndex: next });
      }
      case 'MOVE_UP': {
        if (!state.open || state.results.length === 0) return state;
        const next = (state.activeIndex - 1 + state.results.length) % state.results.length;
        return Object.assign({}, state, { activeIndex: next });
      }
      case 'SET_ACTIVE_INDEX': {
        if (!state.open) return state;
        const idx = typeof action.index === 'number' ? action.index : 0;
        if (state.results.length === 0) return state;
        const clamped = Math.max(0, Math.min(state.results.length - 1, idx));
        return Object.assign({}, state, { activeIndex: clamped });
      }
      case 'CLOSED':
      case 'DISMISSED':
        return initialState();
      default:
        return state;
    }
  }

  // ---------------------------------------------------------------------------
  // Debounce — used for the search side
  // ---------------------------------------------------------------------------

  function debounce(fn, wait) {
    let timer = null;
    function debounced() {
      const ctx = this;
      const args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(ctx, args);
      }, wait);
    }
    debounced.cancel = function () {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return debounced;
  }

  const api = {
    detectMentionTrigger: detectMentionTrigger,
    buildMentionToken: buildMentionToken,
    applyMentionToValue: applyMentionToValue,
    initialState: initialState,
    reduce: reduce,
    debounce: debounce,
  };

  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = api;
  } else {
    root.Lex = root.Lex || {};
    root.Lex.Chat = root.Lex.Chat || {};
    root.Lex.Chat.MentionHelpers = api;
  }

  // factory hook is unused but kept for AMD-style linkage if ever needed
  if (typeof factory === 'function') factory(api);
})(typeof window !== 'undefined' ? window : globalThis);
