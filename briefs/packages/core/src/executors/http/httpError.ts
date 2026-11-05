/**
 * Transport and status failures (Swift `HTTPError`). Carries no response bodies so an
 * error can never leak note text or names into a log line.
 */
export type HTTPErrorReason =
  | { readonly kind: "status"; readonly status: number; readonly retryAfter: number | undefined }
  | { readonly kind: "transport"; readonly reason: string }
  | { readonly kind: "invalidResponse" };

export class HTTPError extends Error {
  override readonly name = "HTTPError";

  constructor(readonly reason: HTTPErrorReason) {
    super(describe(reason));
  }

  static status(status: number, retryAfter?: number): HTTPError {
    return new HTTPError({ kind: "status", status, retryAfter });
  }

  static transport(reason: string): HTTPError {
    return new HTTPError({ kind: "transport", reason });
  }

  static invalidResponse(): HTTPError {
    return new HTTPError({ kind: "invalidResponse" });
  }

  /** Swift `description`: safe to log. */
  get description(): string {
    return describe(this.reason);
  }

  /**
   * True when a request may not have reached the server or was refused for load: the
   * cases where a create must be confirmed by marker search before a resend.
   */
  get isRetryable(): boolean {
    switch (this.reason.kind) {
      case "status":
        return this.reason.status === 429 || (this.reason.status >= 500 && this.reason.status <= 599);
      case "transport":
        return true;
      case "invalidResponse":
        return false;
    }
  }
}

function describe(reason: HTTPErrorReason): string {
  switch (reason.kind) {
    case "status":
      return `HTTP status ${reason.status}`;
    case "transport":
      return `Transport failure: ${reason.reason}`;
    case "invalidResponse":
      return "Invalid HTTP response";
  }
}
