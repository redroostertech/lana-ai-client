'use strict';

// What ActionBridge puts on the wire when a block answers back.
//
// A decision card sends exactly the label the user clicked (or the text they
// typed), with no "[DECISION]" marker. The label is what the user saw and what
// the backend classifies the reply against; a marker in the message text would
// end up in the user's own transcript as their words. The input and form
// handlers keep their bracketed shapes and are pinned here so that moving them
// later is a deliberate change, not a side effect.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BRIDGE_PATH = path.resolve(__dirname, '../../src/js/lex/lex.ai.bridge.js');

function loadBridge() {
  const track = jest.fn();
  const context = {
    console,
    document: {
      head: { appendChild() {} },
      createElement: () => ({ textContent: '', id: '' })
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    Lex: {
      ActivityContext: { track }
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(BRIDGE_PATH, 'utf8'), context, { filename: BRIDGE_PATH });
  return { ActionBridge: context.Lex.ActionBridge, track };
}

function attachedBridge() {
  const { ActionBridge, track } = loadBridge();
  const listeners = {};
  const chatEl = {
    send: jest.fn(),
    addEventListener: (type, handler) => { listeners[type] = handler; },
    removeEventListener: () => {}
  };
  const bridge = new ActionBridge();
  bridge.attach(chatEl);

  // A minimal .lex-block wrapper so _markResponded has something to mark.
  const blockClasses = new Set(['lex-block']);
  const target = {
    classList: {
      contains: (c) => blockClasses.has(c),
      add: (c) => blockClasses.add(c)
    },
    parentElement: null
  };

  const dispatch = (type, detail) => listeners[type]({ detail, target });
  return { chatEl, track, dispatch, blockClasses };
}

describe('Lex ActionBridge outgoing message shapes', () => {
  test.each([
    'Yes, Automatic Document Summarization',
    'No, not that one'
  ])('a decision click sends the bare label: %s', (label) => {
    const { chatEl, dispatch } = attachedBridge();

    dispatch('lex-decision', { value: label, label, custom: null });

    expect(chatEl.send).toHaveBeenCalledTimes(1);
    expect(chatEl.send).toHaveBeenCalledWith(label);
    expect(chatEl.send.mock.calls[0][0]).not.toMatch(/^\[/);
  });

  test('a custom decision reply sends the typed text', () => {
    const { chatEl, dispatch } = attachedBridge();
    const typed = 'run the billing summary instead';

    dispatch('lex-decision', { value: typed, label: null, custom: typed });

    expect(chatEl.send).toHaveBeenCalledTimes(1);
    expect(chatEl.send).toHaveBeenCalledWith(typed);
  });

  test('a decision still records interactionType decision with the detail, and marks the block responded', () => {
    const { chatEl, track, dispatch, blockClasses } = attachedBridge();
    const detail = { value: 'No, not that one', label: 'No, not that one', custom: null };

    dispatch('lex-decision', detail);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('block_interact', { interactionType: 'decision', detail });
    expect(blockClasses.has('lex-block-responded')).toBe(true);
    expect(chatEl.send).toHaveBeenCalledTimes(1);
  });

  test('a decision with neither value nor custom sends nothing and tracks nothing', () => {
    const { chatEl, track, dispatch } = attachedBridge();

    dispatch('lex-decision', { value: '', label: null, custom: '' });
    dispatch('lex-decision', undefined);

    expect(chatEl.send).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  // CONTROL: the other prefixed handlers are unchanged. These pins exist so a
  // later move of the input or form shape is a deliberate edit to this file.
  test('an input response still sends the [INPUT field] shape', () => {
    const { chatEl, track, dispatch } = attachedBridge();

    dispatch('lex-input-response', { field: 'matter_name', value: 'Acme v. Bolt' });
    dispatch('lex-input-response', { value: 'no field given' });

    expect(chatEl.send.mock.calls).toEqual([
      ['[INPUT matter_name] Acme v. Bolt'],
      ['[INPUT response] no field given']
    ]);
    expect(track.mock.calls.map((c) => c[1].interactionType)).toEqual(['input', 'input']);
  });

  test('a form submit still sends the [FORM] summary shape, skipping empty values', () => {
    const { chatEl, track, dispatch } = attachedBridge();

    dispatch('lex-form-submit', {
      values: { client: 'Acme', seats: 3, notes: '', owner: null, region: undefined }
    });

    expect(chatEl.send).toHaveBeenCalledTimes(1);
    expect(chatEl.send).toHaveBeenCalledWith('[FORM] client: Acme, seats: 3');
    expect(track).toHaveBeenCalledWith('block_interact', expect.objectContaining({ interactionType: 'form' }));
  });
});
