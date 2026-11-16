import type { Speaker, TranscriptSegment } from "../intent/meetingParts.js";

/** One recognized stretch of speech, with the loudness of each channel while it was said. */
export interface HeardSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** The recognizer's own text when the vocabulary pass changed a word. */
  readonly recognizedText?: string | undefined;
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
    const heardText = segment.recognizedText?.trim();
    const last = transcript[transcript.length - 1];
    if (last !== undefined && last.speaker === speaker && segment.start - last.end <= joinGap && segment.end - last.start <= maxLine) {
      const recognized = last.recognizedText !== undefined || heardText !== undefined ? `${last.recognizedText ?? last.text} ${heardText ?? text}` : undefined;
      transcript[transcript.length - 1] = { ...last, end: Math.max(last.end, segment.end), text: `${last.text} ${text}`, ...(recognized === undefined ? {} : { recognizedText: recognized }) };
    } else {
      transcript.push({ speaker, start: round(segment.start), end: round(segment.end), text, ...(heardText === undefined ? {} : { recognizedText: heardText }) });
    }
  });
  const used = [...new Set(transcript.map((line) => line.speaker))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return { speakers: used.map((id) => ({ id })), transcript: transcript.map((line) => ({ ...line, end: round(line.end) })) };
}

/** Times to the millisecond, so records stay small and stable. */
function round(seconds: number): number {
  return Math.round(seconds * 1_000) / 1_000;
}

/** Below this much talk, a diarizer cluster is folded into another voice. */
export const SMALL_CLUSTER_SECONDS = 8;
/**
 * A cluster with more talk folds into a bigger one only at or above this voice similarity.
 * Calibrated on synthetic voices: three distinct voices reached 0.87 between two of them, so
 * the cutoff sits above that and three distinct voices stay three.
 */
export const SAME_VOICE_SIMILARITY = 0.9;

export function smallClusterLimit(_turns: readonly SpeakerTurn[]): number {
  return SMALL_CLUSTER_SECONDS;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index]! * b[index]!;
    na += a[index]! * a[index]!;
    nb += b[index]! * b[index]!;
  }
  return na === 0 || nb === 0 ? -1 : dot / Math.sqrt(na * nb);
}

/**
 * Folds diarizer clusters into the voice they belong to. On real speech through one microphone
 * the clustering splits one person into many clusters (a phone recording came out as 45
 * speakers). Calling a real person someone else is worse than an extra speaker label, so:
 * - a cluster with under 8 s of talk joins the cluster of 8 s or more with the most similar voice
 *   embedding, or the one nearest in time when no embedding can be computed;
 * - a cluster with 8 s or more joins a bigger cluster only when their voices are at least
 *   `SAME_VOICE_SIMILARITY` alike (never without embeddings), smallest first, following chains.
 * `allowed` limits which clusters may join (on this computer: the same side, mic or meeting
 * audio). When no cluster reaches 8 s (a very short recording) nothing changes.
 */
export function foldSmallClusters(turns: readonly SpeakerTurn[], embedding: (cluster: number) => Float32Array | null, allowed: (small: number, big: number) => boolean = () => true): SpeakerTurn[] {
  const talk = new Map<number, number>();
  for (const turn of turns) talk.set(turn.speaker, (talk.get(turn.speaker) ?? 0) + Math.max(0, turn.end - turn.start));
  const big = [...talk].filter(([, seconds]) => seconds >= SMALL_CLUSTER_SECONDS).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([cluster]) => cluster);
  if (big.length === 0) return [...turns];
  const target = new Map<number, number>();
  const ordered = [...turns].sort((x, y) => x.start - y.start);

  // Clusters of 8 s or more with the same voice as a bigger one (smallest first).
  big.forEach((cluster, index) => {
    const own = embedding(cluster);
    if (own === null) return;
    let best: number | undefined;
    let score = -Infinity;
    for (const candidate of big.slice(index + 1)) {
      if (!allowed(cluster, candidate)) continue;
      const other = embedding(candidate);
      if (other === null) continue;
      const value = cosine(own, other);
      if (value > score) {
        score = value;
        best = candidate;
      }
    }
    if (best !== undefined && score >= SAME_VOICE_SIMILARITY) target.set(cluster, best);
  });
  const resolve = (cluster: number): number => {
    let current = cluster;
    for (let steps = 0; target.has(current) && steps < talk.size; steps += 1) current = target.get(current)!;
    return current;
  };

  // Clusters under 8 s: the most similar cluster of 8 s or more, else the nearest in time.
  const small = [...talk].filter(([, seconds]) => seconds < SMALL_CLUSTER_SECONDS).map(([cluster]) => cluster);
  for (const cluster of small) {
    const targets = new Set(big.filter((candidate) => allowed(cluster, candidate)));
    if (targets.size === 0) continue;
    const own = embedding(cluster);
    let best: number | undefined;
    if (own !== null) {
      let score = -Infinity;
      for (const candidate of targets) {
        const other = embedding(candidate);
        if (other === null) continue;
        const value = cosine(own, other);
        if (value > score) {
          score = value;
          best = candidate;
        }
      }
    }
    if (best === undefined) {
      // In time order, so on a tie the earlier cluster wins.
      let gap = Infinity;
      for (const turn of ordered.filter((item) => item.speaker === cluster)) {
        for (const other of ordered) {
          if (!targets.has(other.speaker)) continue;
          const distance = Math.max(0, Math.max(turn.start, other.start) - Math.min(turn.end, other.end));
          if (distance < gap) {
            gap = distance;
            best = other.speaker;
          }
        }
      }
    }
    if (best !== undefined) target.set(cluster, best);
  }
  return turns.map((turn) => {
    const speaker = resolve(turn.speaker);
    return speaker === turn.speaker ? turn : { ...turn, speaker };
  });
}
