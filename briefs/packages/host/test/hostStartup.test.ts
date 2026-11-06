import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Review finding (partial start): a start that fails after the phone gateway opened must
// undo everything it installed (permission handlers, the audio scheme, IPC) and close the
// gateway, so nothing keeps listening and the next start is clean.

const runtime = { close: vi.fn(async () => undefined), recheckAccess: vi.fn(), restore: vi.fn(async () => undefined), store: { appendAudit: vi.fn(async () => undefined) } };
let servicesFail = false;

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }));
vi.mock("../src/main/gateway/gatewayRuntime.js", () => ({
  openGatewayRuntime: vi.fn(async () => runtime),
  StartupError: class StartupError extends Error {},
}));
vi.mock("../src/main/services/realServices.js", () => ({
  createRealServices: vi.fn(() => {
    if (servicesFail) throw new Error("store locked");
    return {
      services: {},
      audio: { handle: vi.fn() },
      talk: { end: vi.fn(async () => undefined), appResignedActive: vi.fn() },
      talkAudio: { frame: vi.fn() },
      recording: { frame: vi.fn() },
      start: vi.fn(),
      stop: vi.fn(),
    };
  }),
}));
vi.mock("../src/main/ipc.js", () => ({
  EventHub: class { add() {} emit() {} },
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
    shell: { openExternal: vi.fn() },
    dialog: { showSaveDialog: vi.fn() },
    safeStorage: {},
  };
}

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "briefs-host-"));
  vi.clearAllMocks();
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

function start(electron: ReturnType<typeof electronFakes>) {
  return startBriefsHost({
    electron: electron as never,
    directory: folder,
    isTrustedURL: () => true,
    engineBase: () => null,
    session: () => null,
    speechPackages: [],
    transcriptionWorker: join(folder, "worker.cjs"),
    bleHelper: null,
    showWindow: () => undefined,
    quit: () => undefined,
    applyTheme: () => undefined,
    documentsPath: folder,
  });
}

describe("Briefs host startup", () => {
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
    expect(vi.mocked(ipcMain.removeListener)).toHaveBeenCalledTimes(2);
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("records an import from the standalone app in the audit log once, with no ids; a folder not imported records nothing (control)", async () => {
    servicesFail = false;
    const plain = await start(electronFakes());
    await plain.stop();
    expect(runtime.store.appendAudit).not.toHaveBeenCalled();
    writeFileSync(join(folder, ".imported-from-standalone.json"), JSON.stringify({ importedAt: "2026-11-05T12:00:00Z", from: "standalone", audited: false }));
    const first = await start(electronFakes());
    await first.stop();
    const again = await start(electronFakes());
    await again.stop();
    expect(runtime.store.appendAudit).toHaveBeenCalledTimes(1);
    expect(runtime.store.appendAudit).toHaveBeenCalledWith("store.imported", "standalone");
    expect(JSON.parse(readFileSync(join(folder, ".imported-from-standalone.json"), "utf8")).audited).toBe(true);
  });
});
