import { MeetingAskService, storeAskSource, decodeSavedAskTurns } from "@lana/core/ask";
import { RuntimeAnswerBackend } from "@lana/core/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskConversation, LanaEvent, PlatformInfo } from "../src/shared/api.js";
import { ASK_FAILED, AskService } from "../src/main/services/ask/askService.js";
import { ScriptedAskModel, scriptedReply } from "../src/main/services/ask/scriptedAskModel.js";
import { ScriptedTextModel } from "../../core/test/support/askFakes.js";
import { openRealRig, receiveGoldenMeeting, type RealRig } from "./support/realRig.js";
import { AVAILABLE, BackendError, unavailable } from "@lana/core/ask";
import type { TextModel } from "@lana/core/runtime";

const platform: PlatformInfo = { os: "mac", deviceNoun: "computer", appVersion: "0.1.0", isDemo: false, features: { ask: true, talk: true } };

let rig: RealRig;
let events: LanaEvent[];
beforeEach(async () => {
  rig = await openRealRig();
  events = [];
});
afterEach(() => rig.cleanup());

function service(model: TextModel, allowed = true): AskService {
  const asking = new MeetingAskService(storeAskSource(rig.store), new RuntimeAnswerBackend(model, rig.log), { log: rig.log });
  return new AskService({ store: rig.store, asking, platform, emit: (event) => events.push(event), log: rig.log, allowed: () => allowed });
}

function conversations(key = "screen"): AskConversation[] {
  return events.flatMap((event) => (event.type === "ask" && event.conversation.key === key ? [event.conversation] : []));
}

async function answered(key = "screen"): Promise<AskConversation> {
  await vi.waitFor(() => {
    const last = conversations(key).at(-1);
    expect(last?.exchanges.at(-1)?.outcome.kind).not.toBe("thinking");
  }, { timeout: 5_000 });
  return conversations(key).at(-1)!;
}

describe("AskService (real store, runtime and engine)", () => {
  it("streams drafts in order, then a cited answer, and saves the conversation sealed", async () => {
    const opened = await receiveGoldenMeeting(rig);
    const ask = service(new ScriptedAskModel());
    const first = await ask.send("screen", "What did they say first?");
    expect(first.exchanges).toEqual([{ id: expect.any(Number), question: "What did they say first?", outcome: { kind: "thinking" } }]);
    const done = await answered();

    const drafts = conversations().flatMap((conversation) => (conversation.draft === null ? [] : [conversation.draft.text]));
    expect(drafts.length).toBeGreaterThan(2);
    // Each draft extends the one before: they arrive in the order the model writes them.
    for (let index = 1; index < drafts.length; index += 1) expect(drafts[index]!.startsWith(drafts[index - 1]!)).toBe(true);
    const outcome = done.exchanges[0]!.outcome;
    expect(outcome).toMatchObject({ kind: "answered", status: "answered", statusMessage: null, text: expect.stringMatching(/^The meeting says: /) });
    if (outcome.kind !== "answered") throw new Error("not answered");
    expect(drafts.at(-1)).toBe(outcome.text);
    expect(done.draft).toBeNull();
    expect(outcome.citations).toHaveLength(1);
    expect(outcome.citations[0]).toMatchObject({ meetingID: opened.meeting.id, meetingTitle: null, title: expect.stringMatching(/ at \d+:\d\d$/), audio: "available" });

    // Saved sealed in the store's Ask threads, readable by both apps.
    const threads = await ask.threads();
    expect(threads).toEqual({ ok: true, value: [{ id: done.threadID, meetingID: null, title: "What did they say first?", updatedAt: expect.any(String), questionCount: 1 }] });
    const stored = rig.store.ask.get(done.threadID!)!;
    expect(decodeSavedAskTurns(stored.turns).turns[0]).toMatchObject({ question: "What did they say first?", status: "answered" });
    expect(events.some((event) => event.type === "askThreads" && event.threads.length === 1)).toBe(true);

    // Ids and counts only in the log.
    const log = rig.log.lines.join("\n");
    expect(log).toContain("ask.answered");
    expect(log).not.toContain("What did they say");
    expect(log).not.toContain("The meeting says");
  });

  it("keeps an answer's list lines from the model to the view and the saved thread", async () => {
    await receiveGoldenMeeting(rig);
    const reply = "KIND: suggestion\nANSWER: Measure what matters.\n- Set a **baseline**\nthis week.\n- Review it monthly.\nSOURCES: P1";
    const ask = service(new ScriptedTextModel([reply]));
    await ask.send("screen", "How should we measure this?");
    const done = await answered();
    const text = "Measure what matters.\n- Set a **baseline** this week.\n- Review it monthly.";
    expect(done.exchanges[0]!.outcome).toMatchObject({ kind: "answered", status: "suggested", text });
    const drafts = conversations().flatMap((conversation) => (conversation.draft === null ? [] : [conversation.draft.text]));
    expect(drafts.at(-1)).toBe(text);
    await ask.newConversation("screen");
    const reopened = await ask.openThread("screen", done.threadID!);
    expect(reopened.exchanges[0]!.outcome).toMatchObject({ text });
  });

  it("reopens, continues, deletes and clears saved conversations", async () => {
    const opened = await receiveGoldenMeeting(rig);
    const ask = service(new ScriptedAskModel());
    await ask.setScope("screen", { kind: "meeting", meetingID: opened.meeting.id });
    await ask.send("screen", "First question?");
    const first = await answered();
    await ask.send("screen", "And then?");
    const second = await answered();
    expect(second.threadID).toBe(first.threadID);
    expect(second.exchanges).toHaveLength(2);

    await ask.newConversation("screen");
    expect((await ask.conversation("screen")).exchanges).toEqual([]);
    const reopened = await ask.openThread("meeting:" + opened.meeting.id, first.threadID!);
    expect(reopened).toMatchObject({ scope: { kind: "meeting", meetingID: opened.meeting.id }, threadID: first.threadID, scopeTitle: opened.meeting.title });
    expect(reopened.exchanges.map((exchange) => exchange.question)).toEqual(["First question?", "And then?"]);
    expect(reopened.exchanges[0]?.outcome).toMatchObject({ kind: "answered", citations: [{ meetingID: opened.meeting.id }] });

    expect(await ask.deleteThread(first.threadID!)).toEqual({ ok: true, value: [] });
    expect((await ask.conversation("meeting:" + opened.meeting.id)).exchanges).toEqual([]);

    await ask.send("screen", "Again?");
    await answered();
    expect(rig.store.ask.list()).toHaveLength(1);
    rig.store.ask.deleteAll();
    ask.historyCleared();
    expect((await ask.conversation("screen")).threadID).toBeNull();
    expect((await ask.threads())).toEqual({ ok: true, value: [] });
  });

  it("answers nothing while LANA Briefs is not on for the organization", async () => {
    await receiveGoldenMeeting(rig);
    const ask = service(new ScriptedAskModel(), false);
    expect((await ask.send("screen", "What was decided?")).exchanges).toEqual([]);
  });

  it("shows the closest passages, and says why, while the LANA model is not downloaded", async () => {
    await receiveGoldenMeeting(rig);
    const model = new ScriptedTextModel([]);
    model.availabilityValue = unavailable("modelNotReady");
    const ask = service(model);
    await ask.send("screen", "What was decided?");
    const outcome = (await answered()).exchanges[0]!.outcome;
    expect(outcome).toMatchObject({ kind: "answered", status: "passagesOnly", text: "", statusMessage: "The LANA model is not downloaded yet, so here are the closest passages." });
    expect(model.calls).toHaveLength(0);
  });

  it("says plainly when the model fails, and keeps the failure out of the saved threads", async () => {
    await receiveGoldenMeeting(rig);
    const ask = service(new ScriptedTextModel([BackendError.failed("local_model"), BackendError.failed("local_model")]));
    await ask.send("screen", "Anything?");
    expect((await answered()).exchanges[0]!.outcome).toEqual({ kind: "failed", message: ASK_FAILED });
    expect(rig.store.ask.list()).toEqual([]);
  });

  it("cancels the question in flight", async () => {
    await receiveGoldenMeeting(rig);
    let release: () => void = () => undefined;
    const slow: TextModel = {
      modelID: "slow",
      availability: async () => AVAILABLE,
      respond: (request) => new Promise((resolve, reject) => {
        release = () => resolve("KIND: fact\nANSWER: late\nSOURCES: P1");
        request.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    };
    const ask = service(slow);
    await ask.send("screen", "Slow?");
    await vi.waitFor(() => expect(release).not.toBe(undefined));
    await ask.cancel("screen");
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await ask.conversation("screen")).exchanges).toEqual([]);
    expect(rig.store.ask.list()).toEqual([]);
  });

  it("scripts a cited reply from the first transcript passage", () => {
    expect(scriptedReply("Passages:\n[P1] (AI note from 0:00)\nKey point: x\n[P2] (transcript 0:00 to 0:30)\nDana: We meet Friday.\nMike: Fine.\n\nQuestion: q"))
      .toBe("KIND: fact\nANSWER: The meeting says: We meet Friday.\nSOURCES: P2");
  });
});
