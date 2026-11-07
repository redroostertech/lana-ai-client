import { Worker } from "node:worker_threads";
import { MeetingTranscriber, unpackPcm, type TranscriptionModelPaths } from "@lana/core/recording";
import type { MeetingTranscription } from "./recordingService.js";
import type { WorkerReply, WorkerRequest } from "./transcriptionProtocol.js";

/**
 * Runs each transcription in a fresh worker thread (`transcriptionWorker.js`, built next to
 * the main bundle), so diarization never blocks the window, and every model it loaded is
 * freed when the worker exits.
 */
export class WorkerTranscription implements MeetingTranscription {
  constructor(private readonly script: URL) {}

  transcribe(models: TranscriptionModelPaths, pcm: Uint8Array[], progress: (fraction: number) => void) {
    return new Promise<{ speakers: WorkerReplyDone["speakers"]; transcript: WorkerReplyDone["transcript"] }>((resolve, reject) => {
      const worker = new Worker(this.script);
      let settled = false;
      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        void worker.terminate();
        action();
      };
      worker.on("message", (reply: WorkerReply) => {
        if (reply.type === "progress") progress(reply.fraction);
        else if (reply.type === "done") settle(() => resolve({ speakers: reply.speakers, transcript: reply.transcript }));
        else settle(() => reject(Object.assign(new Error("transcription_failed"), { name: reply.code })));
      });
      worker.on("error", (error) => settle(() => reject(error)));
      worker.on("exit", () => settle(() => reject(new Error("transcription_worker_exited"))));
      // Copies into transferable buffers, so the journal's records are not held twice.
      const buffers = pcm.map((record) => record.slice().buffer);
      const request: WorkerRequest = { models, pcm: buffers };
      worker.postMessage(request, buffers);
    });
  }
}

type WorkerReplyDone = Extract<WorkerReply, { type: "done" }>;

/** The same work in this thread (tests and the opt-in integration run). */
export class InProcessTranscription implements MeetingTranscription {
  async transcribe(models: TranscriptionModelPaths, pcm: Uint8Array[], progress: (fraction: number) => void) {
    return new MeetingTranscriber({ models }).transcribe(unpackPcm(pcm), progress);
  }
}
