export type ExecutorErrorReason =
  | { readonly kind: "unsupportedIntent"; readonly type: string }
  | { readonly kind: "missingTarget" }
  | { readonly kind: "invalidTarget"; readonly field: string }
  | { readonly kind: "unresolvedRecipients"; readonly count: number }
  | { readonly kind: "wrongExecutor" }
  | { readonly kind: "planHashMismatch" }
  | { readonly kind: "undoExpired" }
  | { readonly kind: "untrustedHost" }
  | { readonly kind: "unexpectedResponse" };

/** Swift `ExecutorError`. `message` is the user-facing copy; `description` is the Swift case, safe to log. */
export class ExecutorError extends Error {
  override readonly name = "ExecutorError";

  constructor(readonly reason: ExecutorErrorReason) {
    super(userMessage(reason));
  }

  static unsupportedIntent = (type: string): ExecutorError => new ExecutorError({ kind: "unsupportedIntent", type });
  static missingTarget = (): ExecutorError => new ExecutorError({ kind: "missingTarget" });
  static invalidTarget = (field: string): ExecutorError => new ExecutorError({ kind: "invalidTarget", field });
  static unresolvedRecipients = (count: number): ExecutorError => new ExecutorError({ kind: "unresolvedRecipients", count });
  static wrongExecutor = (): ExecutorError => new ExecutorError({ kind: "wrongExecutor" });
  static planHashMismatch = (): ExecutorError => new ExecutorError({ kind: "planHashMismatch" });
  static undoExpired = (): ExecutorError => new ExecutorError({ kind: "undoExpired" });
  static untrustedHost = (): ExecutorError => new ExecutorError({ kind: "untrustedHost" });
  static unexpectedResponse = (): ExecutorError => new ExecutorError({ kind: "unexpectedResponse" });

  /** `String(describing:)` of the Swift case, for example `invalidTarget("id")`. */
  get description(): string {
    const r = this.reason;
    switch (r.kind) {
      case "unsupportedIntent":
        return `unsupportedIntent(${JSON.stringify(r.type)})`;
      case "invalidTarget":
        return `invalidTarget(${JSON.stringify(r.field)})`;
      case "unresolvedRecipients":
        return `unresolvedRecipients(${r.count})`;
      default:
        return r.kind;
    }
  }
}

function userMessage(reason: ExecutorErrorReason): string {
  switch (reason.kind) {
    case "unsupportedIntent":
      return "This action type is not supported by this connection.";
    case "missingTarget":
      return "Choose the matter or contact this belongs to.";
    case "invalidTarget":
      return "The selected record cannot receive this action.";
    case "unresolvedRecipients":
      return reason.count === 1 ? "One recipient needs an email address." : `${reason.count} recipients need email addresses.`;
    case "wrongExecutor":
      return "This action was prepared for a different connection.";
    case "planHashMismatch":
      return "This action changed after it was prepared. Review it again.";
    case "undoExpired":
      return "The undo window has closed.";
    case "untrustedHost":
      return "Refused to contact an unexpected server.";
    case "unexpectedResponse":
      return "The service returned an unexpected response.";
  }
}

/** A response body that did not have the expected shape (Swift `DecodingError`). Carries no body text. */
export class ResponseDecodingError extends Error {
  override readonly name = "DecodingError";
  constructor(readonly path: string) {
    super(`Unexpected response shape at ${path}`);
  }
}
