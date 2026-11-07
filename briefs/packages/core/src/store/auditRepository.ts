import {
  appendAuditRecord, exportAuditLines, readAuditEntries, verifyAuditChain,
  type AuditDetail, type AuditEntry, type AuditEvent, type AuditVerification,
} from "./auditLog.js";
import type { StoreContext } from "./storeContext.js";

/** The audit chain: append, read, verify, export (Swift `GatewayStore` audit methods). */
export class AuditRepository {
  constructor(private readonly ctx: StoreContext) {}

  append(event: AuditEvent, subject: string, detail: AuditDetail = {}): void {
    const at = this.ctx.now();
    this.ctx.db.write(() => appendAuditRecord(this.ctx.db, event, subject, detail, at));
  }

  entries(after = 0, limit = -1): AuditEntry[] {
    return readAuditEntries(this.ctx.db, after, limit);
  }

  verify(): AuditVerification {
    return verifyAuditChain(this.entries());
  }

  /** JSON Lines plus a trailer line with the head hash, byte identical to Swift. */
  export(): Uint8Array {
    return exportAuditLines(this.entries());
  }
}
