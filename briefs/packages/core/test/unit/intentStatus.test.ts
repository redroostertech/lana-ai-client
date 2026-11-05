import { describe, expect, it } from "vitest";
import { canTransition, INTENT_STATUSES, InvalidTransitionError, isTerminalStatus, transitioned, makeIntent } from "../../src/intent/index.js";
import { makeLanaId } from "../../src/ids/index.js";

describe("intent lifecycle", () => {
  it("allows exactly the Swift moves", () => {
    const legal = INTENT_STATUSES.flatMap((from) => INTENT_STATUSES.filter((to) => canTransition(from, to)).map((to) => `${from}>${to}`));
    expect(legal).toEqual([
      "proposed>transferred",
      "transferred>resolved", "transferred>failed", "transferred>dismissed",
      "resolved>resolved", "resolved>confirmed", "resolved>dismissed",
      "confirmed>executed", "confirmed>failed",
      "executed>undone",
      "failed>resolved", "failed>confirmed", "failed>dismissed",
    ]);
    expect(INTENT_STATUSES.filter(isTerminalStatus)).toEqual(["dismissed", "undone"]);
  });

  it("throws on an illegal move", () => {
    const intent = makeIntent({
      meetingID: makeLanaId("meeting"),
      params: { type: "note.log", note: { subject: "Call notes", body: "Body" } },
      confidence: 0.9,
      evidence: [{ speaker: "S1", tStart: 0, tEnd: 1, quote: "Log it." }],
      createdAt: new Date(),
    });
    expect(transitioned(intent, "transferred").status).toBe("transferred");
    expect(() => transitioned(intent, "executed")).toThrow(InvalidTransitionError);
  });
});
