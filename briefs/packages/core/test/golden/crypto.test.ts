import { describe, expect, it } from "vitest";
import { fromHex, toHex, utf8 } from "../../src/bytes/index.js";
import {
  aesKeyUnwrap, aesKeyWrap, decodeDevicePublicKeys, decodeHpkeEnvelope, decodePairingInvitation, encodeDevicePublicKeys,
  encodeHpkeEnvelope, encodePairingInvitation, invitationQrString, openHpke, p256PrivateKeyFromRaw, p256Verify, pairingPsk,
  parseInvitationQr, phoneProof, proximityServiceUuid, RecordingKey, sealHpke, shortCode, transportPsk, verifyPhoneProof,
} from "../../src/crypto/index.js";
import { canonicalString, parseJson } from "../../src/json/index.js";
import { golden } from "./fixtures.js";
import { goldenIdentities } from "../support/goldenIdentities.js";

interface IdentityFixture {
  signing_public: string;
  agreement_public: string;
  public_keys_json: string;
}

const identity = golden<{ mac: IdentityFixture; phone: IdentityFixture; signatures: { message: string; signature: string; signer: string }[]; ecdh_shared_secret: string }>("identity");

const { mac, phone } = goldenIdentities();

describe("device identity matches CryptoKit", () => {
  it("derives the same X9.63 public keys from the raw private keys", () => {
    for (const [fixture, id] of [[identity.mac, mac], [identity.phone, phone]] as const) {
      expect(toHex(id.publicKeys.signingKey)).toBe(fixture.signing_public);
      expect(toHex(id.publicKeys.agreementKey)).toBe(fixture.agreement_public);
      expect(canonicalString(encodeDevicePublicKeys(id.publicKeys))).toBe(fixture.public_keys_json);
      expect(canonicalString(encodeDevicePublicKeys(decodeDevicePublicKeys(parseJson(fixture.public_keys_json), "keys")))).toBe(fixture.public_keys_json);
    }
  });

  it("verifies Swift signatures and rejects tampered ones", () => {
    for (const { message, signature, signer } of identity.signatures) {
      const key = (signer === "mac" ? mac : phone).publicKeys.signingKey;
      expect(p256Verify(key, fromHex(message), fromHex(signature))).toBe(true);
      const tampered = fromHex(signature);
      tampered[10] = (tampered[10] ?? 0) ^ 1;
      expect(p256Verify(key, fromHex(message), tampered)).toBe(false);
    }
  });

  it("produces signatures that verify and the same ECDH secret", () => {
    const message = utf8("desktop signs this");
    expect(p256Verify(phone.publicKeys.signingKey, message, phone.sign(message))).toBe(true);
    expect(toHex(mac.sharedSecret(phone.publicKeys.agreementKey))).toBe(identity.ecdh_shared_secret);
    expect(toHex(phone.sharedSecret(mac.publicKeys.agreementKey))).toBe(identity.ecdh_shared_secret);
  });
});

describe("pairing math matches Swift", () => {
  const fixture = golden<Record<string, unknown>>("pairing");
  const invitation = decodePairingInvitation(parseJson(fixture["invitation_json"] as string));

  it("round-trips the invitation and its QR text", () => {
    expect(canonicalString(encodePairingInvitation(invitation))).toBe(fixture["invitation_json"]);
    expect(invitationQrString(invitation)).toBe(fixture["qr"]);
    const parsed = parseInvitationQr(fixture["qr"] as string);
    expect(canonicalString(encodePairingInvitation(parsed))).toBe(fixture["invitation_json"]);
    expect(() => parseInvitationQr("https://pair?d=abc")).toThrow();
    expect(() => parseInvitationQr("lananotes://pair?d=%%%")).toThrow();
  });

  it("computes the same short code, proof, pairing PSK, transport PSK and BLE UUID", () => {
    expect(shortCode(invitation, phone.publicKeys)).toBe(fixture["short_code"]);
    const proof = phoneProof(invitation, phone.publicKeys);
    expect(toHex(proof)).toBe(fixture["phone_proof"]);
    expect(verifyPhoneProof(proof, invitation, phone.publicKeys)).toBe(true);
    expect(verifyPhoneProof(proof, invitation, mac.publicKeys)).toBe(false);
    expect(toHex(pairingPsk(invitation))).toBe(fixture["pairing_psk"]);
    const fromMac = transportPsk(mac, phone.publicKeys, mac.publicKeys.deviceID, phone.publicKeys.deviceID);
    const fromPhone = transportPsk(phone, mac.publicKeys, mac.publicKeys.deviceID, phone.publicKeys.deviceID);
    expect(toHex(fromMac)).toBe(fixture["transport_psk"]);
    expect(toHex(fromPhone)).toBe(fixture["transport_psk"]);
    expect(proximityServiceUuid(fromMac)).toBe(fixture["ble_uuid"]);
  });

  it("matches every exported BLE UUID and short code vector", () => {
    for (const { psk, uuid } of fixture["ble_vectors"] as { psk: string; uuid: string }[]) expect(proximityServiceUuid(fromHex(psk))).toBe(uuid);
    for (const { secret, code } of fixture["short_code_vectors"] as { secret: string; code: string }[]) {
      expect(shortCode({ ...invitation, oneTimeSecret: fromHex(secret) }, phone.publicKeys)).toBe(code);
    }
  });
});

describe("HPKE opens envelopes sealed by CryptoKit", () => {
  const fixture = golden<{ recipient_private: string; recipient_public: string; samples: Record<string, string>[] }>("hpke");
  const recipient = p256PrivateKeyFromRaw(fromHex(fixture.recipient_private));

  it("opens every sample and rejects the wrong info or aad", async () => {
    expect(toHex(recipient.x963)).toBe(fixture.recipient_public);
    for (const sample of fixture.samples) {
      const envelope = { encapsulatedKey: fromHex(sample["enc"] as string), ciphertext: fromHex(sample["ct"] as string) };
      const info = fromHex(sample["info"] as string);
      const aad = fromHex(sample["aad"] as string);
      expect(toHex(await openHpke(envelope, recipient, info, aad))).toBe(sample["plaintext"]);
      expect(canonicalString(encodeHpkeEnvelope(decodeHpkeEnvelope(parseJson(sample["envelope_json"] as string), "env")))).toBe(sample["envelope_json"]);
      await expect(openHpke(envelope, recipient, utf8("other info"), aad)).rejects.toThrow();
    }
  });

  it("opens what it seals", async () => {
    const envelope = await sealHpke(utf8("bundle key"), recipient.x963, utf8("info"));
    expect(Buffer.from(await openHpke(envelope, recipient, utf8("info"))).toString()).toBe("bundle key");
  });
});

describe("at-rest cipher matches CryptoKit", () => {
  const fixture = golden<{ master: string; recording_key: string; wrapped: string; samples: { plaintext: string; context: string; sealed: string }[] }>("atrest");
  const master = fromHex(fixture.master);

  it("wraps the recording key to the same bytes and unwraps it", () => {
    expect(toHex(aesKeyWrap(master, fromHex(fixture.recording_key)))).toBe(fixture.wrapped);
    expect(toHex(aesKeyUnwrap(master, fromHex(fixture.wrapped)))).toBe(fixture.recording_key);
    const bad = fromHex(fixture.wrapped);
    bad[3] = (bad[3] ?? 0) ^ 1;
    expect(() => aesKeyUnwrap(master, bad)).toThrow();
  });

  it("opens every sealed sample and rejects another context", () => {
    const key = RecordingKey.unwrap(fromHex(fixture.wrapped), master);
    for (const { plaintext, context, sealed } of fixture.samples) {
      expect(toHex(key.open(fromHex(sealed), context))).toBe(plaintext);
      expect(() => key.open(fromHex(sealed), `${context}x`)).toThrow();
      expect(toHex(key.open(key.seal(fromHex(plaintext), context), context))).toBe(plaintext);
    }
  });
});
