import type { BackendAvailability } from "../ask/backend.js";

export interface TextModelRequest {
  readonly instructions: string;
  readonly prompt: string;
  readonly temperature: number;
  readonly maximumResponseTokens: number;
  /** The reply so far (the whole text, not a delta) as it is generated. */
  readonly onText?: ((text: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * The one thing the runtime needs from a language model: instructions and a prompt in,
 * plain text out (Swift `TextModel`). On this machine only. Implementations reject with
 * `BackendError` for model failures and with an `AbortError` when cancelled. Models that
 * cannot stream call `onText` once with the whole reply.
 */
export interface TextModel {
  /** Stable identifier recorded in provenance. */
  readonly modelID: string;
  availability(): Promise<BackendAvailability>;
  respond(request: TextModelRequest): Promise<string>;
}
