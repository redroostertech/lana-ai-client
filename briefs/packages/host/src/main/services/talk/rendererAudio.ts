import type { AudioInput, AudioOutput } from "@lana/core/talk";
import { randomUUID } from "node:crypto";
import { TALK_SAMPLE_RATE, type TalkAudioApi, type TalkAudioCommand } from "../../../shared/api.js";

/** How long the window has to open the microphone before Talk gives up. */
const CAPTURE_TIMEOUT_MS = 10_000;
/** Extra time a clip may take past its length before playback counts as done. */
const PLAYBACK_GRACE_MS = 5_000;
/** The system voice speaks roughly this fast; the wait allows twice as long. */
const LEVEL_GAIN = 6;

export class MicrophoneError extends Error {
  constructor(readonly reason: "denied" | "unavailable" | "timeout") {
    super(`microphone_${reason}`);
    this.name = "MicrophoneError";
  }
}

interface Waiter {
  resolve(ok: boolean): void;
  timer: NodeJS.Timeout;
}

/**
 * The window's microphone and speakers as Talk's ports (Swift `TalkAudioEngine`): main asks
 * for capture and playback with `talkAudio` commands, the window answers through the
 * `talkAudio` bridge and streams microphone frames over `TALK_FRAME_CHANNEL`. Nothing heard
 * or said is kept or logged here.
 */
export class RendererAudio implements TalkAudioApi {
  private capturing: ((samples: Float32Array, sampleRate: number) => void) | null = null;
  private captureWaiter: { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout } | null = null;
  private readonly playing = new Map<string, Waiter>();
  private levelListener: ((level: number) => void) | null = null;

  constructor(private readonly send: (command: TalkAudioCommand) => void) {}

  // MARK: - Ports

  /** Microphone audio, 16 kHz mono, from the window. */
  input(): AudioInput {
    return {
      start: (onSamples) => this.startCapture(onSamples),
      stop: async () => this.stopCapture(),
    };
  }

  /** Synthesized speech played by the window through Web Audio. */
  output(): AudioOutput {
    return {
      play: (samples, sampleRate) => {
        const id = randomUUID();
        const done = this.wait(id, (samples.length / sampleRate) * 1000 + PLAYBACK_GRACE_MS);
        this.send({ kind: "play", id, samples, sampleRate });
        return done.then(() => undefined);
      },
      stop: () => this.stopPlayback(),
    };
  }

  /** Muted: the window disables the track, so nothing is captured. */
  setMuted(muted: boolean): void {
    this.send({ kind: "mute", muted });
  }

  /** The microphone level (0 to 1) of each frame, for the orb. */
  onLevel(listener: ((level: number) => void) | null): void {
    this.levelListener = listener;
  }

  /** One frame from `TALK_FRAME_CHANNEL`. Dropped unless a talk is listening. */
  frame(samples: Float32Array): void {
    if (this.capturing === null || !(samples instanceof Float32Array) || samples.length === 0) return;
    this.capturing(samples, TALK_SAMPLE_RATE);
    if (this.levelListener !== null) {
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      this.levelListener(Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN));
    }
  }

  get isCapturing(): boolean {
    return this.capturing !== null;
  }

  // MARK: - TalkAudioApi

  async captureStarted(): Promise<void> {
    const waiter = this.captureWaiter;
    this.captureWaiter = null;
    if (waiter === null) return;
    clearTimeout(waiter.timer);
    waiter.resolve();
  }

  async captureFailed(reason: "denied" | "unavailable"): Promise<void> {
    const waiter = this.captureWaiter;
    this.captureWaiter = null;
    this.capturing = null;
    if (waiter === null) return;
    clearTimeout(waiter.timer);
    waiter.reject(new MicrophoneError(reason === "denied" ? "denied" : "unavailable"));
  }

  async played(id: string): Promise<void> {
    this.finish(String(id), true);
  }

  async playFailed(id: string): Promise<void> {
    this.finish(String(id), false);
  }

  // MARK: - Private

  private startCapture(onSamples: (samples: Float32Array, sampleRate: number) => void): Promise<void> {
    this.captureWaiter?.reject(new MicrophoneError("unavailable"));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.captureWaiter = null;
        this.capturing = null;
        this.send({ kind: "stopCapture" });
        reject(new MicrophoneError("timeout"));
      }, CAPTURE_TIMEOUT_MS);
      this.captureWaiter = { resolve, reject, timer };
      this.capturing = onSamples;
      this.send({ kind: "startCapture" });
    });
  }

  private stopCapture(): void {
    if (this.captureWaiter !== null) {
      clearTimeout(this.captureWaiter.timer);
      this.captureWaiter.reject(new MicrophoneError("unavailable"));
      this.captureWaiter = null;
    }
    this.capturing = null;
    this.send({ kind: "stopCapture" });
  }

  private stopPlayback(): void {
    this.send({ kind: "stopPlayback" });
    for (const id of [...this.playing.keys()]) this.finish(id, false);
  }

  private wait(id: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finish(id, false), timeoutMs);
      this.playing.set(id, { resolve, timer });
    });
  }

  private finish(id: string, ok: boolean): void {
    const waiter = this.playing.get(id);
    if (waiter === undefined) return;
    this.playing.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(ok);
  }
}
