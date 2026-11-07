import { toBase64 } from "../bytes/base64.js";
import { utf8 } from "../bytes/utf8.js";
import { ChunkCipher } from "../crypto/chunkCipher.js";
import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import { verifyDeviceSignature, type DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { sha256Hex } from "../crypto/digest.js";
import { decodeHpkeEnvelope, encodeHpkeEnvelope, sealHpke, type HpkeEnvelope } from "../crypto/hpke.js";
import { randomBytes } from "../crypto/random.js";
import { asLanaId } from "../ids/codec.js";
import { makeLanaId, type LanaId } from "../ids/lanaId.js";
import { contentHash } from "../intent/meetingMerge.js";
import { decodeMeeting, encodeMeeting, type MeetingRecord } from "../intent/meeting.js";
import { canonicalEncode } from "../json/canonical.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { LanaDate } from "../json/lanaDate.js";
import { parseJson } from "../json/parse.js";
import { arrayOf, asBytes, asDate, asEnum, asInt, asObject, asString, field } from "../json/read.js";
import { HandoffError } from "./errors.js";

export const RECORD_UPDATE_SCHEMA = "lana.record-update/v1";
export const RECORD_ACK_SCHEMA = "lana.record-ack/v1";
export const RECORD_DECLINE_SCHEMA = "lana.record-decline/v1";

export interface RecordUpdatePart {
  readonly index: number;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}

/**
 * The desktop's copy of a shared meeting record sealed for the phone (Swift
 * `RecordUpdate`, `sync_update`). Part 0 is the canonical record; audio parts follow as
 * `sync_part` frames for a meeting the phone does not have. Signed by the Mac.
 */
export interface RecordUpdate {
  readonly schema: string;
  readonly updateID: LanaId;
  readonly meetingID: LanaId;
  readonly phoneDeviceID: LanaId;
  readonly macDeviceID: LanaId;
  readonly revision: number;
  readonly contentHash: string;
  readonly parts: readonly RecordUpdatePart[];
  readonly createdAt: Date;
  readonly envelope: HpkeEnvelope;
  readonly signature: Uint8Array;
}

/** Phone-signed proof that an update was applied (Swift `RecordAck`, `sync_ack`). */
export interface RecordAck {
  readonly schema: string;
  readonly updateID: LanaId;
  readonly meetingID: LanaId;
  readonly phoneDeviceID: LanaId;
  readonly revision: number;
  readonly contentHash: string;
  readonly receivedAt: Date;
  readonly signature: Uint8Array;
}

export function encodeRecordUpdate(update: RecordUpdate): JsonObject {
  return {
    schema: update.schema,
    update_id: update.updateID,
    meeting_id: update.meetingID,
    phone_device_id: update.phoneDeviceID,
    mac_device_id: update.macDeviceID,
    revision: update.revision,
    content_hash: update.contentHash,
    parts: update.parts.map((part) => ({ index: part.index, name: part.name, size: part.size, sha256: part.sha256 })),
    created_at: LanaDate.format(update.createdAt),
    envelope: encodeHpkeEnvelope(update.envelope),
    signature: toBase64(update.signature),
  };
}

export function decodeRecordUpdate(value: JsonValue, path = "update"): RecordUpdate {
  const object = asObject(value, path);
  return {
    schema: field(object, "schema", path, asString),
    updateID: field(object, "update_id", path, asLanaId),
    meetingID: field(object, "meeting_id", path, asLanaId),
    phoneDeviceID: field(object, "phone_device_id", path, asLanaId),
    macDeviceID: field(object, "mac_device_id", path, asLanaId),
    revision: field(object, "revision", path, asInt),
    contentHash: field(object, "content_hash", path, asString),
    parts: field(object, "parts", path, arrayOf((item, itemPath) => {
      const part = asObject(item, itemPath);
      return { index: field(part, "index", itemPath, asInt), name: field(part, "name", itemPath, asString), size: field(part, "size", itemPath, asInt), sha256: field(part, "sha256", itemPath, asString) };
    })),
    createdAt: field(object, "created_at", path, asDate),
    envelope: field(object, "envelope", path, decodeHpkeEnvelope),
    signature: field(object, "signature", path, asBytes),
  };
}

export function recordUpdateSignedBytes(update: RecordUpdate): Uint8Array {
  return canonicalEncode(encodeRecordUpdate({ ...update, signature: new Uint8Array() }));
}

export function recordUpdateHpkeInfo(updateID: LanaId, phoneDeviceID: LanaId): Uint8Array {
  return utf8(`lana.record-update/v1|${updateID}|${phoneDeviceID}`);
}

export function recordUpdatePartAad(updateID: LanaId, meetingID: LanaId, revision: number, index: number, name: string): Uint8Array {
  return utf8(`lana.record-update/v1|${updateID}|${meetingID}|${revision}|${index}|${name}`);
}

/** Mac side: seals `record` (and `audio`) for `phone` and signs the header. */
export async function issueRecordUpdate(input: {
  readonly record: MeetingRecord;
  readonly audio?: readonly { readonly name: string; readonly data: Uint8Array }[];
  readonly phone: DevicePublicKeys;
  readonly mac: DeviceIdentity;
  readonly at: Date;
  readonly updateID?: LanaId;
}): Promise<{ update: RecordUpdate; parts: Uint8Array[] }> {
  const updateID = input.updateID ?? makeLanaId("bundle");
  const revision = input.record.sync?.revision ?? 0;
  const key = randomBytes(32);
  const plaintexts = [{ name: "meeting.json", data: canonicalEncode(encodeMeeting(input.record)) }, ...(input.audio ?? [])];
  const parts: Uint8Array[] = [];
  const table = plaintexts.map((part, index) => {
    const sealed = ChunkCipher.seal(part.data, key, recordUpdatePartAad(updateID, input.record.id, revision, index, part.name));
    parts.push(sealed);
    return { index, name: part.name, size: sealed.length, sha256: sha256Hex(sealed) };
  });
  const unsigned: RecordUpdate = {
    schema: RECORD_UPDATE_SCHEMA,
    updateID,
    meetingID: input.record.id,
    phoneDeviceID: input.phone.deviceID,
    macDeviceID: input.mac.publicKeys.deviceID,
    revision,
    contentHash: contentHash(input.record),
    parts: table,
    createdAt: new Date(LanaDate.milliseconds(input.at)),
    envelope: await sealHpke(key, input.phone.agreementKey, recordUpdateHpkeInfo(updateID, input.phone.deviceID)),
    signature: new Uint8Array(),
  };
  return { update: { ...unsigned, signature: input.mac.sign(recordUpdateSignedBytes(unsigned)) }, parts };
}

/** Phone side (tests and the golden check): verifies, opens and checks a record update. */
export async function openRecordUpdate(update: RecordUpdate, parts: readonly Uint8Array[], phone: DeviceIdentity, mac: DevicePublicKeys): Promise<{ record: MeetingRecord; audio: { name: string; data: Uint8Array }[] }> {
  if (update.schema !== RECORD_UPDATE_SCHEMA) throw new HandoffError("bundle_rejected", "unsupported record update");
  if (update.phoneDeviceID !== phone.publicKeys.deviceID || update.macDeviceID !== mac.deviceID) throw new HandoffError("bundle_rejected", "record update for another device");
  if (!verifyDeviceSignature(mac, update.signature, recordUpdateSignedBytes(update))) throw new HandoffError("bundle_rejected", "bad record update signature");
  if (parts.length !== update.parts.length || !update.parts.every((part, index) => parts[index]?.length === part.size && sha256Hex(parts[index] as Uint8Array) === part.sha256)) {
    throw new HandoffError("bundle_rejected", "record update hash mismatch");
  }
  const key = await phone.openHpke(update.envelope, recordUpdateHpkeInfo(update.updateID, update.phoneDeviceID));
  const plaintexts = update.parts.map((part, index) => ChunkCipher.open(parts[index] as Uint8Array, key, recordUpdatePartAad(update.updateID, update.meetingID, update.revision, part.index, part.name)));
  const record = decodeMeeting(parseJson(plaintexts[0] as Uint8Array));
  if (record.id !== update.meetingID || (record.sync?.revision ?? 0) !== update.revision || contentHash(record) !== update.contentHash) {
    throw new HandoffError("bundle_rejected", "record update does not match its header");
  }
  return { record, audio: update.parts.slice(1).map((part, offset) => ({ name: part.name, data: plaintexts[offset + 1] as Uint8Array })) };
}

export function encodeRecordAck(ack: RecordAck): JsonObject {
  return {
    schema: ack.schema,
    update_id: ack.updateID,
    meeting_id: ack.meetingID,
    phone_device_id: ack.phoneDeviceID,
    revision: ack.revision,
    content_hash: ack.contentHash,
    received_at: LanaDate.format(ack.receivedAt),
    signature: toBase64(ack.signature),
  };
}

export function decodeRecordAck(value: JsonValue, path = "ack"): RecordAck {
  const object = asObject(value, path);
  return {
    schema: field(object, "schema", path, asString),
    updateID: field(object, "update_id", path, asLanaId),
    meetingID: field(object, "meeting_id", path, asLanaId),
    phoneDeviceID: field(object, "phone_device_id", path, asLanaId),
    revision: field(object, "revision", path, asInt),
    contentHash: field(object, "content_hash", path, asString),
    receivedAt: field(object, "received_at", path, asDate),
    signature: field(object, "signature", path, asBytes),
  };
}

export function recordAckSignedBytes(ack: RecordAck): Uint8Array {
  return canonicalEncode(encodeRecordAck({ ...ack, signature: new Uint8Array() }));
}

/** Phone side (tests): signs an ack for `update` with the phone's resulting record. */
export function issueRecordAck(update: RecordUpdate, result: MeetingRecord, phone: DeviceIdentity, at: Date): RecordAck {
  const unsigned: RecordAck = {
    schema: RECORD_ACK_SCHEMA,
    updateID: update.updateID,
    meetingID: update.meetingID,
    phoneDeviceID: phone.publicKeys.deviceID,
    revision: result.sync?.revision ?? 0,
    contentHash: contentHash(result),
    receivedAt: new Date(LanaDate.milliseconds(at)),
    signature: new Uint8Array(),
  };
  return { ...unsigned, signature: phone.sign(recordAckSignedBytes(unsigned)) };
}

/** True only if the pinned phone signed an ack for exactly this update. */
export function verifyRecordAck(ack: RecordAck, update: RecordUpdate, phone: DevicePublicKeys): boolean {
  if (ack.schema !== RECORD_ACK_SCHEMA || ack.updateID !== update.updateID || ack.meetingID !== update.meetingID || ack.phoneDeviceID !== phone.deviceID) return false;
  return verifyDeviceSignature(phone, ack.signature, recordAckSignedBytes(ack));
}

export const RECORD_DECLINE_REASONS = ["declined", "later"] as const;
/** `declined`: the person said Decline on the phone. `later`: no answer in the phone's decision window. */
export type RecordDeclineReason = (typeof RECORD_DECLINE_REASONS)[number];

/**
 * Phone-signed answer to an update for a meeting it does not hold, sent instead of
 * `sync_ack` after reading (and discarding) every part (Swift `RecordDecline`, `sync_decline`).
 */
export interface RecordDecline {
  readonly schema: string;
  readonly updateID: LanaId;
  readonly meetingID: LanaId;
  readonly phoneDeviceID: LanaId;
  readonly reason: RecordDeclineReason;
  readonly declinedAt: Date;
  readonly signature: Uint8Array;
}

export function encodeRecordDecline(decline: RecordDecline): JsonObject {
  return {
    schema: decline.schema,
    update_id: decline.updateID,
    meeting_id: decline.meetingID,
    phone_device_id: decline.phoneDeviceID,
    reason: decline.reason,
    declined_at: LanaDate.format(decline.declinedAt),
    signature: toBase64(decline.signature),
  };
}

export function decodeRecordDecline(value: JsonValue, path = "decline"): RecordDecline {
  const object = asObject(value, path);
  return {
    schema: field(object, "schema", path, asString),
    updateID: field(object, "update_id", path, asLanaId),
    meetingID: field(object, "meeting_id", path, asLanaId),
    phoneDeviceID: field(object, "phone_device_id", path, asLanaId),
    reason: field(object, "reason", path, (item, itemPath) => asEnum(item, RECORD_DECLINE_REASONS, itemPath)),
    declinedAt: field(object, "declined_at", path, asDate),
    signature: field(object, "signature", path, asBytes),
  };
}

export function recordDeclineSignedBytes(decline: RecordDecline): Uint8Array {
  return canonicalEncode(encodeRecordDecline({ ...decline, signature: new Uint8Array() }));
}

/** Phone side (tests): signs a decline for `update`. */
export function issueRecordDecline(update: RecordUpdate, reason: RecordDeclineReason, phone: DeviceIdentity, at: Date): RecordDecline {
  const unsigned: RecordDecline = {
    schema: RECORD_DECLINE_SCHEMA,
    updateID: update.updateID,
    meetingID: update.meetingID,
    phoneDeviceID: phone.publicKeys.deviceID,
    reason,
    declinedAt: new Date(LanaDate.milliseconds(at)),
    signature: new Uint8Array(),
  };
  return { ...unsigned, signature: phone.sign(recordDeclineSignedBytes(unsigned)) };
}

/** True only if the pinned phone signed a decline for exactly this update. */
export function verifyRecordDecline(decline: RecordDecline, update: RecordUpdate, phone: DevicePublicKeys): boolean {
  if (decline.schema !== RECORD_DECLINE_SCHEMA || decline.updateID !== update.updateID || decline.meetingID !== update.meetingID || decline.phoneDeviceID !== phone.deviceID) return false;
  return verifyDeviceSignature(phone, decline.signature, recordDeclineSignedBytes(decline));
}
