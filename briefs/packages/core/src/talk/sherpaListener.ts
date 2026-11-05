import { SILENT_LOG, type HandoffLog } from "../handoff/log.js";
import { Endpointing } from "./endpointing.js";
import { loadSherpa, parakeetConfig, resample, sileroConfig, STT_SAMPLE_RATE, VAD_WINDOW, type SherpaModule, type SherpaOfflineRecognizer, type SherpaVad } from "./sherpa.js";
import type { TalkHearing, TalkListener } from "./talkSession.js";

/** Microphone audio (the renderer captures with echo cancellation and sends mono samples). */
export interface AudioInput {
  start(onSamples: (samples: Float32Array, sampleRate: number) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface SherpaListenerOptions {
  readonly vadModel: string;
  /** The Parakeet TDT folder. */
  readonly parakeet: string;
  readonly input: AudioInput;
  readonly numThreads?: number;
  readonly sherpa?: SherpaModule;
  readonly log?: HandoffLog;
  /** Seconds of new speech between live partial transcripts. */
  readonly partialEvery?: number;
}

const PRE_ROLL_SECONDS = 0.4;

/**
 * Hears the person with Silero voice detection and Parakeet TDT, both on this computer
 * (Swift `TalkEar`). Voice edges drive `Endpointing`; the turn's audio (with a short
 * pre-roll) is transcribed for live partials while the person speaks and once more at the
 * end of the turn. Nothing heard is stored or logged.
 */
export class SherpaListener implements TalkListener {
  private recognizer: Promise<SherpaOfflineRecognizer> | undefined;
  private vad: SherpaVad | undefined;
  private running = false;
  private generation = 0;

  constructor(private readonly options: SherpaListenerOptions) {}

  /** Loads the voice detector and recognizer; `start` does this on first use. */
  async prepare(): Promise<void> {
    const sherpa = this.options.sherpa ?? (await loadSherpa());
    this.recognizer ??= sherpa.OfflineRecognizer.createAsync(parakeetConfig(this.options.parakeet, this.options.numThreads));
    this.vad ??= new sherpa.Vad(sileroConfig(this.options.vadModel), 30);
    await this.recognizer;
  }

  /** Transcribes 16 kHz mono audio. */
  async transcribe(samples: Float32Array): Promise<string> {
    await this.prepare();
    const recognizer = await this.recognizer!;
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: STT_SAMPLE_RATE, samples });
    return (await recognizer.decodeAsync(stream)).text.trim();
  }

  async start(onHearing: (hearing: TalkHearing) => void): Promise<void> {
    await this.prepare();
    const vad = this.vad!;
    vad.reset();
    const generation = ++this.generation;
    this.running = true;
    const log = this.options.log ?? SILENT_LOG;
    const partialEvery = (this.options.partialEvery ?? 1) * STT_SAMPLE_RATE;
    const endpoint = new Endpointing();
    let pending = new Float32Array(0);
    let elapsed = 0;
    let wasSpeech = false;
    let inTurn = false;
    let preRoll: Float32Array[] = [];
    let turn: Float32Array[] = [];
    let turnSamples = 0;
    let lastPartialAt = 0;
    let decoding = false;
    const live = (): boolean => this.running && generation === this.generation;
    const joined = (): Float32Array => {
      const out = new Float32Array(turn.reduce((sum, part) => sum + part.length, 0));
      let offset = 0;
      for (const part of turn) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    };

    const onWindow = (window: Float32Array): void => {
      vad.acceptWaveform(window);
      while (!vad.isEmpty()) vad.pop();
      elapsed += window.length / STT_SAMPLE_RATE;
      const speech = vad.isDetected();
      const signals: (string | undefined)[] = [];
      if (speech && !wasSpeech) {
        endpoint.speechStarted(elapsed);
        if (!inTurn) {
          inTurn = true;
          turn = [...preRoll];
          turnSamples = turn.reduce((sum, part) => sum + part.length, 0);
          lastPartialAt = turnSamples;
        }
      }
      if (!speech && wasSpeech) signals.push(endpoint.speechEnded(elapsed));
      wasSpeech = speech;
      signals.push(endpoint.tick(elapsed));
      if (inTurn) {
        turn.push(window);
        turnSamples += window.length;
      } else {
        preRoll.push(window);
        while (preRoll.length * VAD_WINDOW > PRE_ROLL_SECONDS * STT_SAMPLE_RATE) preRoll.shift();
      }
      for (const signal of signals) {
        if (signal === "turnStarted") onHearing({ kind: "speechStarted" });
        if (signal === "turnEnded") {
          const audio = joined();
          inTurn = false;
          turn = [];
          preRoll = [];
          this.transcribe(audio).then((text) => {
            if (live()) onHearing({ kind: "endOfTurn", text });
          }, () => log.error("talk.recognizer_failed"));
        }
      }
      // Too short to be a turn: Endpointing forgot it, so drop the audio too.
      if (inTurn && !speech && !endpoint.isTracking) {
        inTurn = false;
        turn = [];
      }
      if (inTurn && !decoding && turnSamples - lastPartialAt >= partialEvery) {
        decoding = true;
        lastPartialAt = turnSamples;
        this.transcribe(joined()).then((text) => {
          if (live() && inTurn && text.length > 0) onHearing({ kind: "partial", text });
        }, () => log.error("talk.recognizer_failed")).finally(() => {
          decoding = false;
        });
      }
    };

    await this.options.input.start((samples, sampleRate) => {
      if (!live()) return;
      const converted = resample(samples, sampleRate, STT_SAMPLE_RATE);
      const merged = new Float32Array(pending.length + converted.length);
      merged.set(pending);
      merged.set(converted, pending.length);
      let offset = 0;
      for (; offset + VAD_WINDOW <= merged.length; offset += VAD_WINDOW) onWindow(merged.slice(offset, offset + VAD_WINDOW));
      pending = merged.slice(offset);
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.generation += 1;
    await this.options.input.stop();
  }
}
