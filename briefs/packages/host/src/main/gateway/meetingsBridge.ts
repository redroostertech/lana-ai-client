import type { AttestationMethod as CoreMethod } from "@lana/core/handoff";
import { parseLanaId } from "@lana/core/ids";
import { displayTitleOf, overlapsSetAside, segmentSetAside, speakerDisplayName, type IntentParams, type MeetingRecord as CoreMeeting } from "@lana/core/intent";
import type { GatewayStore, MeetingOrigin } from "@lana/core/store";
import type { AttestationMethod, MeetingRecord, MeetingsApi, MeetingSummary, Result } from "../../shared/api.js";
import type { MainLog } from "../log.js";

const NOT_FOUND = { code: "notFound", message: "That meeting is no longer on this computer." } as const;
const UNREADABLE = { code: "store", message: "LANA could not read this meeting from its encrypted store." } as const;
const HIDDEN_STATUSES = new Set(["dismissed", "undone"]);
/** Statuses where the person said yes to the action: "Action made" on the meeting. */
const CONFIRMED_STATUSES = new Set(["confirmed", "executed"]);

/** How the meeting got here; a meeting recorded on this computer has no phone proof. */
export function toApiMethod(method: CoreMethod, origin: MeetingOrigin = "phone"): AttestationMethod {
  if (origin === "computer") return "recordedHere";
  return method === "mac_approval" ? "macApproval" : method;
}

/** A received meeting in the renderer's shape. Text goes to the window, never to logs. */
export function toApiMeeting(record: CoreMeeting, extra: { method: CoreMethod; origin?: MeetingOrigin; hasAudio: boolean; actions: MeetingRecord["actions"] }): MeetingRecord {
  return {
    id: record.id,
    title: record.title,
    startedAt: record.startedAt.toISOString(),
    durationSeconds: record.durationSeconds,
    speakers: record.speakers.map((speaker) => ({ id: speaker.id, name: speakerDisplayName(speaker) })),
    transcript: record.transcript.map((segment) => ({ speaker: segment.speaker, start: segment.start, end: segment.end, text: segment.text })),
    // Anything citing a set-aside part (one set aside after the notes were written) is not shown.
    keyPoints: record.notes.keyPoints.filter((point) => !point.sources.some((span) => overlapsSetAside(span.start, span.end, record.notes.setAside, 0.5))).map((point) => ({
      id: point.id,
      kind: point.kind === "open_question" ? "openQuestion" : point.kind,
      text: pointText(point.text),
      sources: point.sources.map((span) => ({ start: span.start, end: span.end, speaker: span.speaker ?? null })),
      precision: point.precision,
      decidedBy: point.decidedBy ?? null,
    })),
    setAside: (record.notes.setAside ?? []).map((part) => ({ start: part.start, end: part.end, reason: part.reason, speakers: [...(part.speakers ?? [])], ...(part.by === "person" ? { by: "person" as const } : {}) })),
    tables: (record.notes.tables ?? []).filter((table) => !table.sources.some((span) => overlapsSetAside(span.start, span.end, record.notes.setAside, 0.5))).map((table) => ({
      title: table.title, columns: [...table.columns], rows: table.rows.map((row) => [...row]),
      sources: table.sources.map((span) => ({ start: span.start, end: span.end, speaker: span.speaker ?? null })),
    })),
    speakersNamed: speakersNamed(record),
    unnamedSpeakers: unnamedSpeakers(record),
    gaps: record.notes.gaps.map((gap) => ({ start: gap.start, end: gap.end, reason: gap.reason === "refused" ? "refused" : "failed" })),
    userNotes: record.userNotes.map((note) => ({ id: note.id, text: note.text, createdAt: note.createdAt.toISOString(), anchor: note.anchor ?? null })),
    clips: record.clips.map((clip) => ({ id: clip.id, start: clip.start, end: clip.end })),
    actions: extra.actions,
    consent: record.consent.method === "all_parties_confirmed" ? "allPartiesConfirmed" : "announced",
    attestationMethod: toApiMethod(extra.method, extra.origin),
    hasAudio: extra.hasAudio,
  };
}

/**
 * A key point's text as shown and exported. Notes written before strict reading can hold raw
 * model fields ("a | none | b"); only the first non-empty field is shown, never a "|".
 */
export function pointText(text: string): string {
  if (!text.includes("|")) return text;
  return text.split("|").map((field) => field.trim()).find((field) => field !== "") ?? "";
}

/** Labels of speakers with a line outside the set-aside parts and no typed name, in label order. */
export function unnamedSpeakers(record: CoreMeeting): string[] {
  const used = new Set(record.transcript.filter((segment) => segment.text.trim() !== "" && !segmentSetAside(segment, record.notes.setAside)).map((segment) => segment.speaker));
  const named = new Set(record.speakers.filter((speaker) => speaker.name !== undefined && speaker.name.trim() !== "").map((speaker) => speaker.id));
  return [...used].filter((id) => !named.has(id)).sort((a, b) => Number(a.replace(/\D/gu, "")) - Number(b.replace(/\D/gu, "")) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Whether every speaker with a line outside the set-aside parts has a typed name. */
export function speakersNamed(record: CoreMeeting): boolean {
  return unnamedSpeakers(record).length === 0;
}

/** Owner and due date of an action, as the meeting page and the export print them. */
export function actionFacts(params: IntentParams): { owner: string | null; dueDate: string | null; dueText: string | null } {
  if (params.type !== "task.create") return { owner: null, dueDate: null, dueText: null };
  return { owner: params.task.assigneeHint ?? null, dueDate: params.task.dueDate ?? null, dueText: params.task.dueText ?? null };
}

/** Received meetings from the real `GatewayStore`. */
export class MeetingsBridge implements Omit<MeetingsApi, "audio"> {
  constructor(private readonly store: GatewayStore, private readonly log: MainLog) {}

  async list(): Promise<Result<MeetingSummary[]>> {
    try {
      return {
        ok: true,
        value: this.store.meetings.list().map((meeting) => ({
          id: meeting.id,
          title: meeting.title,
          startedAt: meeting.startedAt.toISOString(),
          durationSeconds: meeting.durationSeconds,
          openIntents: meeting.openIntents,
          unreadActions: meeting.unreadActions,
          attestationMethod: toApiMethod(meeting.attestationMethod, meeting.origin),
        })),
      };
    } catch {
      this.log.error("meetings.list_failed");
      return { ok: false, error: UNREADABLE };
    }
  }

  async get(id: string): Promise<Result<MeetingRecord>> {
    const meetingID = parseLanaId(String(id), "meeting");
    if (meetingID === null) return { ok: false, error: NOT_FOUND };
    try {
      const summary = this.store.meetings.list().find((meeting) => meeting.id === meetingID);
      if (summary === undefined) return { ok: false, error: NOT_FOUND };
      const record = this.store.shared.current(meetingID);
      const actions = this.store.intents
        .list({ meetingID })
        .filter((stored) => !HIDDEN_STATUSES.has(stored.intent.status))
        .filter((stored) => !stored.intent.evidence.some((item) => overlapsSetAside(item.tStart, item.tEnd, record.notes.setAside, 0.5)))
        .map((stored) => {
          const evidence = stored.intent.evidence;
          const start = evidence.length === 0 ? 0 : Math.min(...evidence.map((item) => item.tStart));
          return {
            id: stored.intent.id,
            title: pointText(displayTitleOf(stored.intent.params)),
            at: start,
            confirmed: CONFIRMED_STATUSES.has(stored.intent.status),
            ...actionFacts(stored.intent.params),
            start,
            end: evidence.length === 0 ? start : Math.max(...evidence.map((item) => item.tEnd)),
          };
        });
      return { ok: true, value: toApiMeeting(record, { method: summary.attestationMethod, origin: summary.origin, hasAudio: summary.audioAvailable, actions }) };
    } catch {
      this.log.error("meetings.get_failed", { meeting: meetingID });
      return { ok: false, error: UNREADABLE };
    }
  }
}
