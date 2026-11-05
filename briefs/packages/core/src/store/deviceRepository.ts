import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { parseLanaId, type LanaId } from "../ids/lanaId.js";
import { LanaDate } from "../json/lanaDate.js";
import { appendAuditRecord, AUDIT_EVENTS } from "./auditLog.js";
import { blob, optionalText, text, type Row } from "./database.js";
import { StoreError } from "./errors.js";
import type { StoreContext } from "./storeContext.js";
import { parseStoredDate } from "./storedDate.js";
import type { PairedDevice, TransportPsk } from "./types.js";

/** Device trust: paired phones, their pinned public keys and transport PSKs. */
export class DeviceRepository {
  constructor(private readonly ctx: StoreContext) {}

  /** Pins a phone (or re-pins it after a new pairing). The PSK is sealed at rest. */
  pair(phone: DevicePublicKeys, transportPsk: Uint8Array): void {
    const at = this.ctx.now();
    const { db, sealer } = this.ctx;
    db.write(() => {
      db.run(`INSERT INTO paired_device (device_id, display_name, signing_key, agreement_key, transport_psk, paired_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(device_id) DO UPDATE SET display_name = excluded.display_name, signing_key = excluded.signing_key,
            agreement_key = excluded.agreement_key, transport_psk = excluded.transport_psk, paired_at = excluded.paired_at, revoked_at = NULL`,
        phone.deviceID, phone.displayName, phone.signingKey, phone.agreementKey,
        sealer.seal(transportPsk, `psk|${phone.deviceID}`), LanaDate.format(at));
      appendAuditRecord(db, AUDIT_EVENTS.devicePaired, phone.deviceID, {}, at);
    });
  }

  revoke(deviceID: LanaId): void {
    const at = this.ctx.now();
    const { db } = this.ctx;
    db.write(() => {
      const changes = db.run("UPDATE paired_device SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL", LanaDate.format(at), deviceID);
      if (changes === 0) throw StoreError.notFound(deviceID);
      appendAuditRecord(db, AUDIT_EVENTS.deviceRevoked, deviceID, {}, at);
    });
  }

  list(includeRevoked = false): PairedDevice[] {
    const filter = includeRevoked ? "" : "WHERE revoked_at IS NULL";
    return this.ctx.db.all(`SELECT * FROM paired_device ${filter} ORDER BY paired_at`).map((row) => ({
      keys: devicePublicKeys(row),
      pairedAt: parseStoredDate(optionalText(row, "paired_at")),
      revokedAt: optionalText(row, "revoked_at") === null ? null : parseStoredDate(optionalText(row, "revoked_at")),
    }));
  }

  /** Transport keys for every active pairing, for the TLS listener. */
  transportPsks(): TransportPsk[] {
    return this.ctx.db.all("SELECT device_id, transport_psk FROM paired_device WHERE revoked_at IS NULL").map((row) => {
      const deviceID = text(row, "device_id");
      return { identity: deviceID, key: this.ctx.sealer.open(blob(row, "transport_psk"), `psk|${deviceID}`) };
    });
  }

  /** The pinned keys of an active pairing, or null (Swift `TrustStore.pinnedPhone`). */
  pinnedPhone(deviceID: string): DevicePublicKeys | null {
    try {
      const row = this.ctx.db.get("SELECT * FROM paired_device WHERE device_id = ? AND revoked_at IS NULL", deviceID);
      return row === undefined ? null : devicePublicKeys(row);
    } catch {
      return null;
    }
  }
}

function devicePublicKeys(row: Row): DevicePublicKeys {
  const deviceID = parseLanaId(text(row, "device_id"), "device");
  if (deviceID === null) throw StoreError.corrupt("device id");
  return {
    deviceID,
    signingKey: blob(row, "signing_key"),
    agreementKey: blob(row, "agreement_key"),
    displayName: text(row, "display_name"),
  };
}
