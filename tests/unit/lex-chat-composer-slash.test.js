/**
 * Unit tests — src/js/lex/chat/lex-chat.composer-slash.js
 *
 * Pure-JS coverage of:
 *   - detectSlashTrigger    (trigger parser — `/` only valid at position 0)
 *   - applyCommandToValue   (textarea value patch)
 *   - isExactCommand        (send-time interception predicate)
 *   - reduce                (dropdown state machine)
 *
 * Plus interception contract tests against SlashCommandsService's registry
 * (js/services/slash-commands.service.js).
 */

'use strict';

const helpers = require('../../src/js/lex/chat/lex-chat.composer-slash');

// ---------------------------------------------------------------------------
// detectSlashTrigger
// ---------------------------------------------------------------------------

describe('detectSlashTrigger', () => {
  test('detects / at the very start of input', () => {
    expect(helpers.detectSlashTrigger('/', 1)).toEqual({ prefix: '/' });
    expect(helpers.detectSlashTrigger('/he', 3)).toEqual({ prefix: '/he' });
  });

  test('prefix stops at the caret, not the end of the token', () => {
    expect(helpers.detectSlashTrigger('/help', 3)).toEqual({ prefix: '/he' });
  });

  test('does not trigger when / is not the first character', () => {
    expect(helpers.detectSlashTrigger('see /help', 9)).toBeNull();
    expect(helpers.detectSlashTrigger(' /help', 6)).toBeNull();
    expect(helpers.detectSlashTrigger('re-read /etc/hosts', 18)).toBeNull();
  });

  test('does not trigger once the command token has ended (typing args)', () => {
    expect(helpers.detectSlashTrigger('/summary Johnson', 16)).toBeNull();
    expect(helpers.detectSlashTrigger('/help ', 6)).toBeNull();
  });

  test('does not trigger on non-command characters in the token', () => {
    expect(helpers.detectSlashTrigger('/etc/hosts', 10)).toBeNull();
    expect(helpers.detectSlashTrigger('/06.12', 6)).toBeNull();
  });

  test('handles invalid input defensively', () => {
    expect(helpers.detectSlashTrigger(null, 1)).toBeNull();
    expect(helpers.detectSlashTrigger('/help', -1)).toBeNull();
    expect(helpers.detectSlashTrigger('/help', 99)).toBeNull();
    expect(helpers.detectSlashTrigger('', 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyCommandToValue
// ---------------------------------------------------------------------------

describe('applyCommandToValue', () => {
  test('replaces the partial token with the command + trailing space', () => {
    expect(helpers.applyCommandToValue('/he', 3, '/help'))
      .toEqual({ value: '/help ', caret: 6 });
  });

  test('preserves text after the caret', () => {
    expect(helpers.applyCommandToValue('/sum tail', 4, '/summary'))
      .toEqual({ value: '/summary  tail', caret: 9 });
  });

  test('returns input unchanged when command is empty', () => {
    expect(helpers.applyCommandToValue('/he', 3, ''))
      .toEqual({ value: '/he', caret: 3 });
  });
});

// ---------------------------------------------------------------------------
// isExactCommand
// ---------------------------------------------------------------------------

describe('isExactCommand', () => {
  const names = ['/help', '/summary', '/export'];

  test('matches a bare registered command', () => {
    expect(helpers.isExactCommand('/help', names)).toBe(true);
  });

  test('matches a registered command with arguments', () => {
    expect(helpers.isExactCommand('/summary Johnson v. Smith', names)).toBe(true);
  });

  test('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(helpers.isExactCommand('  /HELP  ', names)).toBe(true);
  });

  test('does not match unregistered leading-slash text', () => {
    expect(helpers.isExactCommand('/helpme', names)).toBe(false);
    expect(helpers.isExactCommand('/etc/hosts is missing', names)).toBe(false);
  });

  test('does not match slash mid-message or plain text', () => {
    expect(helpers.isExactCommand('run /help', names)).toBe(false);
    expect(helpers.isExactCommand('hello', names)).toBe(false);
  });

  test('handles invalid input defensively', () => {
    expect(helpers.isExactCommand(null, names)).toBe(false);
    expect(helpers.isExactCommand('/help', null)).toBe(false);
    expect(helpers.isExactCommand('', names)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reduce — dropdown state machine
// ---------------------------------------------------------------------------

describe('reduce', () => {
  const results = [
    { command: '/search', description: 'Search' },
    { command: '/staff', description: 'Staff' },
    { command: '/summary', description: 'Summary' },
  ];

  test('OPENED resets state and stores prefix + results', () => {
    const st = helpers.reduce(helpers.initialState(), {
      type: 'OPENED', prefix: '/s', results,
    });
    expect(st.open).toBe(true);
    expect(st.prefix).toBe('/s');
    expect(st.results).toHaveLength(3);
    expect(st.activeIndex).toBe(0);
  });

  test('PREFIX_CHANGED swaps results and clamps the active index', () => {
    let st = helpers.reduce(helpers.initialState(), { type: 'OPENED', prefix: '/s', results });
    st = helpers.reduce(st, { type: 'MOVE_DOWN' });
    st = helpers.reduce(st, { type: 'MOVE_DOWN' }); // activeIndex 2
    st = helpers.reduce(st, { type: 'PREFIX_CHANGED', prefix: '/st', results: results.slice(0, 2) });
    expect(st.results).toHaveLength(2);
    expect(st.activeIndex).toBe(1);
  });

  test('PREFIX_CHANGED is a no-op when closed', () => {
    const st = helpers.reduce(helpers.initialState(), {
      type: 'PREFIX_CHANGED', prefix: '/s', results,
    });
    expect(st.open).toBe(false);
  });

  test('MOVE_DOWN / MOVE_UP wrap around', () => {
    let st = helpers.reduce(helpers.initialState(), { type: 'OPENED', prefix: '/s', results });
    st = helpers.reduce(st, { type: 'MOVE_UP' });
    expect(st.activeIndex).toBe(2); // wrapped from 0
    st = helpers.reduce(st, { type: 'MOVE_DOWN' });
    expect(st.activeIndex).toBe(0); // wrapped back
  });

  test('CLOSED and DISMISSED return to the initial state', () => {
    const open = helpers.reduce(helpers.initialState(), { type: 'OPENED', prefix: '/s', results });
    expect(helpers.reduce(open, { type: 'CLOSED' })).toEqual(helpers.initialState());
    expect(helpers.reduce(open, { type: 'DISMISSED' })).toEqual(helpers.initialState());
  });

  test('unknown actions and missing state are handled', () => {
    const st = helpers.reduce(null, { type: 'NOPE' });
    expect(st.open).toBe(false);
    expect(helpers.reduce(st, null)).toBe(st);
  });
});

// ---------------------------------------------------------------------------
// Interception contract against the real registry
// ---------------------------------------------------------------------------

describe('SlashCommandsService integration', () => {
  let service;

  beforeAll(() => {
    // The service file assigns to window when present; in Node it only
    // declares consts, so evaluate it and pull the object out.
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/js/services/slash-commands.service.js'), 'utf8'
    );
    // eslint-disable-next-line no-new-func
    service = new Function(`${source}; return SlashCommandsService;`)();
  });

  test('every registered command is picked up by isExactCommand', () => {
    const names = Object.keys(service.commands);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(helpers.isExactCommand(`${name} some args`, names)).toBe(true);
    }
  });

  test('getMatchingCommands agrees with detectSlashTrigger prefixes', () => {
    const trigger = helpers.detectSlashTrigger('/s', 2);
    const matches = service.getMatchingCommands(trigger.prefix.toLowerCase());
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.command.startsWith('/s')).toBe(true);
      expect(typeof m.description).toBe('string');
    }
  });

  test('execute resolves a known command to a message', async () => {
    const result = await service.execute('/help');
    expect(result.success).toBe(true);
    expect(result.message).toContain('/summary');
  });

  test('backend-backed commands call the API instead of returning demo data', async () => {
    const api = {
      executeConversationSlashCommand: jest.fn().mockResolvedValue({
        result: {
          success: true,
          message: '**Real staff metrics**'
        }
      })
    };
    const result = await service.execute('/staff', {
      api,
      conversationId: 'conv-1'
    });

    expect(api.executeConversationSlashCommand).toHaveBeenCalledWith('conv-1', '/staff', '');
    expect(result.success).toBe(true);
    expect(result.message).toBe('**Real staff metrics**');
    expect(result.message).not.toContain('Sarah Martinez');
  });
});
