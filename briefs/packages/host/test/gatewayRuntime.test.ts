import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseInvitationQr, pairingPsk, SoftwareIdentity, transportPsk } from "@lana/core/crypto";
import { connectHandoff, HANDOFF_TLS, issueRecordDecline } from "@lana/core/handoff";
import type { SafeStorageLike } from "@lana/core/keys";
import type { GatewayStatus, HandoffView, LanaEvent, PairingState } from "../src/shared/api.js";
import { openGatewayRuntime, StartupError, type GatewayRuntime } from "../src/main/gateway/gatewayRuntime.js";
import type { ClientSessionSnapshot } from "../src/main/gateway/clientSession.js";
import type { LogFields, MainLog } from "../src/main/log.js";
import { sealTestBundle } from "../../core/test/support/bundleSealer.js";
import { Air, FakePresenter, runScriptedPhone, runScriptedPhonePairing } from "../../core/test/support/handoffFakes.js";

const HOST = "127.0.0.1";
const EMAIL = "person@firm.test";
const TOKEN = "client-token-1";

/** safeStorage stand-in: reversible, and records that it was used. */
function fakeSafeStorage(available = true): SafeStorageLike & { sealed: number } {
  const store = {
    sealed: 0,
    isEncryptionAvailable: () => available,
    encryptString(plain: string): Uint8Array {
      store.sealed += 1;
      return new Uint8Array(Buffer.from(`sealed:${Buffer.from(plain).toString("hex")}`));
    },
    decryptString(encrypted: Buffer): string {
      const text = encrypted.toString();
      if (!text.startsWith("sealed:")) throw new Error("bad");
      return Buffer.from(text.slice(7), "hex").toString();
    },
  };
  return store;
}

/** The LANA client's one session, as the client hands it to Briefs. */
const SIGNED_IN: ClientSessionSnapshot = {
  token: TOKEN,
  apiBase: "http://localhost:8080",
  user: { id: "7", organizationID: "harlow", organizationName: "Harlow Reyes LLP", email: EMAIL, firstName: "Alicia", lastName: "Reyes" },
};

/** Stands in for the client's token store: Briefs reads it, never writes it. */
class ClientSessionHolder {
  current: ClientSessionSnapshot | null = null;
}

class RecordingLog implements MainLog {
  readonly lines: string[] = [];
  readonly path = null;
  info = (event: string, fields?: LogFields) => void this.lines.push(JSON.stringify({ event, ...fields }));
  notice = (event: string, fields?: LogFields) => void this.lines.push(JSON.stringify({ event, ...fields }));
  error = (event: string, fields?: LogFields) => void this.lines.push(JSON.stringify({ event, ...fields }));
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function profile(): string {
  const folder = mkdtempSync(join(tmpdir(), "lana-runtime-"));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

interface Rig {
  runtime: GatewayRuntime;
  events: LanaEvent[];
  log: RecordingLog;
  air: Air;
  client: ClientSessionHolder;
  userData: string;
  next<T extends LanaEvent["type"]>(type: T, match?: (event: Extract<LanaEvent, { type: T }>) => boolean): Promise<Extract<LanaEvent, { type: T }>>;
}

async function open(userData: string, options: { playTone?: boolean; client?: ClientSessionHolder } = {}): Promise<Rig> {
  const events: LanaEvent[] = [];
  const waiters: ((event: LanaEvent) => void)[] = [];
  const air = new Air();
  const log = new RecordingLog();
  const client = options.client ?? new ClientSessionHolder();
  let runtime: GatewayRuntime | null = null;
  const emit = (event: LanaEvent): void => {
    events.push(event);
    for (const waiter of [...waiters]) waiter(event);
    // The renderer's tone player: "plays" the burst into the air, then reports.
    if (event.type === "tone" && options.playTone !== false) {
      void air.play(event.request.samples, event.request.sampleRate).then(() => runtime?.tone.played(event.request.id));
    }
  };
  runtime = await openGatewayRuntime({ userData, safeStorage: fakeSafeStorage(), emit, log, session: () => client.current, listen: { host: HOST, bonjour: false } });
  const live = runtime;
  cleanups.push(() => live.close());
  await runtime.restore();
  const next: Rig["next"] = (type, match) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 8_000);
      const waiter = (event: LanaEvent): void => {
        if (event.type !== type || (match !== undefined && !match(event as never))) return;
        clearTimeout(timer);
        waiters.splice(waiters.indexOf(waiter), 1);
        resolve(event as never);
      };
      waiters.push(waiter);
    });
  return { runtime, events, log, air, client, userData, next };
}

/** Signing in happens in the client; Briefs is told its session changed and reads it. */
async function signIn(rig: Rig): Promise<void> {
  const listening = rig.next("gateway", (event) => event.status.listener.kind === "waitingForPairing" || event.status.listener.kind === "listening");
  rig.client.current = SIGNED_IN;
  rig.runtime.sessionChanged();
  await listening;
  expect(await rig.runtime.account.state()).toEqual({
    kind: "signedIn",
    user: { id: "7", email: EMAIL, firstName: "Alicia", lastName: "Reyes", mustChangePassword: false },
    server: { baseURL: "http://localhost:8080", host: "localhost:8080", organizationID: "harlow", organizationName: "Harlow Reyes LLP", domain: "", isSecure: true },
  });
}

function portOf(status: GatewayStatus, log: RecordingLog): number {
  expect(status.listener.kind === "listening" || status.listener.kind === "waitingForPairing").toBe(true);
  const line = log.lines.map((entry) => JSON.parse(entry) as { event: string; port?: number }).filter((entry) => entry.event === "gateway.listening").at(-1);
  if (line?.port === undefined) throw new Error("no port");
  return line.port;
}

describe("Gateway runtime (main process services)", () => {
  it("refuses to start without the OS keystore", async () => {
    await expect(
      openGatewayRuntime({ userData: profile(), safeStorage: fakeSafeStorage(false), emit: () => undefined, log: new RecordingLog(), session: () => null }),
    ).rejects.toBeInstanceOf(StartupError);
  });

  it("there is one session, the client's: Briefs signs nothing in or out and keeps no token", async () => {
    const rig = await open(profile());
    expect(Object.keys(rig.runtime.account)).toEqual(["state"]);
    expect(await rig.runtime.access.state()).toEqual({ kind: "signedOut" });
    await signIn(rig);
    expect(await rig.runtime.access.state()).toEqual({ kind: "entitled", offline: false });
    // A refreshed token in the client is used on the next call, with no sign-in here.
    rig.client.current = { ...SIGNED_IN, token: "client-token-2" };
    rig.runtime.sessionChanged();
    const seen: string[] = [];
    await rig.runtime.lanaSession?.authorized(async ({ token }) => void seen.push(token));
    expect(seen).toEqual(["client-token-2"]);
    // Nothing of the session is written to Briefs' vault: it holds the computer's identity and the store key only.
    expect(readdirSync(join(rig.userData, "keys")).sort()).toEqual(["datakey.gateway.sealed", "identity.mac.sealed"]);
  });

  it("gates the listener on sign in, pairs, receives a meeting by tone, restores the session, and stops on sign out", async () => {
    const userData = profile();
    const rig = await open(userData);

    // Signed out: no listener, no pairing.
    expect(await rig.runtime.account.state()).toEqual({ kind: "signedOut", reason: "notSignedIn", lastServer: null });
    expect(await rig.runtime.devices.gatewayStatus()).toEqual({ listener: { kind: "signedOut" }, receiving: false });
    expect(await rig.runtime.devices.startPairing()).toMatchObject({ kind: "failed" });

    await signIn(rig);
    // Signed in with no phone paired: nothing listens on the network until pairing starts.
    expect(await rig.runtime.devices.gatewayStatus()).toEqual({ listener: { kind: "waitingForPairing" }, receiving: false });
    expect(rig.log.lines.some((line) => (JSON.parse(line) as { event: string }).event === "gateway.listening")).toBe(false);

    // Pairing through the bridge opens the listener: QR, the phone connects, both show the same code, confirm.
    const waiting = await rig.runtime.devices.startPairing();
    const port = portOf(await rig.runtime.devices.gatewayStatus(), rig.log);
    if (waiting.kind !== "showingCode") throw new Error(`pairing did not start: ${waiting.kind}`);
    expect(waiting.serviceName).toMatch(/^Lana-Pair-/);
    const invitation = parseInvitationQr(waiting.qrText);
    const phone = SoftwareIdentity.generate("Test iPhone");
    const confirming = rig.next("pairing", (event) => event.state.kind === "confirming");
    const paired = rig.next("pairing", (event) => event.state.kind === "paired");
    const phoneSide = runScriptedPhonePairing(
      await connectHandoff({ host: HOST, port, identity: HANDOFF_TLS.pairingIdentity, key: pairingPsk(invitation) }), phone, invitation, true,
    );
    const shown = (await confirming).state as Extract<PairingState, { kind: "confirming" }>;
    expect(shown.phoneName).toBe("Test iPhone");
    expect(await rig.runtime.devices.answerPairing(true)).toMatchObject({ kind: "saving" });
    const { code } = await phoneSide;
    expect(shown.code).toBe(code);
    expect((await paired).state).toEqual({ kind: "paired", phoneName: "Test iPhone" });
    const devices = await rig.runtime.devices.list();
    expect(devices.ok && devices.value.map((device) => [device.id, device.displayName])).toEqual([[phone.publicKeys.deviceID, "Test iPhone"]]);
    expect(await rig.runtime.devices.gatewayStatus()).toEqual({ listener: { kind: "listening" }, receiving: false });

    // A handoff verified by the tone the "renderer" played, receipted, stored.
    const mac = invitation.mac;
    const psk = transportPsk(phone, mac, mac.deviceID, phone.publicKeys.deviceID);
    const bundle = await sealTestBundle(phone, mac, [new Uint8Array(20_000).fill(7)]);
    const received = rig.next("meetingReceived");
    const finished = rig.next("handoff", (event) => event.view.kind === "received");
    const result = await runScriptedPhone(await connectHandoff({ host: HOST, port, identity: phone.publicKeys.deviceID, key: psk }), {
      identity: phone, mac, bundles: [bundle], air: rig.air, presenter: new FakePresenter(),
    });
    expect(result).toMatchObject({ method: "acoustic", delivered: [bundle.manifest.bundleID] });
    expect((await received).meetingID).toBe(bundle.meetingID);
    expect((await finished).view).toMatchObject({ kind: "received", bundles: 1 });
    const views = rig.events.flatMap((event) => (event.type === "handoff" ? [event.view.kind] : []));
    expect(views).toEqual(["receiving", "tone", "receiving", "received"]);
    expect(rig.events.filter((event) => event.type === "tone")).toHaveLength(1);

    const meetings = await rig.runtime.meetings.list();
    expect(meetings.ok && meetings.value.map((meeting) => [meeting.id, meeting.attestationMethod])).toEqual([[bundle.meetingID, "acoustic"]]);
    const meeting = await rig.runtime.meetings.get(bundle.meetingID);
    if (!meeting.ok) throw new Error("meeting not readable");
    expect(meeting.value).toMatchObject({ id: bundle.meetingID, attestationMethod: "acoustic", hasAudio: true });
    expect(meeting.value.transcript.length).toBeGreaterThan(0);
    expect(await rig.runtime.meetings.get("mtg_nope")).toMatchObject({ ok: false, error: { code: "notFound" } });
    expect(await rig.runtime.handoff.dismiss()).toEqual({ kind: "idle" });

    // Quit and relaunch: the client is still signed in, so the gateway listens again.
    await rig.runtime.close();
    const relaunched = await open(userData, { client: rig.client });
    expect(await relaunched.runtime.account.state()).toMatchObject({ kind: "signedIn", user: { id: "7" }, server: { baseURL: "http://localhost:8080", organizationID: "harlow" } });
    // restore() opened the gate before it returned, so the listener is already up.
    expect(await relaunched.runtime.devices.gatewayStatus()).toEqual({ listener: { kind: "listening" }, receiving: false });
    const relaunchedMeetings = await relaunched.runtime.meetings.list();
    expect(relaunchedMeetings.ok && relaunchedMeetings.value).toHaveLength(1);

    // Signing out of the client: the listener closes at once, the phone's key no longer opens a connection.
    const closed = relaunched.next("gateway", (event) => event.status.listener.kind === "signedOut");
    relaunched.client.current = null;
    relaunched.runtime.sessionChanged();
    await closed;
    expect(await relaunched.runtime.account.state()).toEqual({ kind: "signedOut", reason: "notSignedIn", lastServer: null });
    expect(await relaunched.runtime.devices.gatewayStatus()).toEqual({ listener: { kind: "signedOut" }, receiving: false });
    const newPort = portOf({ listener: { kind: "listening" }, receiving: false }, relaunched.log);
    await expect(connectHandoff({ host: HOST, port: newPort, identity: phone.publicKeys.deviceID, key: psk })).rejects.toBeDefined();

    // Logs carry ids and states only.
    for (const line of [...rig.log.lines, ...relaunched.log.lines]) {
      for (const secret of [EMAIL, TOKEN, "Alicia", "Test iPhone", code]) expect(line).not.toContain(secret);
    }
  });

  it("tells the window when the phone declines a meeting sent to it, and Cancel send after that is quiet", async () => {
    const rig = await open(profile());
    await signIn(rig);
    const waiting = await rig.runtime.devices.startPairing();
    const port = portOf(await rig.runtime.devices.gatewayStatus(), rig.log);
    if (waiting.kind !== "showingCode") throw new Error(`pairing did not start: ${waiting.kind}`);
    const invitation = parseInvitationQr(waiting.qrText);
    const phone = SoftwareIdentity.generate("Test iPhone");
    const confirming = rig.next("pairing", (event) => event.state.kind === "confirming");
    const paired = rig.next("pairing", (event) => event.state.kind === "paired");
    const phoneSide = runScriptedPhonePairing(await connectHandoff({ host: HOST, port, identity: HANDOFF_TLS.pairingIdentity, key: pairingPsk(invitation) }), phone, invitation, true);
    await confirming;
    await rig.runtime.devices.answerPairing(true);
    await phoneSide;
    await paired;
    const mac = invitation.mac;
    const psk = transportPsk(phone, mac, mac.deviceID, phone.publicKeys.deviceID);
    const bundle = await sealTestBundle(phone, mac, [new Uint8Array(4_000).fill(3)]);
    await runScriptedPhone(await connectHandoff({ host: HOST, port, identity: phone.publicKeys.deviceID, key: psk }), { identity: phone, mac, bundles: [bundle], air: rig.air, presenter: new FakePresenter() });

    const sent = await rig.runtime.records.sendToPhone(bundle.meetingID, phone.publicKeys.deviceID);
    expect(sent.ok && sent.value.phones[0]?.queued).toBe(true);
    // The phone says Decline: main pushes recordsChanged so the open panel reloads.
    const changed = rig.next("recordsChanged", (event) => event.meetingID === bundle.meetingID);
    await runScriptedPhone(await connectHandoff({ host: HOST, port, identity: phone.publicKeys.deviceID, key: psk }), {
      identity: phone, mac, bundles: [], air: rig.air, presenter: new FakePresenter(), maxProtocolVersion: 2,
      listed: [],
      answerUpdate: async (update) => ({ type: "sync_decline", payload: issueRecordDecline(update, "declined", phone, new Date()) }),
    });
    expect((await changed).meetingID).toBe(bundle.meetingID);
    const state = await rig.runtime.records.state(bundle.meetingID);
    expect(state.ok && state.value.phones[0]).toMatchObject({ queued: false, declinedAt: expect.any(String) });
    // Cancel send from a stale button: not_queued, with the record saying why.
    const cancelled = await rig.runtime.records.cancelSend(bundle.meetingID, phone.publicKeys.deviceID);
    expect(cancelled.ok && cancelled.value.status).toBe("not_queued");
    expect(cancelled.ok && cancelled.value.record.phones[0]?.declinedAt).toEqual(expect.any(String));
  });

  it("shows the QR fallback and the approval prompt, and declines when the person denies", async () => {
    const rig = await open(profile(), { playTone: true });
    await signIn(rig);
    const waiting = await rig.runtime.devices.startPairing();
    const port = portOf(await rig.runtime.devices.gatewayStatus(), rig.log);
    if (waiting.kind !== "showingCode") throw new Error("pairing did not start");
    const invitation = parseInvitationQr(waiting.qrText);
    const phone = SoftwareIdentity.generate("Second iPhone");
    rig.next("pairing", (event) => event.state.kind === "confirming").then(() => rig.runtime.devices.answerPairing(true)).catch(() => undefined);
    const paired = rig.next("pairing", (event) => event.state.kind === "paired");
    await runScriptedPhonePairing(await connectHandoff({ host: HOST, port, identity: HANDOFF_TLS.pairingIdentity, key: pairingPsk(invitation) }), phone, invitation, true);
    await paired;

    // A silent room: the tone never reaches the phone, so it falls back to the QR code.
    rig.air.muted = true;
    const presenter = new FakePresenter();
    const qrShown = rig.next("handoff", (event) => event.view.kind === "qr").then((event) => {
      presenter.qr = (event.view as Extract<HandoffView, { kind: "qr" }>).qrText;
    });
    const psk = transportPsk(phone, invitation.mac, invitation.mac.deviceID, phone.publicKeys.deviceID);
    const bundle = await sealTestBundle(phone, invitation.mac, [new Uint8Array(4_000).fill(1)]);
    const channel = await connectHandoff({ host: HOST, port, identity: phone.publicKeys.deviceID, key: psk });
    // Hold the phone's read of `qr_shown` until the QR event reached the "screen".
    const receive = channel.receive.bind(channel);
    channel.receive = async (timeoutMs) => {
      const frame = await receive(timeoutMs);
      if (frame.message.type === "qr_shown") await qrShown;
      return frame;
    };
    const result = await runScriptedPhone(channel, { identity: phone, mac: invitation.mac, bundles: [bundle], air: rig.air, presenter });
    expect(result).toMatchObject({ method: "qr", delivered: [bundle.manifest.bundleID] });

    // The phone asks for approval on this computer; the person denies.
    const approval = rig.next("handoff", (event) => event.view.kind === "approval");
    const failed = rig.next("handoff", (event) => event.view.kind === "failed");
    const second = await sealTestBundle(phone, invitation.mac, [new Uint8Array(1_000)]);
    const denied = runScriptedPhone(await connectHandoff({ host: HOST, port, identity: phone.publicKeys.deviceID, key: psk }), {
      identity: phone, mac: invitation.mac, bundles: [second], air: rig.air, presenter, fallback: "mac_approval",
    });
    const asked = (await approval).view as Extract<HandoffView, { kind: "approval" }>;
    expect(asked.phoneName).toBe("Second iPhone");
    expect(await rig.runtime.handoff.answerApproval(asked.handoffId, false)).toEqual({ kind: "receiving", handoffId: asked.handoffId });
    await expect(denied).rejects.toBeDefined();
    expect((await failed).view).toMatchObject({ kind: "failed", message: "The phone was not approved, so the meeting stayed on it." });
    const meetings = await rig.runtime.meetings.list();
    expect(meetings.ok && meetings.value.map((meeting) => meeting.attestationMethod)).toEqual(["qr"]);
  });
  it("listens only while a phone is paired or a pairing is under way", async () => {
    const rig = await open(profile());
    await signIn(rig);
    const listeningLines = () => rig.log.lines.filter((line) => (JSON.parse(line) as { event: string }).event === "gateway.listening").length;
    expect(listeningLines()).toBe(0);

    // Cancelling the first pairing closes the listener again.
    const opened = await rig.runtime.devices.startPairing();
    expect(opened.kind).toBe("showingCode");
    expect(listeningLines()).toBe(1);
    const closed = rig.next("gateway", (event) => event.status.listener.kind === "waitingForPairing");
    await rig.runtime.devices.cancelPairing();
    await closed;
    expect(await rig.runtime.devices.gatewayStatus()).toEqual({ listener: { kind: "waitingForPairing" }, receiving: false });

    // Pair a phone: it keeps listening after the pairing finishes.
    const waiting = await rig.runtime.devices.startPairing();
    const port = portOf(await rig.runtime.devices.gatewayStatus(), rig.log);
    if (waiting.kind !== "showingCode") throw new Error(`pairing did not start: ${waiting.kind}`);
    const invitation = parseInvitationQr(waiting.qrText);
    const phone = SoftwareIdentity.generate("Test iPhone");
    const confirming = rig.next("pairing", (event) => event.state.kind === "confirming");
    const paired = rig.next("pairing", (event) => event.state.kind === "paired");
    const phoneSide = runScriptedPhonePairing(await connectHandoff({ host: HOST, port, identity: HANDOFF_TLS.pairingIdentity, key: pairingPsk(invitation) }), phone, invitation, true);
    await confirming;
    await rig.runtime.devices.answerPairing(true);
    await phoneSide;
    await paired;
    await rig.runtime.devices.resetPairing();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await rig.runtime.devices.gatewayStatus()).toEqual({ listener: { kind: "listening" }, receiving: false });

    // Revoking the last phone stops listening.
    const stopped = rig.next("gateway", (event) => event.status.listener.kind === "waitingForPairing");
    expect(await rig.runtime.devices.revoke(phone.publicKeys.deviceID)).toEqual({ ok: true, value: null });
    await stopped;
    expect(await rig.runtime.devices.gatewayStatus()).toEqual({ listener: { kind: "waitingForPairing" }, receiving: false });
  });
});
