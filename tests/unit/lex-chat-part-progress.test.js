'use strict';

// A verification reading a long document in parts (LANA-AI d0ea5957e,
// chat-turn.driver.js) announces deadline_ms on its first progress event and
// then says "Checking part k of n of <file>". The turn's 15 s heartbeat only
// carries the stage label; it must not replace the part line.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const progressEvents = require('../../src/js/lex/chat/lex-chat-progress-events');

const ROOT = path.resolve(__dirname, '../../src/js/lex/chat');

function run(context, file) {
  const filename = path.join(ROOT, file);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}

function loadSource() {
  const context = { console, TextDecoder, AbortController, Intl, setTimeout, clearTimeout, Lex: {} };
  context.window = context;
  context.globalThis = context;
  run(context, 'lex-chat.conversations-api.js');
  run(context, 'lex-chat.source.js');
  return new context.Lex.Chat.SSEChatSource({});
}

function loadChat() {
  class LexElement {
    constructor() { this._props = {}; }
    emit() {}
    addEventListener() {}
  }
  const context = {
    console,
    setTimeout,
    clearTimeout,
    document: { head: { appendChild() {} }, createElement: () => ({ textContent: '' }), querySelector() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    Lex: { LexElement, Chat: {}, Utils: { millisecondsSince: () => 10 } }
  };
  context.window = context;
  context.globalThis = context;
  run(context, 'lex-chat-progress-events.js');
  run(context, 'lex-chat.js');
  const chat = new context.Lex.Chat.LexChat();
  const shown = [];
  chat._activityEl = {
    update(message) { shown.push(message); },
    addReasoningEntry() {}
  };
  chat._partReadAnnounced = false;
  return { chat, shown };
}

const announce = {
  type: 'progress', category: 'chat', message: 'Checking supply.pdf in full, 7 parts',
  status: 'in_progress', heartbeat: false, deadlineMs: 900000
};
const part = { type: 'progress', category: 'chat', message: 'Checking part 3 of 7 of supply.pdf', status: 'in_progress', heartbeat: false, deadlineMs: null };
const heartbeat = { type: 'progress', category: 'chat', message: 'Reading the documents', status: 'in_progress', heartbeat: true, deadlineMs: null };
const statusHeartbeat = { type: 'thinking', message: 'Reading the documents', phase: 'Thinking', heartbeat: true };

describe('verification part progress', () => {
  test('the SSE source carries deadline_ms and the status heartbeat flag', () => {
    const source = loadSource();
    expect(source._mapEvent('progress', { message: 'Checking supply.pdf in full, 7 parts', deadline_ms: 900000 }).deadlineMs).toBe(900000);
    expect(source._mapEvent('status', { message: 'Reading the documents', phase: 'thinking', heartbeat: true }).heartbeat).toBe(true);
  });

  test('control: a progress event without deadline_ms has none, a plain status is no heartbeat', () => {
    const source = loadSource();
    expect(source._mapEvent('progress', { message: 'Reading the documents' }).deadlineMs).toBeNull();
    expect(source._mapEvent('progress', { message: 'Reading the documents' }).remainingMs).toBeNull();
    expect(source._mapEvent('status', { message: 'Reading the documents', phase: 'thinking' }).remainingMs).toBeNull();
    expect(source._mapEvent('status', { message: 'Reading the documents', phase: 'thinking' }).heartbeat).toBe(false);
  });

  test('once a part read is announced, heartbeats keep the part line', () => {
    expect(progressEvents.announcesPartRead(announce)).toBe(true);
    expect(progressEvents.keepsActivityText(heartbeat, true)).toBe(true);

    const { chat, shown } = loadChat();
    [announce, part, heartbeat, statusHeartbeat].forEach((event) => chat._handleEvent(event, false));
    expect(shown).toEqual(['Checking supply.pdf in full, 7 parts', 'Checking part 3 of 7 of supply.pdf']);
  });

  test('remaining_ms on a runtime status or progress frame announces the part read too (LANA-AI 97a72dc8f)', () => {
    const source = loadSource();
    const status = source._mapEvent('status', { message: 'Checking supply.pdf in full, 7 parts', phase: 'reading', remaining_ms: 840000 });
    const progress = source._mapEvent('progress', { message: 'Checking supply.pdf in full, 7 parts', remaining_ms: 840000 });
    expect(status.remainingMs).toBe(840000);
    expect(progress.remainingMs).toBe(840000);
    expect(progressEvents.announcesPartRead(status)).toBe(true);
    expect(progressEvents.announcesPartRead(progress)).toBe(true);

    const { chat, shown } = loadChat();
    const partStatus = { type: 'thinking', message: 'Checking part 3 of 7 of supply.pdf', phase: 'Reading', heartbeat: false, remainingMs: null };
    [status, partStatus, statusHeartbeat, heartbeat].forEach((event) => chat._handleEvent(event, false));
    expect(shown).toEqual(['Checking supply.pdf in full, 7 parts', 'Checking part 3 of 7 of supply.pdf']);
  });

  test('control: without an announced part read, heartbeats update the activity as before', () => {
    expect(progressEvents.announcesPartRead(part)).toBe(false);
    expect(progressEvents.keepsActivityText(heartbeat, false)).toBe(false);
    expect(progressEvents.keepsActivityText(part, true)).toBe(false);

    const { chat, shown } = loadChat();
    [part, heartbeat, statusHeartbeat].forEach((event) => chat._handleEvent(event, false));
    expect(shown).toEqual(['Checking part 3 of 7 of supply.pdf', 'Reading the documents', 'Reading the documents']);
  });
});
