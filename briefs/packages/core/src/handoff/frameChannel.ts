import { HandoffError } from "./errors.js";
import type { Frame } from "./frame.js";
import type { HandoffMessage, HandoffMessageType } from "./messages.js";

/** A bidirectional, already authenticated connection between one phone and one Mac (Swift `FrameChannel`). */
export interface FrameChannel {
  /**
   * TLS exporter value unique to this connection. Attestation signatures cover it, so a
   * signature captured on one connection is useless on another.
   */
  readonly channelBinding: Uint8Array;
  /**
   * Identity of the pre-shared key the peer used (a phone's device id, or "pair"). Undefined
   * when the transport cannot report it; sessions then rely on pinned-key signatures.
   */
  readonly peerIdentity: string | undefined;
  send(frame: Frame): Promise<void>;
  /** The next frame; rejects with `timed_out` after `timeoutMs`, or `channel_closed`. */
  receive(timeoutMs?: number): Promise<Frame>;
  close(): void;
}

export type MessagePayload<T extends HandoffMessageType> = Extract<HandoffMessage, { type: T }> extends { payload: infer P } ? P : undefined;

/** Receives and requires one message type, turning a peer `failure` into `peer_failed` (Swift `expect`). */
export async function expectMessage<T extends HandoffMessageType>(
  channel: FrameChannel,
  timeoutMs: number,
  type: T,
  accept: (payload: MessagePayload<T>) => boolean = () => true,
): Promise<{ payload: MessagePayload<T>; body: Uint8Array }> {
  const frame = await channel.receive(timeoutMs);
  const message = frame.message;
  if (message.type === "failure") throw new HandoffError("peer_failed", message.payload.detail, message.payload.code);
  const payload = ("payload" in message ? message.payload : undefined) as MessagePayload<T>;
  if (message.type !== type || !accept(payload)) throw new HandoffError("unexpected_message", message.type);
  return { payload, body: frame.body };
}
