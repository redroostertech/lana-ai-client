/**
 * Unit tests for rename-conversation.js
 *
 * Covers:
 *   - validateTitle() input handling
 *   - renameConversation() canonical API helper, payload, event dispatch
 *   - error paths (missing api, missing threadId, invalid title, API failure)
 */

'use strict';

const path = require('path');

// Resolve from project root (Jest's cwd is the lana-ai-client package).
const MODULE_PATH = path.resolve(__dirname, '../../src/js/utils/rename-conversation.js');

describe('rename-conversation helper', () => {
  let mod;

  beforeEach(() => {
    // Fresh require per test to keep module state isolated. The module is
    // wrapped in an IIFE and exposes CommonJS exports for tests.
    jest.resetModules();
    mod = require(MODULE_PATH);
  });

  describe('validateTitle', () => {
    test('rejects null / undefined / empty', () => {
      expect(mod.validateTitle(null).valid).toBe(false);
      expect(mod.validateTitle(undefined).valid).toBe(false);
      expect(mod.validateTitle('').valid).toBe(false);
      expect(mod.validateTitle('   ').valid).toBe(false);
    });

    test('trims surrounding whitespace', () => {
      const r = mod.validateTitle('  Hello World  ');
      expect(r.valid).toBe(true);
      expect(r.value).toBe('Hello World');
    });

    test('rejects titles longer than 200 chars', () => {
      const long = 'x'.repeat(201);
      const r = mod.validateTitle(long);
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/too long/i);
    });

    test('accepts exactly 200 chars', () => {
      const ok = 'x'.repeat(200);
      const r = mod.validateTitle(ok);
      expect(r.valid).toBe(true);
      expect(r.value.length).toBe(200);
    });

    test('coerces non-string input', () => {
      // Numbers shouldn't normally be passed but the helper should be defensive.
      const r = mod.validateTitle(42);
      expect(r.valid).toBe(true);
      expect(r.value).toBe('42');
    });
  });

  describe('renameConversation', () => {
    function makeApi(impl) {
      return { updateConversation: jest.fn(impl || (() => Promise.resolve({}))) };
    }

    function makeTarget() {
      // Minimal EventTarget for assertions
      const listeners = {};
      return {
        listeners,
        addEventListener(name, h) { (listeners[name] = listeners[name] || []).push(h); },
        removeEventListener(name, h) {
          const arr = listeners[name] || [];
          const i = arr.indexOf(h);
          if (i >= 0) arr.splice(i, 1);
        },
        dispatchEvent(ev) {
          (listeners[ev.type] || []).forEach((h) => h(ev));
          return true;
        }
      };
    }

    test('calls canonical updateConversation with trimmed title', async () => {
      const api = makeApi();
      const target = makeTarget();
      await mod.renameConversation({
        api,
        threadId: 'abc-123',
        title: '  My New Title  ',
        eventTarget: target
      });
      expect(api.updateConversation).toHaveBeenCalledTimes(1);
      expect(api.updateConversation).toHaveBeenCalledWith('abc-123', { title: 'My New Title' });
    });

    test('passes raw threadId to the canonical API helper', async () => {
      const api = makeApi();
      const target = makeTarget();
      await mod.renameConversation({
        api,
        threadId: 'a/b c',
        title: 'X',
        eventTarget: target
      });
      expect(api.updateConversation.mock.calls[0][0]).toBe('a/b c');
    });

    test('dispatches conversation:renamed event with threadId + title', async () => {
      const api = makeApi();
      const target = makeTarget();
      const seen = [];
      target.addEventListener('conversation:renamed', (e) => seen.push(e.detail));

      await mod.renameConversation({
        api,
        threadId: 't1',
        title: 'New Name',
        eventTarget: target
      });

      expect(seen).toHaveLength(1);
      // Kept exact rather than loosened to objectContaining: the event is a
      // public contract and an accidental extra field should still fail here.
      // registryId is deliberate — dock RECENTS listens on the
      // conversation_threads row id, which is not always the stream thread_id,
      // and falls back to threadId when the caller does not distinguish them.
      expect(seen[0]).toEqual({ threadId: 't1', title: 'New Name', registryId: 't1' });
    });

    test('returns the canonical {threadId, title} after success', async () => {
      const api = makeApi();
      const target = makeTarget();
      const out = await mod.renameConversation({
        api,
        threadId: 't2',
        title: ' Renamed ',
        eventTarget: target
      });
      expect(out).toEqual({ threadId: 't2', title: 'Renamed' });
    });

    test('throws INVALID_TITLE before calling the API on empty input', async () => {
      const api = makeApi();
      const target = makeTarget();
      await expect(mod.renameConversation({
        api,
        threadId: 't3',
        title: '   ',
        eventTarget: target
      })).rejects.toMatchObject({ code: 'INVALID_TITLE' });
      expect(api.updateConversation).not.toHaveBeenCalled();
    });

    test('throws if api is missing or has no .updateConversation()', async () => {
      const target = makeTarget();
      await expect(mod.renameConversation({
        threadId: 't', title: 'X', eventTarget: target
      })).rejects.toThrow(/api\.updateConversation is required/);

      await expect(mod.renameConversation({
        api: {}, threadId: 't', title: 'X', eventTarget: target
      })).rejects.toThrow(/api\.updateConversation is required/);
    });

    test('throws if threadId is missing', async () => {
      const api = makeApi();
      const target = makeTarget();
      await expect(mod.renameConversation({
        api, title: 'X', eventTarget: target
      })).rejects.toThrow(/threadId is required/);
      expect(api.updateConversation).not.toHaveBeenCalled();
    });

    test('propagates API errors and does NOT emit the event', async () => {
      const api = makeApi(() => Promise.reject(new Error('500 Server Error')));
      const target = makeTarget();
      const seen = [];
      target.addEventListener('conversation:renamed', (e) => seen.push(e.detail));

      await expect(mod.renameConversation({
        api, threadId: 't4', title: 'New', eventTarget: target
      })).rejects.toThrow('500 Server Error');
      expect(seen).toHaveLength(0);
    });
  });

  describe('module exports', () => {
    test('exposes the canonical EVENT_NAME constant', () => {
      expect(mod.EVENT_NAME).toBe('conversation:renamed');
    });
  });
});
