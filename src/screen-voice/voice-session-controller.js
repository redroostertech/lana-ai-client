'use strict';

const { EventEmitter } = require('events');

const STATES = Object.freeze([
  'idle', 'listening', 'transcribing', 'awaiting_command', 'gathering_context',
  'thinking', 'previewing', 'executing', 'speaking', 'canceled', 'error'
]);

const TRANSITIONS = Object.freeze({
  idle: new Set(['listening']),
  listening: new Set(['transcribing', 'canceled', 'error']),
  transcribing: new Set(['awaiting_command', 'gathering_context', 'executing', 'canceled', 'error']),
  awaiting_command: new Set(['gathering_context', 'canceled', 'error']),
  gathering_context: new Set(['thinking', 'canceled', 'error']),
  thinking: new Set(['previewing', 'executing', 'speaking', 'idle', 'canceled', 'error']),
  previewing: new Set(['executing', 'speaking', 'idle', 'canceled', 'error']),
  executing: new Set(['speaking', 'idle', 'canceled', 'error']),
  speaking: new Set(['idle', 'canceled', 'error']),
  canceled: new Set(['idle', 'listening']),
  error: new Set(['idle', 'listening', 'canceled'])
});

class VoiceSessionController extends EventEmitter {
  constructor(options = {}) {
    super();
    this.clock = options.clock || (() => Date.now());
    this.state = 'idle';
    this.session = null;
    this.abortController = null;
    this.executedTokens = new Map();
    this.idempotencyTtlMs = options.idempotencyTtlMs || 10 * 60 * 1000;
  }

  start(mode, source = 'shortcut') {
    if (!['dictation', 'agent'].includes(mode)) throw new Error('Unsupported voice mode');
    if (!['idle', 'canceled', 'error'].includes(this.state)) {
      const error = new Error('A voice session is already active');
      error.code = 'SESSION_OVERLAP';
      throw error;
    }
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.session = {
      id: `sv-${this.clock().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      mode,
      source,
      startedAt: this.clock(),
      transcript: '',
      target: null,
      decision: null,
      error: null
    };
    this.transition('listening');
    return this.snapshot();
  }

  transition(next, patch = {}) {
    if (!STATES.includes(next)) throw new Error(`Unknown voice state: ${next}`);
    if (next !== this.state && !TRANSITIONS[this.state]?.has(next)) {
      const error = new Error(`Invalid voice transition: ${this.state} -> ${next}`);
      error.code = 'INVALID_STATE_TRANSITION';
      throw error;
    }
    this.state = next;
    if (this.session) Object.assign(this.session, patch);
    this.emit('state', this.snapshot());
    return this.snapshot();
  }

  cancel(reason = 'user_canceled') {
    if (this.state === 'idle') return this.snapshot();
    this.abortController?.abort(reason);
    this.transition('canceled', { canceledReason: reason });
    return this.snapshot();
  }

  fail(code, userMessage) {
    this.abortController?.abort(code);
    this.transition('error', { error: { code, message: userMessage } });
    return this.snapshot();
  }

  reset() {
    this.abortController?.abort('reset');
    if (this.state !== 'idle') this.transition('idle');
    this.session = null;
    this.abortController = null;
    this.emit('state', this.snapshot());
  }

  claimExecution(token) {
    if (!token || typeof token !== 'string') throw new Error('Execution token is required');
    this.pruneExecutionTokens();
    if (this.executedTokens.has(token)) return false;
    this.executedTokens.set(token, this.clock());
    return true;
  }

  pruneExecutionTokens() {
    const cutoff = this.clock() - this.idempotencyTtlMs;
    for (const [token, at] of this.executedTokens) {
      if (at < cutoff) this.executedTokens.delete(token);
    }
  }

  get signal() {
    return this.abortController?.signal || null;
  }

  snapshot() {
    return {
      state: this.state,
      session: this.session ? { ...this.session } : null
    };
  }
}

module.exports = { STATES, TRANSITIONS, VoiceSessionController };
