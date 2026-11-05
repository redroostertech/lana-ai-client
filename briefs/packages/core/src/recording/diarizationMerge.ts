import type { Speaker, TranscriptSegment } from "../intent/meetingParts.js";

/** One recognized stretch of speech, with the loudness of each channel while it was said. */
export interface HeardSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly mic: number;
  readonly system: number;
}

/** One turn from the diarizer: who spoke when, by cluster number. */
export interface SpeakerTurn {
  readonly start: number;
  readonly end: number;
  readonly speaker: number;
}

export interface MergeOptions {
  /** How many times louder one channel must be for the line to count as coming from it. */
  readonly dominance?: number;
  /** Below this loudness a channel counts as silent. */
  readonly floor?: number;
  /** Same-speaker lines closer than this (seconds) join into one. */
  readonly joinGap?: number;
  /** A joined line never grows past this many seconds. */
  readonly maxLine?: number;
}

export interface MergedTranscript {
  readonly speakers: Speaker[];
  readonly transcript: TranscriptSegment[];
}

type Source = "mic" | "system" | "mixed";

const DEFAULTS = { dominance: 2, floor: 0.003, joinGap: 1, maxLine: 30 } as const;

export function sourceOf(segment: Pick<HeardSegment, "mic" | "system">, options: MergeOptions = {}): Source {
  const dominance = options.dominance ?? DEFAULTS.dominance;
  const floor = options.floor ?? DEFAULTS.floor;
  const mic = segment.mic >= floor ? segment.mic : 0;
  const system = segment.system >= floor ? segment.system : 0;
  if (mic > 0 && mic >= dominance * system) return "mic";
  if (system > 0 && system >= dominance * mic) return "system";
  return "mixed";
}

/** The diarizer cluster that overlaps the segment most, or null. */
export function clusterOf(segment: Pick<HeardSegment, "start" | "end">, turns: readonly SpeakerTurn[]): number | null {
  let best: number | null = null;
  let bestOverlap = 0;
  const totals = new Map<number, number>();
  for (const turn of turns) {
    const overlap = Math.min(segment.end, turn.end) - Math.max(segment.start, turn.start);
    if (overlap <= 0) continue;
    const total = (totals.get(turn.speaker) ?? 0) + overlap;
    totals.set(turn.speaker, total);
    if (total > bestOverlap) {
      bestOverlap = total;
      best = turn.speaker;
    }
  }
  return best;
}

/**
 * Labels each recognized line S1, S2... as the phone does. The microphone is the person at
 * this computer, so when the channels tell lines apart, mic lines are S1 and the diarizer's
 * clusters only separate the other people (S2, S3... in order of first speaking). A cluster
 * whose speech came mostly through the mic is that same local person. With no usable channel
 * difference (one channel silent the whole time, or a shared room) the clusters alone decide,
 * numbered in order of first speaking. Then neighbouring lines of one speaker join.
 */
export function mergeSpeakers(segments: readonly HeardSegment[], turns: readonly SpeakerTurn[], options: MergeOptions = {}): MergedTranscript {
  const heard = [...segments].filter((segment) => segment.text.trim() !== "").sort((a, b) => a.start - b.start);
  const sources = heard.map((segment) => sourceOf(segment, options));
  const clusters = heard.map((segment) => clusterOf(segment, turns));
  const channelsHelp = sources.includes("mic") && sources.includes("system");

  const labels: string[] = [];
  if (channelsHelp) {
    // Seconds each cluster spent on each channel.
    const micSeconds = new Map<number, number>();
    const systemSeconds = new Map<number, number>();
    heard.forEach((segment, index) => {
      const cluster = clusters[index];
      if (cluster === null || cluster === undefined) return;
      const seconds = segment.end - segment.start;
      if (sources[index] === "mic") micSeconds.set(cluster, (micSeconds.get(cluster) ?? 0) + seconds);
      if (sources[index] === "system") systemSeconds.set(cluster, (systemSeconds.get(cluster) ?? 0) + seconds);
    });
    const isLocal = (cluster: number | null): boolean => cluster !== null && (micSeconds.get(cluster) ?? 0) > (systemSeconds.get(cluster) ?? 0);
    const remote = new Map<number, string>();
    let lastRemote: string | null = null;
    heard.forEach((_segment, index) => {
      const source = sources[index];
      const cluster = clusters[index] ?? null;
      let label: string;
      if (source === "mic" || (source === "mixed" && isLocal(cluster))) {
        label = "S1";
      } else if (cluster !== null && !isLocal(cluster)) {
        if (!remote.has(cluster)) remote.set(cluster, `S${remote.size + 2}`);
        label = remote.get(cluster)!;
      } else if (source === "system") {
        // A remote line the diarizer put with the local person, or left unclustered.
        label = lastRemote ?? "S2";
      } else {
        label = labels[index - 1] ?? "S1";
      }
      if (label !== "S1") lastRemote = label;
      labels.push(label);
    });
  } else {
    const order = new Map<number, string>();
    heard.forEach((_segment, index) => {
      const cluster = clusters[index] ?? null;
      if (cluster === null) {
        labels.push(labels[index - 1] ?? "S1");
        return;
      }
      if (!order.has(cluster)) order.set(cluster, `S${order.size + 1}`);
      labels.push(order.get(cluster)!);
    });
  }

  const joinGap = options.joinGap ?? DEFAULTS.joinGap;
  const maxLine = options.maxLine ?? DEFAULTS.maxLine;
  const transcript: TranscriptSegment[] = [];
  heard.forEach((segment, index) => {
    const speaker = labels[index]!;
    const text = segment.text.trim();
    const last = transcript[transcript.length - 1];
    if (last !== undefined && last.speaker === speaker && segment.start - last.end <= joinGap && segment.end - last.start <= maxLine) {
      transcript[transcript.length - 1] = { ...last, end: Math.max(last.end, segment.end), text: `${last.text} ${text}` };
    } else {
      transcript.push({ speaker, start: round(segment.start), end: round(segment.end), text });
    }
  });
  const used = [...new Set(transcript.map((line) => line.speaker))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return { speakers: used.map((id) => ({ id })), transcript: transcript.map((line) => ({ ...line, end: round(line.end) })) };
}

/** Times to the millisecond, so records stay small and stable. */
function round(seconds: number): number {
  return Math.round(seconds * 1_000) / 1_000;
}
