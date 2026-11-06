/**
 * The Briefs bridge for the LANA client's preload: exactly the typed bridge in
 * `shared/api.ts`, exposed as `window.lanaBriefs` (no ipcRenderer, no Node). Main accepts
 * calls only from the client's own pages and only while Briefs is on for the firm.
 */
import type { ContextBridge, IpcRenderer, IpcRendererEvent } from "electron";
import { ALL_API_METHODS, CAPTURE_PAGE, channelName, EVENT_CHANNEL, RECORDING_FRAME_CHANNEL, RECORDING_LEVELS_CHANNEL, TALK_FRAME_CHANNEL } from "../shared/api.js";
import type { LanaBridge, LanaEvent, RecordingFrame, RecordingStart } from "../shared/api.js";
import { importRecording } from "./recording/importAudio.js";
import { startRecordingAudio } from "./recording/recordingAudio.js";
import { startTonePlayer } from "./tonePlayer.js";

type Namespace = keyof typeof ALL_API_METHODS;

export const BRIEFS_GLOBAL = "lanaBriefs";
/** Answered by the client (electron-briefs.js) whether or not Briefs runs. */
export const RUNNING_CHANNEL = "briefs:running";

export function buildBriefsBridge(ipcRenderer: Pick<IpcRenderer, "invoke" | "on" | "removeListener" | "send">): LanaBridge {
  const namespaces = Object.fromEntries(
    (Object.keys(ALL_API_METHODS) as Namespace[]).map((namespace) => {
      const methods: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
      for (const method of ALL_API_METHODS[namespace] as readonly string[]) {
        const channel = channelName(namespace, method);
        methods[method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
      }
      return [namespace, Object.freeze(methods)];
    }),
  );
  const bridge = {
    ...namespaces,
    onEvent(listener: (event: LanaEvent) => void): () => void {
      const handler = (_event: IpcRendererEvent, payload: LanaEvent) => listener(payload);
      ipcRenderer.on(EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(EVENT_CHANNEL, handler);
    },
    sendTalkFrame(frame: Float32Array): void {
      if (frame instanceof Float32Array) ipcRenderer.send(TALK_FRAME_CHANNEL, frame);
    },
    sendRecordingFrame(frame: RecordingFrame): void {
      if (frame.mic instanceof Float32Array && frame.system instanceof Float32Array) ipcRenderer.send(RECORDING_FRAME_CHANNEL, frame);
    },
    importRecording(bytes: ArrayBuffer, request: RecordingStart) {
      if (!(bytes instanceof ArrayBuffer)) return Promise.resolve({ ok: false, error: { code: "unreadable", message: "LANA could not read that file." } });
      return importRecording(bridge, bytes, request);
    },
  } as unknown as LanaBridge;
  return bridge;
}

/** Whether this page is the hidden capture page the host opens while a recording is live. */
export function isCapturePage(pathname: string): boolean {
  return pathname.endsWith(`/${CAPTURE_PAGE}`);
}

/**
 * Exposes the bridge, and plays the phone's proximity tone from this page while Briefs runs:
 * a paired phone checks the computer is nearby by hearing it, so some page must play it. The
 * player switches on only when Briefs answers (it runs only for firms that have it), so pages
 * without Briefs open no audio output.
 */
export function exposeBriefsBridge(
  contextBridge: Pick<ContextBridge, "exposeInMainWorld">,
  ipcRenderer: Pick<IpcRenderer, "invoke" | "on" | "removeListener" | "send">,
  startTone: (bridge: LanaBridge) => void = (bridge) => void startTonePlayer(bridge),
  pathname: string = typeof location === "undefined" ? "" : location.pathname,
  startCapture: (bridge: LanaBridge, publish: (levels: { mic: number; meeting: number }) => void) => void = (bridge, publish) => void startRecordingAudio(bridge, publish),
): void {
  const bridge = buildBriefsBridge(ipcRenderer);
  if (isCapturePage(pathname)) {
    // The capture page shows nothing and exposes nothing: it records, and sends the levels
    // for the pages' meters. It plays no tone (the visible pages do).
    startCapture(bridge, (levels) => ipcRenderer.send(RECORDING_LEVELS_CHANNEL, levels));
    return;
  }
  contextBridge.exposeInMainWorld(BRIEFS_GLOBAL, bridge);
  ipcRenderer.invoke(RUNNING_CHANNEL).then(
    (running: unknown) => {
      if (running === true) startTone(bridge);
    },
    () => undefined,
  );
}
