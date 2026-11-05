import { describe, expect, it } from "vitest";
import { AskEngine, BackendError, type AnswerDraft, type AnswerRequest } from "../../src/ask/index.js";
import {
  ANSWER_INSTRUCTIONS, ANSWER_MAXIMUM_RESPONSE_TOKENS, BRIEFING_FRAMING_PREFIX, draftAnswer, failureReason, formatLineValue, groundingGate,
  modelMessages, parseAnswer, runWorkflow, RuntimeAnswerBackend, validateAnswer, workflowDefinition, WorkflowRunner,
  type JsonLike, type WorkflowDefinition,
} from "../../src/runtime/index.js";
import { meeting, ScriptedTextModel } from "../support/askFakes.js";

const socialWork = meeting([
  ["S1", 1, "Now let's talk. Oh, I like the animation. Yeah, we're talking."],
  ["S2", 6, "Yeah, let's keep talking for another thirty seconds. So tell me a little bit about social work."],
  ["S1", 13, "Social work is about helping people get housing, counseling and benefits."],
  ["S2", 32, "Okay, we decided to stay up and watch the show tonight."],
], { title: "Social Work Practice" });

const engine = (model: ScriptedTextModel): AskEngine => AskEngine.forMeetings([socialWork], new RuntimeAnswerBackend(model));

describe("Runtime: Ask workflow", () => {
  it("answers with its sources through the kernel", async () => {
    const model = new ScriptedTextModel(["ANSWER: Social work helps people get housing and benefits.\nSOURCES: P1"]);
    const answer = await engine(model).ask("What was said about social work?");
    expect(answer.status).toBe("answered");
    expect(answer.citations).toHaveLength(1);
    const call = model.calls[0]!;
    expect(call.instructions).toBe(ANSWER_INSTRUCTIONS);
    expect(call.prompt).toContain("Question: What was said about social work?");
    expect(call.prompt).toContain("housing, counseling and benefits");
    expect(call.prompt).not.toContain(BRIEFING_FRAMING_PREFIX);
    expect(call.prompt.endsWith(workflowDefinition("ask.answer.v1").states[0]!.sub_prompt!)).toBe(true);
    expect([call.temperature, call.maximumResponseTokens]).toEqual([0.1, ANSWER_MAXIMUM_RESPONSE_TOKENS]);
  });

  it("retries an empty reply once", async () => {
    const model = new ScriptedTextModel(["  \n", "ANSWER: They decided to watch the show.\nSOURCES: P1"]);
    expect((await engine(model).ask("What did we decide?")).status).toBe("answered");
    expect(model.calls).toHaveLength(2);
  });

  it("declines after a refusal twice, never guessing", async () => {
    const model = new ScriptedTextModel([BackendError.refused(), BackendError.refused()]);
    expect((await engine(model).ask("What did we decide?")).status).toBe("declined");
    expect(model.calls).toHaveLength(2);
  });

  it("rethrows other model failures after the retry", async () => {
    const model = new ScriptedTextModel([BackendError.failed("local_model"), BackendError.failed("local_model")]);
    await expect(engine(model).ask("What did we decide?")).rejects.toMatchObject({ kind: "failed", code: "local_model" });
    const unreadable = new ScriptedTextModel([" ", " "]);
    await expect(engine(unreadable).ask("What did we decide?")).rejects.toMatchObject({ kind: "malformedOutput" });
  });

  it("withholds an ungrounded answer at the gate", async () => {
    const answer = await engine(new ScriptedTextModel(["ANSWER: Probably March.\nSOURCES: P42"])).ask("When is the deposition?");
    expect(answer.status).toBe("notFound");
    expect(answer.text).toBe("");
  });

  it("takes NONE as an honest not found without a retry", async () => {
    const model = new ScriptedTextModel(["ANSWER: NONE\nSOURCES:"]);
    expect((await engine(model).ask("What is the settlement amount?")).status).toBe("notFound");
    expect(model.calls).toHaveLength(1);
  });
});

describe("Runtime: answer format", () => {
  it("reads an answer over several lines", () => {
    expect(parseAnswer("ANSWER: They agreed to stop the recording\nafter about a minute.\nSOURCES: P1, [P3]"))
      .toEqual({ answerable: true, answer: "They agreed to stop the recording after about a minute.", citations: ["P1", "P3"], kind: "fact" });
  });

  it("reads KIND NONE as not found", () => {
    expect(parseAnswer("KIND: NONE\nSOURCES: P1, P2, P3").answerable).toBe(false);
    expect(parseAnswer("KIND: none").answerable).toBe(false);
    expect(parseAnswer("KIND: fact\nThe arraignment is on November 12 (P2).").answer).toBe("The arraignment is on November 12.");
  });

  it("keeps list steps on their own lines", () => {
    const parsed = parseAnswer("KIND: suggestion\nANSWER: Track each initiative against its goal.\n- Set a baseline\nthis week.\n* Review it monthly.\n2. Share the results.\nSOURCES: P1");
    expect(parsed.kind).toBe("suggestion");
    expect(parsed.answer).toBe("Track each initiative against its goal.\n- Set a baseline this week.\n- Review it monthly.\n- Share the results.");
  });

  it("asks for depth and no repeats", () => {
    expect(ANSWER_INSTRUCTIONS).toContain("3 to 6 concrete");
    expect(ANSWER_INSTRUCTIONS).toContain("Never repeat an earlier answer");
    expect(ANSWER_MAXIMUM_RESPONSE_TOKENS).toBeGreaterThanOrEqual(800);
  });

  it("is not answerable with NONE or no sources", () => {
    for (const reply of ["ANSWER: NONE\nSOURCES:", "ANSWER: Probably March.\nSOURCES: none", "Sorry, I cannot help.", ""]) {
      const parsed = parseAnswer(reply);
      expect(parsed.answerable, reply).toBe(false);
      expect([parsed.answer, parsed.citations]).toEqual(["", []]);
    }
  });

  it("finds only an empty reply invalid", () => {
    expect(validateAnswer(" \n ")).toEqual({ valid: false, reason: "empty_reply" });
    for (const reply of ["ANSWER: NONE\nSOURCES:", "Sorry, I cannot help.", "Boxes. (P1)"]) expect(validateAnswer(reply).valid).toBe(true);
  });

  it("reads prose with labels as an answer and prose without as not found", () => {
    const parsed = parseAnswer("Corvane supplies printed cake boxes, pastry clamshells, and corrugated shipping cartons.\nS2 (in P1, P3, P6) said this.");
    expect([parsed.answer, parsed.citations]).toEqual(["Corvane supplies printed cake boxes, pastry clamshells, and corrugated shipping cartons.", ["P1", "P3", "P6"]]);
    expect(parseAnswer("They decided to watch the show tonight [P2].").answer).toBe("They decided to watch the show tonight.");
    expect(parseAnswer("The passages do not mention a ruling.").answerable).toBe(false);
    expect(parseAnswer("Paragraph 12 of the lease covers it.").answerable).toBe(false);
  });

  it.each([
    "**ANSWER:** They decided to watch the show.\n**SOURCES:** P1",
    "Answer: They decided to watch the show.\nSources: P1",
    "- ANSWER: They decided to watch the show.\n- SOURCES: P1",
    "### ANSWER: They decided to watch the show.\n### SOURCES: P1",
    "**ANSWER**: They decided to watch the show.\n**SOURCES**: P1",
    "> ANSWER: They decided to watch the show.\n> SOURCES: `P1`",
  ])("reads Markdown-dressed lines: %s", (reply) => {
    expect(parseAnswer(reply)).toEqual({ answerable: true, answer: "They decided to watch the show.", citations: ["P1"], kind: "fact" });
  });

  it("does not take a word that starts like a label for one", () => {
    expect(formatLineValue("ANSWER:", "ANSWERS are below")).toBeUndefined();
    expect(formatLineValue("POINT:", "Pointless chatter.")).toBeUndefined();
  });

  it("names a failed step's reason without text", () => {
    expect(failureReason({ content: "the reply text", parse_error: "empty_reply" })).toBe("format:empty_reply");
  });
});

describe("Runtime: workflow kernel", () => {
  it("shapes the kernel's messages: briefing becomes the prompt, system stays instructions", () => {
    expect(modelMessages([
      { role: "system", content: "Reply in the format." },
      { role: "system", content: `${BRIEFING_FRAMING_PREFIX}Passages: [P1] hello` },
      { role: "user", content: "Answer now." },
    ])).toEqual({ instructions: "Reply in the format.", prompt: "Passages: [P1] hello\n\nAnswer now." });
  });

  it("validates definitions and refuses steps that do not run here", async () => {
    const run = (definition: WorkflowDefinition) => runWorkflow({ definition, runID: "r" }, { callModel: async () => ({ content: "" }), persist: () => {} });
    expect((await run({ states: [] })).status).toBe("invalid_definition");
    expect((await run({ states: [{ id: "a", type: "terminal" }, { id: "a", type: "terminal" }] })).output["error"]).toBe("duplicate state id: a");
    expect((await run({ initial_state: "x", states: [{ id: "a", type: "terminal" }] })).status).toBe("invalid_definition");
    expect((await run({ states: [{ id: "a", type: "tool_call" }] })).status).toBe("invalid_definition");
    expect((await run({ states: [{ id: "a", type: "terminal", outcome: "done" }] })).status).toBe("completed");
  });

  it("records begin and end per attempt, with the retry marked", async () => {
    const model = new ScriptedTextModel(["", "ANSWER: x\nSOURCES: P1"]);
    const run = await new WorkflowRunner(model).run("ask.answer.v1", {
      instructions: "i", content: "c", maximumResponseTokens: 10, validators: { "lana.ask.answer.v1": validateAnswer },
      gates: { "lana.grounded_citations": groundingGate(new Set(["P1"])) },
    });
    expect(run.verdict.status).toBe("completed");
    expect(run.attempts("answer")).toBe(2);
    expect(run.trail.map((r) => `${r.phase}:${r.stepID}:${r.status}:${r.attempt}${r.willRetry === true ? ":retry" : ""}`))
      .toEqual(["begin:answer:running:1", "end:answer:errored:1:retry", "begin:answer:running:2", "end:answer:completed:2", "begin:answered:running:1", "end:answered:completed:1"]);
    expect(run.output("answer")?.["parse_error"]).toBeNull();
  });

  it("withholds when a gate id is not supplied, and when the validator is missing it fails", async () => {
    const model = new ScriptedTextModel(["ANSWER: x\nSOURCES: P1", "a", "b"]);
    const runner = new WorkflowRunner(model);
    const unknownGate = await runner.run("ask.answer.v1", { instructions: "i", content: "c", maximumResponseTokens: 10, validators: { "lana.ask.answer.v1": validateAnswer }, gates: { other: () => ({ verdict: "allow" }) } });
    expect(unknownGate.output("answer")?.["withheld_reason"]).toBe("unknown_gate:lana.grounded_citations");
    const noValidator = await runner.run("ask.answer.v1", { instructions: "i", content: "c", maximumResponseTokens: 10, validators: {} });
    expect(noValidator.verdict.status).toBe("failed");
    expect(failureReason(noValidator.output("answer"))).toBe("format:unknown_schema:lana.ask.answer.v1");
  });

  it("does not retry a cancelled call", async () => {
    const controller = new AbortController();
    let calls = 0;
    const verdict = await runWorkflow({ definition: workflowDefinition("ask.answer.v1"), runID: "r", signal: controller.signal }, {
      callModel: async () => { calls += 1; controller.abort(); throw new Error("aborted"); },
      persist: () => {},
      validateModelOutput: () => ({ valid: true, parsed: null }),
    });
    expect([verdict.status, calls]).toEqual(["failed", 1]);
  });
});

describe("Runtime: grounding gate", () => {
  const request: AnswerRequest = { question: "When is the deposition?", passages: [{ label: "P1", heading: "Speaker 1, 0:01", text: "We will depose Dr. Solberg on December 2." }], history: [] };
  const output = (answerable: boolean, citations: string[], suggestion = false): JsonLike => ({ parsed: { answerable, suggestion, citations } });

  it("returns nothing when the gate withholds, and the answer when grounded", async () => {
    expect(await new RuntimeAnswerBackend(new ScriptedTextModel(["ANSWER: Probably March.\nSOURCES: P42"])).answer(request))
      .toEqual({ answerable: false, answer: "", citations: [], kind: "fact" });
    const grounded = await new RuntimeAnswerBackend(new ScriptedTextModel(["ANSWER: December 2.\nSOURCES: P1"])).answer(request);
    expect([grounded.answerable, grounded.citations]).toEqual([true, ["P1"]]);
  });

  it("gives the same verdicts as Swift", () => {
    const gate = groundingGate(new Set(["P1", "P2"]));
    expect(gate("", output(true, ["P2"])).verdict).toBe("allow");
    expect(gate("", output(true, ["P9"])).verdict).toBe("withhold");
    expect(gate("", output(true, [])).verdict).toBe("withhold");
    expect(gate("", output(false, [])).verdict).toBe("allow");
    expect(gate("", undefined).verdict).toBe("withhold");
    expect(gate("", output(true, [], true)).verdict).toBe("allow");
  });
});

describe("Runtime: suggestions", () => {
  it("returns advice as a labelled suggestion", async () => {
    const model = new ScriptedTextModel(["KIND: suggestion\nANSWER: Start with a short weekly check-in so the gap in housing referrals is tracked, and share the intake list before then.\nSOURCES: P1"]);
    const answer = await engine(model).ask("What do you think we should do to bridge the gap?");
    expect(answer.status).toBe("suggested");
    expect(answer.text.startsWith("Start with a short weekly check-in")).toBe(true);
    expect(answer.citations).toHaveLength(1);
    expect(model.calls[0]?.instructions).toContain("KIND: fact, or suggestion");
  });

  it("shows a suggestion without sources and still needs a source for a fact", async () => {
    expect((await engine(new ScriptedTextModel(["KIND: suggestion\nANSWER: Set one shared deadline and an owner for each task.\nSOURCES:"])).ask("Any ideas?")).status).toBe("suggested");
    expect((await engine(new ScriptedTextModel(["KIND: fact\nANSWER: The deposition is in March.\nSOURCES:"])).ask("When is the deposition?")).status).toBe("notFound");
  });
});

describe("Runtime: answer newlines", () => {
  const reply =
    "KIND: suggestion\r\nANSWER: Set clear measures for the advocacy outcomes.\r\n- Define one indicator for each concept\r\nmentioned in the meeting.\r\n- Set a **baseline** first.\n\n1. Review it monthly.\nSOURCES: P1";
  const expected = "Set clear measures for the advocacy outcomes.\n- Define one indicator for each concept mentioned in the meeting.\n- Set a **baseline** first.\n- Review it monthly.";

  it("keeps every list item on its own line through the engine", async () => {
    const answer = await engine(new ScriptedTextModel([reply])).ask("How should we measure this?");
    expect(answer.status).toBe("suggested");
    expect(answer.text).toBe(expected);
    expect(answer.text.split("\n")).toHaveLength(4);
  });

  it("keeps the same lines in every streamed draft", async () => {
    const drafts: AnswerDraft[] = [];
    await engine(new ScriptedTextModel([reply])).ask("How should we measure this?", { onDraft: (d) => drafts.push(d) });
    expect(drafts[drafts.length - 1]?.text).toBe(expected);
    const withList = drafts.filter((d) => d.text.includes("- Set a"));
    expect(withList.length).toBeGreaterThan(0);
    expect(withList.every((d) => d.text.includes("outcomes.\n- Define"))).toBe(true);
  });
});

describe("Runtime: streamed answers", () => {
  it("drafts only the answer as it is written", () => {
    expect(draftAnswer("KIND: fa")).toBeUndefined();
    expect(draftAnswer("KIND: fact\nANSWER: Hous")).toEqual({ kind: "fact", text: "Hous" });
    expect(draftAnswer("KIND: sugg")).toBeUndefined();
    expect(draftAnswer("KIND: suggestion\nANSWER: Try a")).toEqual({ kind: "suggestion", text: "Try a" });
    expect(draftAnswer("ANSWER: Friday.")).toEqual({ kind: undefined, text: "Friday." });
  });

  it("never drafts labels, sources or a half-written NONE", () => {
    expect(draftAnswer("KIND: fact\nANSWER: Friday.\nSOU")?.text).toBe("Friday.");
    expect(draftAnswer("KIND: fact\nANSWER: Friday.\nSOURCES: P1")?.text).toBe("Friday.");
    expect(draftAnswer("KIND: fact\nANSWER: NO")?.text).toBe("");
    expect(draftAnswer("**ANSWER:** Two lines\nof answer")?.text).toBe("Two lines of answer");
    expect(draftAnswer("KIND: fact\nANSWER: Nobody")?.text).toBe("Nobody");
  });

  it("reports growing drafts, then the checked answer", async () => {
    const drafts: AnswerDraft[] = [];
    const model = new ScriptedTextModel(["KIND: fact\nANSWER: Social work helps people get housing and benefits.\nSOURCES: P1"]);
    const answer = await engine(model).ask("What was said about social work?", { onDraft: (d) => drafts.push(d) });
    expect(answer.status).toBe("answered");
    const texts = drafts.map((d) => d.text).filter((t) => t.length > 0);
    expect(texts.length).toBeGreaterThan(3);
    expect(texts[texts.length - 1]).toBe("Social work helps people get housing and benefits.");
    expect(texts.every((t, i) => i === 0 || t.startsWith(texts[i - 1]!))).toBe(true);
    expect(drafts.every((d) => !d.text.includes("SOURCES") && !d.text.includes("P1"))).toBe(true);
  });

  it("drafts a fact the gate rejects but does not keep it", async () => {
    const drafts: AnswerDraft[] = [];
    const answer = await engine(new ScriptedTextModel(["KIND: fact\nANSWER: The trial is in March.\nSOURCES: P9"])).ask("When is the trial?", { onDraft: (d) => drafts.push(d) });
    expect(drafts[drafts.length - 1]?.text).toBe("The trial is in March.");
    expect(answer.status).toBe("notFound");
  });
});
