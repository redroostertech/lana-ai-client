/**
 * Unit tests — src/js/lex/chat/lex-chat.composer-mentions.js
 *
 * Pure-JS coverage of:
 *   - detectMentionTrigger     (token parser)
 *   - buildMentionToken        (per-kind token rendering)
 *   - applyMentionToValue      (textarea value patch)
 *   - reduce                   (dropdown state machine)
 *   - debounce                 (timing helper)
 */

'use strict';

const helpers = require('../../src/js/lex/chat/lex-chat.composer-mentions');

// ---------------------------------------------------------------------------
// detectMentionTrigger
// ---------------------------------------------------------------------------

describe('detectMentionTrigger', () => {
  test('returns null when caret is not inside an active @-token', () => {
    expect(helpers.detectMentionTrigger('hello world', 5)).toBeNull();
    expect(helpers.detectMentionTrigger('', 0)).toBeNull();
  });

  test('detects @ at the start of input', () => {
    const res = helpers.detectMentionTrigger('@al', 3);
    expect(res).toEqual({ atIndex: 0, prefix: 'al' });
  });

  test('detects @ after whitespace', () => {
    const res = helpers.detectMentionTrigger('hi @bo', 6);
    expect(res).toEqual({ atIndex: 3, prefix: 'bo' });
  });

  test('returns the empty prefix immediately after typing @', () => {
    const res = helpers.detectMentionTrigger('hi @', 4);
    expect(res).toEqual({ atIndex: 3, prefix: '' });
  });

  test('does NOT trigger on @ inside an email address', () => {
    expect(helpers.detectMentionTrigger('email alice@example.com', 23)).toBeNull();
  });

  test('does NOT trigger on @ adjacent to other text (e.g. "x@y")', () => {
    expect(helpers.detectMentionTrigger('x@y', 3)).toBeNull();
  });

  test('whitespace inside the token closes the trigger', () => {
    expect(helpers.detectMentionTrigger('@bob smith', 10)).toBeNull();
  });

  test('newline before @ counts as whitespace', () => {
    const res = helpers.detectMentionTrigger('first line\n@al', 14);
    expect(res).toEqual({ atIndex: 11, prefix: 'al' });
  });

  test('rejects bad inputs without throwing', () => {
    expect(helpers.detectMentionTrigger(null, 0)).toBeNull();
    expect(helpers.detectMentionTrigger('hi', -1)).toBeNull();
    expect(helpers.detectMentionTrigger('hi', 999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildMentionToken
// ---------------------------------------------------------------------------

describe('buildMentionToken', () => {
  test('builds @<username> for users', () => {
    expect(helpers.buildMentionToken({ kind: 'user', username: 'alice' })).toBe('@alice');
  });

  test('falls back to email local-part when username is missing', () => {
    expect(helpers.buildMentionToken({ kind: 'user', email: 'bob@example.com' })).toBe('@bob');
  });

  test('builds @<slug> for agents', () => {
    expect(helpers.buildMentionToken({ kind: 'agent', slug: 'matter-architect' })).toBe('@matter-architect');
  });

  test('returns "" for empty / malformed input', () => {
    expect(helpers.buildMentionToken(null)).toBe('');
    expect(helpers.buildMentionToken({})).toBe('');
  });
});

// ---------------------------------------------------------------------------
// applyMentionToValue
// ---------------------------------------------------------------------------

describe('applyMentionToValue', () => {
  test('replaces the active @-token with `@token ` and advances caret', () => {
    // value: "hi @al" — caret at end (6). atIndex of @ is 3.
    const result = helpers.applyMentionToValue('hi @al', 3, 6, { kind: 'user', username: 'alice' });
    expect(result.value).toBe('hi @alice ');
    expect(result.caret).toBe('hi @alice '.length);
  });

  test('inserts in the middle of existing text and preserves trailing chars', () => {
    const value = 'hi @bo there';
    const atIndex = 3;
    const caret = 6; // end of "@bo"
    const result = helpers.applyMentionToValue(value, atIndex, caret, { kind: 'user', username: 'bob' });
    expect(result.value).toBe('hi @bob  there');
    // Caret sits right after the inserted "@bob " (with trailing space)
    expect(result.caret).toBe('hi @bob '.length);
  });

  test('returns input unchanged when match has no usable token', () => {
    const out = helpers.applyMentionToValue('hi @x', 3, 5, {});
    expect(out.value).toBe('hi @x');
    expect(out.caret).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// reduce — dropdown state machine
// ---------------------------------------------------------------------------

describe('reduce', () => {
  test('initialState is closed', () => {
    const s = helpers.initialState();
    expect(s.open).toBe(false);
    expect(s.results).toEqual([]);
    expect(s.activeIndex).toBe(0);
    expect(s.status).toBe('idle');
  });

  test('TRIGGER_OPENED → open + pending', () => {
    const s = helpers.reduce(undefined, { type: 'TRIGGER_OPENED', atIndex: 3, prefix: 'al' });
    expect(s.open).toBe(true);
    expect(s.atIndex).toBe(3);
    expect(s.prefix).toBe('al');
    expect(s.status).toBe('pending');
  });

  test('PREFIX_CHANGED returns to pending, preserves open', () => {
    let s = helpers.reduce(undefined, { type: 'TRIGGER_OPENED', atIndex: 3, prefix: 'a' });
    s = helpers.reduce(s, { type: 'RESULTS_RECEIVED', prefix: 'a', results: [{ id: '1' }] });
    s = helpers.reduce(s, { type: 'PREFIX_CHANGED', prefix: 'al' });
    expect(s.open).toBe(true);
    expect(s.prefix).toBe('al');
    expect(s.status).toBe('pending');
  });

  test('RESULTS_RECEIVED with stale prefix is dropped', () => {
    let s = helpers.reduce(undefined, { type: 'TRIGGER_OPENED', atIndex: 0, prefix: 'al' });
    s = helpers.reduce(s, { type: 'RESULTS_RECEIVED', prefix: 'a', results: [{ id: 'stale' }] });
    expect(s.results).toEqual([]); // stale dropped
    expect(s.status).toBe('pending');
  });

  test('RESULTS_RECEIVED with fresh prefix populates results + status=ready', () => {
    let s = helpers.reduce(undefined, { type: 'TRIGGER_OPENED', atIndex: 0, prefix: 'al' });
    s = helpers.reduce(s, { type: 'RESULTS_RECEIVED', prefix: 'al', results: [{ id: '1' }, { id: '2' }] });
    expect(s.results).toHaveLength(2);
    expect(s.status).toBe('ready');
    expect(s.activeIndex).toBe(0);
  });

  test('RESULTS_RECEIVED uses grouped result order for selection indexes', () => {
    let s = helpers.reduce(undefined, { type: 'TRIGGER_OPENED', atIndex: 0, prefix: '' });
    s = helpers.reduce(s, {
      type: 'RESULTS_RECEIVED',
      prefix: '',
      // Deliberately different from the grouped render order. The reducer
      // should normalize to the grouped order because the DOM rows are
      // rendered from groups when groups are present.
      results: [
        { id: 'michael', label: 'Michael Westbrooks' },
        { id: 'ron', label: 'Ron VanPelt' },
        { id: 'iziah', label: 'Iziah Reid' },
        { id: 'joe', label: 'Joe Calderon' }
      ],
      groups: [
        {
          label: 'Shared With This Matter',
          matches: [
            { id: 'michael', label: 'Michael Westbrooks' },
            { id: 'ron', label: 'Ron VanPelt' }
          ]
        },
        {
          label: 'Users In Your Organization',
          matches: [
            { id: 'iziah', label: 'Iziah Reid' },
            { id: 'joe', label: 'Joe Calderon' }
          ]
        }
      ]
    });

    expect(s.results.map((item) => item.id)).toEqual(['michael', 'ron', 'iziah', 'joe']);
    expect(s.results[3].label).toBe('Joe Calderon');
  });

  test('flattenMentionGroups ignores malformed groups', () => {
    expect(helpers.flattenMentionGroups([
      null,
      { label: 'Empty' },
      { label: 'Users', matches: [{ id: 'u1' }, null, { id: 'u2' }] }
    ])).toEqual([{ id: 'u1' }, { id: 'u2' }]);
  });

  test('MOVE_DOWN cycles activeIndex', () => {
    let s = helpers.reduce(undefined, { type: 'TRIGGER_OPENED', atIndex: 0, prefix: '' });
    s = helpers.reduce(s, {
      type: 'RESULTS_RECEIVED',
      prefix: '',
      results: [{ id: '1' }, { id: '2' }, { id: '3' }],
    });
    s = helpers.reduce(s, { type: 'MOVE_DOWN' });
    expect(s.activeIndex).toBe(1);
    s = helpers.reduce(s, { type: 'MOVE_DOWN' });
    expect(s.activeIndex).toBe(2);
    s = helpers.reduce(s, { type: 'MOVE_DOWN' });
    expect(s.activeIndex).toBe(0); // wraps
  });

  test('MOVE_UP from index 0 wraps to last', () => {
    let s = helpers.reduce(undefined, { type: 'TRIGGER_OPENED', atIndex: 0, prefix: '' });
    s = helpers.reduce(s, { type: 'RESULTS_RECEIVED', prefix: '', results: [{ id: '1' }, { id: '2' }] });
    s = helpers.reduce(s, { type: 'MOVE_UP' });
    expect(s.activeIndex).toBe(1);
  });

  test('MOVE_DOWN with no results is a no-op', () => {
    let s = helpers.reduce(undefined, { type: 'TRIGGER_OPENED', atIndex: 0, prefix: '' });
    s = helpers.reduce(s, { type: 'RESULTS_RECEIVED', prefix: '', results: [] });
    s = helpers.reduce(s, { type: 'MOVE_DOWN' });
    expect(s.activeIndex).toBe(0);
  });

  test('CLOSED / DISMISSED returns to initialState', () => {
    let s = helpers.reduce(undefined, { type: 'TRIGGER_OPENED', atIndex: 3, prefix: 'a' });
    s = helpers.reduce(s, { type: 'CLOSED' });
    expect(s).toEqual(helpers.initialState());
  });

  test('SET_ACTIVE_INDEX clamps', () => {
    let s = helpers.reduce(undefined, { type: 'TRIGGER_OPENED', atIndex: 0, prefix: '' });
    s = helpers.reduce(s, { type: 'RESULTS_RECEIVED', prefix: '', results: [{ id: '1' }, { id: '2' }] });
    s = helpers.reduce(s, { type: 'SET_ACTIVE_INDEX', index: 99 });
    expect(s.activeIndex).toBe(1);
    s = helpers.reduce(s, { type: 'SET_ACTIVE_INDEX', index: -3 });
    expect(s.activeIndex).toBe(0);
  });

  test('unknown actions are no-ops', () => {
    const s0 = helpers.initialState();
    const s1 = helpers.reduce(s0, { type: 'NOPE' });
    expect(s1).toEqual(s0);
  });
});

// ---------------------------------------------------------------------------
// debounce
// ---------------------------------------------------------------------------

describe('debounce', () => {
  jest.useFakeTimers();
  afterAll(() => jest.useRealTimers());

  test('only the last call within the window fires', () => {
    const fn = jest.fn();
    const d = helpers.debounce(fn, 200);
    d('a'); d('b'); d('c');
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  test('cancel() prevents the pending call', () => {
    const fn = jest.fn();
    const d = helpers.debounce(fn, 200);
    d('a');
    d.cancel();
    jest.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
