/**
 * Model availability and failures, shared by Ask, the runtime and the local model
 * (Swift `BackendAvailability` and `BackendError` in LanaSummarizer).
 */
export type UnavailableReason =
  | "deviceNotEligible"
  | "appleIntelligenceNotEnabled"
  | "modelNotReady"
  | "unsupportedOperatingSystem"
  | "other";

export type BackendAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: UnavailableReason };

export const AVAILABLE: BackendAvailability = { available: true };

export function unavailable(reason: UnavailableReason): BackendAvailability {
  return { available: false, reason };
}

export type BackendErrorKind =
  | "refused"
  | "guardrailViolation"
  | "contextWindowExceeded"
  | "malformedOutput"
  | "unavailable"
  | "failed";

/** A model failure. The message is a fixed code, never model or transcript text. */
export class BackendError extends Error {
  readonly kind: BackendErrorKind;
  /** For `failed`: a short code such as `local_model`. */
  readonly code: string | undefined;
  /** For `unavailable`. */
  readonly reason: UnavailableReason | undefined;

  private constructor(kind: BackendErrorKind, code?: string, reason?: UnavailableReason) {
    super(code === undefined ? (reason === undefined ? kind : `${kind}(${reason})`) : `${kind}(${code})`);
    this.name = "BackendError";
    this.kind = kind;
    this.code = code;
    this.reason = reason;
  }

  static readonly refused = (): BackendError => new BackendError("refused");
  static readonly guardrailViolation = (): BackendError => new BackendError("guardrailViolation");
  static readonly contextWindowExceeded = (): BackendError => new BackendError("contextWindowExceeded");
  static readonly malformedOutput = (): BackendError => new BackendError("malformedOutput");
  static readonly unavailable = (reason: UnavailableReason): BackendError => new BackendError("unavailable", undefined, reason);
  static readonly failed = (code: string): BackendError => new BackendError("failed", code);

  /** Refusals and guardrail hits are retried once with a neutral reformulation. */
  get isRetryableWithReformulation(): boolean {
    return this.kind === "refused" || this.kind === "guardrailViolation";
  }
}

/** The error a cancelled call rejects with (`signal.reason` when the caller gave one). */
export function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError(signal);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
