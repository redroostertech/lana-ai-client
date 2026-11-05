import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { BleHelperProcess } from "./bleWakeAdvertiser.js";

export const BLE_HELPER_NAME = "LanaBleWake";

/**
 * Where the helper lives: next to the app's resources when packaged (electron-builder
 * `extraResources`), or the local Swift build in development. Null off macOS (Windows helper: P5).
 */
export function bleHelperPath(input: { readonly platform: NodeJS.Platform; readonly isPackaged: boolean; readonly resourcesPath: string; readonly appPath: string }): string | null {
  if (input.platform !== "darwin") return null;
  const path = input.isPackaged
    ? join(input.resourcesPath, BLE_HELPER_NAME)
    : join(input.appPath, "..", "native", "macos", "ble-wake-helper", ".build", "release", BLE_HELPER_NAME);
  return existsSync(path) ? path : null;
}

/** Starts the helper at `path` with piped stdio. Its stderr is ignored (it logs nothing sensitive, ids only). */
export function spawnBleHelper(path: string): BleHelperProcess {
  const child = spawn(path, [], { stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout });
  // A helper that cannot start or a closed pipe ends as an exit, never an unhandled error.
  child.stdin.on("error", () => undefined);
  return {
    write: (line) => void child.stdin.write(line),
    onLine: (listener) => void lines.on("line", listener),
    onExit: (listener) => {
      child.on("exit", () => listener());
      child.on("error", () => listener());
    },
    kill: () => void child.kill(),
  };
}
