import type { AskTurn } from "@lana/core/ask";
import type { SettingsRepository } from "@lana/core/store";
import { TalkSession, type TalkAnswerer, type TalkListener, type TalkSnapshot, type TalkSpeaker } from "@lana/core/talk";
import type { AskCitation, AskScope, PlatformInfo, TalkApi, TalkDownloads, TalkExchange, TalkOrbPhase, TalkSession as TalkSessionView, TalkState, VoiceOption } from "../../../shared/api.js";
import type { MainLog } from "../../log.js";
import { statusMessage } from "../ask/askService.js";
import { readVoice, VOICE_SETTING_KEYS } from "../preferencesService.js";
import { MuteGate } from "./muteGate.js";

/** Swift `SettingKey.talkIntroAccepted`. */
export const TALK_INTRO_ACCEPTED = "talk.intro_accepted";
const HISTORY_COUNT = 3;
const LEVEL_STEP = 0.05;
const LEVEL_INTERVAL_MS = 100;

/** Everything for one conversation, loaded and ready to start (Swift `TalkParts`). */
export interface TalkParts {
  readonly listener: TalkListener;
  readonly speaker: TalkSpeaker;
  readonly answerer: TalkAnswerer;
  /** Mutes capture at the microphone itself (nothing captured while muted). */
  setMicrophoneMuted(muted: boolean): void;
  /** Microphone levels (0 to 1) for the orb; null to stop. */
  onLevel(listener: ((level: number) => void) | null): void;
  /** The talk ended: speech models may be freed. */
  release(): void;
}

/** Builds talks (Swift `TalkSessionFactory`). The device one hears and speaks on this computer; tests pass fakes. */
export interface TalkPartsFactory {
  requestMicrophone(): Promise<boolean>;
  listenerReady(): boolean;
  /** The one-time listener download, reporting 0 to 1. */
  prepareListener(progress: (fraction: number) => void): Promise<void>;
  voiceReady(): boolean;
  /** The one-time LANA voice download, reporting 0 to 1. */
  prepareVoice(progress: (fraction: number) => void): Promise<void>;
  /** The size of these downloads together, "833 MB". */
  downloadSizeText(needs: TalkDownloads): string;
  /** "off" makes a silent speaker: answers show as text only. */
  makeParts(scope: AskScope, voice: VoiceOption): Promise<TalkParts>;
}

/** What Talk needs from Ask: titles, chips and saving the conversation as a thread. */
export interface TalkAskBridge {
  scopeTitle(scope: AskScope): string;
  citations(answer: AskTurn["answer"], scope: "always"): AskCitation[];
  save(threadID: null, scope: AskScope, turns: readonly AskTurn[]): string | null;
  threadsChanged(): void;
}

export interface TalkServiceOptions {
  readonly factory: TalkPartsFactory;
  readonly ask: TalkAskBridge;
  readonly settings: SettingsRepository;
  readonly platform: PlatformInfo;
  readonly emit: (session: TalkSessionView) => void;
  readonly log: MainLog;
  /** Signed in and LANA Briefs on for the organization; Talk does not open otherwise. */
  readonly allowed: () => boolean;
}

type Phase = "idle" | "intro" | "starting" | "running" | "failed";

/**
 * "Talk with LANA" in real mode (Swift `TalkViewModel`): the intro and the one-time
 * downloads (LANA listening, and the LANA voice unless the voice is off), then a hands-free
 * conversation over the scope chosen on the Ask page, run by core's `TalkSession`. With the
 * voice off, answers show as text and nothing is spoken. The person can cut in at any moment. When a talk ends its answered exchanges are saved as an
 * Ask conversation. Nothing heard or said is logged.
 */
export class TalkService implements TalkApi {
  private scope: AskScope = { kind: "all" };
  private state: TalkState = { kind: "idle" };
  private talk: TalkSession | null = null;
  private gate: MuteGate | null = null;
  private parts: TalkParts | null = null;
  private unsubscribe: (() => void) | null = null;
  private exchanges: TalkExchange[] = [];
  private snapshot: TalkSnapshot | null = null;
  private muted = false;
  private level = 0;
  private levelPublishedAt = 0;
  private ending = false;
  /** Bumped whenever a talk ends or is abandoned, so late work from it is dropped. */
  private generation = 0;

  constructor(private readonly options: TalkServiceOptions) {}

  // MARK: - TalkApi

  async session(): Promise<TalkSessionView> {
    return this.view();
  }

  /**
   * Opens Talk over `scope`. The first time, the intro explains it; whenever LANA listening
   * or the chosen LANA voice is not downloaded yet, it asks before downloading anything.
   */
  async start(scope: AskScope): Promise<TalkSessionView> {
    if ((this.state.kind !== "idle" && this.state.kind !== "failed") || !this.options.allowed()) return this.view();
    this.generation += 1;
    this.scope = scope?.kind === "meeting" && typeof scope.meetingID === "string" ? { kind: "meeting", meetingID: scope.meetingID } : { kind: "all" };
    const needs = this.needs();
    if (this.introSeen && !needs.listener && !needs.voice) {
      void this.begin();
    } else {
      this.state = { kind: "intro", intro: { kind: "ready" } };
    }
    return this.publish();
  }

  /** The intro's button: downloads what is missing (listening, then the voice), then starts. */
  async acceptIntro(): Promise<TalkSessionView> {
    if (this.state.kind !== "intro" || this.state.intro.kind === "downloading") return this.view();
    const current = this.generation;
    const needs = this.needs();
    const steps: Array<(progress: (fraction: number) => void) => Promise<void>> = [];
    if (needs.listener) steps.push((progress) => this.options.factory.prepareListener(progress));
    if (needs.voice) steps.push((progress) => this.options.factory.prepareVoice(progress));
    this.state = { kind: "intro", intro: { kind: "downloading", progress: steps.length === 0 ? null : 0 } };
    let shown = 0;
    const report = (index: number) => (fraction: number) => {
      const overall = (index + fraction) / steps.length;
      if (current !== this.generation || this.state.kind !== "intro" || overall - shown < 0.01) return;
      shown = overall;
      this.state = { kind: "intro", intro: { kind: "downloading", progress: overall } };
      this.publish();
    };
    void steps.reduce<Promise<void>>((done, step, index) => done.then(() => step(report(index))), Promise.resolve()).then(
      () => {
        if (current !== this.generation) return;
        this.options.settings.set(TALK_INTRO_ACCEPTED, "1");
        void this.begin();
      },
      () => {
        if (current !== this.generation) return;
        this.state = { kind: "intro", intro: { kind: "failed", message: "The download did not finish. Check the connection and try again." } };
        this.publish();
      },
    );
    return this.publish();
  }

  /** Mute mic (M): LANA stops hearing until unmuted. Speaking and thinking carry on. */
  async toggleMute(): Promise<TalkSessionView> {
    if (this.state.kind !== "running" || this.gate === null) return this.view();
    this.muted = !this.muted;
    this.gate.setMuted(this.muted);
    this.parts?.setMicrophoneMuted(this.muted);
    this.level = 0;
    this.render();
    return this.publish();
  }

  /** Ends the talk (End, Escape, closing the window) and saves what was answered. */
  async end(): Promise<TalkSessionView> {
    switch (this.state.kind) {
      case "idle":
        return this.view();
      case "running":
        await this.finish(null);
        return this.view();
      default:
        this.generation += 1;
        this.state = { kind: "idle" };
        return this.publish();
    }
  }

  // MARK: - Public

  /** LANA went to the background: ends the talk only when Settings asks for it. */
  appResignedActive(): void {
    if (this.options.settings.get(VOICE_SETTING_KEYS.endWhenInactive) === "true") void this.end();
  }

  /** The voice choice in Settings: "lana" speaks answers, "off" shows them as text only. */
  get voice(): VoiceOption {
    return readVoice(this.options.settings);
  }

  // MARK: - Private

  private get introSeen(): boolean {
    return this.options.settings.get(TALK_INTRO_ACCEPTED) === "1";
  }

  /** What is missing before a talk can start. The voice only counts while it is chosen. */
  private needs(): TalkDownloads {
    return { listener: !this.options.factory.listenerReady(), voice: this.voice === "lana" && !this.options.factory.voiceReady() };
  }

  private async begin(): Promise<void> {
    const current = this.generation;
    this.state = { kind: "starting" };
    this.publish();
    if (!(await this.options.factory.requestMicrophone())) {
      if (current === this.generation) this.fail(this.microphoneMessage());
      return;
    }
    let parts: TalkParts;
    try {
      parts = await this.options.factory.makeParts(this.scope, this.voice);
    } catch (error) {
      this.options.log.error("talk.prepare_failed", { kind: error instanceof Error ? error.name : "unknown" });
      if (current === this.generation) this.fail("LANA could not get ready to talk. Try again.");
      return;
    }
    if (current !== this.generation) {
      parts.release();
      return;
    }
    const gate = new MuteGate(parts.listener);
    const session = new TalkSession(gate, parts.speaker, parts.answerer, this.options.log);
    this.parts = parts;
    this.gate = gate;
    this.talk = session;
    this.exchanges = [];
    this.snapshot = null;
    this.muted = false;
    this.level = 0;
    this.unsubscribe = session.onSnapshot((snapshot) => this.apply(snapshot, current));
    parts.onLevel((level) => this.updateLevel(level, current));
    this.state = { kind: "running", orb: "listening", muted: false, level: 0, caption: null, current: null, history: [] };
    this.publish();
    this.options.log.info("talk.started", { scope: this.scope.kind, voice: this.voice });
    await session.start();
  }

  private apply(snapshot: TalkSnapshot, current: number): void {
    if (current !== this.generation || this.ending || this.state.kind !== "running") return;
    this.snapshot = snapshot;
    snapshot.exchanges.forEach((exchange, index) => {
      const existing = this.exchanges[index];
      if (existing !== undefined) {
        existing.interrupted = exchange.interrupted;
        return;
      }
      this.exchanges.push({
        id: index,
        question: exchange.question,
        text: exchange.answer.text.length > 0 ? exchange.answer.text : (statusMessage(exchange.answer, this.options.platform.deviceNoun) ?? ""),
        citations: this.options.ask.citations(exchange.answer, "always"),
        interrupted: exchange.interrupted,
      });
    });
    if (snapshot.phase.kind === "idle") {
      // The listener stopped on its own (the microphone was refused or went away).
      void this.finish(this.microphoneStoppedMessage());
      return;
    }
    this.render();
    this.publish();
  }

  private updateLevel(level: number, current: number): void {
    if (current !== this.generation || this.state.kind !== "running") return;
    const shown = this.muted || this.state.orb !== "hearing" ? 0 : level;
    const now = Date.now();
    if (Math.abs(shown - this.level) < LEVEL_STEP || now - this.levelPublishedAt < LEVEL_INTERVAL_MS) return;
    this.level = shown;
    this.levelPublishedAt = now;
    this.state = { ...this.state, level: shown };
    this.publish();
  }

  /** The running state from the latest snapshot (Swift `TalkViewModel` caption, current, history). */
  private render(): void {
    if (this.state.kind !== "running") return;
    const phase = this.snapshot?.phase ?? { kind: "listening" as const };
    const orb: TalkOrbPhase = phase.kind === "idle" ? "listening" : phase.kind;
    const caption = phase.kind === "hearing" ? (phase.partial.length > 0 ? phase.partial : null) : phase.kind === "thinking" ? phase.question : null;
    const current = orb === "speaking" || orb === "listening" ? (this.exchanges.at(-1) ?? null) : null;
    const earlier = current === null ? this.exchanges : this.exchanges.slice(0, -1);
    this.state = {
      kind: "running",
      orb,
      muted: this.muted,
      level: orb === "hearing" && !this.muted ? this.level : 0,
      caption,
      current: current === null ? null : { ...current },
      history: earlier.slice(-HISTORY_COUNT).map((exchange) => ({ ...exchange })),
    };
  }

  private async finish(failure: string | null): Promise<void> {
    const session = this.talk;
    if (this.ending || session === null) return;
    this.ending = true;
    this.generation += 1;
    await session.stop();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.parts?.onLevel(null);
    this.parts?.release();
    const final = session.snapshot.exchanges;
    this.talk = null;
    this.gate = null;
    this.parts = null;
    this.save(final.map((exchange) => ({ question: exchange.question, answer: exchange.answer })));
    this.exchanges = [];
    this.snapshot = null;
    this.muted = false;
    this.level = 0;
    this.ending = false;
    this.options.log.info("talk.ended", { exchanges: final.length, failed: failure !== null });
    this.state = failure === null ? { kind: "idle" } : { kind: "failed", message: failure };
    this.publish();
  }

  /** Saves the answered exchanges as an Ask conversation. Sealed by the store; never logged. */
  private save(turns: AskTurn[]): void {
    if (turns.length === 0) return;
    try {
      if (this.options.ask.save(null, this.scope, turns) !== null) this.options.ask.threadsChanged();
    } catch {
      this.options.log.error("talk.save_failed");
    }
  }

  private fail(message: string): void {
    this.state = { kind: "failed", message };
    this.publish();
  }

  private microphoneMessage(): string {
    return this.options.platform.os === "mac"
      ? "LANA needs the microphone to talk. Allow it in System Settings, Privacy and Security, Microphone."
      : "LANA needs the microphone to talk. Allow it in Settings, Privacy and security, Microphone.";
  }

  private microphoneStoppedMessage(): string {
    return this.options.platform.os === "mac"
      ? "LANA stopped listening. Check that the microphone is allowed for LANA in System Settings."
      : "LANA stopped listening. Check that the microphone is allowed for LANA in Settings.";
  }

  private view(): TalkSessionView {
    const needs = this.needs();
    return {
      scope: this.scope,
      scopeTitle: this.options.ask.scopeTitle(this.scope),
      state: this.state,
      introSeen: this.introSeen,
      voice: this.voice,
      needs,
      downloadSizeText: needs.listener || needs.voice ? this.options.factory.downloadSizeText(needs) : "",
    };
  }

  private publish(): TalkSessionView {
    const view = this.view();
    this.options.emit(view);
    return view;
  }
}
