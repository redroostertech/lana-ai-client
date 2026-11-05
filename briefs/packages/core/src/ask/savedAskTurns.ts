import type { LanaId } from "../ids/lanaId.js";
import { parseLanaId } from "../ids/lanaId.js";
import { KEY_POINT_KINDS, type KeyPointKind } from "../intent/keyPoint.js";
import type { AskAnswer, AskStatus, AskTurn } from "./askEngine.js";
import type { UnavailableReason } from "./backend.js";
import { PASSAGE_KINDS, type Passage, type PassageKind } from "./passage.js";

/**
 * A saved Ask conversation as both apps encode it (Swift `SavedAskTurns`). The store
 * seals the JSON at rest; it is never logged. Citations keep enough of each passage to
 * reopen the meeting at that moment, but not the passage text.
 */
export interface SavedCitation {
  readonly passageID: string;
  readonly title: string;
  readonly meetingID: string;
  readonly meetingTitle: string;
  readonly kind: string;
  readonly start: number;
  readonly end: number;
  readonly speakers: readonly string[];
  readonly keyPointKind?: string | undefined;
}

export interface SavedTurn {
  readonly question: string;
  readonly status: string;
  readonly answer: string;
  readonly citations: readonly SavedCitation[];
}

export interface SavedAskTurns {
  readonly version: number;
  readonly turns: readonly SavedTurn[];
}

export const SAVED_ASK_TURNS_VERSION = 1;
/** Swift `Date.distantPast`, 0001-01-01. */
const DISTANT_PAST = new Date(-62_135_596_800_000);

export function statusCode(answer: Pick<AskAnswer, "status" | "reason">): string {
  switch (answer.status) {
    case "answered":
      return "answered";
    case "notFound":
      return "not_found";
    case "declined":
      return "declined";
    case "suggested":
      return "suggested";
    case "passagesOnly":
      return answer.reason === "appleIntelligenceNotEnabled" ? "passages_only.apple_intelligence_off"
        : answer.reason === "modelNotReady" ? "passages_only.model_not_ready" : "passages_only";
  }
}

export function statusFromCode(code: string): { status: AskStatus; reason?: UnavailableReason } {
  switch (code) {
    case "answered":
      return { status: "answered" };
    case "declined":
      return { status: "declined" };
    case "suggested":
      return { status: "suggested" };
    case "passages_only.apple_intelligence_off":
      return { status: "passagesOnly", reason: "appleIntelligenceNotEnabled" };
    case "passages_only.model_not_ready":
      return { status: "passagesOnly", reason: "modelNotReady" };
    case "passages_only":
      return { status: "passagesOnly", reason: "other" };
    default:
      return { status: "notFound" };
  }
}

/** Answered turns as the engine shapes them; `title` names each citation chip. */
export function savedFromTurns(asked: readonly AskTurn[], title: (passage: Passage) => string = (passage) => passage.meetingTitle): SavedAskTurns {
  return {
    version: SAVED_ASK_TURNS_VERSION,
    turns: asked.map((turn) => ({
      question: turn.question,
      status: statusCode(turn.answer),
      answer: turn.answer.text,
      citations: turn.answer.citations.map((passage) => ({
        passageID: passage.id, title: title(passage), meetingID: passage.meetingID, meetingTitle: passage.meetingTitle,
        kind: passage.kind, start: passage.start, end: passage.end, speakers: passage.speakers, keyPointKind: passage.keyPointKind,
      })),
    })),
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => [key, sortKeys(object[key])]));
  }
  return value;
}

/** JSON with sorted keys (Swift `JSONEncoder` with `.sortedKeys`). Read back by both apps. */
export function encodeSavedAskTurns(saved: SavedAskTurns): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(sortKeys(saved)));
}

export class SavedAskTurnsError extends Error {
  constructor() {
    super("saved_ask_turns_unreadable");
    this.name = "SavedAskTurnsError";
  }
}

export function decodeSavedAskTurns(data: Uint8Array): SavedAskTurns {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new SavedAskTurnsError();
  }
  const object = raw as { version?: unknown; turns?: unknown };
  if (typeof object?.version !== "number" || !Array.isArray(object.turns)) throw new SavedAskTurnsError();
  const text = (value: unknown): string => {
    if (typeof value !== "string") throw new SavedAskTurnsError();
    return value;
  };
  const number = (value: unknown): number => {
    if (typeof value !== "number") throw new SavedAskTurnsError();
    return value;
  };
  return {
    version: object.version,
    turns: object.turns.map((turn: Record<string, unknown>) => ({
      question: text(turn["question"]),
      status: text(turn["status"]),
      answer: text(turn["answer"]),
      citations: (Array.isArray(turn["citations"]) ? turn["citations"] : (() => { throw new SavedAskTurnsError(); })()).map((citation: Record<string, unknown>) => ({
        passageID: text(citation["passageID"]),
        title: text(citation["title"]),
        meetingID: text(citation["meetingID"]),
        meetingTitle: text(citation["meetingTitle"]),
        kind: text(citation["kind"]),
        start: number(citation["start"]),
        end: number(citation["end"]),
        speakers: (Array.isArray(citation["speakers"]) ? citation["speakers"] : []).map(text),
        keyPointKind: citation["keyPointKind"] === undefined || citation["keyPointKind"] === null ? undefined : text(citation["keyPointKind"]),
      })),
    })),
  };
}

/**
 * The turns as the engine shapes them, so a reopened conversation renders and continues
 * like a live one. Citations whose meeting id no longer parses are dropped.
 */
export function askTurnsFromSaved(saved: SavedAskTurns, meetingDates: ReadonlyMap<LanaId, Date> = new Map()): AskTurn[] {
  return saved.turns.map((turn) => {
    const citations: Passage[] = [];
    for (const citation of turn.citations) {
      const meetingID = parseLanaId(citation.meetingID, "meeting");
      if (meetingID === null) continue;
      const kind: PassageKind = (PASSAGE_KINDS as readonly string[]).includes(citation.kind) ? citation.kind as PassageKind : "transcript";
      const keyPointKind = citation.keyPointKind !== undefined && (KEY_POINT_KINDS as readonly string[]).includes(citation.keyPointKind)
        ? citation.keyPointKind as KeyPointKind : undefined;
      citations.push({
        id: citation.passageID, meetingID, meetingTitle: citation.meetingTitle, meetingDate: meetingDates.get(meetingID) ?? DISTANT_PAST,
        kind, start: citation.start, end: citation.end, speakers: citation.speakers, text: "", keyPointKind,
      });
    }
    const { status, reason } = statusFromCode(turn.status);
    return { question: turn.question, answer: { status, reason, text: turn.answer, citations } };
  });
}
