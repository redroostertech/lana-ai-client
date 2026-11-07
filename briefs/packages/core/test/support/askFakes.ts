import type { AnswerBackend, AnswerRequest, ModelAnswer } from "../../src/ask/index.js";
import { AVAILABLE, BackendError, type BackendAvailability } from "../../src/ask/index.js";
import { makeLanaId } from "../../src/ids/lanaId.js";
import type { MeetingNotes, MeetingRecord } from "../../src/intent/index.js";
import type { TextModel, TextModelRequest } from "../../src/runtime/index.js";

export function meeting(turns: readonly [string, number, string][], options: { title?: string; notes?: MeetingNotes } = {}): MeetingRecord {
  return {
    schema: "lana.meeting/v1", id: makeLanaId("meeting"), title: options.title ?? "Acme intake",
    startedAt: new Date(1_800_000_000_000), durationSeconds: turns[turns.length - 1]?.[1] ?? 0,
    speakers: [{ id: "S1", name: "Dana Reyes" }, { id: "S2", name: "Mike" }],
    transcript: turns.map(([speaker, start, text]) => ({ speaker, start, end: start + 8, text })),
    notes: options.notes ?? { keyPoints: [], gaps: [] }, intents: [], userNotes: [], clips: [],
    consent: { method: "verbal_announced", confirmedBy: ["Dana"], confirmedAt: new Date() },
    provenance: { asrModel: "a", diarizationModel: "d", notesModel: "n", appVersion: "1" },
  };
}

export const intake = meeting([
  ["S1", 0, "Thanks for meeting with us about the vendor contracts."],
  ["S2", 30, "Happy to. What is the timeline?"],
  ["S1", 60, "Our deposition of Dr. Solberg is scheduled for December 2 in Atlanta."],
  ["S2", 90, "And the engagement letter?"],
  ["S1", 120, "Please send the engagement letter by Friday so we can start."],
], {
  notes: {
    keyPoints: [
      { id: "kp-1", kind: "summary", text: "Acme wants outside counsel for 2027 vendor contracts.", sources: [{ start: 0, end: 8, speaker: "S1" }], precision: "exact" },
      { id: "kp-2", kind: "decision", text: "Engagement letter goes out Friday.", sources: [{ start: 120, end: 128, speaker: "S1" }], precision: "exact" },
    ],
    gaps: [],
  },
});

/** Records requests and returns a scripted answer. */
export class ScriptedBackend implements AnswerBackend {
  available: BackendAvailability = AVAILABLE;
  readonly requests: AnswerRequest[] = [];
  readonly modelID = "scripted";

  constructor(private readonly reply: (request: AnswerRequest) => ModelAnswer) {}

  async availability(): Promise<BackendAvailability> {
    return this.available;
  }

  async answer(request: AnswerRequest): Promise<ModelAnswer> {
    this.requests.push(request);
    return this.reply(request);
  }
}

export const fact = (answer: string, citations: readonly string[], answerable = true): ModelAnswer => ({ answerable, answer, citations, kind: "fact" });

/** A `TextModel` that replays scripted replies, records every call and streams three characters at a time. */
export class ScriptedTextModel implements TextModel {
  readonly calls: { instructions: string; prompt: string; temperature: number; maximumResponseTokens: number }[] = [];
  availabilityValue: BackendAvailability = AVAILABLE;
  readonly modelID = "scripted";

  constructor(private readonly replies: (string | BackendError)[]) {}

  async availability(): Promise<BackendAvailability> {
    return this.availabilityValue;
  }

  async respond(request: TextModelRequest): Promise<string> {
    this.calls.push({ instructions: request.instructions, prompt: request.prompt, temperature: request.temperature, maximumResponseTokens: request.maximumResponseTokens });
    const next = this.replies.shift() ?? BackendError.failed("script_exhausted");
    if (next instanceof BackendError) throw next;
    for (let index = 3; index < next.length + 3; index += 3) request.onText?.(next.slice(0, Math.min(index, next.length)));
    return next;
  }
}
