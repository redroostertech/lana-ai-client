import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wakeServiceUuid, proximityServiceUuid } from "../../src/crypto/index.js";
import { BACKGROUND_UPDATE_KEYS, loadBackgroundUpdates, revokeAllLeases, revokePhoneLeases, saveBackgroundUpdates, StoreLeaseAuthority } from "../../src/gateway/index.js";
import {
  backgroundLeaseSignedBytes, checkLeaseSession, decodeMessage, encodeMessage, expectMessage, HANDOFF_BACKGROUND_LEASE_VERSION, HANDOFF_SNOOZE_VERSION, HandoffError,
  issueBackgroundLease, issueLeaseSession, issueReceipt, issueRecordAck, issueRecordDecline, MacHandoffSession, MemoryFrameChannel, openBundle, openRecordUpdate,
  type BackgroundLease, type FrameChannel, type HandoffMessage, type SharedMeeting,
} from "../../src/handoff/index.js";
import { contentHash, type MeetingRecord } from "../../src/intent/index.js";
import type { LanaId } from "../../src/ids/index.js";
import { canonicalEncode } from "../../src/json/index.js";
import type { AttestationRecord } from "../../src/store/index.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { Air, FakeClock, FakePresenter, runScriptedPhone, type PhoneResult } from "../support/handoffFakes.js";
import { goldenBundle, openRig, type StoreRig } from "../support/storeRig.js";

const { mac, phone } = goldenIdentities();
const HOUR = 3_600_000;

function attestation(): AttestationRecord {
  return { sessionID: "s1", phoneDeviceID: phone.publicKeys.deviceID, method: "qr", latencyMs: 300, attestedAt: new Date(1_800_000_000_000), tonePlays: 0 };
}

let rig: StoreRig;
let clock: FakeClock;
let id: LanaId;
let phoneCopy: MeetingRecord;
beforeEach(async () => {
  rig = await openRig();
  clock = new FakeClock();
  await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
  const { manifest, parts } = goldenBundle();
  const first = await openBundle(manifest, parts, mac);
  await rig.store.complete(first, issueReceipt(manifest, mac, rig.clock.now()), attestation());
  id = first.meeting.id;
  phoneCopy = rig.store.shared.current(id);
});
afterEach(() => rig.cleanup());

function authority() {
  return new StoreLeaseAuthority({ identity: mac, settings: rig.store.settings, trust: rig.store, audit: rig.store, clock });
}

function macSession(withLeases = true) {
  return new MacHandoffSession({
    identity: mac, trust: rig.store, tone: new Air(), presenter: new FakePresenter(), sink: rig.store, records: rig.store, clock,
    snooze: async () => undefined, ...(withLeases ? { leases: authority() } : {}),
  });
}

async function enable(on = true, hours = 8): Promise<void> {
  await saveBackgroundUpdates(rig.store.settings, rig.store, { enabled: on, leaseHours: hours }, clock.now());
}

async function auditRows(event: string) {
  return (await rig.store.auditEntries()).filter((entry) => entry.event === event).map((entry) => ({ subject: entry.subject, detail: JSON.parse(entry.detail) as Record<string, string> }));
}

const listedPhoneCopy = (): SharedMeeting[] => [{ meetingID: id, revision: 1, contentHash: contentHash(phoneCopy) }];

/** The phone side of a background session: hello, challenge, `lease_session`, then receive only. */
async function leasedPhone(channel: FrameChannel, lease: BackgroundLease, options: { listed?: SharedMeeting[]; misbehave?: "offer" | "decline" } = {}) {
  const messages: string[] = [];
  try {
    await channel.send({ message: { type: "hello", payload: { protocolVersion: 1, deviceID: phone.publicKeys.deviceID, appVersion: "1.2", maxProtocolVersion: HANDOFF_BACKGROUND_LEASE_VERSION } }, body: new Uint8Array() });
    const { payload: challenge } = await expectMessage(channel, 5_000, "challenge");
    await channel.send({ message: { type: "lease_session", payload: issueLeaseSession(challenge.sessionID, mac.publicKeys, lease, phone, clock.now()) }, body: new Uint8Array() });
    await expectMessage(channel, 5_000, "lease_accepted", (ref) => ref.sessionID === challenge.sessionID);
    if (options.misbehave === "offer") {
      await channel.send({ message: { type: "offer", payload: goldenBundle().manifest }, body: new Uint8Array() });
    }
    await channel.send({ message: { type: "sync_request", payload: { meetings: options.listed ?? [] } }, body: new Uint8Array() });
    for (;;) {
      const { message, body } = await channel.receive(5_000);
      messages.push(message.type);
      if (message.type === "sync_done") break;
      if (message.type === "failure") throw new HandoffError("peer_failed", message.payload.detail, message.payload.code);
      if (message.type === "sync_update") {
        const update = message.payload;
        const reply: HandoffMessage = options.misbehave === "decline"
          ? { type: "sync_decline", payload: issueRecordDecline(update, "declined", phone, clock.now()) }
          : { type: "sync_ack", payload: issueRecordAck(update, (await openRecordUpdate(update, [body], phone, mac.publicKeys)).record, phone, clock.now()) };
        await channel.send({ message: reply, body: new Uint8Array() });
      }
    }
    await channel.send({ message: { type: "done" }, body: new Uint8Array() });
    return messages;
  } finally {
    channel.close();
  }
}

async function runLeased(lease: BackgroundLease, options: Parameters<typeof leasedPhone>[2] = {}, session = macSession()) {
  const { client, server } = MemoryFrameChannel.pair();
  const [macResult, phoneResult] = await Promise.allSettled([session.run(server), leasedPhone(client, lease, options)]);
  return { mac: macResult, phone: phoneResult };
}

describe("lana.background-lease/v1", () => {
  it("is canonical JSON signed by the Mac, and round-trips through the background_lease message", () => {
    const lease = issueBackgroundLease({ phone: phone.publicKeys, mac, at: clock.now(), durationMs: 8 * HOUR });
    expect(new TextDecoder().decode(backgroundLeaseSignedBytes(lease))).toBe(
      `{"expires_at":"2026-11-01T20:00:00.000Z","issued_at":"2026-11-01T12:00:00.000Z","mac_device_id":"${mac.publicKeys.deviceID}","phone_device_id":"${phone.publicKeys.deviceID}","schema":"lana.background-lease/v1","scope":"receive_shared_updates","signature":""}`,
    );
    const message: HandoffMessage = { type: "background_lease", payload: { lease } };
    expect(canonicalEncode(encodeMessage(decodeMessage(encodeMessage(message))))).toEqual(canonicalEncode(encodeMessage(message)));
    expect(encodeMessage({ type: "background_lease", payload: {} })).toEqual({ type: "background_lease", payload: {} });
  });

  it("checks the session, both signatures, the addressing and the expiry", () => {
    const lease = issueBackgroundLease({ phone: phone.publicKeys, mac, at: clock.now(), durationMs: HOUR });
    const presented = issueLeaseSession("S1", mac.publicKeys, lease, phone, clock.now());
    const check = (overrides: Partial<Parameters<typeof checkLeaseSession>[1]> = {}, value = presented) =>
      checkLeaseSession(value, { sessionID: "S1", mac: mac.publicKeys, phone: phone.publicKeys, now: clock.now(), ...overrides });
    expect(check()).toBeNull();
    expect(check({ sessionID: "S2" })).toBe("invalid");
    expect(check({ now: new Date(clock.ms + HOUR) })).toBe("expired");
    expect(check({ now: new Date(clock.ms - HOUR) })).toBe("not_yet_valid");
    // A lease the phone signed for itself, or a presentation the Mac signed, does not pass.
    const forgedLease = issueBackgroundLease({ phone: phone.publicKeys, mac: phone, at: clock.now(), durationMs: HOUR });
    expect(check({}, issueLeaseSession("S1", mac.publicKeys, { ...forgedLease, macDeviceID: mac.publicKeys.deviceID }, phone, clock.now()))).toBe("bad_signature");
    expect(check({}, issueLeaseSession("S1", mac.publicKeys, lease, mac, clock.now()))).toBe("wrong_device");
    expect(check({}, { ...presented, lease: { ...lease, scope: "everything" } })).toBe("invalid");
  });

  it("derives a daily BLE wake UUID from the pairing key, distinct from the presence UUID", () => {
    const psk = new Uint8Array(32).fill(7);
    const today = wakeServiceUuid(psk, new Date("2026-11-01T23:59:59.000Z"));
    expect(today).toBe(wakeServiceUuid(psk, new Date("2026-11-01T00:00:00.000Z")));
    expect(today).not.toBe(wakeServiceUuid(psk, new Date("2026-11-02T00:00:00.000Z")));
    expect(today).not.toBe(proximityServiceUuid(psk));
    expect(today).not.toBe(wakeServiceUuid(new Uint8Array(32).fill(8), new Date("2026-11-01T12:00:00.000Z")));
    expect(today).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-8[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  });
});

describe("background updates setting", () => {
  it("is off by default with an 8 hour lease, and only offers 1, 4, 8 or 24 hours", async () => {
    expect(loadBackgroundUpdates(rig.store.settings)).toEqual({ enabled: false, leaseHours: 8 });
    await enable(true, 24);
    expect(loadBackgroundUpdates(rig.store.settings)).toEqual({ enabled: true, leaseHours: 24 });
    await enable(true, 5);
    expect(loadBackgroundUpdates(rig.store.settings).leaseHours).toBe(24);
  });

  it("turning it off revokes every lease at once and is audited", async () => {
    await enable();
    const lease = (await authority().issue(phone.publicKeys)) as BackgroundLease;
    expect(await authority().admit(phone.publicKeys, lease)).toBeNull();
    clock.advance(1_000);
    await enable(false);
    expect(await authority().admit(phone.publicKeys, lease)).toBe("background_updates_off");
    clock.advance(1_000);
    await enable(true);
    // On again: the old lease stays revoked; a new attested session issues a new one.
    expect(await authority().admit(phone.publicKeys, lease)).toBe("revoked");
    expect(await auditRows("handoff.leases_revoked")).toEqual([{ subject: "all", detail: { reason: "setting_off" } }]);
  });

  it("signing out and unpairing revoke leases", async () => {
    await enable();
    const lease = (await authority().issue(phone.publicKeys)) as BackgroundLease;
    clock.advance(1_000);
    await revokeAllLeases(rig.store.settings, rig.store, "signed_out", clock.now());
    expect(await authority().admit(phone.publicKeys, lease)).toBe("revoked");
    clock.advance(1_000);
    const fresh = (await authority().issue(phone.publicKeys)) as BackgroundLease;
    expect(await authority().admit(phone.publicKeys, fresh)).toBeNull();
    clock.advance(1_000);
    await revokePhoneLeases(rig.store.settings, rig.store, phone.publicKeys.deviceID, clock.now());
    expect(await authority().admit(phone.publicKeys, fresh)).toBe("revoked");
    await rig.store.revokeDevice(phone.publicKeys.deviceID);
    expect(await authority().admit(phone.publicKeys, fresh)).toBe("not_paired");
    expect(rig.store.settings.get(`${BACKGROUND_UPDATE_KEYS.phoneRevokedAtPrefix}${phone.publicKeys.deviceID}`)).not.toBeNull();
  });
});

describe("issuing leases in attested sessions (protocol 5)", () => {
  async function attestedSession(maxProtocolVersion = HANDOFF_BACKGROUND_LEASE_VERSION, withLeases = true): Promise<PhoneResult> {
    const air = new Air();
    const presenter = new FakePresenter();
    const session = new MacHandoffSession({
      identity: mac, trust: rig.store, tone: air, presenter, sink: rig.store, records: rig.store, clock, snooze: async () => undefined, ...(withLeases ? { leases: authority() } : {}),
    });
    const { client, server } = MemoryFrameChannel.pair();
    const [, phoneSide] = await Promise.all([session.run(server), runScriptedPhone(client, { identity: phone, mac: mac.publicKeys, bundles: [], air, presenter, maxProtocolVersion, acousticAttempts: 0, fallback: "qr" })]);
    return phoneSide;
  }

  it("hands a QR attested phone a signed lease while the setting is on, and audits it", async () => {
    await enable(true, 4);
    const result = await attestedSession();
    expect(result.version).toBe(HANDOFF_BACKGROUND_LEASE_VERSION);
    expect(result.method).toBe("qr");
    const lease = result.leaseGrants[0]?.lease as BackgroundLease;
    expect(lease.expiresAt.getTime() - lease.issuedAt.getTime()).toBe(4 * HOUR);
    expect(result.syncMessages.at(-2)).toBe("background_lease");
    expect(await auditRows("handoff.lease_issued")).toEqual([{ subject: phone.publicKeys.deviceID, detail: { expires_at: "2026-11-01T16:00:00.000Z", hours: "4" } }]);
  });

  it("sends an empty grant while the setting is off, and nothing to older phones or without a lease policy", async () => {
    expect((await attestedSession()).leaseGrants).toEqual([{}]);
    await enable();
    expect((await attestedSession(HANDOFF_SNOOZE_VERSION)).leaseGrants).toEqual([]);
    const withoutPolicy = await attestedSession(HANDOFF_BACKGROUND_LEASE_VERSION, false);
    expect(withoutPolicy.version).toBe(HANDOFF_SNOOZE_VERSION);
    expect(withoutPolicy.leaseGrants).toEqual([]);
  });
});

describe("leased background sessions (receive only)", () => {
  async function lease(): Promise<BackgroundLease> {
    await enable();
    return (await authority().issue(phone.publicKeys)) as BackgroundLease;
  }

  it("sends updates to listed shared meetings and audits the session", async () => {
    const granted = await lease();
    rig.store.meetings.updateUserNotes(id, [{ id: "d1", text: "From the desk", createdAt: clock.now(), updatedAt: clock.now() }]);
    const result = await runLeased(granted, { listed: listedPhoneCopy() });
    expect(result.mac).toEqual({ status: "fulfilled", value: 0 });
    expect(result.phone).toEqual({ status: "fulfilled", value: ["sync_update", "sync_done"] });
    const rows = await auditRows("handoff.leased_session");
    expect(rows).toEqual([{ subject: phone.publicKeys.deviceID, detail: { result: "completed", listed: "1", updates_sent: "1", updates_acknowledged: "1" } }]);
    // No lease renewal in a background session.
    expect(await auditRows("handoff.lease_issued")).toHaveLength(1);
  });

  it("does not offer a meeting the phone did not list", async () => {
    const granted = await lease();
    rig.store.shared.queueForPhone(id, phone.publicKeys.deviceID);
    const result = await runLeased(granted, { listed: [] });
    expect(result.phone).toEqual({ status: "fulfilled", value: ["sync_done"] });
    expect(rig.store.shared.queue(phone.publicKeys.deviceID)).toEqual([id]);
  });

  it("rejects a bundle offered by the phone", async () => {
    const result = await runLeased(await lease(), { misbehave: "offer" });
    expect(result.mac).toMatchObject({ status: "rejected", reason: new HandoffError("bundle_rejected", "not allowed in a background session") });
    expect((await auditRows("handoff.leased_session"))[0]?.detail).toMatchObject({ result: "failed", reason: "bundle_rejected" });
  });

  it("rejects a decline from the phone", async () => {
    const granted = await lease();
    rig.store.meetings.updateUserNotes(id, [{ id: "d1", text: "From the desk", createdAt: clock.now(), updatedAt: clock.now() }]);
    const result = await runLeased(granted, { listed: listedPhoneCopy(), misbehave: "decline" });
    expect(result.mac).toMatchObject({ status: "rejected", reason: new HandoffError("unexpected_message", "sync_decline") });
    expect(rig.store.shared.declined(id)).toEqual([]);
  });

  it("refuses the lease when the setting is off, when it expired, or after sign out", async () => {
    const granted = await lease();
    await enable(false);
    const off = await runLeased(granted);
    expect(off.mac).toMatchObject({ status: "rejected", reason: new HandoffError("attestation_failed", "lease background_updates_off") });
    expect(off.phone).toMatchObject({ status: "rejected", reason: { code: "peer_failed", peerCode: "attestation_failed" } });

    await enable(true);
    clock.advance(1_000);
    const fresh = (await authority().issue(phone.publicKeys)) as BackgroundLease;
    clock.advance(8 * HOUR);
    expect((await runLeased(fresh)).mac).toMatchObject({ status: "rejected", reason: new HandoffError("attestation_failed", "lease expired") });

    clock.advance(-8 * HOUR);
    await revokeAllLeases(rig.store.settings, rig.store, "signed_out", clock.now());
    expect((await runLeased(fresh)).mac).toMatchObject({ status: "rejected", reason: new HandoffError("attestation_failed", "lease revoked") });
    expect((await auditRows("handoff.leased_session")).map((row) => row.detail.reason)).toEqual(["background_updates_off", "expired", "revoked"]);
  });

  it("refuses a lease_session from a desktop without a lease policy", async () => {
    const result = await runLeased(await lease(), {}, macSession(false));
    expect(result.mac).toMatchObject({ status: "rejected", reason: new HandoffError("unexpected_message", "lease_session") });
  });
});
