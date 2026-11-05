import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TalkSpeaker } from "./talkSession.js";
import { Phonemizer, type PhonemizedSentence } from "./phonemizer.js";
import { kokoroConfig, loadSherpa, type SherpaGeneratedAudio, type SherpaModule, type SherpaOfflineTts } from "./sherpa.js";
import { prepareSpokenText, spokenSentences } from "./spokenText.js";

/** Plays mono samples (the renderer, through Web Audio with echo cancellation on the mic). */
export interface AudioOutput {
  /** Resolves when the samples have played, or at once after `stop`. */
  play(samples: Float32Array, sampleRate: number): Promise<void>;
  stop(): void;
}

export interface KokoroSpeakerOptions {
  /** The `kokoro-multi-lang-v1_0` folder. */
  readonly directory: string;
  readonly output: AudioOutput;
  /** Kokoro voice id (0 is af_alloy in v1.0). */
  readonly voice?: number;
  readonly speed?: number;
  readonly numThreads?: number;
  readonly sherpa?: SherpaModule;
}

/**
 * Speaks with Kokoro (sherpa-onnx) sentence by sentence, so the first words play while later
 * sentences are still being made (Swift `TalkVoice`). Every sentence is normalized and
 * phonemized here and sent as phonemes, so names, numbers and codes are spoken, never
 * skipped.
 */
export class KokoroSpeaker implements TalkSpeaker {
  private tts: Promise<SherpaOfflineTts> | undefined;
  private phonemizer: Phonemizer | undefined;
  private vocabulary: ReadonlySet<string> | undefined;
  private token = 0;

  constructor(private readonly options: KokoroSpeakerOptions) {}

  /** Loads the voice and the lexicon (about a second); `speak` does this on first use. */
  async prepare(): Promise<void> {
    this.phonemizer ??= Phonemizer.fromLexiconFile(join(this.options.directory, "lexicon-us-en.txt"));
    this.vocabulary ??= new Set(readFileSync(join(this.options.directory, "tokens.txt"), "utf8").split("\n").map((line) => line.slice(0, line.lastIndexOf(" "))).filter((token) => token.length > 0));
    this.tts ??= (async () => (this.options.sherpa ?? (await loadSherpa())).OfflineTts.createAsync(kokoroConfig(this.options.directory, this.options.numThreads)))();
    await this.tts;
  }

  /** The phonemes Kokoro receives for `sentence`, limited to its vocabulary. */
  phonemize(sentence: string): PhonemizedSentence {
    if (this.phonemizer === undefined) throw new Error("prepare first");
    return this.phonemizer.sentence(sentence);
  }

  /** Synthesizes one sentence without playing it. */
  async synthesize(sentence: string): Promise<SherpaGeneratedAudio | undefined> {
    await this.prepare();
    const phonemes = [...this.phonemize(sentence).phonemes].filter((character) => this.vocabulary!.has(character));
    if (phonemes.every((character) => character === " ")) return undefined;
    const voice = this.options.voice ?? 0;
    const speed = this.options.speed ?? 1;
    return (await this.tts!).generateAsync({
      text: "", sid: voice, speed, enableExternalBuffer: false,
      generationConfig: { sid: voice, speed, phonemeCodepoints: [phonemes.map((character) => character.codePointAt(0)!)] },
    });
  }

  async speak(text: string): Promise<void> {
    const token = ++this.token;
    await this.prepare();
    for (const sentence of spokenSentences(prepareSpokenText(text))) {
      if (token !== this.token) return;
      const audio = await this.synthesize(sentence);
      if (token !== this.token) return;
      if (audio !== undefined) await this.options.output.play(audio.samples, audio.sampleRate);
    }
  }

  async stop(): Promise<void> {
    this.token += 1;
    this.options.output.stop();
  }
}
