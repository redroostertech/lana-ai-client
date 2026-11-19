import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Review finding (partial start): a start that fails after the phone gateway opened must
// undo everything it installed (permission handlers, the audio scheme, IPC) and close the
// gateway, so nothing keeps listening and the next start is clean.

const runtime = { close: vi.fn(async () => undefined), recheckAccess: vi.fn(), restore: vi.fn(async () => undefined) };
let servicesFail = false;
const settingsSetTheme = vi.fn(async (theme: string) => ({ theme }));

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }));
vi.mock("../src/main/gateway/gatewayRuntime.js", () => ({
  openGatewayRuntime: vi.fn(async () => runtime),
  StartupError: class StartupError extends Error {},
}));
vi.mock("../src/main/services/realServices.js", () => ({
  createRealServices: vi.fn(() => {
    if (servicesFail) throw new Error("store locked");
    return {
      services: { settings: { setTheme: settingsSetTheme } },
      audio: { handle: vi.fn() },
      talk: { end: vi.fn(async () => undefined), appResignedActive: vi.fn() },
      talkAudio: { frame: vi.fn() },
      recording: { frame: vi.fn() },
      start: vi.fn(),
      stop: vi.fn(),
    };
  }),
}));
const hubEvents: unknown[] = [];
vi.mock("../src/main/ipc.js", async (importOriginal) => ({
  // The real sender check: the levels test below sends from a frame inside a page.
  trustedTopFrame: (await importOriginal<typeof import("../src/main/ipc.js")>()).trustedTopFrame,
  EventHub: class { add() {} emit(event: unknown) { hubEvents.push(event); } },
  registerServices: vi.fn(() => vi.fn()),
}));

const { startBriefsHost, BriefsHostStartupError } = await import("../src/main/host.js");
const { ipcMain } = await import("electron");

function electronFakes() {
  return {
    app: { getVersion: () => "0.0.0" },
    session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDisplayMediaRequestHandler: vi.fn() },
    protocol: { handle: vi.fn(), unhandle: vi.fn() },
    desktopCapturer: { getSources: vi.fn() },
    systemPreferences: { getMediaAccessStatus: vi.fn(), askForMediaAccess: vi.fn() },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
    dialog: { showSaveDialog: vi.fn() },
    safeStorage: {},
    createPrintWindow: vi.fn(),
  };
}

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "briefs-host-"));
  vi.clearAllMocks();
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

function start(electron: ReturnType<typeof electronFakes>, captureWindow?: { open(): void; close(): void }, extra: Record<string, unknown> = {}) {
  return startBriefsHost({
    ...(captureWindow ? { captureWindow } : {}),
    electron: electron as never,
    directory: folder,
    isTrustedURL: () => true,
    ...extra,
    engineBase: () => null,
    session: () => null,
    speechPackages: [],
    transcriptionWorker: join(folder, "worker.cjs"),
    bleHelper: null,
    showWindow: () => undefined,
    quit: () => undefined,
    applyTheme: () => undefined,
    documentsPath: folder,
    exportAssets: { stylesheet: join(folder, "print.css"), footerStylesheet: join(folder, "footer.css"), logo: join(folder, "logo.png") },
  });
}

describe("Briefs host permissions", () => {
  const APP_PAGE = "lana-app://app/public_html/briefs/index.html";
  const extra = (decide = vi.fn(() => true), restore = vi.fn()) => ({
    isTrustedURL: (url: string) => url.startsWith("lana-app://app/public_html/"),
    isTrustedOrigin: (origin: string) => origin === "lana-app://app",
    permissions: { decide, restore },
  });

  it("media: the app's pages by URL or by origin (the check handler gets lana-app://app); nothing else", async () => {
    servicesFail = false;
    const electron = electronFakes();
    const host = await start(electron, undefined, extra());
    const request = electron.session.setPermissionRequestHandler.mock.calls[0]![0] as (c: unknown, p: string, cb: (ok: boolean) => void, d: unknown) => void;
    const check = electron.session.setPermissionCheckHandler.mock.calls[0]![0] as (c: unknown, p: string, o: string, d: unknown) => boolean;
    const answer = (permission: string, url: string) => new Promise((resolve) => request({}, permission, resolve, { requestingUrl: url }));
    await expect(answer("media", APP_PAGE)).resolves.toBe(true);
    await expect(answer("media", "https://evil.example/")).resolves.toBe(false);
    expect(check({}, "media", "lana-app://app", {})).toBe(true);
    expect(check({}, "media", "lana-app://app", { requestingUrl: APP_PAGE })).toBe(true);
    expect(check({}, "media", "https://evil.example", {})).toBe(false);
    await host.stop();
  });

  it("other permissions are denied unless the client's own policy allows them, and stop restores the client's handlers", async () => {
    servicesFail = false;
    const electron = electronFakes();
    const decide = vi.fn((_c: unknown, permission: string) => permission === "notifications");
    const restore = vi.fn();
    const host = await start(electron, undefined, extra(decide, restore));
    const request = electron.session.setPermissionRequestHandler.mock.calls[0]![0] as (c: unknown, p: string, cb: (ok: boolean) => void, d: unknown) => void;
    const check = electron.session.setPermissionCheckHandler.mock.calls[0]![0] as (c: unknown, p: string, o: string, d: unknown) => boolean;
    await expect(new Promise((resolve) => request({}, "notifications", resolve, { requestingUrl: APP_PAGE }))).resolves.toBe(true);
    await expect(new Promise((resolve) => request({}, "clipboard-read", resolve, { requestingUrl: "https://evil.example/" }))).resolves.toBe(false);
    expect(check({}, "geolocation", "https://evil.example", {})).toBe(false);
    await host.stop();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("without the client's policy, every other permission is denied", async () => {
    servicesFail = false;
    const electron = electronFakes();
    const host = await start(electron);
    const check = electron.session.setPermissionCheckHandler.mock.calls[0]![0] as (c: unknown, p: string, o: string, d: unknown) => boolean;
    expect(check({}, "notifications", "https://evil.example", {})).toBe(false);
    await host.stop();
  });
});

describe("Briefs host startup", () => {
  it("setTheme saves the client's one appearance setting through Briefs' settings service", async () => {
    servicesFail = false;
    const host = await start(electronFakes());
    await host.setTheme("dark");
    expect(settingsSetTheme).toHaveBeenCalledWith("dark");
    await host.stop();
  });

  it("a start that fails after the gateway opened undoes its handlers and closes the gateway", async () => {
    servicesFail = true;
    const electron = electronFakes();
    await expect(start(electron)).rejects.toBeInstanceOf(BriefsHostStartupError);
    expect(electron.session.setPermissionRequestHandler).toHaveBeenLastCalledWith(null);
    expect(electron.session.setPermissionCheckHandler).toHaveBeenLastCalledWith(null);
    expect(electron.session.setDisplayMediaRequestHandler).toHaveBeenLastCalledWith(null);
    expect(electron.protocol.handle).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("a clean start installs everything and stop removes it all (control)", async () => {
    servicesFail = false;
    const electron = electronFakes();
    const host = await start(electron);
    expect(electron.protocol.handle).toHaveBeenCalledTimes(1);
    expect(runtime.close).not.toHaveBeenCalled();
    await host.stop();
    expect(electron.protocol.unhandle).toHaveBeenCalledTimes(1);
    expect(electron.session.setPermissionRequestHandler).toHaveBeenLastCalledWith(null);
    // Recording frames, recording levels (the capture window's meters) and Talk frames.
    expect(vi.mocked(ipcMain.removeListener).mock.calls.map(([channel]) => channel)).toEqual(["briefs:recording.frame", "briefs:recording.levels", "briefs:talk.frame"]);
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("opens the capture window while a recording is live, closes it once saved, and relays levels", async () => {
    servicesFail = false;
    hubEvents.length = 0;
    const capture = { open: vi.fn(), close: vi.fn() };
    const host = await start(electronFakes(), capture, { ipcLimits: { measure: (v: unknown) => JSON.stringify(v ?? null).length, bridgeCall: 1e6, recordingFrame: 1e6, recordingLevels: 1024, talkFrame: 1e6 } });
    const { createRealServices } = await import("../src/main/services/realServices.js");
    const emit = vi.mocked(createRealServices).mock.calls.at(-1)![0].emit;
    const view = (phase: string) => ({ type: "recording", view: { phase, meetingID: null, title: "", elapsedSeconds: 0, meetingAudio: "pending", progress: 0, message: null } }) as never;
    emit(view("starting"));
    emit(view("recording"));
    expect(capture.open).toHaveBeenCalledTimes(2);
    expect(capture.close).not.toHaveBeenCalled();
    emit(view("saving"));
    expect(capture.close).toHaveBeenCalledTimes(1);

    const levels = vi.mocked(ipcMain.on).mock.calls.find(([channel]) => channel === "briefs:recording.levels")![1] as (event: unknown, value: unknown) => void;
    levels({ senderFrame: { url: "file:///app/briefs/capture.html" } }, { mic: 0.5, meeting: 0 });
    levels({ senderFrame: { url: "file:///app/briefs/capture.html" } }, { mic: "loud" });
    // Over the size limit: ignored.
    levels({ senderFrame: { url: "file:///app/briefs/capture.html" } }, { mic: 0.7, meeting: 0.7, padding: "x".repeat(5000) });
    // A frame inside a page, or no frame at all, is not the app's page: ignored.
    levels({ senderFrame: { url: "file:///app/briefs/capture.html", parent: {} } }, { mic: 0.9, meeting: 0.9 });
    levels({ senderFrame: null }, { mic: 0.9, meeting: 0.9 });
    expect(hubEvents.filter((event) => (event as { type: string }).type === "recordingLevels")).toEqual([{ type: "recordingLevels", mic: 0.5, meeting: 0 }]);

    await host.stop();
    expect(capture.close).toHaveBeenCalledTimes(2);
  });
});
