import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { utf8 } from "../../src/bytes/index.js";
import { ChunkCipher, randomBytes } from "../../src/crypto/index.js";
import { HandoffGateway, type RecordsChanged } from "../../src/gateway/index.js";
import {
  connectHandoff, expectMessage, HANDOFF_ACCOUNT_INFO_VERSION, HANDOFF_SNOOZE_VERSION, HandoffError, issueReceipt, issueSyncSnooze, MacHandoffSession,
  MemoryFrameChannel, openBundle, type FrameChannel, type SyncSnooze,
} from "../../src/handoff/index.js";
import type { LanaId } from "../../src/ids/index.js";
import { createSealedFileKeyVault } from "../../src/keys/index.js";
import type { DevicePublicKeys } from "../../src/crypto/index.js";
import type { AttestationRecord } from "../../src/store/index.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { Air, FakeClock, FakePresenter } from "../support/handoffFakes.js";
import { goldenBundle, openRig, temporaryDirectory, type StoreRig } from "../support/storeRig.js";

const { mac, phone } = goldenIdentities();
const AT = new Date("2026-11-01T22:10:00.000Z");

function attestation(): AttestationRecord {
  return { sessionID: "s1", phoneDeviceID: phone.publicKeys.deviceID, method: "qr", latencyMs: 300, attestedAt: new Date(1_800_000_000_000), tonePlays: 0 };
}

/** The phone side of a "Not now" session: hello, challenge, `sync_snooze`, then `sync_done`. */
async function snoozeFromPhone(channel: FrameChannel, wakeNonce: string, options: { maxVersion?: number; signer?: typeof phone; mac?: DevicePublicKeys } = {}): Promise<{ version: number }> {
  try {
    await channel.send({ message: { type: "hello", payload: { protocolVersion: 1, deviceID: phone.publicKeys.deviceID, appVersion: "1.1", maxProtocolVersion: options.maxVersion ?? HANDOFF_SNOOZE_VERSION } }, body: new Uint8Array() });
    const { payload: challenge } = await expectMessage(channel, 5_000, "challenge");
    const snooze = issueSyncSnooze(challenge.sessionID, options.mac ?? mac.publicKeys, wakeNonce, options.signer ?? phone, AT);
    await channel.send({ message: { type: "sync_snooze", payload: snooze }, body: new Uint8Array() });
    await expectMessage(channel, 5_000, "sync_done");
    return { version: challenge.protocolVersion ?? 1 };
  } finally {
    channel.close();
  }
}

describe("sync_snooze on the Mac session (protocol 4)", () => {
  let rig: StoreRig;
  beforeEach(async () => {
    rig = await openRig();
    await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
  });
  afterEach(() => rig.cleanup());

  function session(snooze: ((device: unknown, value: SyncSnooze) => Promise<void>) | undefined) {
    return new MacHandoffSession({ identity: mac, trust: rig.store, tone: new Air(), presenter: new FakePresenter(), sink: rig.store, records: rig.store, clock: new FakeClock(), ...(snooze === undefined ? {} : { snooze }) });
  }

  it("takes a signed snooze before any tone, with no presence proof, and answers sync_done", async () => {
    const received: SyncSnooze[] = [];
    const air = new Air();
    const mac2 = new MacHandoffSession({ identity: mac, trust: rig.store, tone: air, presenter: new FakePresenter(), sink: rig.store, records: rig.store, clock: new FakeClock(), snooze: async (_device, value) => void received.push(value) });
    const { client, server } = MemoryFrameChannel.pair();
    const [bundles, phoneSide] = await Promise.all([mac2.run(server), snoozeFromPhone(client, "0a0b0c0d0e0f1011")]);
    expect(bundles).toBe(0);
    expect(phoneSide.version).toBe(HANDOFF_SNOOZE_VERSION);
    expect(received.map((value) => value.wakeNonce)).toEqual(["0a0b0c0d0e0f1011"]);
    expect(air.plays).toBe(0);
  });

  it("refuses a snooze the pinned phone did not sign", async () => {
    let called = false;
    const { client, server } = MemoryFrameChannel.pair();
    const [macResult] = await Promise.allSettled([session(async () => void (called = true)).run(server), snoozeFromPhone(client, "0a0b", { signer: mac })]);
    expect(macResult).toMatchObject({ status: "rejected", reason: new HandoffError("attestation_failed", "bad snooze") });
    expect(called).toBe(false);
  });

  it("stays on protocol 3 without a snooze handler, and a phone on 3 cannot snooze", async () => {
    const { client, server } = MemoryFrameChannel.pair();
    const [macResult, phoneResult] = await Promise.allSettled([session(undefined).run(server), snoozeFromPhone(client, "0a0b")]);
    expect(macResult).toMatchObject({ status: "rejected", reason: new HandoffError("unexpected_message", "sync_snooze") });
    expect(phoneResult.status).toBe("rejected");

    let called = false;
    const pair = MemoryFrameChannel.pair();
    const [older] = await Promise.allSettled([session(async () => void (called = true)).run(pair.server), snoozeFromPhone(pair.client, "0a0b", { maxVersion: HANDOFF_ACCOUNT_INFO_VERSION })]);
    expect(older).toMatchObject({ status: "rejected", reason: new HandoffError("unexpected_message", "sync_snooze") });
    expect(called).toBe(false);
  });
});

describe("Not now on the gateway: queue, wake flag and nonce", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function openGateway(): Promise<{ gateway: HandoffGateway; meeting: LanaId; port: number; psk: Uint8Array }> {
    const folder = temporaryDirectory("snooze");
    cleanups.push(folder.cleanup);
    const osKey = randomBytes(32);
    const aad = utf8("test.keystore");
    const gateway = await HandoffGateway.open({
      directory: join(folder.path, "store"),
      vault: createSealedFileKeyVault({ directory: join(folder.path, "keys"), sealer: { seal: (plain) => ChunkCipher.seal(plain, osKey, aad), unseal: (sealed) => ChunkCipher.open(sealed, osKey, aad) } }),
      displayName: "Test Mac",
      tone: new Air(),
      host: "127.0.0.1",
      bonjour: false,
    });
    cleanups.push(() => gateway.close());
    const psk = new Uint8Array(32).fill(9);
    await gateway.store.pairDevice(phone.publicKeys, psk);
    const { manifest, parts } = goldenBundle();
    const opened = await openBundle(manifest, parts, mac);
    await gateway.store.complete(opened, issueReceipt(manifest, mac, new Date()), attestation());
    const status = await gateway.start();
    if (status.state !== "listening") throw new Error(`gateway did not start: ${status.state}`);
    return { gateway, meeting: opened.meeting.id, port: status.port, psk };
  }

  /** Resolves when the gateway reports the end of its next handoff. */
  function nextEnd(gateway: HandoffGateway): Promise<string> {
    return new Promise((resolve) => {
      const off = gateway.on("handoff", (event) => {
        if (event.type === "finished" || event.type === "failed") {
          off();
          resolve(event.type);
        }
      });
    });
  }

  it("keeps the same nonce across failed sessions, drops the queue on Not now, and a new send gets a new nonce", async () => {
    const { gateway, meeting, port, psk } = await openGateway();
    const phoneID = phone.publicKeys.deviceID;
    const connect = () => connectHandoff({ host: "127.0.0.1", port, identity: phoneID, key: psk });
    const changes: RecordsChanged[] = [];
    gateway.on("recordsChanged", (change) => changes.push(change));

    gateway.sendToPhone(meeting, phoneID);
    const first = gateway.wakeNonce(phoneID);
    const flag = gateway.wakeRecord;
    expect(first).toMatch(/^[0-9a-f]{16}$/);

    // A session that fails (the phone closes during attestation) leaves the same flag up.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ended = nextEnd(gateway);
      const channel = await connect();
      await channel.send({ message: { type: "hello", payload: { protocolVersion: 1, deviceID: phoneID, appVersion: "1.1", maxProtocolVersion: HANDOFF_SNOOZE_VERSION } }, body: new Uint8Array() });
      await expectMessage(channel, 5_000, "challenge");
      channel.close();
      expect(await ended).toBe("failed");
      expect(gateway.wakeNonce(phoneID)).toBe(first);
      expect(gateway.wakeRecord).toEqual(flag);
    }
    // Sending the same meeting again does not change what is queued, so neither does the flag.
    gateway.sendToPhone(meeting, phoneID);
    expect(gateway.wakeNonce(phoneID)).toBe(first);

    // Not now for an older flag: nothing changes.
    let ended = nextEnd(gateway);
    await snoozeFromPhone(await connect(), "ffffffffffffffff", { mac: gateway.identity.publicKeys });
    await ended;
    expect(gateway.store.shared.queue(phoneID)).toEqual([meeting]);
    expect(changes).toEqual([]);

    // Not now for the current flag: unqueued, flag down, marked and audited, window told.
    ended = nextEnd(gateway);
    await snoozeFromPhone(await connect(), first ?? "", { mac: gateway.identity.publicKeys });
    expect(await ended).toBe("finished");
    expect(gateway.store.shared.queue(phoneID)).toEqual([]);
    expect(gateway.wakeRecord).toEqual({});
    expect(gateway.wakeNonce(phoneID)).toBeNull();
    expect(gateway.store.shared.snoozed(meeting)).toEqual([{ phoneDeviceID: phoneID, phoneName: phone.publicKeys.displayName, snoozedAt: AT }]);
    expect((await gateway.store.auditEntries()).map((entry) => entry.event)).toContain("record.send_snoozed");
    expect(changes).toEqual([{ phoneDeviceId: phoneID, meetingIds: [meeting], reason: "snoozed" }]);

    // Sending again re-queues it under a new nonce and clears "Not now".
    gateway.sendToPhone(meeting, phoneID);
    const second = gateway.wakeNonce(phoneID);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(gateway.store.shared.snoozed(meeting)).toEqual([]);
  });
});
