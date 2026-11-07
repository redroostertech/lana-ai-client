import type { AskAnswer, AskTurn } from "../ask/askEngine.js";
import { graphemeCount } from "../text/graphemes.js";
import { trimWhitespace } from "../ask/askEngine.js";

/** `idle`, `listening`, `hearing` (live transcript), `thinking` (working out an answer), `speaking`. */
export type TalkPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "listening" }
  | { readonly kind: "hearing"; readonly partial: string }
  | { readonly kind: "thinking"; readonly question: string }
  | { readonly kind: "speaking"; readonly answer: AskAnswer; readonly spoken: string };

export type TalkEvent =
  | { readonly kind: "start" }
  | { readonly kind: "stop" }
  /** Voice detection heard speech begin. */
  | { readonly kind: "speechStarted" }
  | { readonly kind: "partial"; readonly text: string }
  /** The person finished their turn with this final transcript. */
  | { readonly kind: "endOfTurn"; readonly text: string }
  | { readonly kind: "answered"; readonly answer: AskAnswer }
  | { readonly kind: "answerFailed" }
  | { readonly kind: "finishedSpeaking" };

export type TalkEffect =
  | { readonly kind: "startListening" }
  | { readonly kind: "stopListening" }
  /** Silence Lana at once (barge-in or stop). */
  | { readonly kind: "stopSpeaking" }
  /** Abandon the answer being prepared. */
  | { readonly kind: "cancelAnswer" }
  | { readonly kind: "ask"; readonly question: string; readonly history: readonly AskTurn[] }
  | { readonly kind: "speak"; readonly text: string };

/** A completed exchange, for the on-screen conversation. */
export interface TalkExchange {
  readonly question: string;
  readonly answer: AskAnswer;
  /** True when the person cut Lana off before it finished. */
  readonly interrupted: boolean;
}

export const ANSWER_FAILED_SPEECH = "Sorry, I could not work that out. Try asking another way.";

/** What Lana says for each kind of answer. Citations stay on screen, not in speech. */
export function spokenForm(answer: AskAnswer): string {
  switch (answer.status) {
    case "answered":
      return answer.text;
    case "notFound":
      return "I could not find that in your meetings.";
    case "suggested":
      return `Here is a suggestion, not something said in the meeting. ${answer.text}`;
    case "declined":
      return "I would rather not answer that one, but the closest passages are on screen.";
    case "passagesOnly":
      // The native app names Apple Intelligence; on the desktop the model is a download.
      return answer.reason === "appleIntelligenceNotEnabled"
        ? "Apple Intelligence is off, so I can only show the closest passages on screen."
        : "The answer model is not downloaded yet, so I can only show the closest passages on screen.";
  }
}

/**
 * The rules of a spoken conversation with Lana, as a pure state machine (Swift
 * `TurnTaker`). The person talks; when they finish a turn Lana thinks, then answers out
 * loud. The person can cut in at any moment: Lana stops speaking at once, drops the answer
 * it was preparing, and listens. Brief noises never count as a turn.
 */
export class TurnTaker {
  private currentPhase: TalkPhase = { kind: "idle" };
  private readonly completed: TalkExchange[] = [];
  /** Turns shorter than this (characters) are treated as noise. */
  minimumQuestionLength = 3;
  /** How many recent exchanges travel with each question for follow-ups. */
  historyTurns = 3;

  get phase(): TalkPhase {
    return this.currentPhase;
  }

  get exchanges(): readonly TalkExchange[] {
    return this.completed;
  }

  /** Applies one event and returns what the session must do, in order. */
  handle(event: TalkEvent): TalkEffect[] {
    const phase = this.currentPhase;
    if (phase.kind === "idle" && event.kind === "start") {
      this.currentPhase = { kind: "listening" };
      return [{ kind: "startListening" }];
    }
    if (event.kind === "stop") {
      if (phase.kind === "idle") return [];
      this.currentPhase = { kind: "idle" };
      return [
        ...(phase.kind === "speaking" ? [{ kind: "stopSpeaking" } as const] : []),
        ...(phase.kind === "thinking" ? [{ kind: "cancelAnswer" } as const] : []),
        { kind: "stopListening" },
      ];
    }
    switch (event.kind) {
      case "speechStarted":
        if (phase.kind === "listening") {
          this.currentPhase = { kind: "hearing", partial: "" };
          return [];
        }
        if (phase.kind === "speaking") {
          // Barge-in: the person is talking over Lana.
          this.markLastInterrupted();
          this.currentPhase = { kind: "hearing", partial: "" };
          return [{ kind: "stopSpeaking" }];
        }
        if (phase.kind === "thinking") {
          // They kept talking (or corrected themselves) before Lana answered.
          this.currentPhase = { kind: "hearing", partial: "" };
          return [{ kind: "cancelAnswer" }];
        }
        return [];
      case "partial":
        if (phase.kind === "hearing" || phase.kind === "listening") this.currentPhase = { kind: "hearing", partial: event.text };
        return [];
      case "endOfTurn": {
        if (phase.kind !== "hearing" && phase.kind !== "listening") return [];
        const question = trimWhitespace(event.text);
        if (graphemeCount(question) < this.minimumQuestionLength) {
          this.currentPhase = { kind: "listening" };
          return [];
        }
        this.currentPhase = { kind: "thinking", question };
        return [{ kind: "ask", question, history: this.recentHistory() }];
      }
      case "answered": {
        if (phase.kind !== "thinking") return [];
        const spoken = spokenForm(event.answer);
        this.completed.push({ question: phase.question, answer: event.answer, interrupted: false });
        this.currentPhase = { kind: "speaking", answer: event.answer, spoken };
        return [{ kind: "speak", text: spoken }];
      }
      case "answerFailed": {
        if (phase.kind !== "thinking") return [];
        const answer: AskAnswer = { status: "notFound", text: "", citations: [] };
        this.completed.push({ question: phase.question, answer, interrupted: false });
        this.currentPhase = { kind: "speaking", answer, spoken: ANSWER_FAILED_SPEECH };
        return [{ kind: "speak", text: ANSWER_FAILED_SPEECH }];
      }
      case "finishedSpeaking":
        if (phase.kind === "speaking") this.currentPhase = { kind: "listening" };
        return [];
      default:
        // Late events from cancelled work (an answer after barge-in, a stale partial) are ignored.
        return [];
    }
  }

  private recentHistory(): AskTurn[] {
    return this.completed.slice(Math.max(0, this.completed.length - this.historyTurns)).map((exchange) => ({ question: exchange.question, answer: exchange.answer }));
  }

  private markLastInterrupted(): void {
    const last = this.completed[this.completed.length - 1];
    if (last !== undefined) this.completed[this.completed.length - 1] = { ...last, interrupted: true };
  }
}
