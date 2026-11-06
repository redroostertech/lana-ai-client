/**
 * The Briefs bridge for the LANA client's preload: exactly the typed bridge in
 * `shared/api.ts`, exposed as `window.lanaBriefs` (no ipcRenderer, no Node). Main accepts
 * calls only from the client's own pages and only while Briefs is on for the firm.
 */
import type { ContextBridge, IpcRenderer, IpcRendererEvent } from "electron";
import { ALL_API_METHODS, channelName, EVENT_CHANNEL, RECORDING_FRAME_CHANNEL, TALK_FRAME_CHANNEL } from "../shared/api.js";
import type { LanaBridge, LanaEvent, RecordingFrame } from "../shared/api.js";
import { startTonePlayer } from "./tonePlayer.js";

type Namespace = keyof typeof ALL_API_METHODS;

export const BRIEFS_GLOBAL = "lanaBriefs";

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
  return {
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
  } as unknown as LanaBridge;
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
): void {
  const bridge = buildBriefsBridge(ipcRenderer);
  contextBridge.exposeInMainWorld(BRIEFS_GLOBAL, bridge);
  bridge.access.state().then(
    () => startTone(bridge),
    () => undefined,
  );
}
