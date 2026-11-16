import { SET_ASIDE_REASONS, speakerDisplayName, type SetAsideReason, type Speaker } from "../intent/meetingParts.js";
import { splitLines } from "../runtime/answerFormat.js";
import { formatLineValue, trimSpaces } from "../runtime/formatLine.js";
import type { ModelOutputValidation } from "../runtime/kernel.js";
import type { ExtractedAside } from "./notesFormat.js";
import { chunkPromptText, segmentAtLine, type TranscriptChunk } from "./transcriptChunk.js";

/**
 * The set-aside check (`lana.notes.aside.v1`): one short call per transcript part, after the
 * notes, asking only which lines are not part of the meeting. Writing notes and spotting a
 * phone call or another client's matter in the same reply is too much for a small model; on
 * its own the question is answered far more reliably. Results join the ASIDE lines of the notes.
 */
export const ASIDE_CHECK_SCHEMA = "lana.notes.aside.v1";
export const ASIDE_CHECK_MAX_RESPONSE_TOKENS = 120;

export const ASIDE_CHECK_INSTRUCTIONS = "You find the lines of a meeting transcript that are not part of this meeting. "
  + "Each transcript line looks like: L4 S1 [12.0-15.5]: text. "
  + "Reply with one line per stretch and nothing else, in exactly this format:\n"
  + "ASIDE: phone_call | L5-L9\n"
  + "Reasons: phone_call (someone takes a phone call with a person who is not in the meeting), "
  + "side_conversation (talk with someone who walked in or is not in the meeting, about something else), "
  + "logistics (getting audio, screens or links working), "
  + "other_matter (talk about a different client, case, family or matter than the meeting is about). "
  + "Cite the first and last line of each stretch. If every line is part of the meeting, reply NONE.";

export interface AsideCheckRequest {
  readonly chunk: TranscriptChunk;
  /** What the meeting is about (the notes' running summary at the end). */
  readonly topic: string;
  readonly speakers: readonly Speaker[];
}

export function asideCheckPrompt(request: AsideCheckRequest): string {
  const parts: string[] = [];
  const named = request.speakers.filter((speaker) => speaker.name !== undefined);
  if (named.length > 0) parts.push(`Speakers: ${named.map((speaker) => `${speaker.id} is ${speakerDisplayName(speaker)}`).join(", ")}.`);
  if (request.topic.trim() !== "") parts.push(`The meeting is about: ${request.topic.trim()}`);
  parts.push(`Transcript part ${request.chunk.index + 1}:\n${chunkPromptText(request.chunk)}`);
  return parts.join("\n\n");
}

export function validateAsideCheck(reply: string): ModelOutputValidation {
  const recognised = splitLines(reply).some((raw) => {
    const line = trimSpaces(raw).replace(/^[*_#\->`\s]+|[*_`\s.]+$/gu, "");
    return line.toUpperCase() === "NONE" || formatLineValue("ASIDE:", line) !== undefined;
  });
  return recognised ? { valid: true, parsed: {} } : { valid: false, reason: "no_recognised_lines" };
}

/** Line numbers in this chunk (`L5`, `5`, ranges `L5-L9`), in order, without repeats. */
export function asideLines(text: string, chunk: TranscriptChunk): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const token of text.split(/[, ]+/u)) {
    const bounds = token.split(/-|–|to/u).map((part) => part.trim().replace(/^[Ll]+|[Ll]+$/gu, "")).filter((part) => part !== "");
    if (bounds.length === 0 || bounds.length > 2 || !bounds.every((part) => /^\d+$/u.test(part))) continue;
    const low = Number(bounds[0]);
    const high = Number(bounds[bounds.length - 1]);
    if (high < low || high - low >= chunk.segments.length) continue;
    for (let line = low; line <= high; line += 1) {
      if (segmentAtLine(chunk, line) === undefined || seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

export function parseAsideCheck(reply: string, chunk: TranscriptChunk): ExtractedAside[] {
  const out: ExtractedAside[] = [];
  for (const raw of splitLines(reply)) {
    const body = formatLineValue("ASIDE:", trimSpaces(raw));
    if (body === undefined) continue;
    const parts = body.split("|").map(trimSpaces);
    const reason = (parts[0] ?? "").toLowerCase();
    if (parts.length < 2 || !(SET_ASIDE_REASONS as readonly string[]).includes(reason)) continue;
    const lines = asideLines(parts[1]!, chunk);
    if (lines.length > 0) out.push({ reason: reason as SetAsideReason, lines });
  }
  return out;
}
