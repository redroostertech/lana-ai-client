import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "../crypto/random.js";
import { toHex } from "../bytes/hex.js";

/**
 * The store's files next to the database: sealed audio (`audio/<meeting>-<index>.bin`)
 * and staged bundle parts (`staging/<bundle>/<index>.part`), the same layout as Swift.
 * Writes are atomic and owner-only.
 */
export class StoreFiles {
  readonly audioDirectory: string;
  readonly stagingDirectory: string;

  constructor(readonly directory: string) {
    this.audioDirectory = join(directory, "audio");
    this.stagingDirectory = join(directory, "staging");
    for (const path of [directory, this.audioDirectory, this.stagingDirectory]) mkdirSync(path, { recursive: true, mode: 0o700 });
  }

  audioFileName(meetingID: string, index: number): string {
    return `${meetingID}-${index}.bin`;
  }

  audioPath(meetingID: string, index: number): string {
    return join(this.audioDirectory, this.audioFileName(meetingID, index));
  }

  stagingFolder(bundleID: string): string {
    return join(this.stagingDirectory, bundleID);
  }

  stagingPath(bundleID: string, index: number): string {
    return join(this.stagingFolder(bundleID), `${index}.part`);
  }

  /** Parts already on disk for a bundle, by index (Swift `storedParts`). */
  stagedParts(bundleID: string): Map<number, Uint8Array> {
    const parts = new Map<number, Uint8Array>();
    let names: string[];
    try {
      names = readdirSync(this.stagingFolder(bundleID));
    } catch {
      return parts;
    }
    for (const name of names) {
      if (!name.endsWith(".part")) continue;
      const stem = name.slice(0, -5);
      if (!/^[+-]?\d+$/.test(stem)) continue;
      const data = readOptional(join(this.stagingFolder(bundleID), name));
      if (data !== null) parts.set(Number(stem), data);
    }
    return parts;
  }

  clearStaging(bundleID: string): void {
    rmSync(this.stagingFolder(bundleID), { recursive: true, force: true });
  }

  remove(path: string): void {
    rmSync(path, { force: true });
  }

  read(path: string): Uint8Array | null {
    return readOptional(path);
  }

  /** Atomic write (temp file, then rename), readable by the owner only. */
  writeProtected(path: string, data: Uint8Array): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${toHex(randomBytes(6))}.tmp`;
    try {
      writeFileSync(temporary, data, { mode: 0o600 });
      renameSync(temporary, path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}

function readOptional(path: string): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return null;
  }
}
