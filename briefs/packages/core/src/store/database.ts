import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { StoreError } from "./errors.js";

export type SqlValue = SQLInputValue;
export type Row = Readonly<Record<string, SQLOutputValue>>;

/**
 * Thin wrapper over Node's built-in SQLite (`node:sqlite`, synchronous). Foreign keys
 * are on and file databases run in WAL mode, as the Swift store configures GRDB.
 * Only store files talk to this class.
 */
export class Database {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, ...params: SqlValue[]): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  all(sql: string, ...params: SqlValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  get(sql: string, ...params: SqlValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  /** Runs `body` in one write transaction (`BEGIN IMMEDIATE`), rolling back on any throw. */
  write<T>(body: () => T): T {
    if (this.db.isTransaction) return body();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

// MARK: - Typed column readers

export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new StoreError("corrupt", column);
  return value;
}

export function optionalText(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new StoreError("corrupt", column);
  return value;
}

export function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number") throw new StoreError("corrupt", column);
  return value;
}

export function blob(row: Row, column: string): Uint8Array {
  const value = row[column];
  if (!(value instanceof Uint8Array)) throw new StoreError("corrupt", column);
  return value;
}

export function optionalBlob(row: Row, column: string): Uint8Array | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (!(value instanceof Uint8Array)) throw new StoreError("corrupt", column);
  return value;
}
