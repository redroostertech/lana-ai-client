/**
 * Worker thread entry: transcribes one recorded meeting with `MeetingTranscriber` and exits.
 * Diarization blocks while it works, so it never runs on the main thread; when the worker
 * ends, every model it loaded leaves memory with it. Nothing heard is logged.
 */
import { parentPort } from "node:worker_threads";
import { MeetingTranscriber, unpackPcm, type TranscriptionModelPaths } from "@lana/core/recording";
import type { WorkerReply, WorkerRequest } from "./transcriptionProtocol.js";

const port = parentPort;
if (port !== null) {
  port.once("message", (request: WorkerRequest) => {
    void run(request).then(
      (result) => port.postMessage(result satisfies WorkerReply),
      (error: unknown) => port.postMessage({ type: "error", code: error instanceof Error ? error.name : "unknown" } satisfies WorkerReply),
    );
  });
}

async function run(request: WorkerRequest): Promise<WorkerReply> {
  const channels = unpackPcm(request.pcm.map((buffer) => new Uint8Array(buffer)));
  const transcriber = new MeetingTranscriber({ models: request.models satisfies TranscriptionModelPaths });
  let last = -1;
  const merged = await transcriber.transcribe(channels, (fraction) => {
    if (fraction - last < 0.02 && fraction < 1) return;
    last = fraction;
    port?.postMessage({ type: "progress", fraction } satisfies WorkerReply);
  });
  return { type: "done", speakers: merged.speakers, transcript: merged.transcript };
}
