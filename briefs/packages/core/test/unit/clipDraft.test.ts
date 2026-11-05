import { describe, expect, it } from "vitest";
import { makeLanaId } from "../../src/ids/lanaId.js";
import { clipActionDraft, clipFallbackAction, clipQuestionFallbackAction, validateIntent, type TranscriptSegment } from "../../src/intent/index.js";
import { CLIP_DRAFT_MAX_RESPONSE_TOKENS, ClipDrafter, clipDraftInstructions, parseClipAction, validateClipDraft, workflowDefinition } from "../../src/runtime/index.js";
import { ScriptedTextModel } from "../support/askFakes.js";

const lines: TranscriptSegment[] = [
  { speaker: "S2", start: 4, end: 9, text: "Can you file the motion to compel by Friday?" },
  { speaker: "S1", start: 9, end: 15, text: "Yes, I will draft it tonight and file it Friday." },
];
const speakers = [{ id: "S1", name: "Dana Reyes" }, { id: "S2", name: "Sofia Marin" }];

describe("ClipDrafter (clip.draft.v1)", () => {
  it("drafts an action from the clipped lines with names", async () => {
    const model = new ScriptedTextModel(["ACTION: task | File the motion to compel | Dana drafts tonight and files Friday | none | Dana Reyes | Pemberton"]);
    const candidate = await new ClipDrafter(model).action(lines, speakers);
    expect(candidate?.type).toBe("task.create");
    expect(candidate?.assigneeHint).toBe("Dana Reyes");
    expect(candidate?.dueDate).toBeUndefined();
    const call = model.calls[0]!;
    expect(call.prompt).toContain("Dana Reyes: Yes, I will draft it tonight");
    expect(call.prompt.endsWith(workflowDefinition("clip.draft.v1").states[0]!.sub_prompt!)).toBe(true);
  });

  it("retries once, then gives no draft for prose", async () => {
    const model = new ScriptedTextModel(["Sure! Here you go.", "Still prose."]);
    expect(await new ClipDrafter(model).decision(lines, speakers)).toBeUndefined();
    expect(model.calls).toHaveLength(2);
  });

  it("drafts a decision", async () => {
    const model = new ScriptedTextModel(["DECISION: Dana will file the motion on Friday."]);
    expect(await new ClipDrafter(model).decision(lines, speakers)).toBe("Dana will file the motion on Friday.");
  });

  it("falls back to a blank task that passes the validator", () => {
    const meetingID = makeLanaId("meeting");
    const intent = clipActionDraft(undefined, lines, meetingID, new Date())!;
    expect(intent.type).toBe("task.create");
    expect(intent.evidence).toHaveLength(2);
    expect(validateIntent(intent)).toEqual([]);
    expect(clipFallbackAction(lines).body).toContain("file the motion");
    // A draft that does not validate (an empty title) falls back too.
    const broken = clipActionDraft({ type: "note.log", title: " ", body: "", recipients: [], confidence: 1 }, lines, meetingID, new Date())!;
    expect(broken.params.type === "task.create" && broken.params.task.title).toBe("Follow up");
    expect(clipActionDraft(undefined, [], meetingID, new Date())).toBeUndefined();
  });

  it("turns an open question into a follow-up task from the question and its lines", async () => {
    const model = new ScriptedTextModel(["TASK: Research how the court sees the motion | Find out before Friday"]);
    const candidate = await new ClipDrafter(model).questionAction(" Will the court accept the motion? ", lines, speakers);
    expect(candidate).toMatchObject({ type: "task.create", title: "Research how the court sees the motion", body: "Find out before Friday" });
    const call = model.calls[0]!;
    expect(call.instructions).toBe(clipDraftInstructions("question"));
    expect(call.instructions).toContain("TASK:");
    expect(call.prompt.startsWith("Open question: Will the court accept the motion?\nLines:\nSofia Marin: Can you file")).toBe(true);
    // Only the question and the clip's lines go to the model, with a short budget.
    expect(call.prompt).not.toContain("transcript");
    expect(call.maximumResponseTokens).toBe(CLIP_DRAFT_MAX_RESPONSE_TOKENS);
    expect(CLIP_DRAFT_MAX_RESPONSE_TOKENS).toBe(120);
  });

  it("reads the short action lines a 9B model writes", () => {
    // The real failure: four fields where six were asked for, so the old parser gave nothing.
    expect(parseClipAction("ACTION: task | Advocate for social work | none | none")).toMatchObject({ type: "task.create", title: "Advocate for social work", body: "" });
    const shifted = parseClipAction("ACTION: task | Advocate for social work | 2024-12-31 | none | government perception")!;
    expect([shifted.dueDate, shifted.assigneeHint, shifted.regardingName]).toEqual([undefined, undefined, undefined]);
    expect(parseClipAction("ACTION: Call the clerk | Ask about the hearing")).toMatchObject({ type: "task.create", title: "Call the clerk", body: "Ask about the hearing" });
    expect(parseClipAction("ACTION: task |  | no title")).toBeUndefined();
  });

  it("validates for the kind asked, so a reply the parser drops is retried", async () => {
    expect(validateClipDraft("DECISION: We file Friday.", "action").valid).toBe(false);
    expect(validateClipDraft("ACTION: task | File it | Friday | none | none | none", "decision").valid).toBe(false);
    expect(validateClipDraft("ACTION: task | File it | Friday", "question").valid).toBe(true);
    const model = new ScriptedTextModel(["DECISION: We file Friday.", "ACTION: task | File the motion | Friday | none | Dana Reyes | none"]);
    expect((await new ClipDrafter(model).action(lines, speakers))?.title).toBe("File the motion");
    expect(model.calls).toHaveLength(2);
  });

  it("starts an undrafted open question from Follow up: <question>", () => {
    const fallback = clipQuestionFallbackAction(" Who pays for the expert? \n", lines);
    expect(fallback.title).toBe("Follow up: Who pays for the expert?");
    const intent = clipActionDraft(undefined, lines, makeLanaId("meeting"), new Date(), fallback)!;
    expect(intent.params.type === "task.create" && intent.params.task.title).toBe("Follow up: Who pays for the expert?");
  });

  it("rejects with the abort when a draft is cancelled", async () => {
    const controller = new AbortController();
    const model = new ScriptedTextModel(["TASK: Research it | Soon"]);
    const respond = model.respond.bind(model);
    model.respond = async (request) => {
      controller.abort();
      return respond(request);
    };
    await expect(new ClipDrafter(model).questionAction("Why?", lines, speakers, controller.signal)).rejects.toBeDefined();
  });
});
