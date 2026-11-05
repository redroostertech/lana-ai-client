import { issueReceipt, openBundle, type OpenedBundle } from "@lana/core/handoff";
import { createInMemoryKeyVault, type KeyVault } from "@lana/core/keys";
import type { AttestationRecord } from "@lana/core/store";
import { goldenIdentities } from "../../../core/test/support/goldenIdentities.js";
import { goldenBundle, openRig, type StoreRig } from "../../../core/test/support/storeRig.js";
import type { LogFields, MainLog } from "../../src/main/log.js";

export const { mac, phone } = goldenIdentities();

/** Records log lines so tests can check that no content is logged. */
export class RecordingLog implements MainLog {
  readonly lines: string[] = [];
  readonly path = null;
  info = (event: string, fields?: LogFields) => void this.lines.push(JSON.stringify({ event, ...fields }));
  notice = (event: string, fields?: LogFields) => void this.lines.push(JSON.stringify({ event, ...fields }));
  error = (event: string, fields?: LogFields) => void this.lines.push(JSON.stringify({ event, ...fields }));
}

export interface RealRig extends StoreRig {
  readonly vault: KeyVault;
  readonly log: RecordingLog;
}

/** A temporary GatewayStore with the paired golden phone, an in-memory vault and a log. */
export async function openRealRig(): Promise<RealRig> {
  const rig = await openRig();
  await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
  return Object.assign(rig, { vault: createInMemoryKeyVault(), log: new RecordingLog() });
}

function attestation(): AttestationRecord {
  return { sessionID: "s1", phoneDeviceID: phone.publicKeys.deviceID, method: "acoustic", latencyMs: 420, attestedAt: new Date(1_800_000_000_000), tonePlays: 1 };
}

/** Receives the bundle the Swift phone code sealed (fixtures/golden): a meeting, its intents and audio. */
export async function receiveGoldenMeeting(rig: StoreRig): Promise<OpenedBundle> {
  const { manifest, parts } = goldenBundle();
  for (const [index, part] of parts.entries()) await rig.store.storePart(manifest.bundleID, index, part);
  const opened = await openBundle(manifest, parts, mac);
  await rig.store.complete(opened, issueReceipt(manifest, mac, rig.clock.now()), attestation());
  return opened;
}

/** Receives `meeting` (for example a richer fixture) through the golden bundle, under the bundle's meeting id. */
export async function receiveMeeting(rig: StoreRig, meeting: Omit<OpenedBundle["meeting"], "id">): Promise<OpenedBundle> {
  const { manifest, parts } = goldenBundle();
  for (const [index, part] of parts.entries()) await rig.store.storePart(manifest.bundleID, index, part);
  const opened = await openBundle(manifest, parts, mac);
  const swapped: OpenedBundle = { ...opened, meeting: { ...meeting, id: opened.meeting.id, intents: [] } };
  await rig.store.complete(swapped, issueReceipt(manifest, mac, rig.clock.now()), attestation());
  return swapped;
}
