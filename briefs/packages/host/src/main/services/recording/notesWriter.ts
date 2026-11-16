import { loadVocabulary } from "@lana/core/gateway";
import type { LanaId } from "@lana/core/ids";
import type { TextModel } from "@lana/core/runtime";
import type { GatewayStore } from "@lana/core/store";
import { MeetingSummarizer, RuntimeNotesBackend, SummarizerUnavailableError } from "@lana/core/summarizer";
import type { MainLog } from "../../log.js";

export type NotesOutcome = "written" | "unavailable" | "empty" | "failed";

/** Writing the notes for one meeting recorded here (the recording service's port). */
export interface NotesWriting {
  write(meetingID: LanaId, progress: (fraction: number) => void): Promise<NotesOutcome>;
}

/**
 * LANA's notes for a meeting recorded on this computer: the TypeScript port of the phone's
 * note writer (`MeetingSummarizer` over `notes.chunk.v1`, checked against Swift golden
 * vectors) on the LANA model. Key points cite transcript lines; every action's quotes come
 * from the transcript and pass the intent validator before it reaches the Inbox. Failures
 * leave the meeting as it is. Logs carry ids and counts only.
 */
export class NotesWriter implements NotesWriting {
  constructor(private readonly store: GatewayStore, private readonly model: TextModel, private readonly log: MainLog) {}

  async write(meetingID: LanaId, progress: (fraction: number) => void): Promise<NotesOutcome> {
    const record = this.store.shared.current(meetingID);
    if (record.transcript.length === 0) return "empty";
    const rewrite = record.provenance.notesModel !== "";
    try {
      const summarizer = new MeetingSummarizer(new RuntimeNotesBackend(this.model));
      const result = await summarizer.summarize({
        transcript: record.transcript,
        speakers: record.speakers,
        meetingID,
        now: new Date(),
        meetingStart: record.startedAt,
        vocabulary: loadVocabulary(this.store.settings).map((entry) => entry.term),
        // Once notes were written, the record's set-aside parts are the person's reviewed list.
        ...(rewrite ? { fixedSetAside: record.notes.setAside ?? [] } : {}),
        progress,
      });
      // Writing the notes again replaces the actions nobody has touched yet, and never repeats
      // one this meeting already has.
      if (rewrite) {
        for (const stored of this.store.intents.list({ meetingID, statuses: ["transferred"] })) {
          this.store.intents.transition(stored.intent.id, "dismissed", "system", { reason: "notes_rewritten" });
        }
      }
      const existing = new Set(this.store.intents.list({ meetingID }).filter((stored) => stored.intent.status !== "dismissed").map((stored) => stored.intent.idempotencyKey));
      const fresh = result.intents.filter((intent) => !existing.has(intent.idempotencyKey));
      const added = this.store.local.applyNotes(meetingID, result.notes, fresh, result.modelID);
      this.log.info("recording.notes_written", {
        meeting: meetingID, key_points: result.notes.keyPoints.length, actions: added.length, dropped: result.droppedIntentCount, chunks: result.chunkCount, skipped: result.skippedChunks.length,
      });
      return "written";
    } catch (error) {
      if (error instanceof SummarizerUnavailableError) {
        this.log.notice("recording.notes_unavailable", { meeting: meetingID });
        return "unavailable";
      }
      this.log.error("recording.notes_failed", { meeting: meetingID, kind: error instanceof Error ? error.name : "unknown" });
      return "failed";
    }
  }
}
