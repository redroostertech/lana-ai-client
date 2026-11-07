import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { BleHelperProcess } from "./bleWakeAdvertiser.js";

// Where the helper lives is the client's to say (electron-briefs.js): resources/briefs in the
// packaged app, build/briefs in development.

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
