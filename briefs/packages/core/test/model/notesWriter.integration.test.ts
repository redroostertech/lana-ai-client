import { describe, expect, it } from "vitest";
import { makeLanaId } from "../../src/ids/index.js";
import { validateIntent, type TranscriptSegment } from "../../src/intent/index.js";
import { MeetingSummarizer, RuntimeNotesBackend } from "../../src/summarizer/index.js";
import { realModel, RUN_MODEL_TESTS } from "../support/modelEnv.js";

/**
 * The note writer on the real LANA model (opt in): `LANA_RUN_MODEL_TESTS=1 LANA_MODELS_DIR=<folder>`
 * or `LANA_EVAL_GGUF=<file>`. Checks what must hold whatever the model writes: every point
 * cites the transcript, every action passed the validator and quotes the transcript word for word.
 */
const TRANSCRIPT: TranscriptSegment[] = [
  { speaker: "S1", start: 0, end: 6, text: "Thanks for joining. Let's review the Acme Logistics intake and the filing deadline next Friday." },
  { speaker: "S2", start: 6.5, end: 12, text: "I spoke with the client yesterday and they want the draft complaint by Wednesday." },
  { speaker: "S1", start: 12.5, end: 18, text: "Okay. I will send the engagement letter to Acme Logistics today and schedule a follow up call." },
  { speaker: "S2", start: 18.5, end: 24, text: "We agreed to go to mediation in December rather than trial." },
  { speaker: "S1", start: 24.5, end: 30, text: "We still do not know whether the insurance policy covers the warehouse fire." },
  { speaker: "S2", start: 30.5, end: 36, text: "Please email Sofia Marin the draft by November 14 so she can review it." },
];

describe.skipIf(!RUN_MODEL_TESTS)("note writer on the LANA model (opt in)", () => {
  it("writes grounded notes and validated actions", async () => {
    const real = await realModel();
    const model = { modelID: real.modelID, availability: () => real.availability(), respond: async (request: Parameters<typeof real.respond>[0]) => { const reply = await real.respond(request); if (process.env["LANA_SHOW_REPLY"] === "1") process.stdout.write(`REPLY<<${reply}>>\n`); return reply; } };
    const meetingID = makeLanaId("meeting");
    const started = Date.now();
    const result = await new MeetingSummarizer(new RuntimeNotesBackend(model)).summarize({ transcript: TRANSCRIPT, speakers: [{ id: "S1" }, { id: "S2" }], meetingID, now: new Date() });
    process.stdout.write(`notes: ${result.notes.keyPoints.length} points (${result.notes.keyPoints.map((point) => point.kind).join(",")}), ${result.intents.length} actions, ${result.droppedIntentCount} dropped, ${Date.now() - started} ms\n`);
    expect(result.notes.keyPoints.length).toBeGreaterThan(0);
    expect(result.skippedChunks).toEqual([]);
    for (const point of result.notes.keyPoints) {
      for (const span of point.sources) expect(TRANSCRIPT.some((line) => span.start <= line.end && span.end >= line.start)).toBe(true);
    }
    for (const intent of result.intents) {
      expect(validateIntent(intent)).toEqual([]);
      for (const quote of intent.evidence) expect(TRANSCRIPT.map((line) => line.text)).toContain(quote.quote);
    }
  }, 300_000);
});
