import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChunkCipher, randomBytes } from "../../src/crypto/index.js";
import { HandoffGateway } from "../../src/gateway/index.js";
import {
  DEFAULT_MAC_HANDOFF_POLICY, HandoffError, issueReceipt, issueRecordAck, issueRecordDecline, MacHandoffSession, MemoryFrameChannel, openBundle, openRecordUpdate,
  recordDecisionTimeoutMs, type HandoffMessage, type RecordDeclineReason, type RecordUpdate,
} from "../../src/handoff/index.js";
import type { LanaId } from "../../src/ids/index.js";
import { utf8 } from "../../src/bytes/index.js";
import { createSealedFileKeyVault } from "../../src/keys/index.js";
import type { AttestationRecord, RecordSync } from "../../src/store/index.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { Air, FakeClock, FakePresenter, runScriptedPhone, type PhoneResult } from "../support/handoffFakes.js";
import { goldenBundle, openRig, temporaryDirectory, type StoreRig } from "../support/storeRig.js";

const { mac, phone } = goldenIdentities();

function attestation(): AttestationRecord {
  return { sessionID: "s1", phoneDeviceID: phone.publicKeys.deviceID, method: "qr", latencyMs: 300, attestedAt: new Date(1_800_000_000_000), tonePlays: 0 };
}

const decline = (reason: RecordDeclineReason) => async (update: RecordUpdate): Promise<HandoffMessage> =>
  ({ type: "sync_decline", payload: issueRecordDecline(update, reason, phone, new Date("2026-11-01T16:00:00.000Z")) });

const accept = async (update: RecordUpdate, parts: Uint8Array[]): Promise<HandoffMessage> => {
  const opened = await openRecordUpdate(update, parts, phone, mac.publicKeys);
  return { type: "sync_ack", payload: issueRecordAck(update, opened.record, phone, new Date("2026-11-01T16:00:00.000Z")) };
};

let rig: StoreRig;
let id: LanaId;
beforeEach(async () => {
  rig = await openRig();
  await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
  const { manifest, parts } = goldenBundle();
  const first = await openBundle(manifest, parts, mac);
  await rig.store.complete(first, issueReceipt(manifest, mac, rig.clock.now()), attestation());
  id = first.meeting.id;
});
afterEach(() => rig.cleanup());

/** One protocol 2 session in which the phone lists nothing, so a queued meeting is new to it. */
async function session(answerUpdate: (update: RecordUpdate, parts: Uint8Array[]) => Promise<HandoffMessage>, records: RecordSync = rig.store) {
  const air = new Air();
  const presenter = new FakePresenter();
  const mac2 = new MacHandoffSession({ identity: mac, trust: rig.store, tone: air, presenter, sink: rig.store, records, clock: new FakeClock() });
  const { client, server } = MemoryFrameChannel.pair();
  const [macResult, phoneResult] = await Promise.allSettled([
    mac2.run(server),
    runScriptedPhone(client, { identity: phone, mac: mac.publicKeys, bundles: [], air, presenter, maxProtocolVersion: 2, answerUpdate }),
  ]);
  return { mac: macResult, phone: phoneResult };
}

function auditEvents(): Promise<string[]> {
  return rig.store.auditEntries().then((entries) => entries.map((entry) => entry.event));
}

describe("sending a meeting to the phone (protocol 2)", () => {
  it("waits at least 90 seconds for the person on the phone", () => {
    expect(recordDecisionTimeoutMs(DEFAULT_MAC_HANDOFF_POLICY)).toBe(90_000);
    expect(recordDecisionTimeoutMs({ ...DEFAULT_MAC_HANDOFF_POLICY, messageTimeoutMs: 120_000 })).toBe(120_000);
  });

  it("takes a declined meeting off the queue, marks it declined on that phone and audits it", async () => {
    rig.store.shared.queueForPhone(id, phone.publicKeys.deviceID);
    const result = await session(decline("declined"));
    expect(result.mac.status).toBe("fulfilled");
    if (result.phone.status !== "fulfilled") throw result.phone.reason;
    expect((result.phone.value as PhoneResult).syncMessages).toEqual(["sync_update", "sync_part", "sync_part", "sync_done"]);
    expect(rig.store.shared.queue(phone.publicKeys.deviceID)).toEqual([]);
    expect(rig.store.shared.declined(id)).toEqual([{ phoneDeviceID: phone.publicKeys.deviceID, phoneName: phone.publicKeys.displayName, declinedAt: new Date("2026-11-01T16:00:00.000Z") }]);
    expect(await auditEvents()).toContain("record.send_declined");
    expect(await auditEvents()).not.toContain("record.update_sent");
    expect(rig.store.shared.isDelivering(id, phone.publicKeys.deviceID)).toBe(false);

    // Sending it again replaces the decline.
    rig.store.shared.queueForPhone(id, phone.publicKeys.deviceID);
    expect(rig.store.shared.declined(id)).toEqual([]);
  });

  it("keeps a meeting the person did not answer queued, without a decline", async () => {
    rig.store.shared.queueForPhone(id, phone.publicKeys.deviceID);
    const result = await session(decline("later"));
    expect(result.mac.status).toBe("fulfilled");
    expect(rig.store.shared.queue(phone.publicKeys.deviceID)).toEqual([id]);
    expect(rig.store.shared.declined(id)).toEqual([]);
    expect(await auditEvents()).not.toContain("record.send_declined");
  });

  it("refuses a decline the pinned phone did not sign", async () => {
    rig.store.shared.queueForPhone(id, phone.publicKeys.deviceID);
    const forged = async (update: RecordUpdate): Promise<HandoffMessage> =>
      ({ type: "sync_decline", payload: issueRecordDecline(update, "declined", mac, new Date("2026-11-01T16:00:00.000Z")) });
    const result = await session(forged);
    expect(result.mac).toMatchObject({ status: "rejected", reason: new HandoffError("receipt_invalid", "record decline") });
    expect(rig.store.shared.queue(phone.publicKeys.deviceID)).toEqual([id]);
    expect(rig.store.shared.isDelivering(id, phone.publicKeys.deviceID)).toBe(false);
  });

  it("answers delivering while the update is out, and the ack clears the queue", async () => {
    rig.store.shared.queueForPhone(id, phone.publicKeys.deviceID);
    let during = "";
    const result = await session(async (update, parts) => {
      during = rig.store.shared.cancelQueued(id, phone.publicKeys.deviceID);
      return accept(update, parts);
    });
    expect(result.mac.status).toBe("fulfilled");
    expect(during).toBe("delivering");
    expect(rig.store.shared.queue(phone.publicKeys.deviceID)).toEqual([]);
    expect(rig.store.shared.cancelQueued(id, phone.publicKeys.deviceID)).toBe("not_queued");
    expect(await auditEvents()).toContain("record.update_sent");
    expect(await auditEvents()).not.toContain("record.send_cancelled");
  });

  it("knows when the meeting last reached each phone: handed off, then each update sent", async () => {
    const handedOff = rig.store.shared.lastSynced(id).get(phone.publicKeys.deviceID);
    expect(handedOff).toBeInstanceOf(Date);
    rig.clock.advance(60);
    rig.store.shared.queueForPhone(id, phone.publicKeys.deviceID);
    const result = await session(accept);
    expect(result.mac.status).toBe("fulfilled");
    const synced = rig.store.shared.lastSynced(id);
    expect(synced.size).toBe(1);
    expect(synced.get(phone.publicKeys.deviceID)!.getTime()).toBeGreaterThan(handedOff!.getTime());
  });

  it("skips a meeting cancelled after the sync request but before its turn", async () => {
    rig.store.shared.queueForPhone(id, phone.publicKeys.deviceID);
    const cancelling: RecordSync = {
      outgoingRecords: async (device, listed) => {
        const out = await rig.store.outgoingRecords(device, listed);
        expect(rig.store.shared.cancelQueued(id, device.deviceID)).toBe("cancelled");
        return out;
      },
      recordAcknowledged: (...args) => rig.store.recordAcknowledged(...args),
      recordDeclined: (...args) => rig.store.recordDeclined(...args),
      beginDelivery: (...args) => rig.store.beginDelivery(...args),
      endDelivery: (...args) => rig.store.endDelivery(...args),
    };
    const result = await session(accept, cancelling);
    expect(result.mac.status).toBe("fulfilled");
    if (result.phone.status !== "fulfilled") throw result.phone.reason;
    expect(result.phone.value.syncMessages).toEqual(["sync_done"]);
    expect(await auditEvents()).toContain("record.send_cancelled");
    expect(await auditEvents()).not.toContain("record.update_sent");
  });
});

describe("Cancel send on the gateway", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("lowers the wake flag once nothing is queued for that phone", async () => {
    const folder = temporaryDirectory("cancel");
    cleanups.push(folder.cleanup);
    const osKey = randomBytes(32);
    const aad = utf8("test.keystore");
    const gateway = await HandoffGateway.open({
      directory: join(folder.path, "store"),
      vault: createSealedFileKeyVault({ directory: join(folder.path, "keys"), sealer: { seal: (plain) => ChunkCipher.seal(plain, osKey, aad), unseal: (sealed) => ChunkCipher.open(sealed, osKey, aad) } }),
      displayName: "Test Mac",
      tone: new Air(),
      bonjour: false,
    });
    cleanups.push(() => gateway.close());
    await gateway.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
    const { manifest, parts } = goldenBundle();
    const opened = await openBundle(manifest, parts, mac);
    await gateway.store.complete(opened, issueReceipt(manifest, mac, new Date()), attestation());
    const meeting = opened.meeting.id;

    expect(gateway.cancelSend(meeting, phone.publicKeys.deviceID)).toBe("not_queued");
    gateway.sendToPhone(meeting, phone.publicKeys.deviceID);
    expect(Object.keys(gateway.wakeRecord)).toEqual(["w0"]);
    expect(gateway.cancelSend(meeting, phone.publicKeys.deviceID)).toBe("cancelled");
    expect(gateway.wakeRecord).toEqual({});
    expect(gateway.store.shared.queue(phone.publicKeys.deviceID)).toEqual([]);
    expect((await gateway.store.auditEntries()).map((entry) => entry.event)).toContain("record.send_cancelled");
  });
});
