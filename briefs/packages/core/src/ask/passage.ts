import type { LanaId } from "../ids/lanaId.js";
import { displayNameFor, type MeetingRecord } from "../intent/meeting.js";
import { keyPointStart, type KeyPointKind } from "../intent/keyPoint.js";
import { regardingOf, titleOf } from "../intent/params.js";
import { graphemeCount } from "../text/graphemes.js";
import { isBlank } from "../text/whitespace.js";

export const PASSAGE_KINDS = ["transcript", "keyPoint", "userNote", "action"] as const;
/**
 * `transcript`: a short run of consecutive turns. `keyPoint`: one AI note, `start`/`end`
 * cover the audio it came from. `userNote`: the person's own note, `start` is when it was
 * typed during recording. `action`: a proposed or executed action with its evidence.
 */
export type PassageKind = (typeof PASSAGE_KINDS)[number];

/**
 * A citable slice of a meeting. Answers cite passages, and the app turns a citation
 * into a jump to that moment.
 */
export interface Passage {
  /** Stable within one index, for example `mtg_01...#t12`. */
  readonly id: string;
  readonly meetingID: LanaId;
  readonly meetingTitle: string;
  readonly meetingDate: Date;
  readonly kind: PassageKind;
  /** Seconds from the start of the recording; zero for notes. */
  readonly start: number;
  readonly end: number;
  /** Display names of the people speaking in this passage. */
  readonly speakers: readonly string[];
  /** Text as shown to the model and the person: `Name: words` per turn. */
  readonly text: string;
  readonly keyPointKind?: KeyPointKind | undefined;
}

/** True when this passage points at a moment in the recording that can be played. */
export function hasAudioMoment(passage: Passage): boolean {
  return passage.kind === "userNote" ? passage.start > 0 : passage.end > passage.start;
}

/** Same conservative estimate as the summarizer's heuristic counter. */
export function estimateTokens(text: string): number {
  return Math.ceil(graphemeCount(text) / 3.5);
}

const KEY_POINT_LABELS: Record<KeyPointKind, string> = { summary: "Key point", decision: "Decision", open_question: "Open question" };

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Splits meetings into passages small enough that several fit in one model session. */
export class PassageBuilder {
  /**
   * @param targetTokens target size of a transcript passage, in estimated tokens.
   * @param overlapTurns turns repeated at the start of the next passage so an answer
   *   that spans a boundary is still found in one passage.
   */
  constructor(readonly targetTokens = 220, readonly overlapTurns = 1) {}

  passages(meeting: MeetingRecord): Passage[] {
    const result: Passage[] = [];
    const make = (suffix: string, kind: PassageKind, start: number, end: number, speakers: readonly string[], text: string, keyPointKind?: KeyPointKind): Passage => ({
      id: `${meeting.id}#${suffix}`, meetingID: meeting.id, meetingTitle: meeting.title, meetingDate: meeting.startedAt,
      kind, start, end, speakers, text, keyPointKind,
    });
    const name = (speaker: string): string => displayNameFor(meeting, speaker);

    for (const point of meeting.notes.keyPoints) {
      const names = unique(point.sources.flatMap((source) => (source.speaker === undefined ? [] : [name(source.speaker)])));
      const start = keyPointStart(point);
      const end = point.sources.length === 0 ? start : Math.max(...point.sources.map((source) => source.end));
      result.push(make(point.id, "keyPoint", start, end, names, `${KEY_POINT_LABELS[point.kind]}: ${point.text}`, point.kind));
    }
    for (const note of meeting.userNotes) {
      if (isBlank(note.text)) continue;
      const anchor = note.anchor ?? 0;
      result.push(make(`user-${note.id}`, "userNote", anchor, anchor, [], `My note: ${note.text}`));
    }
    for (const intent of meeting.intents) {
      const params = intent.params;
      const kind = params.type === "note.log" ? "Proposed note"
        : params.type === "task.create" ? "Proposed task"
        : params.type === "email.draft" ? "Proposed email"
        : `Proposed ${params.rawType}`;
      const lines = [`${kind}: ${titleOf(params)}`];
      const regarding = regardingOf(params);
      if (regarding !== undefined) lines.push(`Regarding: ${regarding.name}`);
      if (params.type === "task.create" && params.task.dueDate !== undefined) lines.push(`Due: ${params.task.dueDate}`);
      for (const evidence of intent.evidence) lines.push(`${name(evidence.speaker)} said: "${evidence.quote}"`);
      const start = intent.evidence.length === 0 ? 0 : Math.min(...intent.evidence.map((evidence) => evidence.tStart));
      const end = intent.evidence.length === 0 ? start : Math.max(...intent.evidence.map((evidence) => evidence.tEnd));
      result.push(make(`action-${intent.id}`, "action", start, end, intent.evidence.map((evidence) => name(evidence.speaker)), lines.join("\n")));
    }

    const turns = meeting.transcript.filter((turn) => !isBlank(turn.text));
    let index = 0;
    let number = 0;
    while (index < turns.length) {
      let end = index;
      let tokens = 0;
      while (end < turns.length) {
        const cost = estimateTokens(turns[end]!.text) + 3;
        if (tokens > 0 && tokens + cost > this.targetTokens) break;
        tokens += cost;
        end += 1;
      }
      const slice = turns.slice(index, end);
      const names = slice.map((turn) => name(turn.speaker));
      result.push(make(
        `t${number}`, "transcript", slice[0]?.start ?? 0, slice[slice.length - 1]?.end ?? 0, unique(names),
        slice.map((turn, offset) => `${names[offset]}: ${turn.text}`).join("\n"),
      ));
      number += 1;
      if (end >= turns.length) break;
      index = Math.max(index + 1, end - this.overlapTurns);
    }
    return result;
  }
}
