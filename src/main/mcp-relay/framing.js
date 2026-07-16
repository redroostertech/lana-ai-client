'use strict';

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_STRING_BYTES = 64 * 1024;
const MAX_ARRAY_LENGTH = 1000;

class FrameDecoder {
  constructor({ maxBytes = MAX_REQUEST_BYTES } = {}) { this.maxBytes = maxBytes; this.buffer = Buffer.alloc(0); this.expected = null; }
  push(chunk) {
    const incoming = Buffer.from(chunk);
    if (this.buffer.length + incoming.length > this.maxBytes + 4) throw frameError('INVALID_REQUEST');
    this.buffer = Buffer.concat([this.buffer, incoming]);
    const frames = [];
    while (true) {
      if (this.expected === null) {
        if (this.buffer.length < 4) break;
        this.expected = this.buffer.readUInt32BE(0); this.buffer = this.buffer.subarray(4);
        if (this.expected < 2 || this.expected > this.maxBytes) throw frameError('INVALID_REQUEST');
      }
      if (this.buffer.length < this.expected) break;
      const raw = this.buffer.subarray(0, this.expected); this.buffer = this.buffer.subarray(this.expected); this.expected = null;
      let value;
      try { value = JSON.parse(raw.toString('utf8')); } catch (_) { throw frameError('INVALID_REQUEST'); }
      inspect(value, 0);
      frames.push(value);
    }
    return frames;
  }
}

function encodeFrame(value, maxBytes = MAX_RESPONSE_BYTES) {
  inspect(value, 0);
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > maxBytes) throw frameError('INVALID_REQUEST');
  const header = Buffer.allocUnsafe(4); header.writeUInt32BE(body.length); return Buffer.concat([header, body]);
}

function inspect(value, depth) {
  if (depth > MAX_DEPTH) throw frameError('INVALID_REQUEST');
  if (typeof value === 'string' && Buffer.byteLength(value) > MAX_STRING_BYTES) throw frameError('INVALID_REQUEST');
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) throw frameError('INVALID_REQUEST');
    for (const item of value) inspect(item, depth + 1);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw frameError('INVALID_REQUEST');
      inspect(item, depth + 1);
    }
  }
}
function frameError(code) { const error = new Error(code); error.code = code; return error; }
module.exports = { FrameDecoder, encodeFrame, inspect, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, MAX_DEPTH };
