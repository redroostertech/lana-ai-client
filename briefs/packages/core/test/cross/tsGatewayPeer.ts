import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { utf8 } from "../../src/bytes/index.js";
import { ChunkCipher, randomBytes, sha256Hex } from "../../src/crypto/index.js";
import { HandoffGateway } from "../../src/gateway/index.js";
import type { AccountInfo, HandoffLog, ToneOutput } from "../../src/handoff/index.js";
import { isLeaseCommand, runLeaseCommand, type LeaseCommand } from "./leaseCommands.js";
import type { LanaId } from "../../src/ids/index.js";
import { contentHash } from "../../src/intent/index.js";
import { createSealedFileKeyVault } from "../../src/keys/index.js";
import { toneSamplesLittleEndian } from "../../src/tone/index.js";
import type { TsMacPeer } from "./tsMacPeer.js";

/**
 * The FULL desktop gateway as the Swift cross test's Mac (`CrossImplementationSessionTests`):
 * `HandoffGateway` with a sealed-file key vault and a real `GatewayStore` in a temporary
 * folder, one TLS-PSK listener for pairing and handoffs, Bonjour from the gateway itself.
 * The exchange files match `tsMacPeer.ts`; the person at the Mac is scripted from the
 * gateway's events (confirm the code, approve), the speaker writes `tone-N.f32`, the QR
 * fallback writes `qr-N.txt`, and `received.json` is read back from the store (audio
 * hashes come from the decrypted stored audio, not from the session).
 */
export async function startTsGatewayPeer(options: { dir: string; bonjour: boolean; log: HandoffLog }): Promise<TsMacPeer> {
  const { dir, log } = options;
  const data = mkdtempSync(join(tmpdir(), "lana-gateway-peer-"));
  const osKey = randomBytes(32);
  const aad = utf8("cross.keystore");
  const files = new ExchangeFiles(dir);

  const gateway = await HandoffGateway.open({
    directory: join(data, "store"),
    vault: createSealedFileKeyVault({ directory: join(data, "keys"), sealer: { seal: (p) => ChunkCipher.seal(p, osKey, aad), unseal: (s) => ChunkCipher.open(s, osKey, aad) } }),
    displayName: "TS Gateway",
    tone: files,
    log,
    ...(options.bonjour ? {} : { bonjour: false as const }),
  });

  // The person signed in on the desktop, as the phone should show it (display only).
  const account: { current: AccountInfo | null } = { current: { name: "Dana Whitfield", email: "dana@whitfield.example", organization: "Whitfield Law", serverHost: "lana.whitfield.example" } };
  gateway.setAccountInfoSource(() => account.current);

  const received: unknown[] = [];
  const sessions: unknown[] = [];
  let qrs = 0;
  gateway.on("pairing", (state) => {
    log.info("peer.pairing", { state: state.state });
    if (state.state === "confirming") {
      files.writeBytes("pair-code.txt", Buffer.from(state.code));
      gateway.answerPairingCode(true);
    }
    if (state.state === "paired") files.write("paired.json", { phone_device_id: state.phoneDeviceId });
  });
  gateway.on("handoff", (event) => {
    switch (event.type) {
      case "qr":
        qrs += 1;
        files.writeBytes(`qr-${qrs}.txt`, Buffer.from(event.qrText));
        break;
      case "approval_requested":
        gateway.answerApproval(event.handoffId, true);
        break;
      case "finished":
        sessions.push({ result: "ok", bundles: event.bundles });
        files.write("sessions.json", sessions);
        break;
      case "failed":
        sessions.push({ result: "failed", code: event.code });
        files.write("sessions.json", sessions);
        break;
      default:
        break;
    }
  });
  gateway.on("meetingReceived", (meeting) => {
    const id = meeting.meetingId as LanaId;
    const stored = gateway.store.meetings.get(id);
    received.push({
      updated: meeting.updated,
      bundle_id: meeting.bundleId,
      meeting_id: stored.id,
      intents: gateway.store.intents.list({ meetingID: id }).length,
      rejected_intents: meeting.quarantinedIntents,
      audio_sha256: gateway.store.meetings.audioParts(id).map((_, index) => sha256Hex(gateway.store.meetings.audioData(id, index))),
      method: meeting.method,
      tone_plays: meeting.tonePlays,
      latency_ms: meeting.latencyMs,
    });
    files.write("received.json", received);
  });

  const status = await gateway.start();
  if (status.state !== "listening") throw new Error(`gateway did not start: ${status.state}`);
  const pairing = gateway.beginPairing();
  if (pairing.state !== "waiting") throw new Error(`pairing did not open: ${pairing.state}`);

  files.write("peer.json", {
    mac_device_id: gateway.identity.publicKeys.deviceID,
    pairing_port: status.port,
    handoff_port: status.port,
    pairing_service: pairing.serviceName,
    gateway_service: gateway.serviceName,
    invitation_qr: pairing.qrText,
    bonjour: options.bonjour,
    gateway: true,
  });
  log.info("peer.ready", { port: status.port, bonjour: options.bonjour, gateway: true });

  let resolveFinished: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (resolveFinished = resolve));
  const done = new Set<string>();
  const watcher = setInterval(() => {
    if (existsSync(join(dir, "stop"))) void stop();
    // The person at the desktop, scripted by the Swift test: `command-N.json` in, `result-N.json` out.
    for (const name of readdirSync(dir).filter((file) => /^command-\d+\.json$/.test(file)).sort()) {
      if (done.has(name)) continue;
      done.add(name);
      const command = JSON.parse(readFileSync(join(dir, name), "utf8")) as DesktopCommand;
      // Background leases (protocol 5): the desktop's setting, sign out and the audit, async.
      if (isLeaseCommand(command)) {
        void runLeaseCommand(gateway, command as unknown as LeaseCommand)
          .catch((error: unknown) => ({ error: error instanceof Error ? error.message : "failed" }))
          .then((result) => files.write(name.replace("command-", "result-"), result));
        log.info("peer.command", { op: command.op });
        continue;
      }
      let result: unknown;
      try {
        result = command.op === "set_account" ? setAccount(account, command) : runCommand(gateway, command);
      } catch (error) {
        result = { error: error instanceof Error ? error.message : "failed" };
      }
      log.info("peer.command", { op: command.op });
      files.write(name.replace("command-", "result-"), result);
    }
  }, 100);
  let stopping: Promise<void> | undefined;
  function stop(): Promise<void> {
    stopping ??= shutDown();
    return stopping;
  }
  async function shutDown(): Promise<void> {
    clearInterval(watcher);
    const audit = await gateway.store.verifyAudit();
    const events = (await gateway.store.auditEntries()).map((entry) => entry.event);
    const devices = (await gateway.store.pairedDevices()).length;
    const meetings = gateway.store.meetings.list().length;
    log.info("peer.store", { devices, meetings, auditEntries: audit.entries, auditIntact: audit.isIntact, events: events.join(",") });
    files.write("store.json", { devices, meetings, audit_entries: audit.entries, audit_intact: audit.isIntact, audit_events: events });
    await gateway.close();
    rmSync(data, { recursive: true, force: true });
    resolveFinished();
  }
  return { finished, stop };
}

class ExchangeFiles implements ToneOutput {
  private tones = 0;
  constructor(private readonly dir: string) {}

  write(name: string, value: unknown): void {
    this.writeBytes(name, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
  }

  /** Write then rename, so the Swift side never reads a half-written file. */
  writeBytes(name: string, data: Uint8Array): void {
    const temporary = join(this.dir, `.${name}.tmp`);
    writeFileSync(temporary, data);
    renameSync(temporary, join(this.dir, name));
  }

  async play(samples: Float32Array): Promise<void> {
    this.tones += 1;
    this.writeBytes(`tone-${this.tones}.f32`, toneSamplesLittleEndian(samples));
  }
}

/** What the Swift cross test asks the desktop to do, as the person at the desktop would. */
interface DesktopCommand {
  readonly op: "state" | "edit_note" | "edit_title" | "execute_first_action" | "resolve" | "queue" | "cancel" | "set_account";
  readonly meeting: string;
  /** `set_account`: the signed-in account, or `signed_out` for none. */
  readonly name?: string;
  readonly email?: string;
  readonly organization?: string;
  readonly server_host?: string;
  readonly signed_out?: boolean;
  readonly note_id?: string;
  readonly text?: string;
  readonly unit?: string;
  readonly choice?: "phone" | "desktop" | "edited";
  readonly phone?: string;
}

/** Signs the desktop in as another account, or out (`signed_out`). */
function setAccount(account: { current: AccountInfo | null }, command: DesktopCommand): unknown {
  account.current = command.signed_out === true
    ? null
    : { name: command.name ?? "", email: command.email ?? "", organization: command.organization ?? "", serverHost: command.server_host ?? "" };
  return { ok: true };
}

function runCommand(gateway: HandoffGateway, command: DesktopCommand): unknown {
  const store = gateway.store;
  const id = command.meeting as LanaId;
  switch (command.op) {
    case "edit_note":
      store.shared.edit(id, (record) => {
        const at = new Date(Math.floor(Date.now() / 1_000) * 1_000);
        const existing = record.userNotes.find((note) => note.id === command.note_id);
        const note = { id: command.note_id ?? "desk", text: command.text ?? "", createdAt: existing?.createdAt ?? at, updatedAt: at, anchor: existing?.anchor };
        return { ...record, userNotes: [...record.userNotes.filter((item) => item.id !== note.id), note] };
      });
      break;
    case "edit_title":
      store.shared.edit(id, (record) => ({ ...record, title: command.text ?? "" }));
      break;
    case "execute_first_action": {
      const first = store.intents.list({ meetingID: id })[0];
      if (first === undefined) throw new Error("no action");
      for (const next of ["resolved", "confirmed", "executed"] as const) store.intents.transition(first.intent.id, next, next === "executed" ? "system" : "user");
      store.intents.setResolution(first.intent.id, new TextEncoder().encode(JSON.stringify({
        target: { regarding: { kind: "matter", id: "9001", displayName: "2026-0147 Acme Logistics" }, recipients: [] },
        result: { external_id: "77", web_url: "https://app.clio.com/nc/#/notes/77", deduplicated: false, undo: { executor: "clio.note", external_id: "77", url: "https://app.clio.com/api/v4/notes/77", expires_at: "2026-11-02T00:00:00.000Z" } },
      })));
      break;
    }
    case "resolve":
      store.shared.resolve(id, command.unit ?? "", command.choice === "edited" ? { kind: "edited", text: command.text ?? "" } : { kind: command.choice ?? "desktop" });
      break;
    case "queue":
      gateway.sendToPhone(id, command.phone as LanaId);
      break;
    case "cancel": {
      // "Cancel send": cancelled, delivering (a session is sending it now) or not_queued.
      const status = gateway.cancelSend(id, command.phone as LanaId);
      return { status, wake: gateway.wakeRecord, ...meetingState(gateway, id) };
    }
    case "state":
      break;
  }
  return meetingState(gateway, id);
}

function meetingState(gateway: HandoffGateway, id: LanaId): Record<string, unknown> {
  const store = gateway.store;
  if (!store.meetings.exists(id)) return { exists: false };
  const record = store.shared.current(id);
  const phones = store.devices.list().map((device) => device.keys.deviceID);
  return {
    exists: true,
    queued: phones.filter((phone) => store.shared.queue(phone).includes(id)),
    declined: store.shared.declined(id).map((entry) => entry.phoneDeviceID),
    snoozed: store.shared.snoozed(id).map((entry) => entry.phoneDeviceID),
    content_hash: contentHash(record),
    revision: record.sync?.revision ?? 0,
    title: record.title,
    conflicts: (record.sync?.conflicts ?? []).map((conflict) => conflict.unit),
    statuses: store.intents.list({ meetingID: id }).map((stored) => stored.intent.status),
    notes: record.userNotes.length,
    outcomes: (record.sync?.outcomes ?? []).length,
    audio_parts: store.meetings.audioParts(id).length,
    meetings: store.meetings.list().length,
    wake: gateway.wakeRecord,
  };
}
