import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AVAILABLE } from "@lana/core/ask";
import { makeLanaId } from "@lana/core/ids";
import { titleOf } from "@lana/core/intent";
import { localMeetingRecord } from "@lana/core/recording";
import type { TextModel, TextModelRequest } from "@lana/core/runtime";
import type { LanaEvent } from "../src/shared/api.js";
import { NotesWriter } from "../src/main/services/recording/notesWriter.js";
import { RecordsService } from "../src/main/gateway/recordsService.js";
import { openRealRig, type RealRig } from "./support/realRig.js";

// Synthetic meeting text only.
const TRANSCRIPT = [
  { speaker: "S1", start: 0, end: 6, text: "Thanks for joining. Let's review the Acme intake today." },
  { speaker: "S2", start: 6, end: 12, text: "The retainer is 2,500 dollars and covers the first three months." },
  { speaker: "S2", start: 12, end: 18, text: "I will send the engagement letter to Acme Logistics by Friday." },
  { speaker: "S1", start: 18, end: 24, text: "We agreed to go to mediation in December." },
];

const REPLY = [
  "POINT: summary | L1 | The team reviewed the Acme intake.",
  "POINT: summary | L2 | The retainer is 2,500 dollars and covers the first three months.",
  "POINT: decision | L4 | S1 | Mediation in December.",
  "ACTION: task | L3 | Send the engagement letter | Send it to Acme Logistics | by Friday | S2 | Acme Logistics",
  "SUMMARY: Intake reviewed.",
].join("\n");

class Same implements TextModel {
  readonly modelID = "scripted";
  async availability() {
    return AVAILABLE;
  }
  async respond(request: TextModelRequest): Promise<string> {
    return request.prompt.includes("Transcript part") ? REPLY : "NONE";
  }
}

let rig: RealRig;
beforeEach(async () => {
  rig = await openRealRig();
});
afterEach(() => rig.cleanup());

function storeLocal() {
  const id = makeLanaId("meeting");
  rig.store.local.insert(localMeetingRecord({
    id, title: "Intake", startedAt: rig.clock.now(), durationSeconds: 24, consent: { method: "verbal_announced", confirmedBy: [], confirmedAt: rig.clock.now() },
    userNotes: [], appVersion: "0.1.0", speakers: [{ id: "S1" }, { id: "S2" }], transcript: TRANSCRIPT,
  }), []);
  return id;
}

describe("writing the notes again respects what the person took out", () => {
  it("never brings back a key point the person removed or an action the person dismissed", async () => {
    const id = storeLocal();
    const writer = new NotesWriter(rig.store, new Same(), rig.log);
    expect(await writer.write(id, () => undefined)).toBe("written");
    const first = rig.store.shared.current(id);
    expect(first.notes.keyPoints.map((point) => point.text)).toContain("The retainer is 2,500 dollars and covers the first three months.");
    expect(first.intents).toHaveLength(1);

    const events: LanaEvent[] = [];
    const records = new RecordsService({ store: rig.store, sendToPhone: () => undefined, cancelSend: () => "not_queued" }, (event) => events.push(event), rig.log);
    const retainer = first.notes.keyPoints.find((point) => point.text.startsWith("The retainer"))!;
    expect(await records.removeKeyPoint(id, retainer.id)).toEqual({ ok: true, value: null });
    rig.store.intents.transition(first.intents[0]!.id, "dismissed", "user");

    expect(await writer.write(id, () => undefined)).toBe("written");
    const again = rig.store.shared.current(id);
    expect(again.notes.keyPoints.map((point) => point.text)).toEqual(["The team reviewed the Acme intake.", "Mediation in December."]);
    const open = rig.store.intents.list({ meetingID: id }).filter((stored) => stored.intent.status !== "dismissed");
    expect(open.map((stored) => titleOf(stored.intent.params))).toEqual([]);
    expect(rig.log.lines.join("\n")).not.toContain("retainer");
  });

  it("brings back an action LANA itself put away on the rewrite (nobody dismissed it)", async () => {
    const id = storeLocal();
    const writer = new NotesWriter(rig.store, new Same(), rig.log);
    await writer.write(id, () => undefined);
    await writer.write(id, () => undefined);
    const open = rig.store.intents.list({ meetingID: id }).filter((stored) => stored.intent.status !== "dismissed");
    expect(open.map((stored) => titleOf(stored.intent.params))).toEqual(["Send the engagement letter"]);
  });
});
