import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Reads the LANA client's sign-in token without touching the client's files. The client's
 * own settings module deletes its settings file when it cannot read it, and its token store
 * deletes the token when it cannot decrypt it, so this loads neither: it copies the settings
 * file to a temporary folder, opens the copy, decrypts the token in memory, and removes the
 * copy. Any failure is null. Never logs anything it reads.
 */
export interface ClientTokenDeps {
  /** The client's data folder (holds `server-config.json`). */
  readonly userData: string;
  /** `conf` (what electron-store is built on), opened on the copy only. */
  readonly Conf: new (options: { cwd: string; configName: string; projectName: string; encryptionKey: string; clearInvalidConfig: boolean }) => { get(key: string): unknown };
  readonly decrypt: (ciphertext: Buffer) => string;
  /** Tests: where the copy goes. */
  readonly tempRoot?: string;
}

/** The client's settings file key: the same formula as electron-storage.js `generateEncryptionKey`. */
export function clientSettingsKey(host = hostname(), home = homedir()): string {
  return createHash("sha256").update(`${host}-${home}-lana-ai-client-stable`).digest("hex");
}

/** Why a read gave nothing, for the tool's message: a state, never a value. */
export type ClientTokenFailure = "noSettingsFile" | "settingsUnreadable" | "noToken" | "tokenUnreadable";

export function readClientToken(deps: ClientTokenDeps, onFailure: (reason: ClientTokenFailure) => void = () => undefined): string | null {
  const original = join(deps.userData, "server-config.json");
  if (!existsSync(original)) return (onFailure("noSettingsFile"), null);
  const copy = mkdtempSync(join(deps.tempRoot ?? tmpdir(), "lana-token-read-"));
  try {
    copyFileSync(original, join(copy, "server-config.json"));
    let store: { get(key: string): unknown };
    try {
      store = new deps.Conf({ cwd: copy, configName: "server-config", projectName: "lana-briefs-import", encryptionKey: clientSettingsKey(), clearInvalidConfig: false });
    } catch {
      return (onFailure("settingsUnreadable"), null);
    }
    const encrypted = store.get("authTokenEncrypted");
    if (typeof encrypted !== "string" || encrypted === "") return (onFailure("noToken"), null);
    try {
      const token = deps.decrypt(Buffer.from(encrypted, "base64"));
      return token.length > 0 ? token : (onFailure("tokenUnreadable"), null);
    } catch {
      return (onFailure("tokenUnreadable"), null);
    }
  } catch {
    return (onFailure("settingsUnreadable"), null);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
