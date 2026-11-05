/** Every way a call to the firm's LANA server can fail, as the action page tells the person. */
export const LANA_ERROR_KINDS = [
  /** 401 after one refresh, or no session at all. */
  "signedOut",
  /** 403: LANA's access rules refuse this matter or this write. */
  "noAccess",
  /** 404: the matter or the record is not there (or not visible to this person). */
  "notFound",
  /** 400 or 422: LANA refused the fields. */
  "rejected",
  /** 429. */
  "busy",
  /** Nothing answered: no network, the server is down, or the request timed out. */
  "offline",
  /** 5xx. */
  "server",
  /** A 2xx reply LANA would not send (no id, not JSON). */
  "invalidResponse",
] as const;

export type LanaErrorKind = (typeof LANA_ERROR_KINDS)[number];

/** Plain words for the action page. Server messages are never shown or logged. */
export const LANA_ERROR_MESSAGES: Readonly<Record<LanaErrorKind, string>> = {
  signedOut: "Your LANA session ended. Sign in to LANA again, then retry.",
  noAccess: "Your LANA account does not have access to this matter. Ask your firm admin, or choose another matter.",
  notFound: "LANA could not find this matter. Choose the matter again, then retry.",
  rejected: "LANA did not accept this action as it is. Check the title, details and date, then retry.",
  busy: "LANA is busy. Retry in a minute.",
  offline: "LANA could not reach your firm's server. Check the connection, then retry.",
  server: "Your firm's LANA server had a problem. Retry in a minute.",
  invalidResponse: "Your firm's LANA server answered in a way LANA Briefs did not expect. Retry, or check with your firm admin.",
};

/** A typed LANA failure. Carries the status only, never the reply body. */
export class LanaError extends Error {
  override readonly name = "LanaError";
  constructor(readonly kind: LanaErrorKind, readonly status: number | null = null) {
    super(LANA_ERROR_MESSAGES[kind]);
  }

  /** The request may have landed (no answer, or a server failure): a create must be searched for before any resend. */
  get isAmbiguous(): boolean {
    return this.kind === "offline" || this.kind === "server";
  }

  /** Safe to try a read or a delete again. */
  get isTransient(): boolean {
    return this.kind === "offline" || this.kind === "server" || this.kind === "busy";
  }
}

export function isLanaError(error: unknown, kind?: LanaErrorKind): error is LanaError {
  return error instanceof LanaError && (kind === undefined || error.kind === kind);
}

/** The kind for an HTTP status outside 2xx. */
export function lanaErrorForStatus(status: number): LanaError {
  if (status === 401) return new LanaError("signedOut", status);
  if (status === 403) return new LanaError("noAccess", status);
  if (status === 404) return new LanaError("notFound", status);
  if (status === 429) return new LanaError("busy", status);
  if (status >= 500) return new LanaError("server", status);
  return new LanaError("rejected", status);
}
