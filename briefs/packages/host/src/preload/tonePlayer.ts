import type { LanaBridge, ToneRequest } from "../shared/api.js";

/** The parts of Web Audio the player uses, so tests can pass a fake. */
export interface ToneAudio {
  createContext(sampleRate: number): AudioContext;
}

/** The standard modem's rate (core tone configuration), so the warm context matches. */
const STANDARD_TONE_RATE = 48_000;

const webAudio: ToneAudio = { createContext: (sampleRate) => new AudioContext({ sampleRate, latencyHint: "interactive" }) };

/**
 * The renderer side of core's `ToneBridge`: plays each burst once through Web Audio (a
 * one-channel AudioBuffer at the burst's sample rate, an AudioBufferSourceNode straight
 * to the destination, no gain) and reports `played` when the source ends, or `failed`.
 * The context runs at the burst's own rate (48 kHz) so the 18.5 to 19.4 kHz carriers are
 * not resampled. Returns the stop function.
 */
export function startTonePlayer(bridge: Pick<LanaBridge, "onEvent" | "tone">, audio: ToneAudio = webAudio): () => void {
  let context: AudioContext | null = null;

  // Open the output now and keep it running. Starting the audio device on the first tone
  // took about 2.4 s, which pushed the burst past the phone's 2.5 s listening window.
  const warm = (sampleRate: number): AudioContext => {
    if (context === null || context.sampleRate !== sampleRate || context.state === "closed") {
      void context?.close().catch(() => undefined);
      context = audio.createContext(sampleRate);
    }
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return context;
  };
  try {
    warm(STANDARD_TONE_RATE);
  } catch {
    // No audio output yet; the first tone tries again.
  }

  const play = async (request: ToneRequest): Promise<void> => {
    try {
      const context = warm(request.sampleRate);
      if (context.state === "suspended") await context.resume();
      const buffer = context.createBuffer(1, request.samples.length, request.sampleRate);
      buffer.copyToChannel(new Float32Array(request.samples), 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        source.disconnect();
        void bridge.tone.played(request.id);
      };
      source.start();
    } catch {
      void bridge.tone.failed(request.id);
    }
  };

  const unsubscribe = bridge.onEvent((event) => {
    if (event.type === "tone") void play(event.request);
  });
  return () => {
    unsubscribe();
    void context?.close().catch(() => undefined);
    context = null;
  };
}
