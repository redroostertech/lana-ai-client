import type { Database } from "./database.js";

export interface Migration {
  readonly identifier: string;
  readonly sql: string;
  /**
   * Rebuilds a table other tables reference. Runs with foreign keys off (so dropping the old
   * table cascades nothing) and checked before commit, as GRDB's deferred foreign key checks do.
   */
  readonly rebuildsTables?: boolean;
}

/**
 * Versioned schema, identical to Swift `GatewaySchema` (same SQL, same migration
 * identifiers, same `grdb_migrations` bookkeeping table), so a store either side
 * created opens on the other. Migrations are append-only: never edit a shipped one,
 * add a new one.
 */
export const GATEWAY_MIGRATIONS: readonly Migration[] = [
  {
    identifier: "v1_core",
    sql: `
CREATE TABLE paired_device (
    device_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    signing_key BLOB NOT NULL,
    agreement_key BLOB NOT NULL,
    transport_psk BLOB NOT NULL,
    paired_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE meeting (
    id TEXT PRIMARY KEY,
    bundle_id TEXT NOT NULL UNIQUE,
    phone_device_id TEXT NOT NULL REFERENCES paired_device(device_id),
    started_at TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    received_at TEXT NOT NULL,
    attestation_method TEXT NOT NULL,
    attestation_latency_ms INTEGER NOT NULL,
    sealed_record BLOB NOT NULL
);

CREATE TABLE meeting_audio (
    meeting_id TEXT NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    byte_count INTEGER NOT NULL,
    purged_at TEXT,
    PRIMARY KEY (meeting_id, idx)
);

CREATE TABLE intent (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    sealed_intent BLOB NOT NULL,
    resolution BLOB,
    updated_at TEXT NOT NULL
);
CREATE INDEX intent_status ON intent(status);
CREATE INDEX intent_meeting ON intent(meeting_id);

CREATE TABLE intent_event (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT NOT NULL REFERENCES intent(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor TEXT NOT NULL,
    detail TEXT,
    at TEXT NOT NULL
);
CREATE TRIGGER intent_event_append_only_update BEFORE UPDATE ON intent_event
BEGIN SELECT RAISE(ABORT, 'intent_event is append-only'); END;
CREATE TRIGGER intent_event_append_only_delete BEFORE DELETE ON intent_event
WHEN (SELECT COUNT(*) FROM intent WHERE id = OLD.intent_id) > 0
BEGIN SELECT RAISE(ABORT, 'intent_event is append-only'); END;

CREATE TABLE bundle_receipt (
    bundle_id TEXT PRIMARY KEY,
    receipt TEXT NOT NULL,
    manifest TEXT NOT NULL,
    received_at TEXT NOT NULL
);

CREATE TABLE idempotency_ledger (
    key TEXT PRIMARY KEY,
    plan_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    result TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 1,
    started_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE TABLE audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    event TEXT NOT NULL,
    subject TEXT NOT NULL,
    detail TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE
);
CREATE TRIGGER audit_append_only_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_append_only_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT
);

CREATE TABLE setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE VIRTUAL TABLE "entity_mirror" USING fts5(source UNINDEXED, external_id UNINDEXED, kind UNINDEXED, name, email, display_number, client_name, tokenize='''unicode61'' ''remove_diacritics'' ''2''');
`,
  },
  {
    identifier: "v2_ask_threads",
    sql: `
CREATE TABLE ask_thread (
    id TEXT PRIMARY KEY,
    meeting_id TEXT REFERENCES meeting(id) ON DELETE CASCADE,
    sealed_turns BLOB NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX ask_thread_meeting ON ask_thread(meeting_id);
`,
  },
  {
    identifier: "v3_action_inbox",
    sql: `
ALTER TABLE intent ADD COLUMN deleted_at TEXT;
CREATE INDEX intent_deleted_status ON intent(deleted_at, status);
CREATE INDEX intent_type ON intent(type);
CREATE INDEX intent_updated ON intent(updated_at);

CREATE TABLE manual_action (
    id TEXT PRIMARY KEY,
    meeting_id TEXT REFERENCES meeting(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    sealed_action BLOB NOT NULL,
    resolution BLOB,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX manual_action_deleted_status ON manual_action(deleted_at, status);
CREATE INDEX manual_action_meeting ON manual_action(meeting_id);
CREATE INDEX manual_action_type ON manual_action(type);
CREATE INDEX manual_action_updated ON manual_action(updated_at);
`,
  },
  {
    identifier: "v4_action_seen",
    sql: `
ALTER TABLE intent ADD COLUMN seen_at TEXT;
ALTER TABLE manual_action ADD COLUMN seen_at TEXT;
UPDATE intent SET seen_at = updated_at;
UPDATE manual_action SET seen_at = updated_at;
`,
  },
  {
    // Meetings recorded on this computer: no phone, no handoff attestation. SQLite cannot
    // relax NOT NULL in place, so the table is rebuilt (the documented 12 step procedure).
    identifier: "v5_local_meetings",
    rebuildsTables: true,
    sql: `
CREATE TABLE meeting_v5 (
    id TEXT PRIMARY KEY,
    bundle_id TEXT NOT NULL UNIQUE,
    phone_device_id TEXT REFERENCES paired_device(device_id),
    started_at TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    received_at TEXT NOT NULL,
    attestation_method TEXT NOT NULL,
    attestation_latency_ms INTEGER NOT NULL,
    sealed_record BLOB NOT NULL,
    origin TEXT NOT NULL DEFAULT 'phone' CHECK (origin IN ('phone', 'computer')),
    CHECK ((origin = 'phone') = (phone_device_id IS NOT NULL))
);
INSERT INTO meeting_v5 (id, bundle_id, phone_device_id, started_at, duration_seconds, received_at, attestation_method, attestation_latency_ms, sealed_record)
    SELECT id, bundle_id, phone_device_id, started_at, duration_seconds, received_at, attestation_method, attestation_latency_ms, sealed_record FROM meeting;
DROP TABLE meeting;
ALTER TABLE meeting_v5 RENAME TO meeting;
`,
  },
];

/** Applies every migration not yet recorded, each in its own transaction. Returns the ones applied. */
export function migrate(db: Database, migrations: readonly Migration[] = GATEWAY_MIGRATIONS): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)");
  const applied = new Set(db.all("SELECT identifier FROM grdb_migrations").map((row) => String(row["identifier"])));
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.identifier)) continue;
    if (migration.rebuildsTables === true) db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.write(() => {
        db.exec(migration.sql);
        if (migration.rebuildsTables === true && db.all("PRAGMA foreign_key_check").length > 0) throw new Error(`foreign key violation in ${migration.identifier}`);
        db.run("INSERT INTO grdb_migrations (identifier) VALUES (?)", migration.identifier);
      });
    } finally {
      if (migration.rebuildsTables === true) db.exec("PRAGMA foreign_keys = ON");
    }
    ran.push(migration.identifier);
  }
  return ran;
}
