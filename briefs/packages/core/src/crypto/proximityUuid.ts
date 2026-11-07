import { utf8 } from "../bytes/utf8.js";
import { hkdfSha256 } from "./digest.js";

/**
 * The BLE service UUID the Mac advertises for one paired phone (Swift `ProximityUUID`):
 * 16 bytes of HKDF over the transport PSK, marked as a version 8 (custom) RFC 4122 UUID,
 * formatted uppercase like `CBUUID.uuidString`.
 */
export function proximityServiceUuid(transportPsk: Uint8Array): string {
  return formatUuid(hkdfSha256(transportPsk, new Uint8Array(), utf8("lana.ble.service/v1"), 16));
}

/**
 * The BLE wake service UUID for one paired phone on one UTC day (Swift `ProximityUUID.wake`):
 * advertised only while something is queued for that phone. HKDF over the transport PSK with
 * info `lana.ble.wake/v1|<YYYY-MM-DD>`, so only the paired phone recognises it and it changes
 * every day (a suspended iPhone can only filter on UUIDs it registered in advance, so it
 * cannot rotate per wake; the phone registers today's and the next days' UUIDs).
 */
export function wakeServiceUuid(transportPsk: Uint8Array, at: Date): string {
  return formatUuid(hkdfSha256(transportPsk, new Uint8Array(), utf8(`lana.ble.wake/v1|${wakeDay(at)}`), 16));
}

/** The UTC day the wake UUID belongs to, `YYYY-MM-DD`. */
export function wakeDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function formatUuid(bytes: Uint8Array): string {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
