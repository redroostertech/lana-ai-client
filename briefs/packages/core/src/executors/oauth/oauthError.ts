export type OAuthErrorReason =
  | { readonly kind: "notAuthorized" }
  | { readonly kind: "noPendingAuthorization" }
  | { readonly kind: "stateMismatch" }
  | { readonly kind: "authorizationDenied"; readonly error: string }
  | { readonly kind: "missingCode" }
  /** The refresh token was rejected (invalid_grant). The user must sign in again. */
  | { readonly kind: "reauthorizationRequired" }
  | { readonly kind: "tokenEndpoint"; readonly status: number; readonly error: string | undefined }
  | { readonly kind: "malformedTokenResponse" };

/** Swift `OAuthError`. `message` is the user-facing copy; `description` is the Swift case, safe to log. */
export class OAuthError extends Error {
  override readonly name = "OAuthError";

  constructor(readonly reason: OAuthErrorReason) {
    super(userMessage(reason));
  }

  static notAuthorized = (): OAuthError => new OAuthError({ kind: "notAuthorized" });
  static noPendingAuthorization = (): OAuthError => new OAuthError({ kind: "noPendingAuthorization" });
  static stateMismatch = (): OAuthError => new OAuthError({ kind: "stateMismatch" });
  static authorizationDenied = (error: string): OAuthError => new OAuthError({ kind: "authorizationDenied", error });
  static missingCode = (): OAuthError => new OAuthError({ kind: "missingCode" });
  static reauthorizationRequired = (): OAuthError => new OAuthError({ kind: "reauthorizationRequired" });
  static tokenEndpoint = (status: number, error: string | undefined): OAuthError => new OAuthError({ kind: "tokenEndpoint", status, error });
  static malformedTokenResponse = (): OAuthError => new OAuthError({ kind: "malformedTokenResponse" });

  get description(): string {
    const r = this.reason;
    switch (r.kind) {
      case "authorizationDenied":
        return `authorizationDenied(${JSON.stringify(r.error)})`;
      case "tokenEndpoint":
        return `tokenEndpoint(status: ${r.status}, error: ${r.error === undefined ? "nil" : `Optional(${JSON.stringify(r.error)})`})`;
      default:
        return r.kind;
    }
  }
}

function userMessage(reason: OAuthErrorReason): string {
  switch (reason.kind) {
    case "notAuthorized":
      return "This account is not connected yet.";
    case "noPendingAuthorization":
    case "stateMismatch":
      return "The sign-in response did not match this request. Try connecting again.";
    case "authorizationDenied":
      return "Sign-in was cancelled or denied.";
    case "missingCode":
      return "The sign-in response was incomplete. Try connecting again.";
    case "reauthorizationRequired":
      return "Your connection expired. Sign in again to continue.";
    case "tokenEndpoint":
    case "malformedTokenResponse":
      return "The sign-in service returned an error. Try again.";
  }
}
