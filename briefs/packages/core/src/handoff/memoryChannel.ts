import { randomBytes } from "../crypto/random.js";
import { HandoffError } from "./errors.js";
import { encodeFrame, type Frame } from "./frame.js";
import type { FrameChannel } from "./frameChannel.js";
import { FrameDecoder } from "./frameDecoder.js";
import { FrameQueue } from "./frameQueue.js";

/**
 * One end of an in-process channel pair (Swift `InMemoryChannel`). Frames still go
 * through full encode and decode so wire bugs surface here too.
 */
export class MemoryFrameChannel implements FrameChannel {
  private readonly queue = new FrameQueue();
  private readonly decoder = new FrameDecoder();
  private peer: MemoryFrameChannel | undefined;

  private constructor(readonly channelBinding: Uint8Array, readonly peerIdentity: string | undefined) {}

  /** `serverSeesPeer` is what the server end reports as `peerIdentity`. */
  static pair(options: { binding?: Uint8Array; serverSeesPeer?: string } = {}): { client: MemoryFrameChannel; server: MemoryFrameChannel } {
    const binding = options.binding ?? randomBytes(32);
    const client = new MemoryFrameChannel(binding, undefined);
    const server = new MemoryFrameChannel(binding, options.serverSeesPeer);
    client.peer = server;
    server.peer = client;
    return { client, server };
  }

  async send(frame: Frame): Promise<void> {
    const peer = this.peer;
    if (peer === undefined || this.queue.failed) throw new HandoffError("channel_closed");
    peer.deliver(encodeFrame(frame));
  }

  receive(timeoutMs?: number): Promise<Frame> {
    return this.queue.next(timeoutMs);
  }

  close(): void {
    const peer = this.peer;
    this.peer = undefined;
    this.queue.fail(new HandoffError("channel_closed"));
    if (peer !== undefined) {
      peer.peer = undefined;
      peer.queue.fail(new HandoffError("channel_closed"));
    }
  }

  private deliver(bytes: Uint8Array): void {
    this.decoder.append(bytes);
    try {
      for (let frame = this.decoder.next(); frame !== undefined; frame = this.decoder.next()) this.queue.push(frame);
    } catch (error) {
      this.queue.fail(error as Error);
    }
  }
}
