export const INTENT_STATUSES = ["proposed", "transferred", "resolved", "confirmed", "executed", "failed", "dismissed", "undone"] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

const LEGAL_MOVES: ReadonlySet<string> = new Set([
  "proposed>transferred",
  "transferred>resolved",
  "transferred>dismissed",
  "transferred>failed",
  "resolved>resolved",
  "resolved>confirmed",
  "resolved>dismissed",
  "confirmed>executed",
  "confirmed>failed",
  "failed>confirmed",
  "failed>dismissed",
  "failed>resolved",
  "executed>undone",
]);

export function isTerminalStatus(status: IntentStatus): boolean {
  return status === "dismissed" || status === "undone";
}

/** Legal lifecycle moves, identical to `IntentStatus.canTransition(to:)`. */
export function canTransition(from: IntentStatus, to: IntentStatus): boolean {
  return LEGAL_MOVES.has(`${from}>${to}`);
}

export class InvalidTransitionError extends Error {
  override readonly name = "InvalidTransitionError";
  constructor(readonly from: IntentStatus, readonly to: IntentStatus) {
    super(`Illegal intent transition ${from} -> ${to}`);
  }
}
