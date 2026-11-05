import { join } from "node:path";
import { loadSherpa, parakeetConfig } from "../talk/sherpa.js";
import { mergeSpeakers, sourceOf, type HeardSegment, type MergedTranscript, type SpeakerTurn } from "./diarizationMerge.js";
import { channelEnergy, mixChannels, TRANSCRIPTION_SAMPLE_RATE, type TwoChannels } from "./pcm.js";

/** Where the models for whole-meeting transcription live (the speech models folder). */
export interface TranscriptionModelPaths {
  /** `silero_vad.onnx`. */
  readonly vad: string;
  /** The Parakeet TDT folder. */
  readonly parakeet: string;
  /** `model.int8.onnx` of the pyannote segmentation export. */
  readonly segmentation: string;
  /** The speaker embedding model. */
  readonly embedding: string;
}

export function transcriptionModelPaths(directory: string): TranscriptionModelPaths {
  return {
    vad: join(directory, "silero_vad.onnx"),
    parakeet: join(directory, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"),
    segmentation: join(directory, "sherpa-onnx-pyannote-segmentation-3-0", "model.int8.onnx"),
    embedding: join(directory, "nemo_en_titanet_small.onnx"),
  };
}

/** Provenance names for a meeting transcribed here. */
export const ASR_MODEL_ID = "parakeet-tdt-0.6b-v2-int8";
export const DIARIZATION_MODEL_ID = "pyannote-segmentation-3.0+titanet-small";

/** The slice of `sherpa-onnx-node` 2.x whole-meeting transcription uses. */
export interface TranscriptionSherpa {
  OfflineRecognizer: { createAsync(config: unknown): Promise<{ createStream(): { acceptWaveform(audio: { sampleRate: number; samples: Float32Array }): void }; decodeAsync(stream: unknown): Promise<{ text: string }> }> };
  Vad: new (config: unknown, bufferSizeInSeconds: number) => TranscriptionVad;
  OfflineSpeakerDiarization: new (config: unknown) => { process(samples: Float32Array): SpeakerTurn[] };
}

export interface TranscriptionVad {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  front(enableExternalBuffer?: boolean): { samples: Float32Array; start: number };
  pop(): void;
  flush(): void;
  reset(): void;
}

/** A line heard while recording, before speakers are worked out: S1 when it came through the mic, else S2. */
export interface LiveLine {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly speaker: string;
}

const VAD_WINDOW = 512;
/** Longer speech is cut into pieces the recognizer handles well. */
const MAX_SPEECH_SECONDS = 20;

export function meetingVadConfig(path: string): unknown {
  return {
    sileroVad: { model: path, threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.5, maxSpeechDuration: MAX_SPEECH_SECONDS, windowSize: VAD_WINDOW },
    sampleRate: TRANSCRIPTION_SAMPLE_RATE, debug: false, numThreads: 1,
  };
}

export function diarizationConfig(models: TranscriptionModelPaths, numThreads: number): unknown {
  return {
    segmentation: { pyannote: { model: models.segmentation }, numThreads, provider: "cpu", debug: 0 },
    embedding: { model: models.embedding, numThreads, provider: "cpu", debug: 0 },
    // Distance at which two voices count as one person. Higher merges more.
    clustering: { numClusters: -1, threshold: 0.65 },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  };
}

/** Speech found by voice detection: where it starts (seconds) and its samples. */
interface Speech {
  readonly start: number;
  readonly samples: Float32Array;
}

/**
 * Whole-meeting speech to text with speaker labels, all on this computer (Swift
 * `SpeechPipeline`): Silero voice detection finds speech in the mixed 16 kHz track,
 * Parakeet TDT transcribes each stretch, the pyannote segmentation and speaker embedding
 * models separate the voices, and `mergeSpeakers` names them S1, S2... using the mic and
 * system channels as a strong hint. While recording, `pushLive` transcribes speech as each
 * stretch ends (a preview; the full pass after Stop replaces it). Nothing heard is logged.
 * Runs in a worker thread in the app, because diarization blocks while it works.
 */
export class MeetingTranscriber {
  private recognizer: ReturnType<TranscriptionSherpa["OfflineRecognizer"]["createAsync"]> | undefined;
  private sherpa: TranscriptionSherpa | undefined;
  private liveVad: TranscriptionVad | undefined;
  private liveCarry = new Float32Array(0);
  private liveMic: Float32Array[] = [];
  private liveSystem: Float32Array[] = [];
  private liveOffset = 0;

  constructor(private readonly options: { readonly models: TranscriptionModelPaths; readonly numThreads?: number; readonly sherpa?: TranscriptionSherpa }) {}

  // MARK: - Live

  /** Adds the next frames (16 kHz, both channels) and returns the lines that just ended. */
  async pushLive(channels: TwoChannels): Promise<LiveLine[]> {
    const sherpa = await this.module();
    this.liveVad ??= new sherpa.Vad(meetingVadConfig(this.options.models.vad), 60);
    this.liveMic.push(channels.mic);
    this.liveSystem.push(channels.system);
    const mixed = mixChannels(channels);
    const data = new Float32Array(this.liveCarry.length + mixed.length);
    data.set(this.liveCarry);
    data.set(mixed, this.liveCarry.length);
    let at = 0;
    for (; at + VAD_WINDOW <= data.length; at += VAD_WINDOW) this.liveVad.acceptWaveform(data.subarray(at, at + VAD_WINDOW));
    this.liveCarry = data.slice(at);
    return this.drainLive();
  }

  /** The speech still open when recording stops. */
  async flushLive(): Promise<LiveLine[]> {
    if (this.liveVad === undefined) return [];
    this.liveVad.flush();
    return this.drainLive();
  }

  // MARK: - Whole meeting

  /** Transcribes and labels the whole meeting. `progress` runs from 0 to 1. */
  async transcribe(channels: TwoChannels, progress: (fraction: number) => void = () => undefined): Promise<MergedTranscript> {
    const sherpa = await this.module();
    const mixed = mixChannels(channels);
    const speech = detectSpeech(sherpa, this.options.models.vad, mixed);
    progress(0.05);
    const heard: HeardSegment[] = [];
    for (const [index, stretch] of speech.entries()) {
      const text = await this.recognize(stretch.samples);
      const end = stretch.start + stretch.samples.length / TRANSCRIPTION_SAMPLE_RATE;
      if (text !== "") heard.push({ start: stretch.start, end, text, ...channelEnergy(channels, stretch.start, end) });
      progress(0.05 + 0.75 * ((index + 1) / speech.length));
    }
    progress(0.8);
    let turns: SpeakerTurn[] = [];
    if (heard.length > 0) {
      const diarizer = new sherpa.OfflineSpeakerDiarization(diarizationConfig(this.options.models, this.options.numThreads ?? 2));
      turns = diarizer.process(mixed).map((turn) => ({ start: turn.start, end: turn.end, speaker: turn.speaker }));
    }
    progress(1);
    return mergeSpeakers(heard, turns);
  }

  // MARK: - Private

  private async module(): Promise<TranscriptionSherpa> {
    this.sherpa ??= this.options.sherpa ?? ((await loadSherpa()) as unknown as TranscriptionSherpa);
    return this.sherpa;
  }

  private async recognize(samples: Float32Array): Promise<string> {
    const sherpa = await this.module();
    this.recognizer ??= sherpa.OfflineRecognizer.createAsync(parakeetConfig(this.options.models.parakeet, this.options.numThreads ?? 2));
    const recognizer = await this.recognizer;
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: TRANSCRIPTION_SAMPLE_RATE, samples });
    return (await recognizer.decodeAsync(stream)).text.trim();
  }

  private async drainLive(): Promise<LiveLine[]> {
    const vad = this.liveVad!;
    const lines: LiveLine[] = [];
    while (!vad.isEmpty()) {
      const segment = vad.front(false);
      vad.pop();
      const start = segment.start / TRANSCRIPTION_SAMPLE_RATE;
      const end = start + segment.samples.length / TRANSCRIPTION_SAMPLE_RATE;
      const text = await this.recognize(Float32Array.from(segment.samples));
      if (text === "") continue;
      const energy = this.liveEnergy(start, end);
      lines.push({ start, end, text, speaker: sourceOf(energy) === "system" ? "S2" : "S1" });
    }
    this.trimLive();
    return lines;
  }

  /** Channel loudness over a live line, from the frames kept since the last trim. */
  private liveEnergy(start: number, end: number): { mic: number; system: number } {
    const join = (parts: Float32Array[]): Float32Array => {
      const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of parts) {
        out.set(part, at);
        at += part.length;
      }
      return out;
    };
    const offset = this.liveOffset;
    return channelEnergy({ mic: join(this.liveMic), system: join(this.liveSystem) }, start - offset, end - offset);
  }

  /** Keeps the last 30 s of frames for line energies, so memory stays flat over a long meeting. */
  private trimLive(): void {
    const keep = 30 * TRANSCRIPTION_SAMPLE_RATE;
    let total = this.liveMic.reduce((sum, part) => sum + part.length, 0);
    while (this.liveMic.length > 1 && total - this.liveMic[0]!.length >= keep) {
      total -= this.liveMic[0]!.length;
      this.liveOffset += this.liveMic[0]!.length / TRANSCRIPTION_SAMPLE_RATE;
      this.liveMic.shift();
      this.liveSystem.shift();
    }
  }
}

/** Speech stretches in a 16 kHz track, each at most `MAX_SPEECH_SECONDS` long. */
function detectSpeech(sherpa: TranscriptionSherpa, vadModel: string, samples: Float32Array): Speech[] {
  const vad = new sherpa.Vad(meetingVadConfig(vadModel), 60);
  const out: Speech[] = [];
  const drain = (): void => {
    while (!vad.isEmpty()) {
      const segment = vad.front(false);
      vad.pop();
      out.push({ start: segment.start / TRANSCRIPTION_SAMPLE_RATE, samples: Float32Array.from(segment.samples) });
    }
  };
  for (let at = 0; at + VAD_WINDOW <= samples.length; at += VAD_WINDOW) {
    vad.acceptWaveform(samples.subarray(at, at + VAD_WINDOW));
    drain();
  }
  vad.flush();
  drain();
  return out;
}
