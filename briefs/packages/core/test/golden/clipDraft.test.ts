import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LanaId } from "../../src/ids/lanaId.js";
import { clipDecision, clipFallbackAction, clipIntent, clipQuestionFallbackAction, encodeIntent, encodeKeyPoint, transcriptClip, clipCovering, type CandidateIntent, type Speaker, type TranscriptSegment } from "../../src/intent/index.js";
import { canonicalString } from "../../src/json/canonical.js";
import { LanaDate } from "../../src/json/lanaDate.js";
import {
  CLIP_DRAFT_MAX_RESPONSE_TOKENS, CLIP_DRAFT_SCHEMA, clipDraftInstructions, clipDraftPrompt, clipQuestionPrompt, parseClipAction, parseClipDecision, parseClipQuestion, validateClipDraft, workflowDefinition,
} from "../../src/runtime/index.js";
import { golden } from "./fixtures.js";

interface GoldenCandidate {
  type: string; title: string; body: string; due_date: string | null; assignee_hint: string | null; recipients: string[]; regarding_name: string | null; confidence: number;
}
interface GoldenReply {
  reply: string; lines: string; valid_action: boolean; valid_decision: boolean; valid_question: boolean; reason?: string;
  decision: string | null; question: GoldenCandidate | null; action: GoldenCandidate | null; intent: string | null;
}
interface ClipDraftGolden {
  schema: string;
  maximum_response_tokens: number;
  meeting_id: string;
  now: string;
  instructions: { action: string; decision: string; question: string };
  question: string;
  question_prompts: Record<string, string>;
  speakers: Array<{ id: string; name: string | null }>;
  line_sets: Record<string, TranscriptSegment[]>;
  prompts: Record<string, string>;
  replies: GoldenReply[];
  fallbacks: Record<string, { action: GoldenCandidate; intent: string | null; question_action: GoldenCandidate }>;
  decisions: Array<{ lines: string; clip_id: string; text: string; key_point: string }>;
}

const fixture = golden<ClipDraftGolden>("clip-draft");
const now = LanaDate.parse(fixture.now)!;
const meetingID = fixture.meeting_id as LanaId;
const speakers: Speaker[] = fixture.speakers.map((speaker) => (speaker.name === null ? { id: speaker.id } : { id: speaker.id, name: speaker.name }));

function asGolden(candidate: CandidateIntent): GoldenCandidate {
  return {
    type: candidate.type, title: candidate.title, body: candidate.body,
    due_date: candidate.dueDate ?? null, assignee_hint: candidate.assigneeHint ?? null,
    recipients: [...candidate.recipients], regarding_name: candidate.regardingName ?? null, confidence: candidate.confidence,
  };
}

/** The TypeScript intent with the Swift intent's (random) id, encoded canonically. */
function intentJSON(candidate: CandidateIntent, lines: TranscriptSegment[], expected: string | null): string | null {
  const id = expected === null ? undefined : (JSON.parse(expected) as { id: LanaId }).id;
  const intent = clipIntent(candidate, lines, meetingID, now, id);
  return intent === undefined ? null : canonicalString(encodeIntent(intent));
}

describe("Clip drafts match Swift (clip-draft.json)", () => {
  it("uses the same schema, budget, instructions and prompts", () => {
    expect(CLIP_DRAFT_SCHEMA).toBe(fixture.schema);
    expect(CLIP_DRAFT_MAX_RESPONSE_TOKENS).toBe(fixture.maximum_response_tokens);
    expect(clipDraftInstructions("action")).toBe(fixture.instructions.action);
    expect(clipDraftInstructions("decision")).toBe(fixture.instructions.decision);
    expect(clipDraftInstructions("question")).toBe(fixture.instructions.question);
    for (const [name, prompt] of Object.entries(fixture.prompts)) expect(clipDraftPrompt(fixture.line_sets[name]!, speakers)).toBe(prompt);
    for (const [name, prompt] of Object.entries(fixture.question_prompts)) expect(clipQuestionPrompt(fixture.question, fixture.line_sets[name]!, speakers)).toBe(prompt);
  });

  it("validates and parses every reply like Swift", () => {
    expect(fixture.replies.length).toBeGreaterThan(10);
    for (const reply of fixture.replies) {
      for (const kind of ["action", "decision", "question"] as const) {
        const validation = validateClipDraft(reply.reply, kind);
        expect(validation.valid, `${kind}: ${reply.reply}`).toBe(reply[`valid_${kind}`]);
        if (!validation.valid) expect(validation.reason).toBe(reply.reason);
      }
      expect(parseClipDecision(reply.reply) ?? null, reply.reply).toBe(reply.decision);
      const question = parseClipQuestion(reply.reply);
      expect(question === undefined ? null : asGolden(question), reply.reply).toEqual(reply.question);
      const action = parseClipAction(reply.reply);
      expect(action === undefined ? null : asGolden(action), reply.reply).toEqual(reply.action);
    }
  });

  it("builds the same action from the clip, byte for byte", () => {
    for (const reply of fixture.replies) {
      const action = parseClipAction(reply.reply);
      if (action === undefined) continue;
      expect(intentJSON(action, fixture.line_sets[reply.lines]!, reply.intent), reply.reply).toBe(reply.intent);
    }
  });

  it("makes the same blank fallback and decision", () => {
    for (const [name, fallback] of Object.entries(fixture.fallbacks)) {
      const lines = fixture.line_sets[name]!;
      expect(asGolden(clipFallbackAction(lines))).toEqual(fallback.action);
      expect(asGolden(clipQuestionFallbackAction(fixture.question, lines))).toEqual(fallback.question_action);
      expect(intentJSON(clipFallbackAction(lines), lines, fallback.intent)).toBe(fallback.intent);
    }
    for (const decision of fixture.decisions) {
      const lines = fixture.line_sets[decision.lines]!;
      const covering = clipCovering(decision.clip_id, lines, now)!;
      const clip = transcriptClip(decision.clip_id, covering.start, covering.end, now);
      expect(canonicalString(encodeKeyPoint(clipDecision(decision.text, clip, lines)))).toBe(decision.key_point);
    }
  });

  it("keeps the clip.draft.v1 definition identical to the Swift bundle", () => {
    const path = fileURLToPath(new URL("../../../../fixtures/workflows/clip.draft.v1.json", import.meta.url));
    expect(workflowDefinition("clip.draft.v1")).toEqual(JSON.parse(readFileSync(path, "utf8")));
  });
});
