import type { Speaker } from "../intent/meetingParts.js";

/**
 * Speaker labels in text LANA writes (Amendment 9, notes and Find more, both platforms): a bare
 * label (S1, S2 ... as a whole word) becomes the speaker's name when the speaker is named, and
 * "Speaker 1" style text when not. Transcript text and speaker fields (decided by, sources) keep
 * their labels.
 */
export function namesForLabels(text: string, speakers: readonly Speaker[]): string {
  return text.replace(/\bS(\d+)\b/gu, (_whole, number: string) => {
    const name = speakers.find((speaker) => speaker.id === `S${number}`)?.name?.trim();
    return name === undefined || name === "" ? `Speaker ${number}` : name;
  });
}
