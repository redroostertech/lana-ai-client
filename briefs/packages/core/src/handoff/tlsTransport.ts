import { connect, createServer, type Server, type TLSSocket } from "node:tls";
import { HandoffError } from "./errors.js";
import { encodeFrame, type Frame } from "./frame.js";
import type { FrameChannel } from "./frameChannel.js";
import { FrameDecoder } from "./frameDecoder.js";
import { FrameQueue } from "./frameQueue.js";
import { SILENT_LOG, type HandoffLog } from "./log.js";

/**
 * TLS-PSK transport (Swift `HandoffTransport`, `NetworkFrameChannel`, `HandoffListener`).
 *
 * TLS 1.2 only, with the single suite TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256 (0xCCAC):
 * only a device holding the pairing-derived key finishes the handshake, and ECDHE gives
 * each session forward secrecy. Proven against Network.framework in P0.1.
 */
export const HANDOFF_TLS = Object.freeze({
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
  ciphers: "ECDHE-PSK-CHACHA20-POLY1305",
  exporterLabel: "EXPORTER-lana-channel-binding",
  exporterLength: 32,
  /** PSK identity the phone presents on a pairing connection. */
  pairingIdentity: "pair",
} as const);

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;
const KEEPALIVE_IDLE_MS = 10_000;

/** Pre-shared key for an identity the client presents, or undefined to refuse the handshake. */
export type PskResolver = (identity: string) => Uint8Array | undefined;

/**
 * Apple's `sec_protocol_metadata_create_secret` exports with an empty context, which
 * differs from exporting with no context. Both ends must use the empty one.
 */
export function exportChannelBinding(socket: TLSSocket): Uint8Array {
  const value = socket.exportKeyingMaterial(HANDOFF_TLS.exporterLength, HANDOFF_TLS.exporterLabel, Buffer.alloc(0));
  if (value.length !== HANDOFF_TLS.exporterLength) throw new HandoffError("transport", "TLS exporter wrong length");
  return new Uint8Array(value);
}

/** A `FrameChannel` over an authenticated TLS socket. */
export class SocketFrameChannel implements FrameChannel {
  readonly channelBinding: Uint8Array;
  private readonly queue = new FrameQueue();
  private readonly decoder = new FrameDecoder();

  constructor(private readonly socket: TLSSocket, readonly peerIdentity: string | undefined) {
    this.channelBinding = exportChannelBinding(socket);
    socket.setKeepAlive(true, KEEPALIVE_IDLE_MS);
    socket.on("data", (chunk: Buffer) => {
      this.decoder.append(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      try {
        for (let frame = this.decoder.next(); frame !== undefined; frame = this.decoder.next()) this.queue.push(frame);
      } catch (error) {
        this.queue.fail(error as Error);
        socket.destroy();
      }
    });
    socket.on("end", () => this.queue.fail(new HandoffError("channel_closed")));
    socket.on("close", () => this.queue.fail(new HandoffError("channel_closed")));
    socket.on("error", (error: Error) => this.queue.fail(new HandoffError("transport", errorCode(error))));
  }

  send(frame: Frame): Promise<void> {
    const data = encodeFrame(frame);
    if (this.socket.destroyed || !this.socket.writable) return Promise.reject(new HandoffError("channel_closed"));
    return new Promise((resolve, reject) => {
      this.socket.write(data, (error) => (error ? reject(new HandoffError("transport", errorCode(error))) : resolve()));
    });
  }

  receive(timeoutMs?: number): Promise<Frame> {
    return this.queue.next(timeoutMs);
  }

  close(): void {
    this.queue.fail(new HandoffError("channel_closed"));
    if (!this.socket.destroyed) this.socket.end();
    setTimeout(() => this.socket.destroy(), 1_000).unref();
  }
}

export interface HandoffListenerOptions {
  readonly psks: PskResolver;
  /** Fixed port (tests); 0 or undefined lets the system choose. */
  readonly port?: number;
  /** Bind address; undefined listens on every interface, as the phone reaches the Mac over the LAN. */
  readonly host?: string;
  readonly handshakeTimeoutMs?: number;
  readonly log?: HandoffLog;
}

/** Mac side: accepts TLS-PSK connections and hands out authenticated channels. */
export class HandoffListener {
  private server: Server | undefined;
  private readonly identities = new WeakMap<TLSSocket, string>();
  private readonly log: HandoffLog;

  constructor(private readonly options: HandoffListenerOptions) {
    this.log = options.log ?? SILENT_LOG;
  }

  /** Starts listening; `onChannel` runs once per connection that completes TLS. Resolves to the bound port. */
  start(onChannel: (channel: SocketFrameChannel) => void | Promise<void>): Promise<number> {
    const log = this.log;
    const server = createServer({
      minVersion: HANDOFF_TLS.minVersion,
      maxVersion: HANDOFF_TLS.maxVersion,
      ciphers: HANDOFF_TLS.ciphers,
      handshakeTimeout: this.options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
      pskCallback: (socket: TLSSocket, identity: string) => {
        const key = this.options.psks(identity);
        if (key === undefined) {
          log.notice("handoff.listener.unknown_psk_identity");
          return null;
        }
        this.identities.set(socket, identity);
        return Buffer.from(key);
      },
    });
    server.on("secureConnection", (socket: TLSSocket) => {
      let channel: SocketFrameChannel;
      try {
        channel = new SocketFrameChannel(socket, this.identities.get(socket));
      } catch (error) {
        log.notice("handoff.listener.rejected", { reason: errorCode(error) });
        socket.destroy();
        return;
      }
      Promise.resolve()
        .then(() => onChannel(channel))
        .catch((error: unknown) => log.notice("handoff.listener.channel_ended", { reason: errorCode(error) }));
    });
    server.on("tlsClientError", (error: Error) => log.notice("handoff.listener.handshake_failed", { reason: errorCode(error) }));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", (error: Error) => reject(new HandoffError("transport", errorCode(error))));
      server.listen(this.options.port ?? 0, this.options.host, () => {
        const address = server.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }
}

/**
 * Client side, used by tests and tools (the phone's real client is Swift). Presents
 * `identity` with `key`, exactly as `NetworkFrameChannel.connect` does.
 */
export function connectHandoff(options: { host: string; port: number; identity: string; key: Uint8Array; timeoutMs?: number }): Promise<SocketFrameChannel> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: options.host,
      port: options.port,
      minVersion: HANDOFF_TLS.minVersion,
      maxVersion: HANDOFF_TLS.maxVersion,
      ciphers: HANDOFF_TLS.ciphers,
      checkServerIdentity: () => undefined,
      pskCallback: () => ({ psk: Buffer.from(options.key), identity: options.identity }),
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new HandoffError("timed_out"));
    }, options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      try {
        resolve(new SocketFrameChannel(socket, undefined));
      } catch (error) {
        socket.destroy();
        reject(error as Error);
      }
    });
    socket.once("error", (error: Error) => {
      clearTimeout(timer);
      reject(new HandoffError("transport", errorCode(error)));
    });
  });
}

/** An error's code or class name, never its message (which may echo peer data). */
function errorCode(error: unknown): string {
  if (error instanceof HandoffError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.name : "unknown";
}
