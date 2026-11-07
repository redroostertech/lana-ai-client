import { clock, hasAudioMoment, type AskAnswer, type Passage } from "@lana/core/ask";
import type { LanaId } from "@lana/core/ids";
import type { AskCitation } from "../../../shared/api.js";

/** What citation chips read from the store: whether a meeting still has its audio. */
export interface CitationAudioSource {
  audioParts(id: LanaId): readonly unknown[];
}

/** "Helen Ortiz at 5:12", "Decision at 2:10", "Your note at 3:40" (Swift `AskCitation.title`). */
export function citationTitle(passage: Passage): string {
  const time = clock(passage.start);
  switch (passage.kind) {
    case "transcript":
      return `${speakerText(passage.speakers)} at ${time}`;
    case "keyPoint": {
      const kind = passage.keyPointKind === "decision" ? "Decision" : passage.keyPointKind === "open_question" ? "Open question" : "Key point";
      return `${kind} at ${time}`;
    }
    case "userNote":
      return passage.start > 0 ? `Your note at ${time}` : "Your note";
    case "action":
      return `Action at ${time}`;
  }
}

export function speakerText(speakers: readonly string[]): string {
  if (speakers.length === 0) return "Transcript";
  if (speakers.length === 1) return speakers[0] ?? "";
  if (speakers.length === 2) return `${speakers[0]} and ${speakers[1]}`;
  return `${speakers[0]} and ${speakers.length - 1} others`;
}

/**
 * Chips for an answer (Swift `AskCitationBuilder`): whether each span can still be played
 * (audio is read once per meeting cited) and whether the chip names its meeting.
 */
export function buildCitations(answer: Pick<AskAnswer, "citations">, namesMeeting: boolean, store: CitationAudioSource): AskCitation[] {
  const withAudio = new Map<LanaId, boolean>();
  for (const passage of answer.citations) {
    if (!withAudio.has(passage.meetingID)) {
      let parts = 0;
      try {
        parts = store.audioParts(passage.meetingID).length;
      } catch {
        parts = 0;
      }
      withAudio.set(passage.meetingID, parts > 0);
    }
  }
  return answer.citations.map((passage) => ({
    id: passage.id,
    title: citationTitle(passage),
    meetingID: passage.meetingID,
    meetingTitle: namesMeeting ? passage.meetingTitle : null,
    start: passage.start,
    end: passage.end,
    audio: !hasAudioMoment(passage) ? "none" : withAudio.get(passage.meetingID) === true ? "available" : "removed",
  }));
}
