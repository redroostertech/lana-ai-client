const path = require('path');

const {
  buildRequest,
  buildNotification,
  encodeFrame,
  isResponseFor,
  unwrapToolResult,
  FrameDecoder,
  PROTOCOL_VERSION
} = require(path.join(__dirname, '../../src/electron-mcp-client.js'));

describe('electron-mcp-client (pure JSON-RPC framing)', () => {
  describe('buildRequest', () => {
    test('produces a JSON-RPC 2.0 request with id/method', () => {
      expect(buildRequest(7, 'tools/call', { name: 'list_notes' })).toEqual({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'list_notes' }
      });
    });

    test('omits params when not provided', () => {
      const req = buildRequest(1, 'initialize');
      expect(req).not.toHaveProperty('params');
      expect(req.id).toBe(1);
    });
  });

  describe('buildNotification', () => {
    test('has no id (no response expected)', () => {
      const note = buildNotification('notifications/initialized');
      expect(note).not.toHaveProperty('id');
      expect(note.jsonrpc).toBe('2.0');
      expect(note.method).toBe('notifications/initialized');
    });
  });

  describe('encodeFrame', () => {
    test('serializes to a single newline-terminated line', () => {
      const frame = encodeFrame({ a: 1 });
      expect(frame.endsWith('\n')).toBe(true);
      expect(frame.indexOf('\n')).toBe(frame.length - 1);
      expect(JSON.parse(frame.trim())).toEqual({ a: 1 });
    });
  });

  describe('isResponseFor', () => {
    test('matches by id', () => {
      expect(isResponseFor({ id: 3, result: {} }, 3)).toBe(true);
      expect(isResponseFor({ id: 4, result: {} }, 3)).toBe(false);
      expect(isResponseFor({ method: 'x' }, 3)).toBe(false);
      expect(isResponseFor(null, 3)).toBe(false);
    });
  });

  describe('FrameDecoder', () => {
    test('parses one message per complete line', () => {
      const d = new FrameDecoder();
      const out = d.push('{"id":1}\n{"id":2}\n');
      expect(out.messages).toEqual([{ id: 1 }, { id: 2 }]);
      expect(out.errors).toEqual([]);
    });

    test('buffers partial chunks across pushes', () => {
      const d = new FrameDecoder();
      expect(d.push('{"id":').messages).toEqual([]);
      expect(d.push('1}').messages).toEqual([]); // still no newline
      const out = d.push('\n');
      expect(out.messages).toEqual([{ id: 1 }]);
    });

    test('handles multiple messages split awkwardly across chunks', () => {
      const d = new FrameDecoder();
      const a = d.push('{"a":1}\n{"b":');
      expect(a.messages).toEqual([{ a: 1 }]);
      const b = d.push('2}\n{"c":3}\n');
      expect(b.messages).toEqual([{ b: 2 }, { c: 3 }]);
    });

    test('skips malformed lines without throwing, reporting them as errors', () => {
      const d = new FrameDecoder();
      const out = d.push('not-json\n{"ok":true}\n');
      expect(out.messages).toEqual([{ ok: true }]);
      expect(out.errors).toEqual(['not-json']);
    });

    test('ignores blank lines', () => {
      const d = new FrameDecoder();
      const out = d.push('\n\n{"x":1}\n');
      expect(out.messages).toEqual([{ x: 1 }]);
      expect(out.errors).toEqual([]);
    });
  });

  describe('unwrapToolResult', () => {
    test('prefers structuredContent', () => {
      const result = {
        content: [{ type: 'text', text: '{"notes":[],"count":0}' }],
        structuredContent: { notes: [{ path: 'A.md' }], count: 1 }
      };
      expect(unwrapToolResult(result)).toEqual({ notes: [{ path: 'A.md' }], count: 1 });
    });

    test('falls back to parsing the text content block', () => {
      const result = { content: [{ type: 'text', text: '{"notes":[],"count":0}' }] };
      expect(unwrapToolResult(result)).toEqual({ notes: [], count: 0 });
    });

    test('returns { text } when the text block is not JSON', () => {
      const result = { content: [{ type: 'text', text: 'hello' }] };
      expect(unwrapToolResult(result)).toEqual({ text: 'hello' });
    });

    test('throws on isError, surfacing the message', () => {
      const result = { isError: true, content: [{ type: 'text', text: 'get_note failed: 404' }] };
      expect(() => unwrapToolResult(result)).toThrow('get_note failed: 404');
    });

    test('throws on an empty/invalid result', () => {
      expect(() => unwrapToolResult(null)).toThrow('Empty tool result');
    });
  });

  test('exports a protocol version', () => {
    expect(typeof PROTOCOL_VERSION).toBe('string');
    expect(PROTOCOL_VERSION.length).toBeGreaterThan(0);
  });
});
