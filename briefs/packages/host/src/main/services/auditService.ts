import { writeFile } from "node:fs/promises";
import { displayTitleOf } from "@lana/core/intent";
import type { AuditEntry as CoreAuditEntry, GatewayStore } from "@lana/core/store";
import type { AuditApi, AuditEntry, AuditLogApi, AuditRow, AuditVerification, Result } from "../../shared/api.js";
import { describeAuditEntry, NO_AUDIT_NAMES, type AuditNames } from "../../shared/auditDisplay.js";
import type { MainLog } from "../log.js";

/** Asks the person where to save the export; null when they cancelled. */
export type SavePicker = (suggestedName: string) => Promise<string | null>;

const UNREADABLE = { code: "store", message: "LANA could not read the audit log." } as const;

/** `lana-audit-yyyy-MM-dd.jsonl` in local time, as the Mac app names it. */
export function exportFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `lana-audit-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.jsonl`;
}

/** The stored detail object; empty when it is not a JSON object of strings. */
export function parseAuditDetail(detail: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const object = parsed as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, typeof object[key] === "string" ? (object[key] as string) : ""]));
}

export function toAuditRow(entry: CoreAuditEntry, names: AuditNames = NO_AUDIT_NAMES): AuditRow {
  const detail = parseAuditDetail(entry.detail);
  const { sentence, category } = describeAuditEntry({ at: entry.at, event: entry.event, subject: entry.subject, detail }, names);
  return {
    seq: entry.seq,
    at: entry.at.toISOString(),
    event: entry.event,
    sentence,
    category,
    subject: entry.subject,
    detail: Object.entries(detail).map(([key, value]) => ({ key, value })),
    hash: entry.hash,
  };
}

/** One lookup that may fail on its own (a meeting that will not open) without hiding the log. */
function lookup(read: () => Array<[string, string]>): Map<string, string> {
  try {
    return new Map(read());
  } catch {
    return new Map();
  }
}

/**
 * The store's hash-chained audit log (Swift `AuditViewModel`): entries, verification and
 * the auditor export, written as JSON Lines exactly as `GatewayStore.exportAudit` makes
 * them, to a file the person picks in the native save dialog.
 */
export class AuditService implements AuditLogApi {
  readonly legacy: AuditApi;

  constructor(
    private readonly store: GatewayStore,
    private readonly pickSavePath: SavePicker,
    private readonly log: MainLog,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.legacy = {
      list: async (): Promise<Result<AuditEntry[]>> => {
        const rows = await this.entries();
        return rows.ok ? { ok: true, value: rows.value.map((row) => ({ at: row.at, event: row.event, subject: row.subject })) } : rows;
      },
      verify: async () => {
        const result = await this.verify();
        return result.ok ? { ok: true, value: { intact: result.value.kind === "intact", entries: result.value.entries } } : result;
      },
    };
  }

  async entries(): Promise<Result<AuditRow[]>> {
    try {
      const entries = await this.store.auditEntries();
      const names = await this.names();
      return { ok: true, value: entries.map((entry) => toAuditRow(entry, names)) };
    } catch {
      this.log.error("audit.list_failed");
      return { ok: false, error: UNREADABLE };
    }
  }

  /** Meeting titles, device names (unpaired ones too) and action titles, for the sentences. */
  private async names(): Promise<AuditNames> {
    const { store } = this;
    const paired = await store.pairedDevices(true).catch(() => []);
    return {
      meetings: lookup(() => store.meetings.list().map((meeting) => [meeting.id, meeting.title])),
      devices: lookup(() => paired.map((device) => [device.keys.deviceID, device.keys.displayName])),
      actions: lookup(() => [false, true].flatMap((deleted) => store.actions.list({ status: [], kind: [], deleted })).map((stored) => [stored.id, displayTitleOf(stored.params)])),
    };
  }

  async verify(): Promise<Result<AuditVerification>> {
    try {
      const result = await this.store.verifyAudit();
      this.log.info("audit.verified", { entries: result.entries, intact: result.isIntact });
      return {
        ok: true,
        value: result.isIntact || result.brokenAt === null ? { kind: "intact", entries: result.entries } : { kind: "broken", seq: result.brokenAt, entries: result.entries },
      };
    } catch {
      this.log.error("audit.verify_failed");
      return { ok: false, error: UNREADABLE };
    }
  }

  async export(): Promise<Result<{ message: string } | null>> {
    let data: Uint8Array;
    let count: number;
    try {
      count = (await this.store.auditEntries()).length;
      data = await this.store.exportAudit();
    } catch {
      this.log.error("audit.export_read_failed");
      return { ok: false, error: { code: "store", message: "The export could not be saved." } };
    }
    const path = await this.pickSavePath(exportFileName(this.now()));
    if (path === null) return { ok: true, value: null };
    try {
      await writeFile(path, data, { mode: 0o600 });
    } catch {
      this.log.error("audit.export_write_failed");
      return { ok: false, error: { code: "io", message: "The export could not be saved." } };
    }
    this.log.info("audit.exported", { entries: count });
    return { ok: true, value: { message: `Exported ${count} entries.` } };
  }
}
