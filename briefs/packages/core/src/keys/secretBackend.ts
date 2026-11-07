import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toHex } from "../bytes/hex.js";
import { randomBytes } from "../crypto/random.js";
import { KeyVaultError } from "./keyVaultError.js";

/** Raw storage for named secrets. Names are short ASCII labels such as `identity.mac`. */
export interface SecretBackend {
  read(name: string): Promise<Uint8Array | null>;
  /** Writes the secret, or deletes it when `data` is null. */
  write(name: string, data: Uint8Array | null): Promise<void>;
}

/** Process memory only. Tests and previews; never real credentials. */
export class InMemorySecretBackend implements SecretBackend {
  private readonly items = new Map<string, Uint8Array>();

  async read(name: string): Promise<Uint8Array | null> {
    checkName(name);
    return this.items.get(name)?.slice() ?? null;
  }

  async write(name: string, data: Uint8Array | null): Promise<void> {
    checkName(name);
    if (data === null) this.items.delete(name);
    else this.items.set(name, data.slice());
  }
}

/** Seals and opens bytes with an OS keystore (Electron `safeStorage`: Keychain, DPAPI, libsecret). */
export interface SecretSealer {
  seal(plaintext: Uint8Array): Uint8Array;
  unseal(sealed: Uint8Array): Uint8Array;
}

/**
 * One file per secret (`<name>.sealed`, owner-only, written atomically) holding the
 * sealer's ciphertext. With the safeStorage sealer this is the desktop counterpart of
 * the Keychain items the Mac app keeps: the ciphertext is useless without the OS
 * account's keystore entry, which is not in the app data folder.
 */
export class SealedFileSecretBackend implements SecretBackend {
  constructor(private readonly directory: string, private readonly sealer: SecretSealer) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  async read(name: string): Promise<Uint8Array | null> {
    let sealed: Uint8Array;
    try {
      sealed = new Uint8Array(readFileSync(this.path(name)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new KeyVaultError("io", name);
    }
    try {
      return this.sealer.unseal(sealed);
    } catch {
      throw new KeyVaultError("corrupt", name);
    }
  }

  async write(name: string, data: Uint8Array | null): Promise<void> {
    const path = this.path(name);
    if (data === null) {
      rmSync(path, { force: true });
      return;
    }
    const sealed = this.sealer.seal(data);
    const temporary = `${path}.${toHex(randomBytes(6))}.tmp`;
    try {
      writeFileSync(temporary, sealed, { mode: 0o600 });
      renameSync(temporary, path);
    } catch {
      rmSync(temporary, { force: true });
      throw new KeyVaultError("io", name);
    }
  }

  private path(name: string): string {
    checkName(name);
    return join(this.directory, `${name}.sealed`);
  }
}

function checkName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) throw new KeyVaultError("badName", "secret name");
}
