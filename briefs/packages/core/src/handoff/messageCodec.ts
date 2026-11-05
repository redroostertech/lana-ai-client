import { toBase64 } from "../bytes/base64.js";
import { decodeDevicePublicKeys, encodeDevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { asLanaId } from "../ids/codec.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { arrayOf, asBool, asBytes, asEnum, asInt, asObject, asString, field, JsonShapeError, optional } from "../json/read.js";
import { decodeAccountInfoUpdate, encodeAccountInfoUpdate } from "./accountInfo.js";
import { decodeManifest, encodeManifest } from "./bundleManifest.js";
import { FAILURE_CODES } from "./errors.js";
import { ATTESTATION_METHODS, type AttestationMethod, type HandoffMessage, type PartHeader, type SessionRef } from "./messages.js";
import { decodeReceipt, encodeReceipt } from "./receipt.js";
import { decodeSyncSnooze, encodeSyncSnooze } from "./syncSnooze.js";
import { decodeBackgroundLeaseGrant, decodeLeaseSession, encodeBackgroundLeaseGrant, encodeLeaseSession } from "./backgroundLease.js";
import { decodeRecordAck, decodeRecordDecline, decodeRecordUpdate, encodeRecordAck, encodeRecordDecline, encodeRecordUpdate } from "./recordUpdate.js";

const method = (value: JsonValue, path: string): AttestationMethod => asEnum(value, ATTESTATION_METHODS, path);

const partHeader = (value: JsonValue, path: string): PartHeader => {
  const object = asObject(value, path);
  return { bundleID: field(object, "bundleID", path, asLanaId), index: field(object, "index", path, asInt) };
};

const sessionRef = (value: JsonValue, path: string): SessionRef => ({
  sessionID: field(asObject(value, path), "sessionID", path, asString),
});

function encodePayload(message: HandoffMessage): JsonValue {
  switch (message.type) {
    case "hello":
      return { ...message.payload };
    case "challenge":
      return { ...message.payload, methods: [...message.payload.methods] };
    case "sync_request":
      return { meetings: message.payload.meetings.map((meeting) => ({ ...meeting })) };
    case "sync_update":
      return encodeRecordUpdate(message.payload);
    case "sync_ack":
      return encodeRecordAck(message.payload);
    case "sync_decline":
      return encodeRecordDecline(message.payload);
    case "sync_snooze":
      return encodeSyncSnooze(message.payload);
    case "background_lease":
      return encodeBackgroundLeaseGrant(message.payload);
    case "lease_session":
      return encodeLeaseSession(message.payload);
    case "lease_accepted":
      return { sessionID: message.payload.sessionID };
    case "sync_part":
      return { bundleID: message.payload.bundleID, index: message.payload.index };
    case "account_info":
      return encodeAccountInfoUpdate(message.payload);
    case "sync_done":
      return {};
    case "listening":
    case "qr_shown":
    case "fallback":
    case "attested":
    case "failure":
    case "pair_decision":
      return { ...message.payload };
    case "attest":
      return { ...message.payload, nonce: toBase64(message.payload.nonce), signature: toBase64(message.payload.signature) };
    case "offer":
      return encodeManifest(message.payload);
    case "resume":
      return { bundleID: message.payload.bundleID, haveParts: [...message.payload.haveParts] };
    case "part":
    case "part_ack":
      return { bundleID: message.payload.bundleID, index: message.payload.index };
    case "receipt":
      return encodeReceipt(message.payload);
    case "done":
      return {};
    case "pair_request":
      return { phone: encodeDevicePublicKeys(message.payload.phone), proof: toBase64(message.payload.proof) };
    case "pair_complete":
      return encodeDevicePublicKeys(message.payload);
  }
}

export function encodeMessage(message: HandoffMessage): JsonObject {
  return { type: message.type, payload: encodePayload(message) };
}

/** Decodes `{"type", "payload"}`. Unknown types are rejected, as in Swift. */
export function decodeMessage(value: JsonValue, path = "message"): HandoffMessage {
  const object = asObject(value, path);
  const type = field(object, "type", path, asString);
  if (type === "done" || type === "sync_done") return { type };
  const payload = field(object, "payload", path, (v) => v);
  const at = `${path}.payload`;
  switch (type) {
    case "hello": {
      const p = asObject(payload, at);
      return {
        type,
        payload: {
          protocolVersion: field(p, "protocolVersion", at, asInt), deviceID: field(p, "deviceID", at, asLanaId), appVersion: field(p, "appVersion", at, asString),
          maxProtocolVersion: optional(p, "maxProtocolVersion", at, asInt),
        },
      };
    }
    case "challenge": {
      const p = asObject(payload, at);
      return {
        type,
        payload: {
          sessionID: field(p, "sessionID", at, asString), methods: field(p, "methods", at, arrayOf(method)), nonceBytes: field(p, "nonceBytes", at, asInt),
          protocolVersion: optional(p, "protocolVersion", at, asInt),
        },
      };
    }
    case "sync_request": {
      const p = asObject(payload, at);
      return {
        type,
        payload: {
          meetings: field(p, "meetings", at, arrayOf((item, itemPath) => {
            const meeting = asObject(item, itemPath);
            return { meetingID: field(meeting, "meetingID", itemPath, asLanaId), revision: field(meeting, "revision", itemPath, asInt), contentHash: field(meeting, "contentHash", itemPath, asString) };
          })),
        },
      };
    }
    case "sync_update":
      return { type, payload: decodeRecordUpdate(payload, at) };
    case "sync_ack":
      return { type, payload: decodeRecordAck(payload, at) };
    case "sync_decline":
      return { type, payload: decodeRecordDecline(payload, at) };
    case "sync_snooze":
      return { type, payload: decodeSyncSnooze(payload, at) };
    case "background_lease":
      return { type, payload: decodeBackgroundLeaseGrant(payload, at) };
    case "lease_session":
      return { type, payload: decodeLeaseSession(payload, at) };
    case "lease_accepted":
      return { type, payload: sessionRef(payload, at) };
    case "sync_part":
      return { type, payload: partHeader(payload, at) };
    case "account_info":
      return { type, payload: decodeAccountInfoUpdate(payload, at) };
    case "listening":
    case "qr_shown":
      return { type, payload: sessionRef(payload, at) };
    case "fallback": {
      const p = asObject(payload, at);
      return { type, payload: { method: field(p, "method", at, method), reason: field(p, "reason", at, asString) } };
    }
    case "attest": {
      const p = asObject(payload, at);
      return {
        type,
        payload: { sessionID: field(p, "sessionID", at, asString), method: field(p, "method", at, method), nonce: field(p, "nonce", at, asBytes), signature: field(p, "signature", at, asBytes) },
      };
    }
    case "attested": {
      const p = asObject(payload, at);
      return { type, payload: { sessionID: field(p, "sessionID", at, asString), method: field(p, "method", at, method), latencyMs: field(p, "latencyMs", at, asInt) } };
    }
    case "offer":
      return { type, payload: decodeManifest(payload, at) };
    case "resume": {
      const p = asObject(payload, at);
      return { type, payload: { bundleID: field(p, "bundleID", at, asLanaId), haveParts: field(p, "haveParts", at, arrayOf(asInt)) } };
    }
    case "part":
    case "part_ack":
      return { type, payload: partHeader(payload, at) };
    case "receipt":
      return { type, payload: decodeReceipt(payload, at) };
    case "failure": {
      const p = asObject(payload, at);
      return { type, payload: { code: field(p, "code", at, (v, q) => asEnum(v, FAILURE_CODES, q)), detail: field(p, "detail", at, asString) } };
    }
    case "pair_request": {
      const p = asObject(payload, at);
      return { type, payload: { phone: field(p, "phone", at, decodeDevicePublicKeys), proof: field(p, "proof", at, asBytes) } };
    }
    case "pair_decision":
      return { type, payload: { accepted: field(asObject(payload, at), "accepted", at, asBool) } };
    case "pair_complete":
      return { type, payload: decodeDevicePublicKeys(payload, at) };
    default:
      throw new JsonShapeError(`${path}.type`, "unknown message");
  }
}
