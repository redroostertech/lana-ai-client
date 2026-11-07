import { describe, expect, it } from "vitest";
import { fromBase64, fromBase64Url } from "../../src/bytes/index.js";
import { randomBytes, SoftwareIdentity } from "../../src/crypto/index.js";
import {
  ACCOUNT_INFO_SCHEMA, attestationQrText, attestationSignedBytes, decodeManifest, decodeMessage, DEFAULT_MAC_HANDOFF_POLICY, encodeAccountInfoUpdate, encodeMessage,
  expectMessage, HandoffError, handoffPolicyFromSettings, issueAccountInfoUpdate, MacHandoffSession, MemoryFrameChannel, openAccountInfoUpdate,
  type AccountInfo, type AccountInfoUpdate, type MacHandoffPolicy,
} from "../../src/handoff/index.js";
import { canonicalEncode, canonicalString } from "../../src/json/index.js";
import type { RecordSync } from "../../src/store/index.js";
import { makeLanaId } from "../../src/ids/index.js";
import { parseJson } from "../../src/json/index.js";
import { golden } from "../golden/fixtures.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { Air, FakeClock, FakePresenter, MemorySink, MemoryTrust, runScriptedPhone, type PhoneScript, type ScriptedBundle } from "../support/handoffFakes.js";

const { mac, phone } = goldenIdentities();
const fixture = golden<Record<string, unknown>>("bundle");

function bundle(): ScriptedBundle {
  return {
    manifest: decodeManifest(parseJson(fixture["manifest_json"] as string)),
    parts: (fixture["parts"] as string[]).map((part) => fromBase64(part) as Uint8Array),
  };
}

class Rig {
  readonly air = new Air();
  readonly presenter = new FakePresenter();
  readonly sink = new MemorySink();
  readonly clock = new FakeClock();
  trust = new MemoryTrust([phone.publicKeys]);

  session(policy: Partial<MacHandoffPolicy> = {}): MacHandoffSession {
    return new MacHandoffSession({
      identity: mac,
      trust: this.trust,
      tone: this.air,
      presenter: this.presenter,
      sink: this.sink,
      clock: this.clock,
      policy: { ...DEFAULT_MAC_HANDOFF_POLICY, ...policy },
    });
  }

  script(bundles: ScriptedBundle[] = [bundle()], extra: Partial<PhoneScript> = {}): PhoneScript {
    return { identity: phone, mac: mac.publicKeys, bundles, air: this.air, presenter: this.presenter, ...extra };
  }

  async runBoth(session: MacHandoffSession, script: PhoneScript, serverSeesPeer?: string) {
    const { client, server } = MemoryFrameChannel.pair(serverSeesPeer === undefined ? {} : { serverSeesPeer });
    const [macResult, phoneResult] = await Promise.allSettled([session.run(server), runScriptedPhone(client, script)]);
    return { mac: macResult, phone: phoneResult };
  }
}

describe("Mac handoff session", () => {
  it("attests by tone, stores the opened bundle and returns a receipt the phone verifies", async () => {
    const rig = new Rig();
    const result = await rig.runBoth(rig.session(), rig.script(), phone.publicKeys.deviceID);
    expect(result.mac).toEqual({ status: "fulfilled", value: 1 });
    expect(result.phone.status).toBe("fulfilled");
    if (result.phone.status !== "fulfilled") return;
    expect(result.phone.value.method).toBe("acoustic");
    expect(result.phone.value.delivered).toEqual([bundle().manifest.bundleID]);
    expect(rig.sink.completed).toHaveLength(1);
    const { opened, attestation } = rig.sink.completed[0] as (typeof rig.sink.completed)[number];
    expect(opened.meeting.id).toBe(bundle().manifest.meetingID);
    expect(attestation).toMatchObject({ method: "acoustic", tonePlays: 1, phoneDeviceID: phone.publicKeys.deviceID });
    expect(attestation.sessionID).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
    expect(rig.presenter.dismissals).toBe(1);
  });

  it("falls back to the QR code in a silent room after two plays", async () => {
    const rig = new Rig();
    rig.air.muted = true;
    const result = await rig.runBoth(rig.session(), rig.script());
    expect(result.phone.status).toBe("fulfilled");
    expect(rig.sink.completed[0]?.attestation).toMatchObject({ method: "qr", tonePlays: 2 });
    expect(rig.presenter.qr).toMatch(/^lananotes:\/\/attest\?s=[0-9A-F-]{36}&n=[A-Za-z0-9_-]{22}$/);
  });

  it("accepts a Mac approval fallback and refuses when declined", async () => {
    const policy = handoffPolicyFromSettings({ requireMacClick: false, allowQr: false, allowMacApproval: true });
    expect(policy.allowedMethods).toEqual(["acoustic", "mac_approval"]);
    const ok = new Rig();
    ok.air.muted = true;
    const okResult = await ok.runBoth(ok.session(policy), ok.script());
    expect(okResult.phone.status).toBe("fulfilled");
    expect(ok.sink.completed[0]?.attestation).toMatchObject({ method: "mac_approval", latencyMs: 0 });

    const declined = new Rig();
    declined.air.muted = true;
    declined.presenter.approve = false;
    const declinedResult = await declined.runBoth(declined.session(policy), declined.script());
    expect(declinedResult.phone).toMatchObject({ status: "rejected", reason: { code: "peer_failed", peerCode: "attestation_failed", detail: "declined on Mac" } });
    expect(declined.sink.completed).toHaveLength(0);
  });

  it("rejects an unpaired phone and tells it why", async () => {
    const rig = new Rig();
    rig.trust = new MemoryTrust([]);
    const result = await rig.runBoth(rig.session(), rig.script());
    expect(result.mac).toMatchObject({ status: "rejected", reason: { code: "unknown_device" } });
    expect(result.phone).toMatchObject({ status: "rejected", reason: { code: "peer_failed", peerCode: "unknown_device", detail: "This phone is not paired with this Mac" } });
  });

  it("requires the hello to match the PSK identity", async () => {
    const rig = new Rig();
    const result = await rig.runBoth(rig.session(), rig.script([]), makeLanaId("device"));
    expect(result.mac).toMatchObject({ status: "rejected", reason: { code: "unknown_device" } });
  });

  it("refuses another protocol version", async () => {
    const rig = new Rig();
    const { client, server } = MemoryFrameChannel.pair();
    const run = rig.session().run(server);
    await client.send({ message: { type: "hello", payload: { protocolVersion: 2, deviceID: phone.publicKeys.deviceID, appVersion: "9" } }, body: new Uint8Array() });
    await expect(run).rejects.toMatchObject({ code: "protocol_version" });
    await expect(expectMessage(client, 1_000, "challenge")).rejects.toMatchObject({ peerCode: "protocol_version", detail: "Update LANA Briefs" });
  });

  it("resumes an interrupted transfer and re-requests a corrupt stored part", async () => {
    const resumed = new Rig();
    const scripted = bundle();
    resumed.sink.preload(scripted.manifest.bundleID, 0, scripted.parts[0] as Uint8Array);
    resumed.sink.preload(scripted.manifest.bundleID, 1, scripted.parts[1] as Uint8Array);
    const result = await resumed.runBoth(resumed.session(), resumed.script([scripted]));
    expect(result.phone).toMatchObject({ status: "fulfilled", value: { sentParts: 1 } });
    expect(resumed.sink.storeCalls).toBe(1);

    const corrupt = new Rig();
    corrupt.sink.preload(scripted.manifest.bundleID, 1, new Uint8Array(10));
    corrupt.sink.preload(scripted.manifest.bundleID, 7, scripted.parts[1] as Uint8Array);
    const corruptResult = await corrupt.runBoth(corrupt.session(), corrupt.script([scripted]));
    expect(corruptResult.phone).toMatchObject({ status: "fulfilled", value: { sentParts: 3 } });
    expect(corrupt.sink.storeCalls).toBe(3);
  });

  it("answers a repeat offer with the stored receipt without reprocessing", async () => {
    const rig = new Rig();
    await rig.runBoth(rig.session(), rig.script());
    const again = await rig.runBoth(rig.session(), rig.script());
    expect(again.phone).toMatchObject({ status: "fulfilled", value: { sentParts: 0 } });
    expect(rig.sink.completed).toHaveLength(1);
  });

  it("rejects a tampered part and keeps nothing", async () => {
    const rig = new Rig();
    const tampered = bundle();
    const part = (tampered.parts[1] as Uint8Array).slice();
    part[0] = (part[0] ?? 0) ^ 0xff;
    tampered.parts[1] = part;
    const result = await rig.runBoth(rig.session(), rig.script([tampered]));
    expect(result.mac).toMatchObject({ status: "rejected", reason: { code: "bundle_rejected", detail: "part 1 hash mismatch" } });
    expect(result.phone).toMatchObject({ status: "rejected", reason: { peerCode: "bundle_rejected" } });
    expect(rig.sink.completed).toHaveLength(0);
  });

  it("rejects a bundle addressed to another Mac", async () => {
    const rig = new Rig();
    const other = SoftwareIdentity.generate("Other");
    const session = new MacHandoffSession({ identity: other, trust: rig.trust, tone: rig.air, presenter: rig.presenter, sink: rig.sink, clock: rig.clock });
    const result = await rig.runBoth(session, { ...rig.script(), mac: other.publicKeys });
    expect(result.mac).toMatchObject({ status: "rejected", reason: { code: "bundle_rejected", detail: "bundle addressed to another Mac" } });
  });

  it("does not trust a receipt from a Mac other than the pinned one", async () => {
    const rig = new Rig();
    const impostor = SoftwareIdentity.generate("Impostor").publicKeys;
    const result = await rig.runBoth(rig.session(), { ...rig.script(), mac: { ...mac.publicKeys, signingKey: impostor.signingKey } });
    expect(result.phone).toMatchObject({ status: "rejected", reason: { code: "receipt_invalid" } });
  });

  it("refuses an attestation replayed from another connection", async () => {
    const rig = new Rig();
    const captured = MemoryFrameChannel.pair();
    const nonce = randomBytes(16);
    const signature = phone.sign(attestationSignedBytes("A", nonce, captured.client.channelBinding, "acoustic"));
    const { client, server } = MemoryFrameChannel.pair();
    const run = rig.session().run(server);
    await client.send({ message: { type: "hello", payload: { protocolVersion: 1, deviceID: phone.publicKeys.deviceID, appVersion: "1" } }, body: new Uint8Array() });
    const { payload: challenge } = await expectMessage(client, 1_000, "challenge");
    await client.send({ message: { type: "attest", payload: { sessionID: challenge.sessionID, method: "acoustic", nonce, signature } }, body: new Uint8Array() });
    await expect(run).rejects.toMatchObject({ code: "attestation_failed" });
  });

  it("refuses a correct nonce with a signature over another channel binding", async () => {
    const rig = new Rig();
    const other = MemoryFrameChannel.pair();
    const result = await rig.runBoth(rig.session(), {
      ...rig.script(),
      identity: Object.assign(Object.create(Object.getPrototypeOf(phone) as object) as typeof phone, phone, {
        sign: (message: Uint8Array) => phone.sign(new Uint8Array([...message.slice(0, message.length - 32 - 8), ...other.client.channelBinding, ...message.slice(message.length - 8)])),
      }),
    });
    expect(result.mac).toMatchObject({ status: "rejected", reason: { code: "attestation_failed", detail: "bad signature" } });
  });

  it("enforces the response window and the nonce lifetime", async () => {
    const slow = new Rig();
    const slowResult = await slow.runBoth(slow.session(), slow.script([bundle()], { beforeAttest: () => slow.clock.advance(5_001) }));
    expect(slowResult.mac).toMatchObject({ status: "rejected", reason: { detail: "response too slow" } });

    const expired = new Rig();
    const expiredResult = await expired.runBoth(expired.session(), expired.script([bundle()], { beforeAttest: () => expired.clock.advance(30_001) }));
    expect(expiredResult.mac).toMatchObject({ status: "rejected", reason: { detail: "nonce expired" } });

    const onTime = new Rig();
    const onTimeResult = await onTime.runBoth(onTime.session(), onTime.script([bundle()], { beforeAttest: () => onTime.clock.advance(4_999) }));
    expect(onTimeResult.mac.status).toBe("fulfilled");
    expect(onTime.sink.completed[0]?.attestation.latencyMs).toBe(4_999);
  });

  it("plays the tone at most three times", async () => {
    const rig = new Rig();
    rig.air.muted = true;
    const result = await rig.runBoth(rig.session(), rig.script([bundle()], { acousticAttempts: 4 }));
    expect(result.mac).toMatchObject({ status: "rejected", reason: { code: "attestation_failed", detail: "too many tone attempts" } });
    expect(rig.air.plays).toBe(3);
  });

  it("asks the person at the Mac after the tone when the firm requires it", async () => {
    const rig = new Rig();
    rig.presenter.approve = false;
    const result = await rig.runBoth(rig.session({ requireMacConfirmation: true }), rig.script());
    expect(rig.presenter.approvals).toBe(1);
    expect(result.mac).toMatchObject({ status: "rejected", reason: { detail: "declined on Mac" } });
  });

  it("refuses methods the firm turned off", async () => {
    const rig = new Rig();
    rig.air.muted = true;
    const result = await rig.runBoth(rig.session({ allowedMethods: ["acoustic", "mac_approval"] }), rig.script([bundle()], { fallback: "qr" }));
    // The phone asks for what the challenge offered instead.
    expect(result.phone.status).toBe("fulfilled");
    expect(rig.sink.completed[0]?.attestation.method).toBe("mac_approval");

    const strict = new Rig();
    const { client, server } = MemoryFrameChannel.pair();
    const run = strict.session({ allowedMethods: ["acoustic"] }).run(server);
    await client.send({ message: { type: "hello", payload: { protocolVersion: 1, deviceID: phone.publicKeys.deviceID, appVersion: "1" } }, body: new Uint8Array() });
    await expectMessage(client, 1_000, "challenge");
    await client.send({ message: { type: "fallback", payload: { method: "qr", reason: "x" } }, body: new Uint8Array() });
    await expect(run).rejects.toMatchObject({ code: "unexpected_message", detail: "fallback" });
  });

  it("builds the QR text the phone parses", () => {
    const nonce = randomBytes(16);
    const text = attestationQrText("S1", nonce);
    const url = new URL(text);
    expect(url.protocol).toBe("lananotes:");
    expect(url.hostname).toBe("attest");
    expect(url.searchParams.get("s")).toBe("S1");
    expect(fromBase64Url(url.searchParams.get("n") ?? "")).toEqual(nonce);
  });

  it("times out a silent phone", async () => {
    const rig = new Rig();
    const { server } = MemoryFrameChannel.pair();
    await expect(rig.session({ messageTimeoutMs: 20 }).run(server)).rejects.toEqual(new HandoffError("timed_out"));
  });
});

describe("account info (protocol 3)", () => {
  const account: AccountInfo = { name: "Dana Whitfield", email: "dana@whitfield.example", organization: "Whitfield Law", serverHost: "lana.whitfield.example" };
  const noRecords: RecordSync = {
    outgoingRecords: async () => [], recordAcknowledged: async () => undefined, recordDeclined: async () => undefined, beginDelivery: async () => true, endDelivery: async () => undefined,
  };

  function session(rig: Rig, source: () => AccountInfo | null): MacHandoffSession {
    return new MacHandoffSession({
      identity: mac, trust: rig.trust, tone: rig.air, presenter: rig.presenter, sink: rig.sink, clock: rig.clock, records: noRecords, account: source,
    });
  }

  it("sends the signed-in account, sealed to the phone, before sync_done", async () => {
    const rig = new Rig();
    const result = await rig.runBoth(session(rig, () => account), rig.script([], { maxProtocolVersion: 3 }));
    expect(result.mac.status).toBe("fulfilled");
    if (result.phone.status !== "fulfilled") throw result.phone.reason;
    expect(result.phone.value.version).toBe(3);
    expect(result.phone.value.syncMessages).toEqual(["account_info", "sync_done"]);
    const update = result.phone.value.accountInfo[0] as AccountInfoUpdate;
    expect(update).toMatchObject({ schema: ACCOUNT_INFO_SCHEMA, phoneDeviceID: phone.publicKeys.deviceID, macDeviceID: mac.publicKeys.deviceID });
    expect(await openAccountInfoUpdate(update, phone, mac.publicKeys)).toEqual(account);
  });

  it("sends nothing while signed out", async () => {
    const rig = new Rig();
    const result = await rig.runBoth(session(rig, () => null), rig.script([], { maxProtocolVersion: 3 }));
    if (result.phone.status !== "fulfilled") throw result.phone.reason;
    expect(result.phone.value.version).toBe(3);
    expect(result.phone.value.syncMessages).toEqual(["sync_done"]);
  });

  it("sends nothing to a protocol 2 phone, and stays on protocol 1 without records", async () => {
    const rig = new Rig();
    const two = await rig.runBoth(session(rig, () => account), rig.script([], { maxProtocolVersion: 2 }));
    if (two.phone.status !== "fulfilled") throw two.phone.reason;
    expect(two.phone.value.version).toBe(2);
    expect(two.phone.value.syncMessages).toEqual(["sync_done"]);

    const bare = new Rig();
    const one = await bare.runBoth(bare.session(), bare.script([], { maxProtocolVersion: 3 }));
    if (one.phone.status !== "fulfilled") throw one.phone.reason;
    expect(one.phone.value.version).toBe(1);
    expect(one.phone.value.syncMessages).toEqual([]);
  });

  it("round trips through the wire and rejects tampering, another phone and another Mac", async () => {
    const update = await issueAccountInfoUpdate({ account, phone: phone.publicKeys, mac, at: new Date("2026-11-01T10:00:00.123Z") });
    const wire = decodeMessage(parseJson(canonicalEncode(encodeMessage({ type: "account_info", payload: update }))));
    expect(wire.type).toBe("account_info");
    const decoded = (wire as { payload: AccountInfoUpdate }).payload;
    expect(canonicalString(encodeAccountInfoUpdate(decoded))).toBe(canonicalString(encodeAccountInfoUpdate(update)));
    expect(await openAccountInfoUpdate(decoded, phone, mac.publicKeys)).toEqual(account);

    const signature = Uint8Array.from(update.signature);
    signature[signature.length - 1] = (signature[signature.length - 1] as number) ^ 1;
    await expect(openAccountInfoUpdate({ ...update, signature }, phone, mac.publicKeys)).rejects.toMatchObject({ code: "bundle_rejected" });
    await expect(openAccountInfoUpdate({ ...update, createdAt: new Date("2026-11-02T00:00:00.000Z") }, phone, mac.publicKeys)).rejects.toMatchObject({ code: "bundle_rejected" });
    await expect(openAccountInfoUpdate(update, mac, mac.publicKeys)).rejects.toMatchObject({ code: "bundle_rejected" });
    // Same Mac id, other keys: the pinned key decides.
    const stranger = new SoftwareIdentity(mac.publicKeys.deviceID, "Impostor");
    await expect(openAccountInfoUpdate(update, phone, stranger.publicKeys)).rejects.toMatchObject({ code: "bundle_rejected" });
  });
});
