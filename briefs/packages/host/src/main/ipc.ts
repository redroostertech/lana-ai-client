import { ipcMain } from "electron";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { ALL_API_METHODS, channelName, EVENT_CHANNEL } from "../shared/api.js";
import type { AllLanaServices, LanaEvent } from "../shared/api.js";
import type { ShutdownGate } from "./shutdownGate.js";

type Namespace = keyof typeof ALL_API_METHODS;
type Handler = (...args: unknown[]) => Promise<unknown>;

/** The parts of an IPC event the sender check reads. */
export interface SenderEvent {
  readonly senderFrame?: { readonly url: string; readonly parent?: unknown } | null;
}

/**
 * The sender check for every Briefs channel: the top frame of a page whose URL the client
 * trusts (its shared guard's app-page check, electron-ipc-guard.js). A frame inside a page,
 * even one of the app's own, is refused: the preload runs only in the top frame.
 */
export function trustedTopFrame(isTrustedURL: (url: string) => boolean): (event: SenderEvent) => boolean {
  return (event) => {
    const frame = event.senderFrame;
    if (!frame || frame.parent) return false;
    return isTrustedURL(frame.url ?? "");
  };
}

/**
 * Registers one `ipcMain.handle` channel per bridge method. Calls are accepted only from
 * the app's own renderer (`isTrustedSender`), never from other frames or origins. With a
 * `gate`, calls made after shutdown began resolve to `SHUTTING_DOWN`.
 */
/** A size limit for bridge calls: the client's measure (electron-ipc-guard.js payloadBytes) and its maximum. */
export interface CallSizeLimit {
  readonly measure: (value: unknown, stopAt?: number) => number;
  readonly maxBytes: number;
}

export function registerServices(services: AllLanaServices, isTrustedSender: (event: IpcMainInvokeEvent) => boolean, gate?: ShutdownGate, limit?: CallSizeLimit): () => void {
  const channels: string[] = [];
  for (const namespace of Object.keys(ALL_API_METHODS) as Namespace[]) {
    const target = services[namespace] as unknown as Record<string, Handler>;
    for (const method of ALL_API_METHODS[namespace] as readonly string[]) {
      const channel = channelName(namespace, method);
      const handler = target[method];
      if (typeof handler !== "function") throw new Error(`Bridge method ${channel} has no implementation`);
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (!isTrustedSender(event)) throw new Error("Untrusted sender");
        if (limit !== undefined && limit.measure(args, limit.maxBytes) > limit.maxBytes) throw new Error("Too large");
        // Once shutdown began, calls resolve to SHUTTING_DOWN instead of reading a closing store.
        return gate === undefined ? handler.apply(target, args) : gate.run(() => handler.apply(target, args));
      });
      channels.push(channel);
    }
  }
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}

/** Pushes events to every live window. */
export class EventHub {
  private readonly targets = new Set<WebContents>();

  /** Adding a window twice is a no-op. */
  add(contents: WebContents): void {
    if (this.targets.has(contents)) return;
    this.targets.add(contents);
    contents.once("destroyed", () => this.targets.delete(contents));
  }

  emit(event: LanaEvent): void {
    for (const contents of this.targets) {
      if (!contents.isDestroyed()) contents.send(EVENT_CHANNEL, event);
    }
  }
}
