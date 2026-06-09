/**
 * electron-mcp-client.js
 *
 * A SMALL, hand-rolled stdio JSON-RPC 2.0 MCP client for Electron main.
 *
 * Why hand-rolled: @modelcontextprotocol/sdk ships a *server* surface (the
 * brainchild repo uses it to BUILD a server). It is not a client dependency of
 * this Electron app, and pulling it in just to drive a child process would bloat
 * the bundle. The MCP stdio wire format is plain newline-delimited JSON-RPC, so
 * a ~150-line client covers the read path (initialize + tools/call) we need.
 *
 * Transport contract (matches brainchild/bin/brainchild-mcp.js):
 *   - stdout of the child = pure newline-delimited JSON-RPC frames (no logging).
 *   - stderr of the child = human logs (we inherit/ignore it).
 *   - We write our requests to the child's stdin, one JSON object per line.
 *
 * The pure framing/protocol helpers (buildRequest, encodeFrame, FrameDecoder,
 * isResponseFor) are exported separately so they can be unit-tested without
 * spawning a process.
 */

'use strict';

const JSONRPC_VERSION = '2.0';
const PROTOCOL_VERSION = '2024-11-05';

/**
 * Build a JSON-RPC request object. Pure.
 * @param {number} id
 * @param {string} method
 * @param {Object} [params]
 */
function buildRequest(id, method, params) {
  const req = { jsonrpc: JSONRPC_VERSION, id, method };
  if (params !== undefined) req.params = params;
  return req;
}

/**
 * Build a JSON-RPC notification (no id, no response expected). Pure.
 * @param {string} method
 * @param {Object} [params]
 */
function buildNotification(method, params) {
  const note = { jsonrpc: JSONRPC_VERSION, method };
  if (params !== undefined) note.params = params;
  return note;
}

/**
 * Encode a JSON-RPC message to a single newline-terminated frame. Pure.
 * @param {Object} message
 * @returns {string}
 */
function encodeFrame(message) {
  return JSON.stringify(message) + '\n';
}

/**
 * Decide whether a parsed message is the response for a given request id. Pure.
 * @param {Object} message
 * @param {number} id
 */
function isResponseFor(message, id) {
  return Boolean(message) && Object.prototype.hasOwnProperty.call(message, 'id') && message.id === id;
}

/**
 * Newline-delimited JSON frame decoder. Feed it raw chunks; it yields one parsed
 * message per complete line. Pure (no I/O) — exported for unit testing the
 * partial-chunk / multi-message buffering logic.
 */
class FrameDecoder {
  constructor() {
    this._buffer = '';
  }

  /**
   * Push a chunk of text and return any complete parsed JSON messages.
   * Malformed lines are skipped (returned in `errors`) rather than thrown, so a
   * single bad line never kills the stream.
   * @param {string} chunk
   * @returns {{ messages: Object[], errors: string[] }}
   */
  push(chunk) {
    this._buffer += chunk;
    const messages = [];
    const errors = [];
    let newlineIndex = this._buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this._buffer.slice(0, newlineIndex).trim();
      this._buffer = this._buffer.slice(newlineIndex + 1);
      if (line.length) {
        try {
          messages.push(JSON.parse(line));
        } catch (error) {
          errors.push(line);
        }
      }
      newlineIndex = this._buffer.indexOf('\n');
    }
    return { messages, errors };
  }
}

/**
 * Unwrap an MCP tools/call result into the structured payload the renderer
 * wants. MCP tool callbacks return `{ content: [...], structuredContent?, isError? }`.
 * Brainchild returns both a JSON text block and `structuredContent`; we prefer
 * the structured form and fall back to parsing the text block. Pure.
 * @param {Object} result - the JSON-RPC `result` field of a tools/call response
 * @returns {Object} structured payload (e.g. { notes, count } or { path, body })
 */
function unwrapToolResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Empty tool result');
  }
  if (result.isError) {
    const text = firstText(result.content) || 'Tool reported an error';
    throw new Error(text);
  }
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  const text = firstText(result.content);
  if (text) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return { text };
    }
  }
  return {};
}

function firstText(content) {
  if (!Array.isArray(content)) return '';
  for (const part of content) {
    if (part && part.type === 'text' && typeof part.text === 'string') return part.text;
  }
  return '';
}

/**
 * Stdio MCP client. Wraps a spawned child process' stdin/stdout streams.
 *
 * Usage:
 *   const client = new StdioMcpClient(child, { onError });
 *   await client.initialize();
 *   const out = await client.callTool('list_notes', {});
 *   client.dispose();
 */
class StdioMcpClient {
  /**
   * @param {import('child_process').ChildProcess} child
   * @param {Object} [options]
   * @param {(msg: string, error?: Error) => void} [options.onError] - diagnostics sink
   * @param {number} [options.requestTimeoutMs] - per-call timeout (default 15s)
   */
  constructor(child, options = {}) {
    this._child = child;
    this._onError = typeof options.onError === 'function' ? options.onError : function () {};
    this._requestTimeoutMs = options.requestTimeoutMs || 15000;
    this._nextId = 1;
    this._pending = new Map(); // id -> { resolve, reject, timer }
    this._decoder = new FrameDecoder();
    this._initialized = false;
    this._disposed = false;

    if (child && child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this._onStdout(chunk));
    }
    if (child && child.stdin && typeof child.stdin.on === 'function') {
      // A broken stdin pipe (child died) must not crash Electron main.
      child.stdin.on('error', (error) => this._onError('mcp stdin pipe error', error));
    }
  }

  _onStdout(chunk) {
    const { messages, errors } = this._decoder.push(chunk);
    errors.forEach((line) => this._onError('mcp: dropped malformed frame: ' + line.slice(0, 200)));
    messages.forEach((message) => this._dispatch(message));
  }

  _dispatch(message) {
    if (!Object.prototype.hasOwnProperty.call(message, 'id')) return; // notification — ignore
    const pending = this._pending.get(message.id);
    if (!pending) return;
    this._pending.delete(message.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (message.error) {
      const detail = message.error && message.error.message ? message.error.message : JSON.stringify(message.error);
      pending.reject(new Error('MCP error: ' + detail));
    } else {
      pending.resolve(message.result);
    }
  }

  _send(message) {
    if (this._disposed) return Promise.reject(new Error('MCP client disposed'));
    if (!this._child || !this._child.stdin || !this._child.stdin.writable) {
      return Promise.reject(new Error('MCP child process is not writable'));
    }
    try {
      this._child.stdin.write(encodeFrame(message));
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  _request(method, params) {
    const id = this._nextId++;
    const message = buildRequest(id, method, params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error('MCP request timed out: ' + method));
        }
      }, this._requestTimeoutMs);
      // A pending request timeout must never keep the runtime (or a test worker)
      // alive on its own; responses clear it via _pending in the message handler.
      if (timer && typeof timer.unref === 'function') timer.unref();
      this._pending.set(id, { resolve, reject, timer });
      this._send(message).catch((error) => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          clearTimeout(timer);
        }
        reject(error);
      });
    });
  }

  /**
   * Perform the MCP initialize handshake. Idempotent.
   */
  async initialize() {
    if (this._initialized) return;
    await this._request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'lana-ai-client', version: '1.0.0' }
    });
    // Per the MCP spec the client follows initialize with a notification.
    await this._send(buildNotification('notifications/initialized'));
    this._initialized = true;
  }

  /**
   * Call a tool and return its unwrapped structured payload.
   * @param {string} name
   * @param {Object} [args]
   */
  async callTool(name, args) {
    if (!this._initialized) await this.initialize();
    const result = await this._request('tools/call', { name, arguments: args || {} });
    return unwrapToolResult(result);
  }

  /**
   * Reject all in-flight requests and stop accepting new ones.
   */
  dispose() {
    this._disposed = true;
    for (const [, pending] of this._pending) {
      if (pending.timer) clearTimeout(pending.timer);
      try { pending.reject(new Error('MCP client disposed')); } catch (_error) { /* noop */ }
    }
    this._pending.clear();
  }
}

module.exports = {
  PROTOCOL_VERSION,
  buildRequest,
  buildNotification,
  encodeFrame,
  isResponseFor,
  unwrapToolResult,
  FrameDecoder,
  StdioMcpClient
};
