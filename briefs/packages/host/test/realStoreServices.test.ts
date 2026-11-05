import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HANDOFF_SETTING_KEYS, loadHandoffSettings } from "@lana/core/gateway";
import type { GatewayStatus, LanaEvent, PlatformInfo, Preferences, ThemePreference, VoiceDownload } from "../src/shared/api.js";
import { AuditService, exportFileName } from "../src/main/services/auditService.js";
import { PreferencesService } from "../src/main/services/preferencesService.js";
import { APP_SETTING_KEYS, SettingsService } from "../src/main/services/settingsService.js";
import { UserNotesService } from "../src/main/services/userNotesService.js";
import { openRealRig, phone, receiveGoldenMeeting, type RealRig } from "./support/realRig.js";

const platform: PlatformInfo = { os: "mac", deviceNoun: "computer", appVersion: "0.1.0", isDemo: false, features: { ask: false, talk: false } };

let rig: RealRig;
beforeEach(async () => {
  rig = await openRealRig();
});
afterEach(() => rig.cleanup());

describe("AuditService (real store)", () => {
  it("lists, verifies and exports the chain as JSON Lines exactly as the store makes them", async () => {
    const opened = await receiveGoldenMeeting(rig);
    let suggested = "";
    const target = join(rig.directory, "export.jsonl");
    const audit = new AuditService(rig.store, async (name) => ((suggested = name), target), rig.log, () => new Date(2026, 10, 1, 9));

    const entries = await audit.entries();
    expect(entries.ok && entries.value.map((row) => row.event)).toEqual(["device.paired", "bundle.received"]);
    const received = entries.ok ? entries.value[1] : undefined;
    const phoneName = phone.publicKeys.displayName;
    expect(entries.ok && entries.value[0]).toMatchObject({ sentence: `Paired ${phoneName}`, category: "devices" });
    expect(received).toMatchObject({
      seq: 2,
      sentence: `Received ${opened.meeting.title} from ${phoneName}, verified by tone`,
      category: "meetings",
      subject: opened.manifest.bundleID,
    });
    expect(received?.detail).toContainEqual({ key: "meeting_id", value: opened.meeting.id });
    expect(received?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await audit.verify()).toEqual({ ok: true, value: { kind: "intact", entries: 2 } });

    expect(await audit.export()).toEqual({ ok: true, value: { message: "Exported 2 entries." } });
    expect(suggested).toBe("lana-audit-2026-11-01.jsonl");
    expect(new Uint8Array(readFileSync(target))).toEqual(await rig.store.exportAudit());
    const lines = readFileSync(target, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2] ?? "{}")).toMatchObject({ entries: "2", intact: "true" });
  });

  it("names an unpaired phone and falls back to short ids once a meeting is gone", async () => {
    await receiveGoldenMeeting(rig);
    await rig.store.revokeDevice(phone.publicKeys.deviceID);
    const meetings = rig.store.meetings.list();
    const audit = new AuditService(rig.store, async () => null, rig.log);
    const rows = await audit.entries();
    expect(rows.ok && rows.value.at(-1)?.sentence).toBe(`Unpaired ${phone.publicKeys.displayName}`);

    const gone = new AuditService(Object.assign(Object.create(rig.store) as typeof rig.store, {
      pairedDevices: async () => [],
      meetings: { list: () => [] },
    }), async () => null, rig.log);
    const bare = await gone.entries();
    const meetingID = meetings[0]?.id ?? "";
    expect(bare.ok && bare.value[1]?.sentence).toBe(`Received meeting ${meetingID.slice(4, 10)}... from phone ${phone.publicKeys.deviceID.slice(4, 10)}..., verified by tone`);
  });

  it("returns null when the person cancels the save dialog and writes nothing", async () => {
    const audit = new AuditService(rig.store, async () => null, rig.log);
    expect(await audit.export()).toEqual({ ok: true, value: null });
    expect(exportFileName(new Date(2026, 0, 5))).toBe("lana-audit-2026-01-05.jsonl");
  });

  it("answers the older audit namespace from the same chain", async () => {
    await receiveGoldenMeeting(rig);
    const audit = new AuditService(rig.store, async () => null, rig.log);
    expect(await audit.legacy.verify()).toEqual({ ok: true, value: { intact: true, entries: 2 } });
    const listed = await audit.legacy.list();
    expect(listed.ok && listed.value.map((entry) => entry.event)).toEqual(["device.paired", "bundle.received"]);
  });
});

describe("SettingsService (store settings)", () => {
  it("persists the theme, applies it, and pushes the change", async () => {
    const applied: ThemePreference[] = [];
    const events: LanaEvent[] = [];
    const settings = new SettingsService(rig.store.settings, (theme) => applied.push(theme), (event) => events.push(event), rig.log);
    settings.start(null);
    expect(await settings.get()).toEqual({ theme: "system" });
    await settings.setTheme("dark");
    expect(rig.store.settings.get(APP_SETTING_KEYS.theme)).toBe("dark");
    expect(events).toContainEqual({ type: "settings", settings: { theme: "dark" } });
    const reopened = new SettingsService(rig.store.settings, (theme) => applied.push(theme), () => undefined, rig.log);
    reopened.start(null);
    expect(applied).toEqual(["system", "dark", "dark"]);
  });

  it("keeps walkthrough completion in the store and imports walkthrough.json once", async () => {
    const legacy = join(rig.directory, "walkthrough.json");
    writeFileSync(legacy, JSON.stringify(["u-old"]));
    const settings = new SettingsService(rig.store.settings, () => undefined, () => undefined, rig.log);
    settings.start(legacy);
    expect(existsSync(legacy)).toBe(false);
    expect(await settings.walkthroughCompleted("u-old")).toBe(true);
    expect(await settings.walkthroughCompleted("u-new")).toBe(false);
    await settings.setWalkthroughCompleted("u-new");
    expect(JSON.parse(rig.store.settings.get(APP_SETTING_KEYS.walkthroughCompleted) ?? "[]")).toEqual(["u-new", "u-old"]);
  });
});

describe("PreferencesService (store settings)", () => {
  const voice = { download: { kind: "needed" } as VoiceDownload, started: 0, removed: 0, cleared: 0 };
  function preferences(status: GatewayStatus = { listener: { kind: "listening" }, receiving: false }, pushed: Preferences[] = []) {
    return new PreferencesService({
      voice: {
        download: () => voice.download,
        sizeText: () => "350 MB",
        start: () => void voice.started++,
        remove: async () => void voice.removed++,
      },
      onAskHistoryCleared: () => void voice.cleared++,
      store: rig.store,
      platform,
      gatewayStatus: async () => status,
      pairedPhones: async () => 1,
      emit: (value) => pushed.push(value),
      log: rig.log,
    });
  }

  it("maps the handoff toggles to the gateway's HandoffSettings keys", async () => {
    const pushed: Preferences[] = [];
    const service = preferences(undefined, pushed);
    const initial = await service.get();
    expect(initial).toMatchObject({ requireMacClick: false, allowQR: true, allowMacApproval: true, retentionDays: 90, listener: { text: "Listening for your phone" } });
    await service.setHandoff({ requireMacClick: true, allowQR: false });
    expect(loadHandoffSettings(rig.store.settings)).toMatchObject({ requireMacClick: true, allowQr: false, allowMacApproval: true });
    expect(rig.store.settings.get(HANDOFF_SETTING_KEYS.requireMacClick)).toBe("true");
    expect(pushed.at(-1)).toMatchObject({ requireMacClick: true, allowQR: false });
  });

  it("clamps audio retention and keeps it in the store", async () => {
    const service = preferences();
    expect((await service.setRetentionDays(0)).preferences.retentionDays).toBe(1);
    expect((await service.setRetentionDays(99_999)).preferences.retentionDays).toBe(3650);
    expect((await service.setRetentionDays(30.4)).preferences.retentionDays).toBe(30);
    expect(rig.store.settings.get(HANDOFF_SETTING_KEYS.retentionDays)).toBe("30");
  });

  it("counts the outbox and Ask threads, clears Ask history and reports the LANA voice download", async () => {
    await receiveGoldenMeeting(rig);
    rig.store.ask.save("t1", null, new Uint8Array([1]));
    const service = preferences({ listener: { kind: "failed", message: "Port in use" }, receiving: false });
    const before = await service.get();
    expect(before.pendingOutbox).toBeGreaterThan(0);
    expect(before.askThreadCount).toBe(1);
    expect(before.listenerError).toBe("Port in use");
    expect(before.voice).toMatchObject({ download: { kind: "needed" }, downloadSizeText: "350 MB" });
    expect((await service.clearAskHistory()).preferences.askThreadCount).toBe(0);
    expect(voice.cleared).toBe(1);
    await service.downloadVoice();
    voice.download = { kind: "downloading", progress: 0.5 };
    expect((await service.removeVoiceDownload()).preferences.voice.download).toEqual({ kind: "downloading", progress: 0.5 });
    expect([voice.started, voice.removed]).toEqual([1, 1]);
  });

  it("purges audio past the retention period", async () => {
    await receiveGoldenMeeting(rig);
    const service = preferences();
    await service.setRetentionDays(1);
    rig.clock.advance(3 * 86_400);
    service.startRetention();
    service.stopRetention();
    expect(rig.store.meetings.list()[0]?.audioAvailable).toBe(false);
  });
});

describe("UserNotesService (scratch pad on received meetings)", () => {
  it("round trips notes through the sealed meeting record, dropping empty ones and cutting long ones", async () => {
    const opened = await receiveGoldenMeeting(rig);
    const service = new UserNotesService(rig.store, "computer", rig.log, () => new Date("2026-11-01T10:00:00.000Z"));
    const kept = opened.meeting.userNotes[0];
    const long = "a".repeat(10_050);
    const result = await service.save(opened.meeting.id, [
      { id: kept?.id ?? "x", text: kept?.text ?? "", createdAt: "2020-01-01T00:00:00.000Z", anchor: kept?.anchor ?? null },
      { id: "note-new", text: "Call the client back", createdAt: "2026-11-01T09:59:00.000Z", anchor: 12.5 },
      { id: "note-empty", text: "   ", createdAt: "2026-11-01T09:59:00.000Z", anchor: null },
      { id: "note-long", text: long, createdAt: "2026-11-01T09:59:00.000Z", anchor: null },
    ]);
    expect(result).toEqual({ ok: true, value: null });
    // The shared record keeps notes in a fixed order (created time, then id) on both devices.
    const notes = rig.store.meetings.get(opened.meeting.id).userNotes;
    expect(notes.map((note) => note.id)).toEqual(["note-long", "note-new", kept?.id]);
    expect(notes[2]?.createdAt).toEqual(kept?.createdAt);
    expect(notes[1]).toMatchObject({ text: "Call the client back", anchor: 12.5 });
    expect(notes[0]?.text.length).toBe(10_000);
    expect(rig.log.lines.join("\n")).not.toContain("Call the client");
  });

  it("refuses unknown meetings", async () => {
    const service = new UserNotesService(rig.store, "computer", rig.log);
    expect(await service.save("mtg_01JCQ8Y6Q2W0000000000000AA", [])).toMatchObject({ ok: false, error: { code: "notFound", message: "That meeting is no longer on this computer." } });
    expect(await service.save("not-an-id", [])).toMatchObject({ ok: false, error: { code: "notFound" } });
  });
});
