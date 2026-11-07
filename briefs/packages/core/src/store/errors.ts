import type { IntentStatus } from "../intent/intentStatus.js";

export type StoreErrorKind = "notFound" | "invalidTransition" | "notEditable" | "corrupt";

/**
 * Swift `GatewayStore.StoreError`. `subject` carries an id, a column or a context
 * label, never record content, so messages are safe to log.
 */
export class StoreError extends Error {
  override readonly name = "StoreError";

  constructor(
    readonly kind: StoreErrorKind,
    readonly subject: string,
    readonly from?: IntentStatus,
    readonly to?: IntentStatus,
  ) {
    super(kind === "invalidTransition" ? `invalidTransition ${from ?? ""} -> ${to ?? ""}` : `${kind}: ${subject}`);
  }

  static notFound(subject: string): StoreError {
    return new StoreError("notFound", subject);
  }

  static invalidTransition(from: IntentStatus, to: IntentStatus): StoreError {
    return new StoreError("invalidTransition", "intent", from, to);
  }

  static notEditable(status: IntentStatus): StoreError {
    return new StoreError("notEditable", status);
  }

  static corrupt(subject: string): StoreError {
    return new StoreError("corrupt", subject);
  }
}
