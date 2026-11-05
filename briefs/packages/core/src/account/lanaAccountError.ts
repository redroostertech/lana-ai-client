/** Every way signing in to LANA can fail (Swift `LanaAccountError`). */
export const ACCOUNT_ERROR_KINDS = [
  "organizationNotFound",
  "organizationDetailsInvalid",
  "directoryUnavailable",
  "invalidServerAddress",
  "invalidCredentials",
  "accountInactive",
  "mfaRequired",
  "invalidMFACode",
  "invalidActivationCode",
  "activationCodeUsed",
  "activationCodeExpired",
  "alreadyActivated",
  "activationCodeRejected",
  "passwordTooShort",
  "passwordsDoNotMatch",
  "sessionExpired",
  "rateLimited",
  "serverUnavailable",
  "network",
  "invalidResponse",
] as const;

export type AccountErrorKind = (typeof ACCOUNT_ERROR_KINDS)[number];

/**
 * The sign-in screens' copy, word for word from the Mac app, except `network`, which
 * says "this computer" because the desktop app also runs on Windows.
 */
export const ACCOUNT_ERROR_MESSAGES: Readonly<Record<AccountErrorKind, string>> = {
  organizationNotFound: "We could not find that organization. Check the Organization ID and domain with your firm admin.",
  organizationDetailsInvalid: "Check the Organization ID and domain. Both are needed.",
  directoryUnavailable: "The LANA directory is not answering. Try again in a minute.",
  invalidServerAddress: "Enter a full server address that starts with https://.",
  invalidCredentials: "That email and password do not match a LANA account.",
  accountInactive: "This account is not active. If it is new, activate it first, or ask your firm admin.",
  mfaRequired: "Enter the 6-digit code from your authenticator app.",
  invalidMFACode: "That code did not work. Codes change every 30 seconds, so try the newest one.",
  invalidActivationCode: "That activation code is not right. Check the code your firm admin sent.",
  activationCodeUsed: "That activation code was already used. Sign in instead, or ask your firm admin for a new code.",
  activationCodeExpired: "That activation code has expired. Ask your firm admin for a new one.",
  alreadyActivated: "This account is already active. Sign in with your password.",
  activationCodeRejected: "That activation code cannot be used. Ask your firm admin for a new one.",
  passwordTooShort: "Use at least 8 characters.",
  passwordsDoNotMatch: "The two passwords do not match.",
  sessionExpired: "Your LANA session ended. Sign in again to keep receiving meetings.",
  rateLimited: "Too many attempts. Wait a minute and try again.",
  serverUnavailable: "Your firm's LANA server had a problem. Try again in a minute.",
  network: "LANA could not reach the server. Check this computer's connection and try again.",
  invalidResponse: "The server answered in a way LANA did not expect. Check the server address with your firm admin.",
};

/** Server messages are matched, never shown, so the wording stays ours. */
export class LanaAccountError extends Error {
  override readonly name = "LanaAccountError";
  constructor(readonly kind: AccountErrorKind) {
    super(ACCOUNT_ERROR_MESSAGES[kind]);
  }
}

export function isAccountError(error: unknown, kind?: AccountErrorKind): error is LanaAccountError {
  return error instanceof LanaAccountError && (kind === undefined || error.kind === kind);
}
