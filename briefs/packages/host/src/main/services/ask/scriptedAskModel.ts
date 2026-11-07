import { AVAILABLE, abortError } from "@lana/core/ask";
import type { TextModel, TextModelRequest } from "@lana/core/runtime";

/** Characters per streamed chunk and the pause between chunks. */
const CHUNK = 6;
const CHUNK_MS = 15;

/**
 * Tests only (`LANA_TEST_ASK_MODEL=scripted`, unpackaged builds): a stand-in for the LANA
 * model that answers in the real reply format from the first transcript passage it is
 * given, streamed a few characters at a time, so the whole pipeline (runtime, grounding
 * gate, drafts over IPC, citations, saved threads) runs without a 2.5 GB download.
 */
export class ScriptedAskModel implements TextModel {
  readonly modelID = "scripted-test";

  async availability() {
    return AVAILABLE;
  }

  async respond(request: TextModelRequest): Promise<string> {
    const reply = scriptedReply(request.prompt);
    for (let end = CHUNK; end < reply.length + CHUNK; end += CHUNK) {
      if (request.signal?.aborted === true) throw abortError(request.signal);
      request.onText?.(reply.slice(0, Math.min(end, reply.length)));
      await new Promise((resolve) => setTimeout(resolve, CHUNK_MS));
    }
    return reply;
  }
}

/** `KIND: fact`, the first spoken line of the first transcript passage, and its label. */
export function scriptedReply(prompt: string): string {
  const blocks = prompt.split(/\n(?=\[P\d+\] \()/);
  for (const block of blocks) {
    const header = /^(?:[\s\S]*\n)?\[(P\d+)\] \(([^)]*)\)\n([\s\S]*)$/.exec(block);
    if (header === null || !header[2]!.includes("transcript")) continue;
    const line = header[3]!.split("\n").find((candidate) => candidate.includes(": "));
    if (line === undefined) continue;
    const said = line.slice(line.indexOf(": ") + 2).trim();
    return `KIND: fact\nANSWER: The meeting says: ${said}\nSOURCES: ${header[1]}`;
  }
  return "KIND: fact\nANSWER: NONE\nSOURCES:";
}
