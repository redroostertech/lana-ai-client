/**
 * LANA Briefs inside the LANA client: the main-process host (Briefs integration plan,
 * phase 1). The client starts it when the organization's discovery `enabled_apps` lists
 * `lana-notes` and stops it when that goes away. It has no window or tray of its own: the
 * client's windows are its windows, and its pages reach it through `window.lanaBriefs`.
 *
 * It owns what the standalone app's main process owned: the KeyVault (safeStorage), the
 * HandoffGateway (phone pairing and sync), the store-backed services and the typed IPC
 * bridge (`briefs:` channels). Every language model call goes to LANA's runtime
 * (`lanaRuntime`): LANA picks the model and applies the matter's AI policy.
 */
import type { App, Dialog, DesktopCapturer, IpcMainEvent, Protocol, SafeStorage, Session, Shell, SystemPreferences, WebContents } from "electron";
import { ipcMain } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_EVENTS } from "@lana/core/store";
import { IMPORT_MARKER } from "./import/standaloneImport.js";
import { pathToFileURL } from "node:url";
import { RECORDING_FRAME_CHANNEL, TALK_FRAME_CHANNEL, type AccessStatus, type LanaEvent, type PlatformInfo, type RecordingFrame, type RecordingPermissions, type ThemePreference } from "../shared/api.js";
import { openGatewayRuntime, StartupError, type GatewayRuntime } from "./gateway/gatewayRuntime.js";
import { EventHub, registerServices } from "./ipc.js";
import { createMainLog, type MainLog } from "./log.js";
import { AUDIO_SCHEME } from "./services/meetingAudio.js";
import { createRealServices } from "./services/realServices.js";
import type { ClientSessionSnapshot } from "./gateway/clientSession.js";
import type { SpeechModelPackage } from "@lana/core/model";
import { spawnBleHelper } from "./services/bleWake/bleHelperProcess.js";
import { WorkerTranscription } from "./services/recording/workerTranscription.js";
import { SHUTDOWN_DRAIN_MS, ShutdownGate } from "./shutdownGate.js";

// The replay audio scheme (AUDIO_SCHEME) is registered by the client before the app is ready
// (electron-briefs.js registerBriefsSchemes), without loading this module.

export interface BriefsHostOptions {
  readonly electron: {
    readonly app: Pick<App, "getVersion">;
    readonly session: Session;
    readonly protocol: Pick<Protocol, "handle" | "unhandle">;
    readonly desktopCapturer: Pick<DesktopCapturer, "getSources">;
    readonly systemPreferences: Pick<SystemPreferences, "getMediaAccessStatus" | "askForMediaAccess">;
    readonly shell: Pick<Shell, "openExternal">;
    readonly dialog: Pick<Dialog, "showSaveDialog">;
    readonly safeStorage: SafeStorage;
  };
  /** Briefs' own folder inside the client's userData: keys, the store, logs and speech models. */
  readonly directory: string;
  /** The client's own pages: only they may call Briefs, open the microphone or record meeting audio. */
  readonly isTrustedURL: (url: string) => boolean;
  /** The local AI engine's address while it is in use, else null: every language model call goes to its runtime route. */
  readonly engineBase: () => string | null;
  /** The LANA client's session, read when needed. There is one session: Briefs has no sign-in of its own. */
  readonly session: () => ClientSessionSnapshot | null;
  /** The speech packages from the LANA client's model catalog (electron-local-models.js speechPackages()). */
  readonly speechPackages: readonly SpeechModelPackage[];
  /** The bundled transcription worker script (a file path). */
  readonly transcriptionWorker: string;
  /** The macOS Bluetooth wake helper, or null where there is none. */
  readonly bleHelper: string | null;
  readonly showWindow: () => void;
  readonly quit: () => void;
  readonly applyTheme: (theme: ThemePreference) => void;
  /** For the Phone settings: the documents folder the audit export suggests. */
  readonly documentsPath: string;
}

export interface BriefsHost {
  /** A client window that shows Briefs pages: it gets Briefs' events. */
  addWebContents(contents: WebContents): void;
  /** The window came forward. */
  focused(): void;
  /** The client's session changed (sign-in, a refreshed token): read it again. */
  sessionChanged(): void;
  /** The person's session ended (sign-out, another person): revokes the phones' background leases. Call before stop. */
  endSession(): Promise<void>;
  /** A window went to the background: Talk ends there only when Settings says so. */
  blurred(): void;
  /** Reads the client's session and opens the phone gateway. Call once a client window has loaded. */
  restore(): Promise<void>;
  /** Stops IPC, drains calls in flight and closes the store. */
  stop(): Promise<void>;
}

/**
 * The first start after an import from the standalone app records it in the audit log (no
 * ids, no names), once: the marker says whether it was recorded.
 */
async function recordImport(directory: string, runtime: GatewayRuntime, log: MainLog): Promise<void> {
  const marker = join(directory, IMPORT_MARKER);
  if (!existsSync(marker)) return;
  try {
    const state = JSON.parse(readFileSync(marker, "utf8")) as { audited?: boolean };
    if (state.audited === true) return;
    await runtime.store.appendAudit(AUDIT_EVENTS.storeImported, "standalone");
    writeFileSync(marker, JSON.stringify({ ...state, audited: true }), { mode: 0o600 });
    log.info("import.recorded");
  } catch {
    log.error("import.record_failed");
  }
}

export class BriefsHostStartupError extends Error {
  override readonly name = "BriefsHostStartupError";
}

/**
 * Starts the Briefs host. Throws `BriefsHostStartupError` with a message for a person when
 * the keystore, identity or store cannot be opened.
 */
export async function startBriefsHost(options: BriefsHostOptions): Promise<BriefsHost> {
  const { electron } = options;
  const log: MainLog = createMainLog(join(options.directory, "logs"));
  const hub = new EventHub();
  const gate = new ShutdownGate();
  let derive: ((event: LanaEvent) => void) | null = null;
  const emit = (event: LanaEvent): void => {
    hub.emit(event);
    derive?.(event);
  };
  const derived = async <T>(read: () => Promise<T>, push: (value: T) => void): Promise<void> => {
    try {
      const value = await gate.run(read);
      if (!gate.isClosing) push(value as T);
    } catch {
      log.error("derive.failed");
    }
  };
  const platform: PlatformInfo = {
    os: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux",
    deviceNoun: "computer",
    appVersion: electron.app.getVersion(),
    isDemo: false,
    features: { ask: true, talk: true },
  };

  let runtime: GatewayRuntime;
  try {
    log.info("startup.host", { version: platform.appVersion, os: process.platform });
    runtime = await openGatewayRuntime({ userData: options.directory, safeStorage: electron.safeStorage, emit: (event) => emit(event), log, session: options.session });
  } catch (error) {
    if (error instanceof StartupError) throw new BriefsHostStartupError(error.message);
    log.error("startup.failed", { error: error instanceof Error ? error.name : "unknown" });
    throw new BriefsHostStartupError("LANA Briefs could not start its services on this computer.");
  }

  await recordImport(options.directory, runtime, log);

  // MARK: - Permissions (only while Briefs is on)

  let meetingAudioArmed = false;
  const accessStatus = (media: "microphone" | "screen"): AccessStatus => {
    if (process.platform !== "darwin" && process.platform !== "win32") return "unsupported";
    if (process.platform === "win32" && media === "screen") return "granted";
    const status = electron.systemPreferences.getMediaAccessStatus(media);
    if (status === "granted") return "granted";
    if (status === "denied" || status === "restricted") return "denied";
    return status === "not-determined" ? "notDetermined" : "unsupported";
  };
  const recordingPermissions = (): RecordingPermissions => ({ microphone: accessStatus("microphone"), meetingAudio: accessStatus("screen") });
  const requestMicrophone = async (): Promise<boolean> => {
    if (process.platform === "darwin") {
      const status = electron.systemPreferences.getMediaAccessStatus("microphone");
      if (status === "granted") return true;
      if (status === "not-determined") return electron.systemPreferences.askForMediaAccess("microphone");
      return false;
    }
    if (process.platform === "win32") return electron.systemPreferences.getMediaAccessStatus("microphone") !== "denied";
    return true;
  };
  const openPrivacySettings = async (kind: "microphone" | "meetingAudio"): Promise<void> => {
    if (process.platform === "darwin") {
      await electron.shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${kind === "microphone" ? "Privacy_Microphone" : "Privacy_ScreenCapture"}`);
    } else if (process.platform === "win32") {
      await electron.shell.openExternal("ms-settings:privacy-microphone");
    }
  };
  // Everything installed below is undone in reverse order: by stop(), or at once when the
  // start fails partway, so a failed start never leaves a gateway, handler or channel behind.
  const undo: Array<() => void> = [];
  const undoAll = (): void => {
    for (const step of undo.splice(0).reverse()) {
      try {
        step();
      } catch {
        log.error("shutdown.undo_failed");
      }
    }
  };

  try {
    // The client had no permission handler: Electron's default grants everything. These keep
    // that for every permission but media, and grant media (the microphone for dictation, Talk
    // and recording) only to the client's own pages.
    electron.session.setPermissionRequestHandler((_contents, permission, callback, details) => {
      if (permission !== "media") return callback(true);
      const media = details as { requestingUrl?: string };
      callback(options.isTrustedURL(media.requestingUrl ?? ""));
    });
    electron.session.setPermissionCheckHandler((_contents, permission, origin) => (permission === "media" ? options.isTrustedURL(origin) : true));
    // Meeting audio (everyone else in the call): display-media capture with loopback audio, only
    // for the client's own pages and only while a recording is starting. The page stops the
    // screen's video track at once and keeps the audio.
    electron.session.setDisplayMediaRequestHandler((request, callback) => {
      const deny = () => callback({});
      if (!meetingAudioArmed || !options.isTrustedURL(request.frame?.url ?? "")) return deny();
      electron.desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } }).then(
        (sources) => (sources[0] === undefined ? deny() : callback({ video: sources[0], audio: "loopback" })),
        () => deny(),
      );
    });
    // Back to the client's own behavior: no handlers (Electron's defaults).
    undo.push(() => {
      electron.session.setPermissionRequestHandler(null);
      electron.session.setPermissionCheckHandler(null);
      electron.session.setDisplayMediaRequestHandler(null);
    });

    // MARK: - Services

    const created = createRealServices({
      runtime,
      // LANA's runtime, with the one session's token.
      lanaRuntime: { engineBase: () => options.engineBase(), token: () => options.session()?.token ?? null },
      platform,
      emit: (event) => emit(event),
      log,
      applyTheme: options.applyTheme,
      pickSavePath: async (suggestedName) => {
        const result = await electron.dialog.showSaveDialog({ title: "Export audit log", defaultPath: join(options.documentsPath, suggestedName), filters: [{ name: "JSON Lines", extensions: ["jsonl"] }] });
        return result.canceled || !result.filePath ? null : result.filePath;
      },
      showWindow: options.showWindow,
      quit: options.quit,
      legacyWalkthroughFile: null,
      rendered: () => undefined,
      modelsDirectory: join(options.directory, "Models"),
      speechPackages: options.speechPackages,
      requestMicrophone,
      recording: {
        permissions: recordingPermissions,
        openPrivacySettings,
        armMeetingAudio: (armed) => {
          meetingAudioArmed = armed;
        },
        transcription: new WorkerTranscription(pathToFileURL(options.transcriptionWorker)),
      },
      bleHelper: () => (options.bleHelper === null ? null : spawnBleHelper(options.bleHelper)),
    });
    undo.push(() => {
      void created.talk.end();
      created.stop();
    });

    const isTrustedSender = (event: { readonly senderFrame?: { readonly url: string } | null }): boolean => options.isTrustedURL(event.senderFrame?.url ?? "");
    const onRecordingFrame = (event: IpcMainEvent, frame: RecordingFrame): void => {
      if (isTrustedSender(event) && typeof frame === "object" && frame !== null) created.recording.frame(frame);
    };
    const onTalkFrame = (event: IpcMainEvent, frame: unknown): void => {
      if (isTrustedSender(event) && frame instanceof Float32Array) created.talkAudio.frame(frame);
    };
    ipcMain.on(RECORDING_FRAME_CHANNEL, onRecordingFrame);
    ipcMain.on(TALK_FRAME_CHANNEL, onTalkFrame);
    undo.push(() => {
      ipcMain.removeListener(RECORDING_FRAME_CHANNEL, onRecordingFrame);
      ipcMain.removeListener(TALK_FRAME_CHANNEL, onTalkFrame);
    });
    derive = (event) => {
      if (event.type === "meetingReceived") {
        const { inbox } = created.services;
        void derived(async () => ({ pending: await inbox.pendingCount(), unread: await inbox.unreadCount() }), (counts) => emit({ type: "inbox", ...counts }));
      }
      if (event.type === "gateway") void derived(() => created.services.preferences.get(), (preferences) => emit({ type: "preferences", preferences }));
    };
    undo.push(() => {
      derive = null;
    });
    electron.protocol.handle(AUDIO_SCHEME, (request) => created.audio.handle(request.url, request.headers.get("range")));
    undo.push(() => electron.protocol.unhandle(AUDIO_SCHEME));
    undo.push(registerServices(created.services, isTrustedSender, gate));
    created.start();
    log.info("startup.host_ready");

    let stopped: Promise<void> | null = null;
    return {
      addWebContents: (contents) => hub.add(contents),
      focused: () => runtime.sessionChanged(),
      sessionChanged: () => runtime.sessionChanged(),
      endSession: () => runtime.endSession(),
      blurred: () => created.talk.appResignedActive(),
      restore: () => runtime.restore(),
      stop() {
        stopped ??= (async () => {
          log.info("shutdown.closing");
          gate.close();
          undoAll();
          try {
            await gate.drain(SHUTDOWN_DRAIN_MS);
            await runtime.close();
          } catch {
            log.error("shutdown.close_failed");
          }
        })();
        return stopped;
      },
    };
  } catch (error) {
    log.error("startup.failed", { error: error instanceof Error ? error.name : "unknown", stage: "services" });
    gate.close();
    undoAll();
    await runtime.close().catch(() => log.error("shutdown.close_failed"));
    throw new BriefsHostStartupError("LANA Briefs could not start its services on this computer.");
  }
}

export { importStandalone, standaloneSources, type StandaloneImportOutcome } from "./import/standaloneImport.js";
export { safeStorageSealer } from "@lana/core/keys";
