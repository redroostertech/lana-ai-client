import { HTTPError } from "../executors/http/httpError.js";
import { ExecutorError } from "../executors/execution/executorError.js";
import { LedgerUnreadableResultError } from "../executors/execution/idempotencyLedger.js";
import { OAuthError } from "../executors/oauth/oauthError.js";
import { StoreError } from "../store/errors.js";
import { ExecutorUnavailable } from "./connector.js";

/** A failed action in plain words, plus a short code for the audit log, never the text (Swift `ActionFailure`). */
export interface ActionFailure {
  readonly code: string;
  readonly message: string;
}

/** The message for a stored failure code, used when a failed card is reloaded (Swift `ActionFailure.message(forCode:)`). */
export function failureMessage(code: string | null | undefined): string {
  switch (code) {
    case "auth":
      return "The connection needs you to sign in again. Reconnect in Connections, then retry.";
    case "rejected":
      return "The service refused the request. Check the fields and the target, then retry.";
    case "not_found":
      return "The service could not find the target record. Choose it again, then retry.";
    case "busy":
      return "The service is busy. Retry in a minute.";
    case "server":
      return "The service had a problem. Retry in a minute.";
    case "unreachable":
      return "Could not reach the service. Check the internet connection, then retry.";
    case "not_connected":
      return "Connect the service in Connections, then retry.";
    default:
      return "The action did not finish. Retry checks for an earlier copy before sending.";
  }
}

/** Swift `ActionFailure.init(_ error:)`, case for case. `deviceNoun` is "Mac" or "PC". */
export function actionFailure(error: unknown, deviceNoun: string): ActionFailure {
  if (error instanceof HTTPError) return httpFailure(error);
  if (error instanceof ExecutorError) return { code: "executor", message: error.message };
  if (error instanceof OAuthError) return { code: "auth", message: error.message };
  if (error instanceof ExecutorUnavailable) return { code: "not_connected", message: error.message };
  if (error instanceof StoreError) return { code: "store", message: `LANA could not save this change on this ${deviceNoun}. Try again.` };
  if (error instanceof LedgerUnreadableResultError) return { code: "ledger", message: "The record of an earlier attempt is unreadable. LANA will not resend it." };
  if (error instanceof Error && error.name === "AbortError") return { code: "cancelled", message: "The action was stopped before it finished." };
  return { code: "unknown", message: "Something went wrong. Try again." };
}

function httpFailure(error: HTTPError): ActionFailure {
  let code: string;
  switch (error.reason.kind) {
    case "status": {
      const status = error.reason.status;
      if (status === 401 || status === 403) code = "auth";
      else if (status === 404) code = "not_found";
      else if (status === 429) code = "busy";
      else if (status >= 500 && status <= 599) code = "server";
      else code = "rejected";
      break;
    }
    case "transport":
      code = "unreachable";
      break;
    case "invalidResponse":
      code = "server";
      break;
  }
  return { code, message: failureMessage(code) };
}
