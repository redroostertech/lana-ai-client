import { canonicalEncode } from "../json/canonical.js";
import { HandoffError } from "./errors.js";
import { encodeMessage } from "./messageCodec.js";
import type { HandoffMessage } from "./messages.js";

export const MAX_HEADER_BYTES = 256 * 1024;
export const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** One unit on the wire: a JSON control message plus an optional binary body. */
export interface Frame {
  readonly message: HandoffMessage;
  readonly body: Uint8Array;
}

/** `u32 headerLength | header | u32 bodyLength | body`, lengths big-endian. */
export function encodeFrame(frame: Frame): Uint8Array {
  const header = canonicalEncode(encodeMessage(frame.message));
  if (header.length > MAX_HEADER_BYTES || frame.body.length > MAX_BODY_BYTES) throw new HandoffError("frame_too_large");
  const out = new Uint8Array(8 + header.length + frame.body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, header.length, false);
  out.set(header, 4);
  view.setUint32(4 + header.length, frame.body.length, false);
  out.set(frame.body, 8 + header.length);
  return out;
}
