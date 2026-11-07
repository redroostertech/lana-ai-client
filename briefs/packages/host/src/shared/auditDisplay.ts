/**
 * Plain language for the audit log: one sentence and one category per entry, and day
 * groups for the list. Display only. Stored entries, their hashes and the export never
 * change; this reads them.
 */

export type AuditCategory = "meetings" | "devices" | "actions" | "security";

export const AUDIT_CATEGORIES: readonly AuditCategory[] = ["meetings", "devices", "actions", "security"];

/** Names the main process could find for the ids in an entry. Missing ids fall back to a short id. */
export interface AuditNames {
  /** Meeting id to meeting title. */
  readonly meetings: ReadonlyMap<string, string>;
  /** Device id to the paired device's display name. */
  readonly devices: ReadonlyMap<string, string>;
  /** Action (intent) id to the action title. */
  readonly actions: ReadonlyMap<string, string>;
}

/** The stored fields a sentence is made from. `detail` is the parsed detail object. */
export interface AuditFacts {
  readonly at: Date;
  readonly event: string;
  readonly subject: string;
  readonly detail: Readonly<Record<string, string>>;
}

export interface AuditDescription {
  readonly sentence: string;
  readonly category: AuditCategory;
}

export const NO_AUDIT_NAMES: AuditNames = { meetings: new Map(), devices: new Map(), actions: new Map() };

const SHORT_ID_LENGTH = 6;

const clockTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** "7:30 AM", or "Nov 2, 7:30 AM" when it falls on a later day than `from`. */
export function auditTime(date: Date, from: Date): string {
  return sameDay(date, from) ? clockTime.format(date) : `${monthDay.format(date)}, ${clockTime.format(date)}`;
}

/** "01M6A8..." from "mtg_01M6A803VKNQ9ZTXNRHGYNWYVQ": the id after its prefix, cut short. */
export function shortId(id: string): string {
  const bare = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  return bare.length > SHORT_ID_LENGTH ? `${bare.slice(0, SHORT_ID_LENGTH)}...` : bare;
}

/** "Record send declined" from "record.send_declined", for events this build does not know. */
export function tidyEventKey(event: string): string {
  const words = event.split(/[._]+/).filter((word) => word.length > 0).join(" ").toLowerCase();
  return words.length === 0 ? "Audit entry" : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The filter an event belongs to. Unknown events go by their prefix. */
export function auditCategory(event: string): AuditCategory {
  const prefix = event.split(".")[0] ?? "";
  if (event === "audio.purged" || event === "store.imported" || prefix === "connector" || prefix === "entitlement") return "security";
  if (prefix === "bundle" || prefix === "meeting" || prefix === "record") return "meetings";
  if (prefix === "device" || prefix === "handoff") return "devices";
  if (prefix === "intent" || prefix === "action" || prefix === "draft") return "actions";
  return "security";
}

/** One plain sentence for an entry, with names where the main process found them. */
export function describeAuditEntry(facts: AuditFacts, names: AuditNames = NO_AUDIT_NAMES): AuditDescription {
  return { sentence: sentence(facts, names), category: auditCategory(facts.event) };
}

// MARK: - Day groups

export interface AuditDay<Row> {
  /** "Today", "Yesterday", "Saturday, October 31" (with the year when it is not this year). */
  readonly title: string;
  readonly rows: Row[];
}

const weekdayMonthDay = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const weekdayMonthDayYear = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export function auditDayTitle(date: Date, now: Date): string {
  if (sameDay(date, now)) return "Today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.getFullYear() === now.getFullYear() ? weekdayMonthDay.format(date) : weekdayMonthDayYear.format(date);
}

/** Groups rows by local calendar day, keeping their order. */
export function groupAuditDays<Row extends { readonly at: string }>(rows: readonly Row[], now: Date): Array<AuditDay<Row>> {
  const days: Array<AuditDay<Row>> = [];
  let current: { key: string; day: AuditDay<Row> } | null = null;
  for (const row of rows) {
    const date = new Date(row.at);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (current === null || current.key !== key) {
      current = { key, day: { title: auditDayTitle(date, now), rows: [] } };
      days.push(current.day);
    }
    current.day.rows.push(row);
  }
  return days;
}

// MARK: - Private

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const METHODS: Readonly<Record<string, string>> = { acoustic: "tone", qr: "QR code", mac_approval: "approval on this computer" };
const CONNECTORS: Readonly<Record<string, string>> = { clio: "Clio", microsoft: "Microsoft 365" };
const EXECUTOR_PLACES: Readonly<Record<string, string>> = { clio: "Clio", graph: "Outlook" };
const ACTION_KINDS: Readonly<Record<string, string>> = {
  "note.log": "Log a note in Clio",
  "task.create": "Create a task in Clio",
  "email.draft": "Draft an email in Outlook",
};
const UNITS: Readonly<Record<string, string>> = {
  title: "the title",
  speaker: "a speaker name",
  segment: "a transcript line",
  gaps: "the open questions",
  keypoint: "a key point",
  note: "a note",
  clip: "a clip",
  intent: "an action",
};
const CHOICES: Readonly<Record<string, string>> = { phone: "your phone's version", desktop: "this computer's version", edited: "an edited version" };
const STATUS_WORDS: Readonly<Record<string, string>> = {
  proposed: "proposed",
  transferred: "received",
  resolved: "ready",
  confirmed: "confirmed",
  executed: "done",
  failed: "failed",
  dismissed: "dismissed",
  undone: "undone",
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function count(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/** "an action" or "a decision" (an open question's draft is an action). */
function draftWhat(kind: string | undefined): string {
  return kind === "decision" ? "a decision" : "an action";
}

function sentence(facts: AuditFacts, names: AuditNames): string {
  const { event, subject, detail } = facts;
  // Names are shown as written; only the fallback words take a capital at the start of a sentence.
  const meeting = (id: string | undefined, opening = false) => {
    if (id === undefined || id === "") return opening ? "A meeting" : "a meeting";
    return names.meetings.get(id) ?? `${opening ? "Meeting" : "meeting"} ${shortId(id)}`;
  };
  const device = (id: string | undefined, opening = false) => {
    if (id === undefined || id === "") return opening ? "Your phone" : "your phone";
    return names.devices.get(id) ?? `${opening ? "Phone" : "phone"} ${shortId(id)}`;
  };
  const action = (id: string) => names.actions.get(id) ?? ACTION_KINDS[detail["type"] ?? ""] ?? `action ${shortId(id)}`;
  const place = () => {
    const executor = detail["executor"] ?? "";
    return EXECUTOR_PLACES[executor.split(".")[0] ?? ""] ?? null;
  };
  const phone = detail["phone_device_id"];

  switch (event) {
    case "device.paired":
      return `Paired ${device(subject)}`;
    case "device.revoked":
      return `Unpaired ${device(subject)}`;
    case "bundle.received": {
      const from = phone === undefined ? "" : ` from ${device(phone)}`;
      const method = METHODS[detail["attestation_method"] ?? detail["attestation"] ?? ""];
      return `Received ${meeting(detail["meeting_id"])}${from}${method === undefined ? "" : `, verified by ${method}`}`;
    }
    case "meeting.updated": {
      const from = phone === undefined ? "" : ` from ${device(phone)}`;
      const conflicts = count(detail["conflicts"]) ?? 0;
      const suffix = conflicts > 0 ? `, ${plural(conflicts, "change", "changes")} to reconcile` : "";
      return `Received changes to ${meeting(detail["meeting_id"])}${from}${suffix}`;
    }
    case "meeting.recorded":
      return `Recorded ${meeting(subject)} on this computer`;
    case "meeting.notes_written":
      return `Wrote the notes for ${meeting(subject)}`;
    case "meeting.queued":
      return `${meeting(subject, true)} queued to send to ${device(phone)}`;
    case "record.update_sent":
      return `Sent ${meeting(subject)} to ${device(phone)}`;
    case "record.send_declined":
      return `${device(phone, true)} declined ${meeting(subject)}`;
    case "record.send_cancelled":
      return `Send of ${meeting(subject)} to ${device(phone)} cancelled`;
    case "record.send_snoozed":
      return `${device(phone, true)} chose Not now for ${meeting(subject)}`;
    case "record.conflict_resolved": {
      const unit = UNITS[detail["unit"] ?? ""] ?? "a change";
      const choice = CHOICES[detail["choice"] ?? ""];
      return `Reconciled ${unit} in ${meeting(subject)}${choice === undefined ? "" : `, kept ${choice}`}`;
    }
    case "draft.requested":
      return `Asked LANA to draft ${draftWhat(detail["kind"])} from ${meeting(subject)}`;
    case "draft.ready":
      return detail["drafted"] === "false"
        ? `LANA could not draft ${draftWhat(detail["kind"])} from ${meeting(subject)}, so it starts from the clip`
        : `LANA drafted ${draftWhat(detail["kind"])} from ${meeting(subject)}`;
    case "draft.cancelled":
      return `Draft of ${draftWhat(detail["kind"])} from ${meeting(subject)} cancelled`;
    case "draft.added":
      return `Drafted decision added to ${meeting(subject)}`;
    case "intent.quarantined":
      return `Set aside an action from ${meeting(detail["meeting_id"])} that did not pass checks`;
    case "intent.transition":
      return transition(detail, action(subject));
    case "intent.edited":
      return detail["actor"] === "phone" ? `Action edited on your phone: ${action(subject)}` : `Action edited: ${action(subject)}`;
    case "action.executed": {
      const where = place();
      const verb = detail["deduplicated"] === "true" ? "Action already done" : "Action done";
      return `${verb}${where === null ? "" : ` in ${where}`}: ${action(subject)}`;
    }
    case "action.failed": {
      const where = place();
      return `Action failed${where === null ? "" : ` in ${where}`}: ${action(subject)}`;
    }
    case "action.ran":
      return `Ran ${action(subject)} in LANA`;
    case "action.created_manually":
      return detail["meeting_id"] ? `Added by you: ${action(subject)}, linked to ${meeting(detail["meeting_id"])}` : `Added by you: ${action(subject)}`;
    case "action.saved":
      return `Saved changes: ${action(subject)}`;
    case "action.deleted":
      return `Deleted: ${action(subject)}`;
    case "action.restored":
      return `Restored: ${action(subject)}`;
    case "action.undone": {
      if (detail["lana_id"] !== undefined) return `Undid ${action(subject)} in LANA`;
      const where = place();
      return `Action undone${where === null ? "" : ` in ${where}`}: ${action(subject)}`;
    }
    case "connector.linked":
      return `Connected ${CONNECTORS[detail["connector"] ?? subject] ?? tidyEventKey(subject)}`;
    case "connector.unlinked":
      return `Disconnected ${CONNECTORS[detail["connector"] ?? subject] ?? tidyEventKey(subject)}`;
    case "audio.purged": {
      const days = count(detail["days"]);
      const parts = count(detail["parts"]);
      const age = days === null ? "" : ` older than ${plural(days, "day", "days")}`;
      return `Audio${age} removed by retention${parts === null ? "" : `, ${plural(parts, "file", "files")}`}`;
    }
    case "store.imported":
      return "Meetings and phone pairing moved from the LANA Briefs app into LANA";
    case "entitlement.changed": {
      const organization = subject === "" ? "" : ` for ${subject}`;
      if (detail["state"] === "enabled") return `LANA Briefs turned on${organization}`;
      if (detail["state"] === "disabled") return `LANA Briefs turned off${organization}`;
      return `LANA Briefs access changed${organization}`;
    }
    case "handoff.lease_issued": {
      const expires = detail["expires_at"] === undefined ? null : new Date(detail["expires_at"]);
      const until = expires === null || Number.isNaN(expires.getTime()) ? "" : ` until ${auditTime(expires, facts.at)}`;
      return `Background updates lease issued to ${device(subject)}${until}`;
    }
    case "handoff.leased_session":
      return leasedSession(detail, device(subject));
    case "handoff.leases_revoked":
      if (subject !== "all") return `Background updates leases ended for ${device(subject)}`;
      if (detail["reason"] === "setting_off") return "Background updates turned off, all leases ended";
      if (detail["reason"] === "signed_out") return "Signed out, all background updates leases ended";
      return "All background updates leases ended";
    default:
      return tidyEventKey(event);
  }
}

function transition(detail: Readonly<Record<string, string>>, title: string): string {
  const to = detail["to"] ?? "";
  if (to === "resolved" && detail["from"] === "transferred" && detail["target"] !== undefined) return `Chose the ${detail["target"]} for: ${title}`;
  const word = STATUS_WORDS[to];
  return word === undefined ? `Action changed: ${title}` : `Action ${word}: ${title}`;
}

function leasedSession(detail: Readonly<Record<string, string>>, phone: string): string {
  const sent = count(detail["updates_sent"]) ?? 0;
  switch (detail["result"]) {
    case "completed":
      return sent === 0 ? `Background update with ${phone}, nothing to send` : `Background update sent ${plural(sent, "meeting", "meetings")} to ${phone}`;
    case "rejected":
      return `Background update from ${phone} refused`;
    case "failed":
      return `Background update with ${phone} failed`;
    default:
      return `Background update with ${phone}`;
  }
}
