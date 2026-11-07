import { concatBytes } from "../bytes/concat.js";
import { parseJson } from "../json/parse.js";
import { HandoffError } from "./errors.js";
import { MAX_BODY_BYTES, MAX_HEADER_BYTES, type Frame } from "./frame.js";
import { decodeMessage } from "./messageCodec.js";

/** Incremental decoder: feed bytes as they arrive, pull complete frames out. */
export class FrameDecoder {
  private buffer: Uint8Array = new Uint8Array();

  append(data: Uint8Array): void {
    this.buffer = this.buffer.length === 0 ? data.slice() : concatBytes(this.buffer, data);
  }

  /** The next complete frame, or undefined until more bytes arrive. Oversized lengths throw before buffering them. */
  next(): Frame | undefined {
    const buffer = this.buffer;
    if (buffer.length < 4) return undefined;
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const headerLength = view.getUint32(0, false);
    if (headerLength > MAX_HEADER_BYTES) throw new HandoffError("frame_too_large");
    if (buffer.length < 8 + headerLength) return undefined;
    const bodyLength = view.getUint32(4 + headerLength, false);
    if (bodyLength > MAX_BODY_BYTES) throw new HandoffError("frame_too_large");
    const total = 8 + headerLength + bodyLength;
    if (buffer.length < total) return undefined;
    const header = buffer.slice(4, 4 + headerLength);
    const body = buffer.slice(8 + headerLength, total);
    this.buffer = buffer.slice(total);
    try {
      return { message: decodeMessage(parseJson(header)), body };
    } catch {
      throw new HandoffError("malformed_frame");
    }
  }
}
