import { canonicalString } from "../../json/canonical.js";
import { parseJson } from "../../json/parse.js";
import type { LedgerRepository } from "../../store/ledgerRepository.js";
import type { LedgerRecord } from "../../store/types.js";
import { decodeExecutionResult, encodeExecutionResult, type ExecutionResult } from "./executionResult.js";

export type LedgerState =
  | { readonly kind: "inProgress" }
  | { readonly kind: "completed"; readonly result: ExecutionResult }
  | { readonly kind: "failed"; readonly error: string };

export interface LedgerEntry {
  readonly key: string;
  readonly planHash: string;
  readonly state: LedgerState;
  readonly attempts: number;
}

/**
 * Durable record of execution attempts (Swift `IdempotencyLedger`). `begin` is written
 * BEFORE the network call so a crash mid-request leaves evidence; a key that already
 * completed returns its result instead of executing again.
 */
export interface IdempotencyLedger {
  begin(key: string, planHash: string): Promise<LedgerEntry>;
  complete(key: string, result: ExecutionResult): Promise<void>;
  fail(key: string, error: string): Promise<void>;
}

/** A completed row whose result no longer decodes. Refuse rather than resend. */
export class LedgerUnreadableResultError extends Error {
  override readonly name = "LedgerUnreadableResultError";
  constructor(readonly key: string) {
    super("A completed ledger entry could not be read.");
  }
}

/**
 * The gateway store's ledger rows behind `IdempotencyLedger` (the Mac app's `GatewayLedger`).
 * `pending` is `inProgress` (a row left by a crash sends the executor down its marker
 * search), `completed` carries the decoded result, `failed` the stored reason. Results
 * are stored as canonical JSON, the same text the Mac app writes.
 */
export class StoreIdempotencyLedger implements IdempotencyLedger {
  constructor(private readonly ledger: LedgerRepository) {}

  async begin(key: string, planHash: string): Promise<LedgerEntry> {
    return StoreIdempotencyLedger.entry(this.ledger.begin(key, planHash));
  }

  async complete(key: string, result: ExecutionResult): Promise<void> {
    this.ledger.complete(key, canonicalString(encodeExecutionResult(result)));
  }

  async fail(key: string, error: string): Promise<void> {
    this.ledger.fail(key, error);
  }

  static entry(record: LedgerRecord): LedgerEntry {
    let state: LedgerState;
    switch (record.status) {
      case "pending":
        state = { kind: "inProgress" };
        break;
      case "completed": {
        if (record.result === undefined || record.result === null) throw new LedgerUnreadableResultError(record.key);
        try {
          state = { kind: "completed", result: decodeExecutionResult(parseJson(record.result)) };
        } catch {
          throw new LedgerUnreadableResultError(record.key);
        }
        break;
      }
      case "failed":
        state = { kind: "failed", error: record.error ?? "" };
        break;
    }
    return { key: record.key, planHash: record.planHash, state, attempts: record.attempts };
  }
}

/** Test ledger (Swift `InMemoryIdempotencyLedger`). */
export class InMemoryIdempotencyLedger implements IdempotencyLedger {
  private readonly entries = new Map<string, LedgerEntry>();

  async begin(key: string, planHash: string): Promise<LedgerEntry> {
    const existing = this.entries.get(key);
    if (existing !== undefined && existing.state.kind === "completed") return existing;
    const entry: LedgerEntry = { key, planHash, state: { kind: "inProgress" }, attempts: (existing?.attempts ?? 0) + 1 };
    this.entries.set(key, entry);
    return entry;
  }

  async complete(key: string, result: ExecutionResult): Promise<void> {
    const previous = this.entries.get(key);
    this.entries.set(key, { key, planHash: previous?.planHash ?? "", state: { kind: "completed", result }, attempts: previous?.attempts ?? 1 });
  }

  async fail(key: string, error: string): Promise<void> {
    const previous = this.entries.get(key);
    this.entries.set(key, { key, planHash: previous?.planHash ?? "", state: { kind: "failed", error }, attempts: previous?.attempts ?? 1 });
  }

  entry(key: string): LedgerEntry | undefined {
    return this.entries.get(key);
  }
}
