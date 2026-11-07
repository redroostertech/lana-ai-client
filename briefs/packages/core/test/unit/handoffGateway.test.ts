import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChunkCipher, parseInvitationQr, pairingPsk, randomBytes, shortCode, SoftwareIdentity, transportPsk, type PairingInvitation } from "../../src/crypto/index.js";
import {
  DEFAULT_HANDOFF_SETTINGS, HANDOFF_SETTING_KEYS, HandoffGateway, loadHandoffSettings, saveHandoffSettings, ToneBridge,
  type GatewayEventMap, type GatewayStatus, type HandoffEvent, type MeetingReceived, type PairingState, type ToneRequest,
} from "../../src/gateway/index.js";
import { connectHandoff, HANDOFF_TLS, type MdnsResponder } from "../../src/handoff/index.js";
import { utf8 } from "../../src/bytes/index.js";
import { createSealedFileKeyVault, type SecretSealer } from "../../src/keys/index.js";
import { sealTestBundle } from "../support/bundleSealer.js";
import { Air, FakePresenter, runScriptedPhone, runScriptedPhonePairing } from "../support/handoffFakes.js";
import { temporaryDirectory } from "../support/storeRig.js";

const HOST = "127.0.0.1";

/** The OS keystore: AES-GCM under a key that lives outside the data folder. */
function fakeKeystore(osKey = randomBytes(32)): SecretSealer {
  const aad = utf8("test.keystore");
  return { seal: (plaintext) => ChunkCipher.seal(plaintext, osKey, aad), unseal: (sealed) => ChunkCipher.open(sealed, osKey, aad) };
}

/** Records what Bonjour would advertise. */
class FakeResponder implements MdnsResponder {
  readonly live = new Map<string, number>();
  readonly published: string[] = [];
  publish(config: { name: string; port: number }): never {
    this.live.set(config.name, config.port);
    this.published.push(config.name);
    return { on: () => undefined, stop: (done: () => void) => (this.live.delete(config.name), done()) } as never;
  }
  unpublishAll(callback?: () => void): void {
    this.live.clear();
    callback?.();
  }
  destroy(callback?: () => void): void {
    callback?.();
  }
}

class Recorder {
  readonly status: GatewayStatus[] = [];
  readonly pairing: PairingState[] = [];
  readonly handoff: HandoffEvent[] = [];
  readonly meetings: MeetingReceived[] = [];
  constructor(gateway: HandoffGateway) {
    gateway.on("gatewayStatus", (value) => this.status.push(value));
    gateway.on("pairing", (value) => this.pairing.push(value));
    gateway.on("handoff", (value) => this.handoff.push(value));
    gateway.on("meetingReceived", (value) => this.meetings.push(value));
  }
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function rig(options: { pairingLifetimeMs?: number } = {}) {
  const folder = temporaryDirectory("gateway");
  cleanups.push(folder.cleanup);
  const keystore = fakeKeystore();
  const responder = new FakeResponder();
  const air = new Air();
  const open = async (): Promise<HandoffGateway> => {
    const gateway = await HandoffGateway.open({
      directory: join(folder.path, "store"),
      vault: createSealedFileKeyVault({ directory: join(folder.path, "keys"), sealer: keystore }),
      displayName: "Test Mac",
      tone: air,
      host: HOST,
      bonjour: () => responder,
      ...(options.pairingLifetimeMs === undefined ? {} : { pairingLifetimeMs: options.pairingLifetimeMs }),
    });
    cleanups.push(() => gateway.close());
    return gateway;
  };
  return { open, responder, air };
}

function waitFor<K extends keyof GatewayEventMap>(gateway: HandoffGateway, name: K, match: (value: GatewayEventMap[K]) => boolean, timeoutMs = 5_000): Promise<GatewayEventMap[K]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${String(name)}`));
    }, timeoutMs);
    const off = gateway.on(name, (value) => {
      if (!match(value)) return;
      clearTimeout(timer);
      off();
      resolve(value);
    });
  });
}

function listeningPort(status: GatewayStatus): number {
  if (status.state !== "listening") throw new Error(`not listening: ${status.state}`);
  return status.port;
}

async function pairPhone(gateway: HandoffGateway, phone: SoftwareIdentity): Promise<{ invitation: PairingInvitation; macCode: string; phoneCode: string }> {
  const waiting = gateway.beginPairing();
  if (waiting.state !== "waiting") throw new Error("pairing did not start");
  const invitation = parseInvitationQr(waiting.qrText);
  let macCode = "";
  const off = gateway.on("pairing", (state) => {
    if (state.state !== "confirming") return;
    macCode = state.code;
    gateway.answerPairingCode(true);
  });
  const paired = waitFor(gateway, "pairing", (state) => state.state === "paired");
  const channel = await connectHandoff({ host: HOST, port: listeningPort(gateway.status), identity: HANDOFF_TLS.pairingIdentity, key: pairingPsk(invitation) });
  const result = await runScriptedPhonePairing(channel, phone, invitation, true);
  await paired;
  off();
  return { invitation, macCode, phoneCode: result.code };
}

describe("Handoff gateway", () => {
  it("pairs, receives a meeting into the store, survives a restart and receives again", async () => {
    const { open, responder, air } = rig();
    const gateway = await open();
    const events = new Recorder(gateway);
    const started = await gateway.start();
    expect(started).toMatchObject({ state: "listening", pairedDevices: 0, activeTransfers: 0, serviceName: gateway.serviceName });
    expect(gateway.serviceName).toMatch(/^Lana-[0-9A-Z]{6}$/);
    expect(events.status.map((status) => status.state)).toEqual(["starting", "listening"]);
    // Nothing paired yet: the handoff service is not advertised.
    expect(responder.live.size).toBe(0);

    // 1. Pairing over the single listener with the invitation from the QR text.
    const phone = SoftwareIdentity.generate("Test Phone");
    const { invitation, macCode, phoneCode } = await pairPhone(gateway, phone);
    const port = listeningPort(gateway.status);
    expect(invitation.mac.deviceID).toBe(gateway.identity.publicKeys.deviceID);
    expect(invitation.serviceName).toMatch(/^Lana-Pair-[0-9A-Z]{6}$/);
    expect(invitation.expiresAt.getTime() - Date.now()).toBeGreaterThan(290_000);
    expect(invitation.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    expect(macCode).toMatch(/^[0-9]{6}$/);
    expect(macCode).toBe(phoneCode);
    expect(macCode).toBe(shortCode(invitation, phone.publicKeys));
    expect(events.pairing.map((state) => state.state)).toEqual(["waiting", "confirming", "saving", "paired"]);
    expect(responder.published).toEqual([invitation.serviceName, gateway.serviceName]);
    expect([...responder.live]).toEqual([[gateway.serviceName, port]]);
    expect(gateway.status).toMatchObject({ state: "listening", pairedDevices: 1 });
    // Single use: the invitation's key no longer opens a connection.
    await expect(connectHandoff({ host: HOST, port, identity: HANDOFF_TLS.pairingIdentity, key: pairingPsk(invitation) })).rejects.toMatchObject({ code: "transport" });

    // 2. Handoff by tone.
    const mac = invitation.mac;
    const psk = transportPsk(phone, mac, mac.deviceID, phone.publicKeys.deviceID);
    const audio = randomBytes(40_000);
    const first = await sealTestBundle(phone, mac, [audio]);
    const presenter = new FakePresenter();
    const firstDone = waitFor(gateway, "handoff", (event) => event.type === "finished" || event.type === "failed");
    const phoneResult = await runScriptedPhone(await connectHandoff({ host: HOST, port, identity: phone.publicKeys.deviceID, key: psk }), {
      identity: phone, mac, bundles: [first], air, presenter,
    });
    expect(phoneResult).toMatchObject({ method: "acoustic", delivered: [first.manifest.bundleID] });
    await firstDone;
    expect(events.meetings).toEqual([expect.objectContaining({
      bundleId: first.manifest.bundleID, meetingId: first.meetingID, phoneDeviceId: phone.publicKeys.deviceID, method: "acoustic", tonePlays: 1, audioParts: 1,
    })]);
    const handoffTypes = events.handoff.map((event) => event.type);
    expect(handoffTypes).toEqual(["started", "tone", "dismissed", "finished"]);
    expect(events.handoff[0]).toMatchObject({ phoneDeviceId: phone.publicKeys.deviceID });
    expect(events.handoff.at(-1)).toMatchObject({ type: "finished", bundles: 1 });

    const store = gateway.store;
    expect(store.meetings.get(first.meetingID).id).toBe(first.meetingID);
    expect(store.meetings.audioData(first.meetingID, 0)).toEqual(audio);
    expect(store.intents.list({ meetingID: first.meetingID })).toHaveLength(events.meetings[0]?.intents ?? -1);
    expect((events.meetings[0]?.intents ?? 0) + (events.meetings[0]?.quarantinedIntents ?? 0)).toBe(first.intents);
    const auditEvents = (await store.auditEntries()).map((entry) => entry.event);
    expect(auditEvents).toContain("device.paired");
    expect(auditEvents).toContain("bundle.received");
    expect(auditEvents.indexOf("device.paired")).toBeLessThan(auditEvents.indexOf("bundle.received"));
    expect(await store.verifyAudit()).toMatchObject({ isIntact: true, brokenAt: null });

    await gateway.close();
    expect(gateway.status).toEqual({ state: "stopped" });
    expect(responder.live.size).toBe(0);

    // 3. Restart from the same folder and keystore: same identity, pairing kept.
    const restarted = await open();
    const after = new Recorder(restarted);
    expect(restarted.identity.publicKeys.deviceID).toBe(mac.deviceID);
    const status = await restarted.start();
    expect(status).toMatchObject({ state: "listening", pairedDevices: 1 });
    expect(responder.live.has(restarted.serviceName)).toBe(true);
    expect((await restarted.store.pairedDevices()).map((device) => device.keys.deviceID)).toEqual([phone.publicKeys.deviceID]);

    // 4. Second handoff under a stricter firm policy: QR fallback in a silent room, then a click on the Mac.
    restarted.saveHandoffSettings({ ...restarted.handoffSettings(), requireMacClick: true });
    restarted.on("handoff", (event) => {
      if (event.type === "qr") presenter.qr = event.qrText;
      if (event.type === "approval_requested") restarted.answerApproval(event.handoffId, true);
    });
    air.muted = true;
    const second = await sealTestBundle(phone, mac, [randomBytes(9_000), randomBytes(3_000)]);
    const secondDone = waitFor(restarted, "handoff", (event) => event.type === "finished" || event.type === "failed");
    const secondResult = await runScriptedPhone(await connectHandoff({ host: HOST, port: listeningPort(status), identity: phone.publicKeys.deviceID, key: psk }), {
      identity: phone, mac, bundles: [second], air, presenter,
    });
    expect(secondResult).toMatchObject({ method: "qr", delivered: [second.manifest.bundleID] });
    await secondDone;
    expect(after.handoff.map((event) => event.type)).toEqual(["started", "tone", "tone", "qr", "approval_requested", "dismissed", "finished"]);
    expect(after.handoff.find((event) => event.type === "approval_requested")).toMatchObject({ phoneDeviceId: phone.publicKeys.deviceID, phoneName: "Test Phone" });
    expect(after.meetings).toEqual([expect.objectContaining({ meetingId: second.meetingID, method: "qr", tonePlays: 2, audioParts: 2 })]);
    expect(restarted.store.meetings.list().map((meeting) => meeting.id).sort()).toEqual([first.meetingID, second.meetingID].sort());
    expect((await restarted.store.auditEntries()).filter((entry) => entry.event === "bundle.received")).toHaveLength(2);
    expect(await restarted.store.verifyAudit()).toMatchObject({ isIntact: true });

    // 5. Revoking the phone closes its key at the next handshake and withdraws the service.
    await restarted.revokeDevice(phone.publicKeys.deviceID);
    expect(restarted.status).toMatchObject({ state: "listening", pairedDevices: 0 });
    expect(responder.live.has(restarted.serviceName)).toBe(false);
    await expect(connectHandoff({ host: HOST, port: listeningPort(status), identity: phone.publicKeys.deviceID, key: psk })).rejects.toMatchObject({ code: "transport" });
  });

  it("stores nothing when the code is declined on the Mac", async () => {
    const { open } = rig();
    const gateway = await open();
    await gateway.start();
    const waiting = gateway.beginPairing();
    if (waiting.state !== "waiting") throw new Error("pairing did not start");
    const invitation = parseInvitationQr(waiting.qrText);
    gateway.on("pairing", (state) => {
      if (state.state === "confirming") gateway.answerPairingCode(false);
    });
    const phone = SoftwareIdentity.generate("Test Phone");
    const channel = await connectHandoff({ host: HOST, port: listeningPort(gateway.status), identity: HANDOFF_TLS.pairingIdentity, key: pairingPsk(invitation) });
    await expect(runScriptedPhonePairing(channel, phone, invitation, true)).rejects.toMatchObject({ code: "peer_failed" });
    expect(gateway.pairing).toMatchObject({ state: "failed", reason: "declined_on_mac", message: "Pairing cancelled on this computer." });
    expect(await gateway.store.pairedDevices()).toEqual([]);
    expect(gateway.status).toMatchObject({ pairedDevices: 0 });
  });

  it("expires the invitation and refuses its key afterwards", async () => {
    const { open, responder } = rig({ pairingLifetimeMs: 300 });
    const gateway = await open();
    await gateway.start();
    const waiting = gateway.beginPairing();
    if (waiting.state !== "waiting") throw new Error("pairing did not start");
    expect(responder.live.has(waiting.serviceName)).toBe(true);
    await waitFor(gateway, "pairing", (state) => state.state === "expired");
    expect(responder.live.has(waiting.serviceName)).toBe(false);
    const key = pairingPsk(parseInvitationQr(waiting.qrText));
    await expect(connectHandoff({ host: HOST, port: listeningPort(gateway.status), identity: HANDOFF_TLS.pairingIdentity, key })).rejects.toMatchObject({ code: "transport" });
  });

  it("cancels an open invitation and refuses pairing while stopped", async () => {
    const { open, responder } = rig();
    const gateway = await open();
    expect(gateway.beginPairing()).toMatchObject({ state: "failed", reason: "not_running" });
    await gateway.start();
    const waiting = gateway.beginPairing();
    if (waiting.state !== "waiting") throw new Error("pairing did not start");
    gateway.cancelPairing();
    expect(gateway.pairing).toEqual({ state: "idle" });
    expect(responder.live.size).toBe(0);
    await expect(connectHandoff({ host: HOST, port: listeningPort(gateway.status), identity: HANDOFF_TLS.pairingIdentity, key: pairingPsk(parseInvitationQr(waiting.qrText)) }))
      .rejects.toMatchObject({ code: "transport" });
  });
});

describe("Handoff settings", () => {
  it("reads the Swift keys with Swift's defaults and range check", () => {
    const values = new Map<string, string>();
    const store = { get: (key: string) => values.get(key) ?? null, set: (key: string, value: string) => void values.set(key, value) };
    expect(loadHandoffSettings(store)).toEqual(DEFAULT_HANDOFF_SETTINGS);
    saveHandoffSettings(store, { retentionDays: 30, requireMacClick: true, allowQr: false, allowMacApproval: true });
    expect(Object.fromEntries(values)).toEqual({
      [HANDOFF_SETTING_KEYS.retentionDays]: "30",
      [HANDOFF_SETTING_KEYS.requireMacClick]: "true",
      [HANDOFF_SETTING_KEYS.allowQr]: "false",
      [HANDOFF_SETTING_KEYS.allowMacApproval]: "true",
    });
    expect(loadHandoffSettings(store)).toEqual({ retentionDays: 30, requireMacClick: true, allowQr: false, allowMacApproval: true });
    values.set(HANDOFF_SETTING_KEYS.retentionDays, "4000");
    expect(loadHandoffSettings(store).retentionDays).toBe(90);
    values.set(HANDOFF_SETTING_KEYS.retentionDays, "12.5");
    expect(loadHandoffSettings(store).retentionDays).toBe(90);
  });
});

describe("Tone bridge", () => {
  it("resolves when the renderer reports the burst played, and fails on error or silence", async () => {
    const requests: ToneRequest[] = [];
    const bridge = new ToneBridge((request) => requests.push(request), { marginMs: 50 });
    const samples = new Float32Array(4_800);
    const played = bridge.play(samples, 48_000);
    expect(requests[0]).toMatchObject({ sampleRate: 48_000, durationMs: 100 });
    expect(requests[0]?.samples).toBe(samples);
    bridge.played(requests[0]?.id as string);
    await expect(played).resolves.toBeUndefined();

    const failed = bridge.play(samples, 48_000);
    bridge.failed(requests[1]?.id as string);
    await expect(failed).rejects.toMatchObject({ code: "transport" });

    await expect(bridge.play(samples, 48_000)).rejects.toMatchObject({ code: "transport", detail: "tone output timed out" });
  });
});
