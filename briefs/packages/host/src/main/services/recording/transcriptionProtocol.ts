import type { Speaker, TranscriptSegment } from "@lana/core/intent";
import type { TranscriptionModelPaths, VocabularyEntry } from "@lana/core/recording";

/** One job for the transcription worker: the models and the recording's 16 kHz audio (journal records, transferred). */
export interface WorkerRequest {
  readonly models: TranscriptionModelPaths;
  readonly pcm: ArrayBuffer[];
  /** The firm's meeting word list, for the vocabulary pass. */
  readonly vocabulary?: readonly VocabularyEntry[];
}

export type WorkerReply =
  | { readonly type: "progress"; readonly fraction: number }
  | { readonly type: "done"; readonly speakers: Speaker[]; readonly transcript: TranscriptSegment[] }
  | { readonly type: "error"; readonly code: string };
