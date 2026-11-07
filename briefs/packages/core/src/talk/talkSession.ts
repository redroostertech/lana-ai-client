import type { AskEngine, AskAnswer, AskTurn } from "../ask/askEngine.js";
import { SILENT_LOG, type HandoffLog } from "../handoff/log.js";
import { TurnTaker, type TalkEffect, type TalkEvent, type TalkExchange, type TalkPhase } from "./turnTaker.js";

export type TalkHearing =
  | { readonly kind: "speechStarted" }
  | { readonly kind: "partial"; readonly text: string }
  | { readonly kind: "endOfTurn"; readonly text: string };

/** Hears the person: voice activity plus transcription, end of turn included. */
export interface TalkListener {
  /** Starts listening and reports what it hears until `stop`. */
  start(onHearing: (hearing: TalkHearing) => void): Promise<void>;
  stop(): Promise<void>;
}

/** Speaks Lana's answer; `speak` resolves when finished or stopped. */
export interface TalkSpeaker {
  speak(text: string): Promise<void>;
  stop(): Promise<void>;
}

/** Answers a question from the meetings (implemented with `AskEngine`). */
export interface TalkAnswerer {
  answer(question: string, history: readonly AskTurn[], signal: AbortSignal): Promise<AskAnswer>;
}

export interface TalkSnapshot {
  readonly phase: TalkPhase;
  readonly exchanges: readonly TalkExchange[];
}

/** `TalkAnswerer` over the meetings' Ask engine. */
export class AskEngineAnswerer implements TalkAnswerer {
  constructor(private readonly engine: AskEngine) {}

  answer(question: string, history: readonly AskTurn[], signal: AbortSignal): Promise<AskAnswer> {
    return this.engine.ask(question, { history, signal });
  }
}

/**
 * Runs a spoken conversation (Swift `TalkSession`): applies `TurnTaker` rules to real
 * listening, answering and speaking, and publishes every change for the UI. Nothing heard
 * or said is stored or logged by the session; the caller decides whether to keep it.
 */
export class TalkSession {
  private readonly rules = new TurnTaker();
  private readonly listeners = new Set<(snapshot: TalkSnapshot) => void>();
  private queue: Promise<void> = Promise.resolve();
  private answerController: AbortController | undefined;
  private speakToken = 0;
  private listenToken = 0;

  constructor(
    private readonly listener: TalkListener,
    private readonly speaker: TalkSpeaker,
    private readonly answerer: TalkAnswerer,
    private readonly log: HandoffLog = SILENT_LOG,
  ) {}

  get snapshot(): TalkSnapshot {
    return { phase: this.rules.phase, exchanges: [...this.rules.exchanges] };
  }

  /** Every change, for the UI. Returns an unsubscribe function. */
  onSnapshot(listener: (snapshot: TalkSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<void> {
    return this.apply({ kind: "start" });
  }

  stop(): Promise<void> {
    return this.apply({ kind: "stop" });
  }

  /** Events are applied one at a time, in order, with their effects. */
  private apply(event: TalkEvent): Promise<void> {
    const run = this.queue.then(async () => {
      const effects = this.rules.handle(event);
      this.publish();
      for (const effect of effects) await this.perform(effect);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private publish(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  private async perform(effect: TalkEffect): Promise<void> {
    switch (effect.kind) {
      case "startListening": {
        const token = ++this.listenToken;
        this.listener.start((hearing) => {
          if (token !== this.listenToken) return;
          void this.apply(hearing.kind === "speechStarted" ? { kind: "speechStarted" } : hearing.kind === "partial" ? { kind: "partial", text: hearing.text } : { kind: "endOfTurn", text: hearing.text });
        }).catch(() => {
          this.log.error("talk.listening_failed");
          if (token === this.listenToken) void this.apply({ kind: "stop" });
        });
        return;
      }
      case "stopListening":
        this.listenToken += 1;
        await this.listener.stop();
        this.publish();
        return;
      case "stopSpeaking":
        this.speakToken += 1;
        await this.speaker.stop();
        return;
      case "cancelAnswer":
        this.answerController?.abort();
        this.answerController = undefined;
        return;
      case "ask": {
        this.answerController?.abort();
        const controller = new AbortController();
        this.answerController = controller;
        this.answerer.answer(effect.question, effect.history, controller.signal).then(
          (answer) => {
            if (!controller.signal.aborted) void this.apply({ kind: "answered", answer });
          },
          () => {
            if (!controller.signal.aborted) void this.apply({ kind: "answerFailed" });
          },
        );
        return;
      }
      case "speak": {
        const token = ++this.speakToken;
        this.speaker.speak(effect.text).catch(() => undefined).then(() => {
          if (token === this.speakToken) void this.apply({ kind: "finishedSpeaking" });
        });
        return;
      }
    }
  }
}
