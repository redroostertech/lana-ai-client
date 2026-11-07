/// <reference path="./sherpaModule.d.ts" />
import { join } from "node:path";

/**
 * The slice of `sherpa-onnx-node` 2.x that Talk uses. Electron forbids external array
 * buffers, so every call that returns audio passes `enableExternalBuffer: false`.
 */
export interface SherpaGeneratedAudio {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

export interface SherpaOfflineTts {
  generateAsync(request: {
    text: string; sid: number; speed: number; enableExternalBuffer: false;
    generationConfig: { sid: number; speed: number; phonemeCodepoints: number[][] };
  }): Promise<SherpaGeneratedAudio>;
}

export interface SherpaOfflineStream {
  acceptWaveform(audio: { sampleRate: number; samples: Float32Array }): void;
}

export interface SherpaOfflineRecognizer {
  createStream(): SherpaOfflineStream;
  decodeAsync(stream: SherpaOfflineStream): Promise<{ text: string }>;
}

export interface SherpaVad {
  acceptWaveform(samples: Float32Array): void;
  isDetected(): boolean;
  isEmpty(): boolean;
  pop(): void;
  reset(): void;
}

export interface SherpaModule {
  OfflineTts: { createAsync(config: unknown): Promise<SherpaOfflineTts> };
  OfflineRecognizer: { createAsync(config: unknown): Promise<SherpaOfflineRecognizer> };
  Vad: new (config: unknown, bufferSizeInSeconds: number) => SherpaVad;
}

/** Loads the native module on first use, so processes that never talk do not load it. */
export async function loadSherpa(): Promise<SherpaModule> {
  const loaded = (await import("sherpa-onnx-node")) as unknown as { default?: SherpaModule } & SherpaModule;
  return loaded.default ?? loaded;
}

/** Where the speech models live, in the folders their releases unpack to. */
export interface SpeechModelPaths {
  /** `silero_vad.onnx`. */
  readonly vad: string;
  /** `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8`. */
  readonly parakeet: string;
  /** `kokoro-multi-lang-v1_0`. */
  readonly kokoro: string;
}

export function speechModelPaths(directory: string): SpeechModelPaths {
  return {
    vad: join(directory, "silero_vad.onnx"),
    parakeet: join(directory, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"),
    kokoro: join(directory, "kokoro-multi-lang-v1_0"),
  };
}

export const STT_SAMPLE_RATE = 16_000;
export const VAD_WINDOW = 512;

export function parakeetConfig(directory: string, numThreads = 2): unknown {
  return {
    featConfig: { sampleRate: STT_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: join(directory, "encoder.int8.onnx"), decoder: join(directory, "decoder.int8.onnx"), joiner: join(directory, "joiner.int8.onnx") },
      tokens: join(directory, "tokens.txt"), numThreads, provider: "cpu", debug: 0, modelType: "nemo_transducer",
    },
  };
}

export function kokoroConfig(directory: string, numThreads = 2): unknown {
  return {
    model: {
      kokoro: { model: join(directory, "model.onnx"), voices: join(directory, "voices.bin"), tokens: join(directory, "tokens.txt"), lexicon: join(directory, "lexicon-us-en.txt") },
      debug: false, numThreads, provider: "cpu",
    },
    maxNumSentences: 1,
  };
}

export function sileroConfig(path: string): unknown {
  return {
    sileroVad: { model: path, threshold: 0.5, minSpeechDuration: 0.1, minSilenceDuration: 0.1, windowSize: VAD_WINDOW },
    sampleRate: STT_SAMPLE_RATE, debug: false, numThreads: 1,
  };
}

/** Mono linear resampling, enough for speech into a 16 kHz recognizer. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const length = Math.floor((samples.length * to) / from);
  const out = new Float32Array(length);
  const step = from / to;
  for (let index = 0; index < length; index += 1) {
    const position = index * step;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = position - left;
    out[index] = samples[left]! * (1 - fraction) + samples[right]! * fraction;
  }
  return out;
}
