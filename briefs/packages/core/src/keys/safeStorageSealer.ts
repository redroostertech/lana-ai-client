import { fromBase64, toBase64 } from "../bytes/base64.js";
import { KeyVaultError } from "./keyVaultError.js";
import type { SecretSealer } from "./secretBackend.js";

/**
 * The parts of Electron's `safeStorage` the vault needs, typed structurally so core
 * never imports Electron. The app passes `safeStorage` from the main process.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Uint8Array;
  decryptString(encrypted: Buffer): string;
  /** Linux only: `basic_text` means no keyring, so secrets would be stored unprotected. */
  getSelectedStorageBackend?(): string;
}

/**
 * Seals with `safeStorage` (Keychain on macOS, DPAPI on Windows, libsecret or kwallet
 * on Linux). Bytes travel as base64 because `safeStorage` takes strings. Refuses to run
 * when the OS keystore is unavailable or Linux fell back to its plaintext backend.
 * Call it after the app's `ready` event.
 */
export function safeStorageSealer(safeStorage: SafeStorageLike): SecretSealer {
  if (!safeStorage.isEncryptionAvailable()) throw new KeyVaultError("unavailable", "safeStorage");
  if (safeStorage.getSelectedStorageBackend?.() === "basic_text") throw new KeyVaultError("unavailable", "safeStorage basic_text");
  return {
    seal: (plaintext) => new Uint8Array(safeStorage.encryptString(toBase64(plaintext))),
    unseal: (sealed) => {
      const plaintext = fromBase64(safeStorage.decryptString(Buffer.from(sealed)));
      if (plaintext === null) throw new KeyVaultError("corrupt", "safeStorage");
      return plaintext;
    },
  };
}
