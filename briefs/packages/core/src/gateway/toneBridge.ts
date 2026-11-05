import { randomUUID } from "node:crypto";
import { HandoffError } from "../handoff/errors.js";
import type { ToneOutput } from "../handoff/ports.js";

/**
 * One tone burst for the speaker. The contract with the Electron renderer:
 *
 * - `samples` is mono Float32 PCM in -1...1 at `sampleRate` Hz (48 kHz for the
 *   standard modem), to be played once, unmodified, at full volume (as Swift's
 *   `EngineTonePlayer` fixes the mixer volume for the burst). In Web Audio: an
 *   `AudioBuffer` of one channel at `sampleRate`, `copyToChannel(samples, 0)`, an
 *   `AudioBufferSourceNode` straight to the destination.
 * - The renderer reports `played(id)` when playback has ended (the source node's
 *   `ended` event), or `failed(id)` if it cannot play. The handoff timing window starts
 *   when `play` resolves, so report the end of playback, not the start.
 * - Without an answer within `durationMs` plus the margin, the play fails.
 */
export interface ToneRequest {
  readonly id: string;
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly durationMs: number;
}

const DEFAULT_MARGIN_MS = 5_000;

/**
 * `ToneOutput` for a speaker in another process: sends each burst through `send`
 * (for example `webContents.send`) and resolves when the other side reports it played.
 */
export class ToneBridge implements ToneOutput {
  private readonly pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly marginMs: number;

  constructor(private readonly send: (request: ToneRequest) => void, options: { readonly marginMs?: number } = {}) {
    this.marginMs = options.marginMs ?? DEFAULT_MARGIN_MS;
  }

  play(samples: Float32Array, sampleRate: number): Promise<void> {
    const id = randomUUID();
    const durationMs = Math.ceil((samples.length / sampleRate) * 1_000);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, new HandoffError("transport", "tone output timed out")), durationMs + this.marginMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, samples, sampleRate, durationMs });
      } catch {
        this.settle(id, new HandoffError("transport", "tone output unavailable"));
      }
    });
  }

  /** The renderer finished playing burst `id`. Unknown ids are ignored. */
  played(id: string): void {
    this.settle(id);
  }

  /** The renderer could not play burst `id`. */
  failed(id: string): void {
    this.settle(id, new HandoffError("transport", "tone output failed"));
  }

  /** Fails every burst still waiting (window closed, gateway stopping). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, new HandoffError("transport", "tone output closed"));
  }

  private settle(id: string, error?: Error): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (error === undefined) entry.resolve();
    else entry.reject(error);
  }
}
