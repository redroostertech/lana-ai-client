import { describe, expect, it } from "vitest";
import { BackendError } from "../../src/ask/backend.js";
import { makeLanaId } from "../../src/ids/lanaId.js";
import { clipIntentIssues, type TranscriptSegment } from "../../src/intent/index.js";
import {
  CLIP_QUESTION_REQUEST, ClipDrafter, clipDraftReplyShape, clipQuestionPrompt, parseClipAction, parseClipQuestion, validateClipDraft, type ClipDraftAttempt,
} from "../../src/runtime/index.js";
import { ScriptedTextModel } from "../support/askFakes.js";

const lines: TranscriptSegment[] = [
  { speaker: "S2", start: 4, end: 9, text: "Can you file the motion to compel by Friday?" },
  { speaker: "S1", start: 9, end: 15, text: "Yes, I will draft it tonight and file it Friday." },
];
const speakers = [{ id: "S1", name: "Dana Reyes" }, { id: "S2", name: "Sofia Marin" }];
const QUESTION = "Will the court accept the motion?";

describe("Open question drafts (the real meeting fell back twice with no_draft_line)", () => {
  it("ends the prompt by asking for the task line, not an answer", () => {
    const prompt = clipQuestionPrompt(QUESTION, lines, speakers);
    expect(prompt.endsWith(`Dana Reyes: Yes, I will draft it tonight and file it Friday.\n${CLIP_QUESTION_REQUEST}`)).toBe(true);
  });

  it("reads a task written without its label, or quoted, and refuses an answer", () => {
    expect(parseClipQuestion("Find out whether the court will accept the motion | Ask the clerk")).toMatchObject({ title: "Find out whether the court will accept the motion", body: "Ask the clerk" });
    expect(parseClipQuestion("- Follow up with Dana | Who funds it")?.title).toBe("Follow up with Dana");
    expect(parseClipQuestion("\"TASK: Research the filing rules | Check the local rules\"")).toMatchObject({ title: "Research the filing rules", body: "Check the local rules" });
    expect(parseClipQuestion("The court will probably accept it because the deadline was met.")).toBeUndefined();
    expect(parseClipQuestion("Open question: Will the court accept the motion | yes")).toBeUndefined();
    expect(parseClipQuestion("1. Research the filing rules | Check")).toBeUndefined();
    expect(parseClipQuestion("Dana should check with the clerk whether the court will accept the motion before the hearing next week | soon")).toBeUndefined();
    expect(validateClipDraft("Research the filing rules | Check", "question").valid).toBe(true);
    // Only the question format reads a bare line.
    expect(parseClipAction("Research the filing rules | Check")).toBeUndefined();
    expect(validateClipDraft("Research the filing rules | Check", "action").valid).toBe(false);
  });

  it("drafts on the first reply when the model leaves the label out", async () => {
    const model = new ScriptedTextModel(["Research the filing rules | Check the local rules"]);
    const candidate = await new ClipDrafter(model).questionAction(QUESTION, lines, speakers);
    expect(candidate).toMatchObject({ type: "task.create", title: "Research the filing rules", body: "Check the local rules" });
    expect(model.calls).toHaveLength(1);
  });
});

describe("The drafting diagnostic", () => {
  it("records each attempt as sizes and states, never text", async () => {
    const attempts: ClipDraftAttempt[] = [];
    const model = new ScriptedTextModel(["The court will accept it.", "TASK: Research the rules | Check the local rules"]);
    const candidate = await new ClipDrafter(model, undefined, (attempt) => attempts.push(attempt)).questionAction(QUESTION, lines, speakers);
    expect(candidate?.title).toBe("Research the rules");
    expect(attempts.map((a) => [a.attempt, a.rule, a.label, a.fields, a.bareLine])).toEqual([[1, "no_label", "none", 0, false], [2, "ok", "task", 2, false]]);
    expect(attempts[0]!.replyChars).toBe("The court will accept it.".length);
    expect(attempts[0]!.promptLines).toBeGreaterThan(3);
    expect(attempts.every((a) => a.ms >= 0 && a.kind === "question" && a.modelError === null)).toBe(true);
    const text = JSON.stringify(attempts);
    for (const secret of ["court", "Research", "Dana", "motion"]) expect(text).not.toContain(secret);
  });

  it("records a model error by class name", async () => {
    const attempts: ClipDraftAttempt[] = [];
    const model = new ScriptedTextModel([BackendError.failed("local_model"), BackendError.failed("local_model")]);
    expect(await new ClipDrafter(model, undefined, (attempt) => attempts.push(attempt)).decision(lines, speakers)).toBeUndefined();
    expect(attempts.map((a) => a.rule)).toEqual(["model_error", "model_error"]);
    expect(attempts[0]!.modelError).toBe("BackendError");
  });

  it("names the rule a reply failed", () => {
    expect(clipDraftReplyShape("", "question", false).rule).toBe("empty_reply");
    expect(clipDraftReplyShape("TASK:  | none", "question", false)).toMatchObject({ rule: "empty_title", label: "task", fields: 2 });
    expect(clipDraftReplyShape("DECISION: x", "question", false)).toMatchObject({ rule: "no_label", label: "decision" });
    expect(clipDraftReplyShape("a | b | c\nmore", "action", false)).toMatchObject({ rule: "no_label", bareLine: true, fields: 3, replyLines: 2 });
  });

  it("names why a parsed draft was refused by field only", () => {
    const issues = clipIntentIssues({ type: "task.create", title: "x".repeat(201), body: "", recipients: [], confidence: 1 }, lines, makeLanaId("meeting"), new Date());
    expect(issues).toEqual(["params.title"]);
    expect(clipIntentIssues({ type: "task.create", title: "Fine", body: "", recipients: [], confidence: 1 }, lines, makeLanaId("meeting"), new Date())).toEqual([]);
  });
});
