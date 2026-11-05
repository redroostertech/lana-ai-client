import { randomUUID } from "node:crypto";
import { AVAILABLE, BackendError, abortError, unavailable, type BackendAvailability } from "../ask/backend.js";
import type { TextModel, TextModelRequest } from "../runtime/textModel.js";
import { cleanedReply } from "./localModelReply.js";

/** What Briefs asks the runtime for; LANA's engine reads it as the request's purpose. */
export type RuntimePurpose = "briefs.notes" | "briefs.ask" | "briefs.actions" | "briefs.talk" | "briefs.clips";

export type RuntimeFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal | undefined }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly body: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface LanaRuntimeTextModelOptions {
  /** The engine's API base (the client's local AI engine), or null when it is not running. */
  readonly engineBase: () => string | null;
  /** The person's LANA session token, or null when signed out. */
  readonly token: () => string | null;
  readonly purpose: RuntimePurpose;
  /** The matter this work is about, when the meeting has one: its AI policy then applies. */
  readonly matterRef?: (() => string | null) | undefined;
  /** Background work (notes, drafts) waits behind what a person is waiting on (Ask, Talk). */
  readonly priority?: "foreground" | "background" | undefined;
  readonly fetch?: RuntimeFetch | undefined;
  readonly newRequestID?: (() => string) | undefined;
}

const MAX_TOKENS = 8192;
const RESTRICTED = new Set(["local_only", "never_leave_firm"]);

/**
 * LANA's runtime as Briefs' `TextModel` (Workstream R). Briefs never names a model or a
 * host: it sends instructions and a prompt to the engine's `POST /api/v1/runtime/requests`,
 * and LANA picks the model on this computer or Forge under the matter's AI policy. Streams
 * when the caller wants text as it is written (`onText` gets the whole reply so far).
 *
 * Failures are fixed codes, never model or transcript text:
 * - engine not running, or no model to run on: `unavailable(modelNotReady)`;
 * - a matter that stays local while the local model is down: `failed(matter_kept_local)`;
 * - signed out: `failed(signed_out)`; a matter this person cannot read: `failed(matter_not_found)`;
 * - anything else: `failed(runtime)`.
 */
export class LanaRuntimeTextModel implements TextModel {
  readonly modelID = "lana-runtime";
  private readonly fetchImpl: RuntimeFetch;
  private readonly newRequestID: () => string;

  constructor(private readonly options: LanaRuntimeTextModelOptions) {
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as RuntimeFetch);
    this.newRequestID = options.newRequestID ?? randomUUID;
  }

  async availability(): Promise<BackendAvailability> {
    if (this.options.engineBase() === null || this.options.token() === null) return unavailable("modelNotReady");
    return AVAILABLE;
  }

  async respond(request: TextModelRequest): Promise<string> {
    const base = this.options.engineBase();
    const token = this.options.token();
    if (base === null) throw BackendError.unavailable("modelNotReady");
    if (token === null) throw BackendError.failed("signed_out");
    if (request.signal?.aborted === true) throw abortError(request.signal);
    const stream = request.onText !== undefined;
    const matterRef = this.options.matterRef?.() ?? null;
    const body = {
      request_id: this.newRequestID(),
      purpose: this.options.purpose,
      ...(matterRef !== null ? { matter_ref: matterRef } : {}),
      priority: this.options.priority ?? "foreground",
      messages: [
        { role: "system", content: request.instructions },
        { role: "user", content: request.prompt },
      ],
      max_tokens: Math.max(1, Math.min(MAX_TOKENS, Math.round(request.maximumResponseTokens))),
      temperature: Math.max(0, Math.min(2, request.temperature)),
      stream,
    };
    let response: Awaited<ReturnType<RuntimeFetch>>;
    try {
      response = await this.fetchImpl(`${base.replace(/\/+$/, "")}/api/v1/runtime/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch {
      // The signal may have fired while the request was in flight.
      if (aborted(request.signal)) throw abortError(request.signal);
      throw BackendError.unavailable("modelNotReady");
    }
    if (!response.ok) throw await refusal(response);
    if (!stream) {
      const answer = (await response.json()) as { data?: { content?: unknown } };
      return cleanedReply(typeof answer.data?.content === "string" ? answer.data.content : "");
    }
    return readStream(response, request);
  }
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function refusal(response: { status: number; json(): Promise<unknown> }): Promise<BackendError> {
  let problem: { code?: unknown; ai_policy?: unknown } = {};
  try {
    problem = (await response.json()) as typeof problem;
  } catch {
    problem = {};
  }
  return errorOf(response.status, problem);
}

function errorOf(status: number, problem: { code?: unknown; ai_policy?: unknown }): BackendError {
  if (status === 401) return BackendError.failed("signed_out");
  if (problem.code === "MATTER_NOT_FOUND") return BackendError.failed("matter_not_found");
  if (problem.code === "LOCAL_MODEL_UNAVAILABLE") {
    return typeof problem.ai_policy === "string" && RESTRICTED.has(problem.ai_policy)
      ? BackendError.failed("matter_kept_local")
      : BackendError.unavailable("modelNotReady");
  }
  return BackendError.failed("runtime");
}

/** Server-sent events from the engine: `delta` { text }, then `done` { content } or `error` (problem). */
async function readStream(response: { body: ReadableStream<Uint8Array> | null }, request: TextModelRequest): Promise<string> {
  if (response.body === null) throw BackendError.failed("runtime");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let written = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (event === undefined || data === undefined) continue;
        const payload = JSON.parse(data) as { text?: unknown; content?: unknown; status?: unknown; code?: unknown; ai_policy?: unknown };
        if (event === "delta" && typeof payload.text === "string") {
          written += payload.text;
          request.onText?.(cleanedReply(written));
        } else if (event === "done") {
          const content = cleanedReply(typeof payload.content === "string" ? payload.content : written);
          request.onText?.(content);
          return content;
        } else if (event === "error") {
          throw errorOf(typeof payload.status === "number" ? payload.status : 500, payload);
        }
      }
    }
  } catch (error) {
    if (aborted(request.signal)) throw abortError(request.signal);
    throw error instanceof BackendError ? error : BackendError.failed("runtime");
  } finally {
    reader.releaseLock();
  }
  throw BackendError.failed("runtime");
}
