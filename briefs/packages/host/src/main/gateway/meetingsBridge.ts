import type { AttestationMethod as CoreMethod } from "@lana/core/handoff";
import { parseLanaId } from "@lana/core/ids";
import { displayTitleOf, speakerDisplayName, type MeetingRecord as CoreMeeting } from "@lana/core/intent";
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
    keyPoints: record.notes.keyPoints.map((point) => ({
      id: point.id,
      kind: point.kind === "open_question" ? "openQuestion" : point.kind,
      text: point.text,
      sources: point.sources.map((span) => ({ start: span.start, end: span.end, speaker: span.speaker ?? null })),
      precision: point.precision,
    })),
    gaps: record.notes.gaps.map((gap) => ({ start: gap.start, end: gap.end, reason: gap.reason === "refused" ? "refused" : "failed" })),
    userNotes: record.userNotes.map((note) => ({ id: note.id, text: note.text, createdAt: note.createdAt.toISOString(), anchor: note.anchor ?? null })),
    clips: record.clips.map((clip) => ({ id: clip.id, start: clip.start, end: clip.end })),
    actions: extra.actions,
    consent: record.consent.method === "all_parties_confirmed" ? "allPartiesConfirmed" : "announced",
    attestationMethod: toApiMethod(extra.method, extra.origin),
    hasAudio: extra.hasAudio,
  };
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
        .map((stored) => ({
          id: stored.intent.id,
          title: displayTitleOf(stored.intent.params),
          at: stored.intent.evidence.length === 0 ? 0 : Math.min(...stored.intent.evidence.map((evidence) => evidence.tStart)),
          confirmed: CONFIRMED_STATUSES.has(stored.intent.status),
        }));
      return { ok: true, value: toApiMeeting(record, { method: summary.attestationMethod, origin: summary.origin, hasAudio: summary.audioAvailable, actions }) };
    } catch {
      this.log.error("meetings.get_failed", { meeting: meetingID });
      return { ok: false, error: UNREADABLE };
    }
  }
}
