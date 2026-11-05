import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toHex } from "../../src/bytes/index.js";
import { verifyDeviceSignature } from "../../src/crypto/index.js";
import {
  createInMemoryKeyVault, createSealedFileKeyVault, KeyVaultError, InMemorySecretBackend, safeStorageSealer, type SafeStorageLike,
} from "../../src/keys/index.js";
import { GatewayStore } from "../../src/store/index.js";
import { temporaryDirectory } from "../support/storeRig.js";

/** Stands in for Electron's `safeStorage`: AES-256-GCM under a key that lives outside the folder, like the OS keystore. */
function fakeSafeStorage(osKey: Buffer = randomBytes(32), options: { available?: boolean; backend?: string } = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => options.available ?? true,
    getSelectedStorageBackend: () => options.backend ?? "keychain",
    encryptString: (plainText) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", osKey, iv);
      const body = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
      return Buffer.concat([Buffer.from("v10"), iv, body, cipher.getAuthTag()]);
    },
    decryptString: (encrypted) => {
      const iv = encrypted.subarray(3, 15);
      const decipher = createDecipheriv("aes-256-gcm", osKey, iv);
      decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
      return Buffer.concat([decipher.update(encrypted.subarray(15, encrypted.length - 16)), decipher.final()]).toString("utf8");
    },
  };
}

describe("in-memory key vault", () => {
  it("creates the data key and identity once, and keeps nothing else", async () => {
    const vault = createInMemoryKeyVault();
    const [first, second] = await Promise.all([vault.dataKey(), vault.dataKey()]);
    expect(first).toHaveLength(32);
    expect(toHex(second as Uint8Array)).toBe(toHex(first as Uint8Array));
    const identity = await vault.macIdentity("Office Mac");
    expect((await vault.macIdentity("ignored")).publicKeys).toEqual(identity.publicKeys);
    expect(identity.publicKeys.displayName).toBe("Office Mac");
  });

  it("rejects item names that could escape the vault folder", async () => {
    await expect(new InMemorySecretBackend().write("../x", Buffer.from("x"))).rejects.toThrow(KeyVaultError);
  });
});

describe("safeStorage file vault", () => {
  let folder: ReturnType<typeof temporaryDirectory>;
  beforeEach(() => {
    folder = temporaryDirectory("vault");
  });
  afterEach(() => folder.cleanup());

  it("round trips identity and data key across restarts, sealed on disk, and holds no sign-in or connector tokens", async () => {
    const osKey = randomBytes(32);
    const vault = createSealedFileKeyVault({ directory: folder.path, sealer: safeStorageSealer(fakeSafeStorage(osKey)) });
    const identity = await vault.macIdentity("Office Mac");
    const dataKey = await vault.dataKey();

    const names = readdirSync(folder.path).sort();
    expect(names).toEqual(["datakey.gateway.sealed", "identity.mac.sealed"]);
    const onDisk = Buffer.concat(names.map((name) => readFileSync(join(folder.path, name))));
    for (const secret of [Buffer.from(dataKey).toString("base64"), identity.publicKeys.deviceID]) {
      expect(onDisk.includes(Buffer.from(secret))).toBe(false);
    }
    expect(onDisk.includes(Buffer.from(dataKey))).toBe(false);
    if (process.platform !== "win32") expect(statSync(join(folder.path, "datakey.gateway.sealed")).mode & 0o077).toBe(0);

    const restarted = createSealedFileKeyVault({ directory: folder.path, sealer: safeStorageSealer(fakeSafeStorage(osKey)) });
    const reloaded = await restarted.macIdentity("ignored");
    expect(reloaded.publicKeys).toEqual(identity.publicKeys);
    const message = Buffer.from("receipt bytes");
    expect(verifyDeviceSignature(identity.publicKeys, reloaded.sign(message), message)).toBe(true);
    expect(toHex(await restarted.dataKey())).toBe(toHex(dataKey));
  });

  it("cannot read the folder with another OS keystore, or after tampering", async () => {
    const vault = createSealedFileKeyVault({ directory: folder.path, sealer: safeStorageSealer(fakeSafeStorage()) });
    await vault.dataKey();
    const elsewhere = createSealedFileKeyVault({ directory: folder.path, sealer: safeStorageSealer(fakeSafeStorage()) });
    await expect(elsewhere.dataKey()).rejects.toThrow(expect.objectContaining({ kind: "corrupt", subject: "datakey.gateway" }));

    const osKey = randomBytes(32);
    const tampered = join(folder.path, "tampered");
    const owner = createSealedFileKeyVault({ directory: tampered, sealer: safeStorageSealer(fakeSafeStorage(osKey)) });
    await owner.macIdentity("Office Mac");
    const path = join(tampered, "identity.mac.sealed");
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    writeFileSync(path, bytes);
    const reopened = createSealedFileKeyVault({ directory: tampered, sealer: safeStorageSealer(fakeSafeStorage(osKey)) });
    await expect(reopened.macIdentity("Office Mac")).rejects.toThrow(expect.objectContaining({ kind: "corrupt" }));
  });

  it("refuses to run without a real OS keystore", () => {
    expect(() => safeStorageSealer(fakeSafeStorage(undefined, { available: false }))).toThrow(expect.objectContaining({ kind: "unavailable" }));
    expect(() => safeStorageSealer(fakeSafeStorage(undefined, { backend: "basic_text" }))).toThrow(expect.objectContaining({ kind: "unavailable" }));
  });

  it("supplies the gateway store's data key", async () => {
    const vault = createSealedFileKeyVault({ directory: join(folder.path, "keys"), sealer: safeStorageSealer(fakeSafeStorage()) });
    const store = await GatewayStore.open({ directory: join(folder.path, "store"), keys: vault });
    store.settings.set("a", "b");
    store.ask.save("t", null, Buffer.from("turns"));
    store.close();
    const reopened = await GatewayStore.open({ directory: join(folder.path, "store"), keys: vault });
    expect(Buffer.from(reopened.ask.get("t")?.turns as Uint8Array).toString()).toBe("turns");
    reopened.close();
  });
});
