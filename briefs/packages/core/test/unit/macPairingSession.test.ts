import { describe, expect, it } from "vitest";
import { makePairingInvitation, phoneProof, SoftwareIdentity, transportPsk, type PairingInvitation } from "../../src/crypto/index.js";
import { expectMessage, MacPairingSession, MemoryFrameChannel } from "../../src/handoff/index.js";
import { FakeClock, FakePairingPresenter, MemoryTrust, runScriptedPhonePairing } from "../support/handoffFakes.js";

function setup(options: { macAnswer?: boolean; invitation?: (mac: SoftwareIdentity, clock: FakeClock) => PairingInvitation } = {}) {
  const mac = SoftwareIdentity.generate("Mac");
  const phone = SoftwareIdentity.generate("Phone");
  const clock = new FakeClock();
  const invitation = options.invitation?.(mac, clock) ?? makePairingInvitation(mac.publicKeys, "Lana-Pair-ABCDEF", clock.now());
  const presenter = new FakePairingPresenter(options.macAnswer ?? true);
  const trust = new MemoryTrust();
  const session = new MacPairingSession({ identity: mac, invitation, presenter, sink: trust, clock });
  return { mac, phone, clock, invitation, presenter, trust, session };
}

describe("Mac pairing session", () => {
  it("pairs when both sides confirm the same six-digit code and stores the transport key", async () => {
    const { mac, phone, invitation, presenter, trust, session } = setup();
    const { client, server } = MemoryFrameChannel.pair();
    const [macResult, phoneResult] = await Promise.all([session.run(server), runScriptedPhonePairing(client, phone, invitation, true)]);
    expect(macResult).toEqual(phone.publicKeys);
    expect(phoneResult.mac).toEqual(mac.publicKeys);
    expect(presenter.codes).toEqual([phoneResult.code]);
    expect(phoneResult.code).toMatch(/^\d{6}$/);
    expect(trust.psks.get(phone.publicKeys.deviceID)).toEqual(transportPsk(phone, mac.publicKeys, mac.publicKeys.deviceID, phone.publicKeys.deviceID));
    expect(await trust.transportPsks()).toEqual([{ identity: phone.publicKeys.deviceID, key: trust.psks.get(phone.publicKeys.deviceID) }]);
  });

  it.each([
    [false, true, "declined on Mac"],
    [true, false, "declined on phone"],
  ])("fails when the Mac answers %s and the phone %s", async (macAnswer, phoneAnswer, detail) => {
    const { phone, invitation, trust, session } = setup({ macAnswer });
    const { client, server } = MemoryFrameChannel.pair();
    const [macResult, phoneResult] = await Promise.allSettled([session.run(server), runScriptedPhonePairing(client, phone, invitation, phoneAnswer)]);
    expect(macResult).toMatchObject({ status: "rejected", reason: { code: "pairing_rejected", detail } });
    expect(phoneResult.status).toBe("rejected");
    expect(trust.phones).toHaveLength(0);
  });

  it("refuses an expired invitation", async () => {
    const { phone, invitation, session, clock } = setup();
    clock.advance(300_001);
    const { client, server } = MemoryFrameChannel.pair();
    const [macResult, phoneResult] = await Promise.allSettled([session.run(server), runScriptedPhonePairing(client, phone, invitation, true)]);
    expect(macResult).toMatchObject({ status: "rejected", reason: { detail: "invitation expired" } });
    expect(phoneResult).toMatchObject({ status: "rejected", reason: { code: "peer_failed", peerCode: "pairing_rejected", detail: "Pairing cancelled" } });
  });

  it("burns the invitation on the first attempt", async () => {
    const { session } = setup();
    const first = MemoryFrameChannel.pair();
    first.client.close();
    await expect(session.run(first.server)).rejects.toThrow();
    const second = MemoryFrameChannel.pair();
    await expect(session.run(second.server)).rejects.toMatchObject({ code: "pairing_rejected", detail: "invitation already used" });
  });

  it("rejects a proof made without the QR secret", async () => {
    const { phone, invitation, session, presenter } = setup();
    const { client, server } = MemoryFrameChannel.pair();
    const run = session.run(server);
    const forged = { ...invitation, oneTimeSecret: new Uint8Array(32) };
    await client.send({ message: { type: "pair_request", payload: { phone: phone.publicKeys, proof: phoneProof(forged, phone.publicKeys) } }, body: new Uint8Array() });
    await expect(run).rejects.toMatchObject({ detail: "bad proof" });
    await expect(expectMessage(client, 1_000, "pair_complete")).rejects.toMatchObject({ peerCode: "pairing_rejected" });
    expect(presenter.codes).toHaveLength(0);
  });

  it("closes the Mac prompt when the phone gives up first", async () => {
    const { mac, phone, invitation, clock } = setup();
    const presenter = new FakePairingPresenter(() => new Promise<boolean>(() => undefined));
    const waiting = new MacPairingSession({ identity: mac, invitation, presenter, sink: new MemoryTrust(), clock, decisionTimeoutMs: 30 });
    const { client, server } = MemoryFrameChannel.pair();
    const run = waiting.run(server);
    await client.send({ message: { type: "pair_request", payload: { phone: phone.publicKeys, proof: phoneProof(invitation, phone.publicKeys) } }, body: new Uint8Array() });
    await expect(run).rejects.toMatchObject({ code: "timed_out" });
    expect(presenter.aborted).toBe(true);
  });
});
