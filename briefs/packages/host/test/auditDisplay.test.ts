import { describe, expect, it } from "vitest";
import { AUDIT_EVENTS } from "@lana/core/store";
import {
  auditCategory,
  auditDayTitle,
  describeAuditEntry,
  groupAuditDays,
  NO_AUDIT_NAMES,
  shortId,
  tidyEventKey,
  type AuditCategory,
  type AuditNames,
} from "../src/shared/auditDisplay.js";

const MEETING = "mtg_01M6A803VKNQ9ZTXNRHGYNWYVQ";
const PHONE = "dev_01M6A7TWW46W93TBEHEWANBHGJ";
const ACTION = "int_01M6B2Q8ZK3V7RWXN4TYCPHD5M";
const BUNDLE = "bdl_01M6CQ2RNN6Q6N0B4RS2RBXBGY";
const AT = new Date(2026, 10, 1, 18, 28, 31);

const NAMES: AuditNames = {
  meetings: new Map([[MEETING, "Social Work Practice"]]),
  devices: new Map([[PHONE, "Mike's iPhone"]]),
  actions: new Map([[ACTION, "Log a note in Clio"]]),
};

const say = (event: string, subject: string, detail: Record<string, string> = {}, names: AuditNames = NAMES) =>
  describeAuditEntry({ at: AT, event, subject, detail }, names).sentence;

/** One stored shape per event, as core and the main process write them. */
const STORED: Record<string, { subject: string; detail: Record<string, string>; sentence: string; category: AuditCategory }> = {
  "device.paired": { subject: PHONE, detail: {}, sentence: "Paired Mike's iPhone", category: "devices" },
  "device.revoked": { subject: PHONE, detail: {}, sentence: "Unpaired Mike's iPhone", category: "devices" },
  "bundle.received": {
    subject: BUNDLE,
    detail: { meeting_id: MEETING, phone_device_id: PHONE, attestation_method: "acoustic", attestation_latency_ms: "420", tone_plays: "1", intents: "3", quarantined: "0", audio_parts: "4" },
    sentence: "Received Social Work Practice from Mike's iPhone, verified by tone",
    category: "meetings",
  },
  "intent.quarantined": {
    subject: ACTION,
    detail: { meeting_id: MEETING, issues: "params" },
    sentence: "Set aside an action from Social Work Practice that did not pass checks",
    category: "actions",
  },
  "intent.transition": {
    subject: ACTION,
    detail: { actor: "user", from: "resolved", to: "confirmed", type: "note.log", plan_hash: "9f2c" },
    sentence: "Action confirmed: Log a note in Clio",
    category: "actions",
  },
  "intent.edited": { subject: ACTION, detail: { type: "note.log", actor: "user" }, sentence: "Action edited: Log a note in Clio", category: "actions" },
  "action.executed": {
    subject: ACTION,
    detail: { executor: "clio.note", external_id: "880001", deduplicated: "false", plan_hash: "9f2c" },
    sentence: "Action done in Clio: Log a note in Clio",
    category: "actions",
  },
  "action.failed": { subject: ACTION, detail: { reason: "server", executor: "clio.note" }, sentence: "Action failed in Clio: Log a note in Clio", category: "actions" },
  "action.undone": { subject: ACTION, detail: { executor: "clio.note", external_id: "880001" }, sentence: "Action undone in Clio: Log a note in Clio", category: "actions" },
  "action.ran": { subject: ACTION, detail: { lana_id: "t-42" }, sentence: "Ran Log a note in Clio in LANA", category: "actions" },
  "action.created_manually": { subject: ACTION, detail: { meeting_id: MEETING, status: "transferred", type: "task.create" }, sentence: "Added by you: Log a note in Clio, linked to Social Work Practice", category: "actions" },
  "action.saved": { subject: ACTION, detail: { from: "transferred", to: "resolved", type: "task.create" }, sentence: "Saved changes: Log a note in Clio", category: "actions" },
  "action.deleted": { subject: ACTION, detail: { origin: "meeting", status: "executed", type: "note.log" }, sentence: "Deleted: Log a note in Clio", category: "actions" },
  "action.restored": { subject: ACTION, detail: { origin: "manual", status: "resolved", type: "task.create" }, sentence: "Restored: Log a note in Clio", category: "actions" },
  "connector.linked": { subject: "clio", detail: { connector: "clio", region: "us" }, sentence: "Connected Clio", category: "security" },
  "connector.unlinked": { subject: "microsoft", detail: { connector: "microsoft" }, sentence: "Disconnected Microsoft 365", category: "security" },
  "draft.requested": { subject: MEETING, detail: { draft_id: "d1", kind: "question" }, sentence: "Asked LANA to draft an action from Social Work Practice", category: "actions" },
  "draft.ready": { subject: MEETING, detail: { draft_id: "d1", kind: "question", drafted: "false", intent_id: ACTION }, sentence: "LANA could not draft an action from Social Work Practice, so it starts from the clip", category: "actions" },
  "draft.cancelled": { subject: MEETING, detail: { draft_id: "d2", kind: "decision" }, sentence: "Draft of a decision from Social Work Practice cancelled", category: "actions" },
  "draft.added": { subject: MEETING, detail: { draft_id: "d2", kind: "decision" }, sentence: "Drafted decision added to Social Work Practice", category: "actions" },
  "entitlement.changed": { subject: "mwestbrooks", detail: { state: "enabled" }, sentence: "LANA Briefs turned on for mwestbrooks", category: "security" },
  "store.imported": { subject: "standalone", detail: {}, sentence: "Meetings and phone pairing moved from the LANA Briefs app into LANA", category: "security" },
  "audio.purged": { subject: "retention", detail: { parts: "4", days: "30" }, sentence: "Audio older than 30 days removed by retention, 4 files", category: "security" },
  "meeting.recorded": { subject: MEETING, detail: { audio_parts: "3", consent: "verbal_announced" }, sentence: "Recorded Social Work Practice on this computer", category: "meetings" },
  "meeting.notes_written": { subject: MEETING, detail: { key_points: "4", intents: "2" }, sentence: "Wrote the notes for Social Work Practice", category: "meetings" },
  "meeting.updated": {
    subject: BUNDLE,
    detail: { meeting_id: MEETING, phone_device_id: PHONE, attestation_method: "qr", revision: "4", conflicts: "2" },
    sentence: "Received changes to Social Work Practice from Mike's iPhone, 2 changes to reconcile",
    category: "meetings",
  },
  "meeting.queued": { subject: MEETING, detail: { phone_device_id: PHONE }, sentence: "Social Work Practice queued to send to Mike's iPhone", category: "meetings" },
  "record.update_sent": {
    subject: MEETING,
    detail: { phone_device_id: PHONE, update_id: BUNDLE, revision: "3", phone_revision: "3", in_sync: "true", parts: "2" },
    sentence: "Sent Social Work Practice to Mike's iPhone",
    category: "meetings",
  },
  "record.conflict_resolved": {
    subject: MEETING,
    detail: { unit: "title", choice: "phone" },
    sentence: "Reconciled the title in Social Work Practice, kept your phone's version",
    category: "meetings",
  },
  "record.send_declined": {
    subject: MEETING,
    detail: { phone_device_id: PHONE, update_id: BUNDLE },
    sentence: "Mike's iPhone declined Social Work Practice",
    category: "meetings",
  },
  "record.send_cancelled": { subject: MEETING, detail: { phone_device_id: PHONE }, sentence: "Send of Social Work Practice to Mike's iPhone cancelled", category: "meetings" },
  "record.send_snoozed": { subject: MEETING, detail: { phone_device_id: PHONE }, sentence: "Mike's iPhone chose Not now for Social Work Practice", category: "meetings" },
  "handoff.lease_issued": {
    subject: PHONE,
    detail: { expires_at: new Date(2026, 10, 1, 19, 30).toISOString(), hours: "10" },
    sentence: "Background updates lease issued to Mike's iPhone until 7:30 PM",
    category: "devices",
  },
  "handoff.leased_session": {
    subject: PHONE,
    detail: { result: "completed", listed: "3", updates_sent: "2", updates_acknowledged: "2" },
    sentence: "Background update sent 2 meetings to Mike's iPhone",
    category: "devices",
  },
  "handoff.leases_revoked": { subject: PHONE, detail: { reason: "unpaired" }, sentence: "Background updates leases ended for Mike's iPhone", category: "devices" },
};

describe("audit sentences", () => {
  it("has a stored shape and a sentence for every event core writes", () => {
    expect(Object.keys(STORED).sort()).toEqual(Object.values(AUDIT_EVENTS).sort());
  });

  it.each(Object.entries(STORED))("%s", (event, { subject, detail, sentence, category }) => {
    expect(describeAuditEntry({ at: AT, event, subject, detail }, NAMES)).toEqual({ sentence, category });
  });

  it("never shows a raw id when a name is known", () => {
    for (const [event, { subject, detail }] of Object.entries(STORED)) {
      const text = say(event, subject, detail);
      for (const id of [MEETING, PHONE, ACTION, BUNDLE]) expect(text).not.toContain(id);
    }
  });

  it("falls back to short ids when a meeting is deleted or a phone is gone", () => {
    expect(say("record.send_declined", MEETING, { phone_device_id: PHONE }, NO_AUDIT_NAMES)).toBe("Phone 01M6A7... declined meeting 01M6A8...");
    expect(say("record.update_sent", MEETING, { phone_device_id: PHONE }, NO_AUDIT_NAMES)).toBe("Sent meeting 01M6A8... to phone 01M6A7...");
    expect(say("meeting.queued", MEETING, { phone_device_id: PHONE }, NO_AUDIT_NAMES)).toBe("Meeting 01M6A8... queued to send to phone 01M6A7...");
    expect(say("device.paired", PHONE, {}, NO_AUDIT_NAMES)).toBe("Paired phone 01M6A7...");
  });

  it("says an action ran or was undone in LANA, and was added by hand without a meeting", () => {
    expect(say("action.undone", ACTION, { lana_id: "t-42" })).toBe("Undid Log a note in Clio in LANA");
    expect(say("action.created_manually", ACTION, { meeting_id: "", status: "transferred", type: "task.create" })).toBe("Added by you: Log a note in Clio");
  });

  it("names an action by its kind, then by a short id, when its title is gone", () => {
    expect(say("intent.transition", ACTION, { to: "confirmed", type: "task.create" }, NO_AUDIT_NAMES)).toBe("Action confirmed: Create a task in Clio");
    expect(say("action.executed", ACTION, { executor: "graph.draft", deduplicated: "true" }, NO_AUDIT_NAMES)).toBe("Action already done in Outlook: action 01M6B2...");
  });

  it("leaves out parts of a sentence whose detail is missing", () => {
    expect(say("bundle.received", BUNDLE, { meeting_id: MEETING })).toBe("Received Social Work Practice");
    expect(say("bundle.received", BUNDLE, {})).toBe("Received a meeting");
    expect(say("handoff.lease_issued", PHONE, { expires_at: "not a date" })).toBe("Background updates lease issued to Mike's iPhone");
    expect(say("audio.purged", "retention", {})).toBe("Audio removed by retention");
  });

  it("dates a lease that ends on a later day", () => {
    const expires = new Date(2026, 10, 2, 7, 30).toISOString();
    expect(say("handoff.lease_issued", PHONE, { expires_at: expires })).toBe("Background updates lease issued to Mike's iPhone until Nov 2, 7:30 AM");
  });

  it("says how each attestation method verified a meeting", () => {
    const via = (method: string) => say("bundle.received", BUNDLE, { meeting_id: MEETING, phone_device_id: PHONE, attestation_method: method });
    expect(via("qr")).toBe("Received Social Work Practice from Mike's iPhone, verified by QR code");
    expect(via("mac_approval")).toBe("Received Social Work Practice from Mike's iPhone, verified by approval on this computer");
  });

  it("covers every status an action moves to", () => {
    const moved = (to: string, extra: Record<string, string> = {}) => say("intent.transition", ACTION, { to, ...extra });
    expect(moved("transferred")).toBe("Action received: Log a note in Clio");
    expect(moved("resolved", { from: "transferred", target: "matter" })).toBe("Chose the matter for: Log a note in Clio");
    expect(moved("executed")).toBe("Action done: Log a note in Clio");
    expect(moved("dismissed")).toBe("Action dismissed: Log a note in Clio");
    expect(moved("undone")).toBe("Action undone: Log a note in Clio");
    expect(moved("someday")).toBe("Action changed: Log a note in Clio");
    expect(say("intent.edited", ACTION, { actor: "phone" })).toBe("Action edited on your phone: Log a note in Clio");
  });

  it("reads license entries stored by earlier builds as one generic sentence", () => {
    for (const detail of [{ action: "activated", state: "active" }, { action: "deactivated" }, { state: "grace" }, {}]) {
      expect(describeAuditEntry({ at: AT, event: "license.changed", subject: "license", detail }, NAMES)).toEqual({ sentence: "License changed", category: "security" });
    }
  });

  it("reads a drafted action LANA wrote itself", () => {
    expect(say("draft.ready", MEETING, { draft_id: "d1", kind: "action", drafted: "true" })).toBe("LANA drafted an action from Social Work Practice");
  });

  it("reads LANA Briefs being turned off", () => {
    expect(say("entitlement.changed", "mwestbrooks", { state: "disabled" })).toBe("LANA Briefs turned off for mwestbrooks");
    expect(say("entitlement.changed", "mwestbrooks", {})).toBe("LANA Briefs access changed for mwestbrooks");
  });

  it("reads lease and background update variants", () => {
    expect(say("handoff.leases_revoked", "all", { reason: "setting_off" })).toBe("Background updates turned off, all leases ended");
    expect(say("handoff.leases_revoked", "all", { reason: "signed_out" })).toBe("Signed out, all background updates leases ended");
    expect(say("handoff.leased_session", PHONE, { result: "completed", updates_sent: "0" })).toBe("Background update with Mike's iPhone, nothing to send");
    expect(say("handoff.leased_session", PHONE, { result: "completed", updates_sent: "1" })).toBe("Background update sent 1 meeting to Mike's iPhone");
    expect(say("handoff.leased_session", PHONE, { result: "rejected", reason: "expired" })).toBe("Background update from Mike's iPhone refused");
    expect(say("handoff.leased_session", PHONE, { result: "failed" })).toBe("Background update with Mike's iPhone failed");
  });

  it("tidies the key of an event this build does not know", () => {
    expect(describeAuditEntry({ at: AT, event: "record.send_rewound", subject: MEETING, detail: {} })).toEqual({ sentence: "Record send rewound", category: "meetings" });
    expect(tidyEventKey("record.send_declined")).toBe("Record send declined");
    expect(tidyEventKey("")).toBe("Audit entry");
    expect(auditCategory("vault.rotated")).toBe("security");
    expect(auditCategory("handoff.something_new")).toBe("devices");
  });

  it("shortens ids after their prefix", () => {
    expect(shortId(MEETING)).toBe("01M6A8...");
    expect(shortId("abc")).toBe("abc");
  });
});

describe("audit days", () => {
  const now = new Date(2026, 10, 1, 23, 30);

  it("titles today, yesterday, this year and older days", () => {
    expect(auditDayTitle(new Date(2026, 10, 1, 0, 5), now)).toBe("Today");
    expect(auditDayTitle(new Date(2026, 9, 31, 23, 59), now)).toBe("Yesterday");
    expect(auditDayTitle(new Date(2026, 9, 29, 9), now)).toBe("Thursday, October 29");
    expect(auditDayTitle(new Date(2025, 11, 31, 9), now)).toBe("Wednesday, December 31, 2025");
  });

  it("groups rows by local day in their order", () => {
    const rows = [new Date(2026, 9, 30, 9), new Date(2026, 9, 31, 8), new Date(2026, 9, 31, 20), new Date(2026, 10, 1, 6)].map((date, index) => ({ seq: index + 1, at: date.toISOString() }));
    expect(groupAuditDays(rows, now).map((day) => [day.title, day.rows.map((row) => row.seq)])).toEqual([
      ["Friday, October 30", [1]],
      ["Yesterday", [2, 3]],
      ["Today", [4]],
    ]);
    expect(groupAuditDays([], now)).toEqual([]);
  });
});
