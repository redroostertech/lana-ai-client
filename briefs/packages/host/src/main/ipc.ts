import { ipcMain } from "electron";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { ALL_API_METHODS, channelName, EVENT_CHANNEL } from "../shared/api.js";
import type { AllLanaServices, LanaEvent } from "../shared/api.js";
import type { ShutdownGate } from "./shutdownGate.js";

type Namespace = keyof typeof ALL_API_METHODS;
type Handler = (...args: unknown[]) => Promise<unknown>;

/**
 * Registers one `ipcMain.handle` channel per bridge method. Calls are accepted only from
 * the app's own renderer (`isTrustedSender`), never from other frames or origins. With a
 * `gate`, calls made after shutdown began resolve to `SHUTTING_DOWN`.
 */
export function registerServices(services: AllLanaServices, isTrustedSender: (event: IpcMainInvokeEvent) => boolean, gate?: ShutdownGate): () => void {
  const channels: string[] = [];
  for (const namespace of Object.keys(ALL_API_METHODS) as Namespace[]) {
    const target = services[namespace] as unknown as Record<string, Handler>;
    for (const method of ALL_API_METHODS[namespace] as readonly string[]) {
      const channel = channelName(namespace, method);
      const handler = target[method];
      if (typeof handler !== "function") throw new Error(`Bridge method ${channel} has no implementation`);
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (!isTrustedSender(event)) throw new Error("Untrusted sender");
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
