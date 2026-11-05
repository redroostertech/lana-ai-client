import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fromHex, toHex, utf8 } from "../../src/bytes/index.js";
import { p256PrivateKeyFromRaw, sha256 } from "../../src/crypto/index.js";
import { parseLanaId, type LanaId } from "../../src/ids/index.js";
import { LanaDate } from "../../src/json/index.js";
import { InMemoryDataKeyProvider } from "../../src/keys/index.js";
import {
  AUDIT_EVENTS, auditHash, DISTANT_PAST, exportAuditLines, FieldSealer, STORE_AAD_PREFIX, STORE_DATABASE_FILE, verifyAuditChain,
  type AuditEntry, type AuditEvent,
} from "../../src/store/index.js";
import { ManualClock, openRig, type StoreRig } from "../support/storeRig.js";
import { golden } from "./fixtures.js";

interface EntryFixture { seq: number; at: string; event: string; subject: string; detail: string; prev_hash: string; hash: string }
interface StoreFixture {
  data_key: string;
  entries: EntryFixture[];
  export: string;
  intact: boolean;
  tamper: { case: string; broken_at: number | null }[];
  schema: { type: string; name: string; tbl_name: string; sql: string | null }[];
  migrations: string[];
  sealed: { context: string; plaintext: string; sealed: string }[];
  aad_prefix: string;
}

const fixture = golden<StoreFixture>("store");
const seed = (label: string): Uint8Array => sha256(utf8(label));
const entries: AuditEntry[] = fixture.entries.map((entry) => ({
  seq: entry.seq,
  at: LanaDate.parse(entry.at) as Date,
  event: entry.event,
  subject: entry.subject,
  detail: entry.detail,
  prevHash: entry.prev_hash,
  hash: entry.hash,
}));

describe("audit chain matches Swift AuditLog", () => {
  it("recomputes every Swift hash from the canonical fields", () => {
    expect(entries.length).toBeGreaterThanOrEqual(6);
    for (const entry of entries) expect(auditHash(entry.prevHash, entry.at, entry.event, entry.subject, entry.detail)).toBe(entry.hash);
    expect(verifyAuditChain(entries)).toEqual({ entries: entries.length, brokenAt: null, isIntact: fixture.intact });
  });

  it("exports the same JSON Lines bytes, trailer included", () => {
    expect(Buffer.from(exportAuditLines(entries)).toString("utf8")).toBe(fixture.export);
  });

  it("reaches the same tamper verdicts", () => {
    const edit = (entry: AuditEntry, rehash: boolean): AuditEntry => {
      const detail = "{\"state\":\"revoked\"}";
      return { ...entry, detail, hash: rehash ? auditHash(entry.prevHash, entry.at, entry.event, entry.subject, detail) : entry.hash };
    };
    const swapped = [...entries];
    [swapped[3], swapped[4]] = [entries[4] as AuditEntry, entries[3] as AuditEntry];
    const cases: Record<string, AuditEntry[]> = {
      edit_detail_index_2: entries.map((entry, index) => (index === 2 ? edit(entry, false) : entry)),
      edit_and_rehash_index_2: entries.map((entry, index) => (index === 2 ? edit(entry, true) : entry)),
      remove_index_1: entries.filter((_, index) => index !== 1),
      swap_index_3_4: swapped,
      drop_last: entries.slice(0, -1),
    };
    expect(fixture.tamper).toHaveLength(Object.keys(cases).length);
    for (const verdict of fixture.tamper) {
      expect(verifyAuditChain(cases[verdict.case] as AuditEntry[]).brokenAt, verdict.case).toBe(verdict.broken_at);
    }
  });

  it("reads Foundation's distantPast the same way", () => {
    expect(LanaDate.format(DISTANT_PAST)).toBe("0001-01-01T00:00:00.000Z");
  });
});

describe("a TypeScript store matches a Swift store", () => {
  let rig: StoreRig;
  const deviceID = parseLanaId("dev_01JCQ7A1B2C3D4E5F6G7H8J9K0") as LanaId;

  beforeAll(async () => {
    rig = await openRig({ keys: new InMemoryDataKeyProvider(fromHex(fixture.data_key)), clock: new ManualClock(1_800_000_000_000) });
    const { store, clock } = rig;
    const phone = {
      deviceID,
      signingKey: p256PrivateKeyFromRaw(seed("lana.golden.store.phone.signing")).x963,
      agreementKey: p256PrivateKeyFromRaw(seed("lana.golden.store.phone.agreement")).x963,
      displayName: "Golden iPhone",
    };
    // The same calls, in the same order, at the same times as StoreGoldenVectorExportTests.
    await store.pairDevice(phone, seed("lana.golden.store.psk"));
    clock.advance(1.5);
    await store.appendAudit(AUDIT_EVENTS.connectorLinked, "clio", { account: "acct-42", scopes: "matters,contacts" });
    clock.advance(0.001);
    // An event this build no longer writes (licensing moved to the LANA platform account).
    // The Swift chain still holds it, so stored entries like it must keep hashing and verifying.
    await store.appendAudit("license.changed" as AuditEvent, "license", {
      state: "active",
      note: "Ünïcödé \"quoted\" back\\slash | pipe / slash \n newline \u0001 ctl \u{1F600}   \u007F",
    });
    clock.advance(60);
    await store.appendAudit(AUDIT_EVENTS.actionExecuted, "int_01JCQ8A1B2C3D4E5F6G7H8J9K0|x",
      { intent_id: "int_01JCQ8A1B2C3D4E5F6G7H8J9K0", type: "note.log", z: "", A: "upper", "é": "e" });
    clock.advance(3_600);
    await store.revokeDevice(deviceID);
    clock.advance(86_400 * 400);
    await store.appendAudit(AUDIT_EVENTS.audioPurged, "", {});
  });
  afterAll(() => rig.cleanup());

  it("writes the identical audit chain, hash for hash", async () => {
    const ours = await rig.store.auditEntries();
    expect(ours.map((entry) => ({ ...entry, at: LanaDate.format(entry.at) }))).toEqual(fixture.entries.map((entry) => ({
      seq: entry.seq, at: entry.at, event: entry.event, subject: entry.subject, detail: entry.detail, prevHash: entry.prev_hash, hash: entry.hash,
    })));
    expect(Buffer.from(await rig.store.exportAudit()).toString("utf8")).toBe(fixture.export);
  });

  it("has the same schema, triggers, indexes and migration records", () => {
    const db = new DatabaseSync(join(rig.directory, STORE_DATABASE_FILE), { readOnly: true });
    try {
      const normalize = (sql: string | null): string | null => (sql === null ? null : sql.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim());
      const ours = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all()
        .map((row) => ({ type: row["type"], name: row["name"], tbl_name: row["tbl_name"], sql: normalize(row["sql"] as string | null) }));
      expect(ours).toEqual(fixture.schema.map((row) => ({ ...row, sql: normalize(row.sql) })));
      expect(db.prepare("SELECT identifier FROM grdb_migrations ORDER BY rowid").all().map((row) => row["identifier"])).toEqual(fixture.migrations);
    } finally {
      db.close();
    }
  });
});

describe("fields sealed at rest by Swift open on the desktop", () => {
  const sealer = new FieldSealer(fromHex(fixture.data_key));

  it("uses the same AAD prefix", () => {
    expect(STORE_AAD_PREFIX).toBe(fixture.aad_prefix);
  });

  it("opens every Swift sample, and only under its own context", () => {
    expect(fixture.sealed.length).toBeGreaterThanOrEqual(5);
    for (const sample of fixture.sealed) {
      expect(toHex(sealer.open(fromHex(sample.sealed), sample.context))).toBe(sample.plaintext);
      expect(() => sealer.open(fromHex(sample.sealed), `${sample.context}x`)).toThrow(expect.objectContaining({ kind: "corrupt" }));
    }
    const wrongKey = new FieldSealer(new Uint8Array(32));
    const first = fixture.sealed[0] as StoreFixture["sealed"][number];
    expect(() => wrongKey.open(fromHex(first.sealed), first.context)).toThrow(expect.objectContaining({ kind: "corrupt" }));
  });

  it("seals values the same layout opens", () => {
    for (const sample of fixture.sealed) {
      const sealed = sealer.seal(fromHex(sample.plaintext), sample.context);
      expect(sealed.length).toBe(fromHex(sample.sealed).length);
      expect(toHex(sealer.open(sealed, sample.context))).toBe(sample.plaintext);
    }
  });
});
