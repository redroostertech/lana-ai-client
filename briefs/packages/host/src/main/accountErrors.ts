import type { AppError } from "../shared/api.js";

/** User-facing account messages, word for word from the Mac app's LanaAccountError. */
const messages = {
  organizationNotFound: "We could not find that organization. Check the Organization ID and domain with your firm admin.",
  organizationIncomplete: "Check the Organization ID and domain. Both are needed.",
  directoryUnavailable: "The LANA directory is not answering. Try again in a minute.",
  invalidServerAddress: "Enter a full server address that starts with https://.",
  invalidCredentials: "That email and password do not match a LANA account.",
  accountInactive: "This account is not active. If it is new, activate it first, or ask your firm admin.",
  mfaRequired: "Enter the 6-digit code from your authenticator app.",
  invalidMFACode: "That code did not work. Codes change every 30 seconds, so try the newest one.",
  activationCodeInvalid: "That activation code is not right. Check the code your firm admin sent.",
  activationCodeUsed: "That activation code was already used. Sign in instead, or ask your firm admin for a new code.",
  activationCodeExpired: "That activation code has expired. Ask your firm admin for a new one.",
  alreadyActive: "This account is already active. Sign in with your password.",
  activationUnavailable: "That activation code cannot be used. Ask your firm admin for a new one.",
  passwordTooShort: "Use at least 8 characters.",
  passwordsDoNotMatch: "The two passwords do not match.",
  sessionExpired: "Your LANA session ended. Sign in again to keep receiving meetings.",
  rateLimited: "Too many attempts. Wait a minute and try again.",
  serverUnavailable: "Your firm's LANA server had a problem. Try again in a minute.",
  network: "LANA could not reach the server. Check this computer's connection and try again.",
  unexpectedResponse: "The server answered in a way LANA did not expect. Check the server address with your firm admin.",
} as const;

export type AccountErrorCode = keyof typeof messages;

export function accountError(code: AccountErrorCode): AppError {
  return { code, message: messages[code] };
}
