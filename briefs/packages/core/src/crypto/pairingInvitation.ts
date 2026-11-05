import { fromBase64Url, toBase64, toBase64Url } from "../bytes/base64.js";
import { utf8 } from "../bytes/utf8.js";
import { canonicalEncode } from "../json/canonical.js";
import { LanaDate } from "../json/lanaDate.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { parseJson } from "../json/parse.js";
import { asBytes, asDate, asInt, asObject, asString, field } from "../json/read.js";
import { hkdfSha256 } from "./digest.js";
import { decodeDevicePublicKeys, encodeDevicePublicKeys, type DevicePublicKeys } from "./devicePublicKeys.js";
import { randomBytes } from "./random.js";

export const PAIRING_INVITATION_VERSION = 1;
const SECRET_BYTES = 32;
const DEFAULT_LIFETIME_MS = 300_000;

/** What the Mac shows as a QR code: its public keys and a one-time secret. */
export interface PairingInvitation {
  readonly version: number;
  readonly mac: DevicePublicKeys;
  readonly oneTimeSecret: Uint8Array;
  readonly expiresAt: Date;
  /** Bonjour service instance name the phone should connect to. */
  readonly serviceName: string;
}

export class PairingError extends Error {
  override readonly name = "PairingError";
  constructor(readonly code: "malformed_invitation" | "expired" | "already_used" | "bad_proof") {
    super(`Pairing failed: ${code}`);
  }
}

export function makePairingInvitation(mac: DevicePublicKeys, serviceName: string, now: Date, lifetimeMs = DEFAULT_LIFETIME_MS): PairingInvitation {
  return {
    version: PAIRING_INVITATION_VERSION,
    mac,
    oneTimeSecret: randomBytes(SECRET_BYTES),
    expiresAt: new Date(LanaDate.milliseconds(now.getTime() + lifetimeMs)),
    serviceName,
  };
}

export function encodePairingInvitation(invitation: PairingInvitation): JsonObject {
  return {
    v: invitation.version,
    mac: encodeDevicePublicKeys(invitation.mac),
    secret: toBase64(invitation.oneTimeSecret),
    exp: LanaDate.format(invitation.expiresAt),
    svc: invitation.serviceName,
  };
}

export function decodePairingInvitation(value: JsonValue, path = "invitation"): PairingInvitation {
  const object = asObject(value, path);
  return {
    version: field(object, "v", path, asInt),
    mac: field(object, "mac", path, decodeDevicePublicKeys),
    oneTimeSecret: field(object, "secret", path, asBytes),
    expiresAt: field(object, "exp", path, asDate),
    serviceName: field(object, "svc", path, asString),
  };
}

/** QR text: `lananotes://pair?d=<base64url canonical JSON>`. */
export function invitationQrString(invitation: PairingInvitation): string {
  return `lananotes://pair?d=${toBase64Url(canonicalEncode(encodePairingInvitation(invitation)))}`;
}

export function parseInvitationQr(qr: string): PairingInvitation {
  let url: URL;
  try {
    url = new URL(qr);
  } catch {
    throw new PairingError("malformed_invitation");
  }
  if (url.protocol !== "lananotes:" || url.hostname !== "pair") throw new PairingError("malformed_invitation");
  const item = url.search.slice(1).split("&").find((part) => part === "d" || part.startsWith("d="));
  let payload: Uint8Array | null = null;
  try {
    payload = item === undefined ? null : fromBase64Url(decodeURIComponent(item.slice(2)));
  } catch {
    payload = null;
  }
  if (payload === null) throw new PairingError("malformed_invitation");
  try {
    const invitation = decodePairingInvitation(parseJson(payload));
    if (invitation.version !== PAIRING_INVITATION_VERSION || invitation.oneTimeSecret.length !== SECRET_BYTES) throw new PairingError("malformed_invitation");
    return invitation;
  } catch {
    throw new PairingError("malformed_invitation");
  }
}

/** TLS pre-shared key for the pairing connection only. */
export function pairingPsk(invitation: PairingInvitation): Uint8Array {
  return hkdfSha256(invitation.oneTimeSecret, new Uint8Array(), utf8("lana.pairing.psk/v1"), 32);
}
