import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toHex } from "../../src/bytes/index.js";
import { verifyDeviceSignature } from "../../src/crypto/index.js";
import {
  createInMemoryKeyVault, createSealedFileKeyVault, KeyVaultError, safeStorageSealer, SECRET_ACCOUNTS, type SafeStorageLike,
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
  it("creates the data key and identity once and keeps secrets and tokens", async () => {
    const vault = createInMemoryKeyVault();
    const [first, second] = await Promise.all([vault.dataKey(), vault.dataKey()]);
    expect(first).toHaveLength(32);
    expect(toHex(second as Uint8Array)).toBe(toHex(first as Uint8Array));
    const identity = await vault.macIdentity("Office Mac");
    expect((await vault.macIdentity("ignored")).publicKeys).toEqual(identity.publicKeys);
    expect(identity.publicKeys.displayName).toBe("Office Mac");

    expect(await vault.secret(SECRET_ACCOUNTS.clioClientSecret)).toBeNull();
    await vault.setSecret(SECRET_ACCOUNTS.clioClientSecret, Buffer.from("clio-secret"));
    expect(Buffer.from((await vault.secret(SECRET_ACCOUNTS.clioClientSecret)) as Uint8Array).toString()).toBe("clio-secret");
    await vault.setSecret(SECRET_ACCOUNTS.clioClientSecret, null);
    expect(await vault.secret(SECRET_ACCOUNTS.clioClientSecret)).toBeNull();

    const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: new Date("2027-01-01T00:00:00.000Z"), region: "us" };
    await vault.saveOAuthTokens(tokens, "clio");
    expect(await vault.oauthTokens("clio")).toEqual({ ...tokens, scope: undefined });
    await vault.deleteOAuthTokens("clio");
    expect(await vault.oauthTokens("clio")).toBeNull();
  });

  it("rejects item names that could escape the vault folder", async () => {
    const vault = createInMemoryKeyVault();
    await expect(vault.setSecret("../x", Buffer.from("x"))).rejects.toThrow(KeyVaultError);
  });
});

describe("safeStorage file vault", () => {
  let folder: ReturnType<typeof temporaryDirectory>;
  beforeEach(() => {
    folder = temporaryDirectory("vault");
  });
  afterEach(() => folder.cleanup());

  it("round trips identity, data key, secrets and tokens across restarts, sealed on disk", async () => {
    const osKey = randomBytes(32);
    const vault = createSealedFileKeyVault({ directory: folder.path, sealer: safeStorageSealer(fakeSafeStorage(osKey)) });
    const identity = await vault.macIdentity("Office Mac");
    const dataKey = await vault.dataKey();
    await vault.setSecret(SECRET_ACCOUNTS.clioClientSecret, Buffer.from("client-secret-value"));
    await vault.saveOAuthTokens({ accessToken: "access-token-value", expiresAt: new Date("2027-01-01T00:00:00.000Z") }, "graph");

    const names = readdirSync(folder.path).sort();
    expect(names).toEqual(["datakey.gateway.sealed", "identity.mac.sealed", "oauth.graph.sealed", "secret.clio.client_secret.sealed"]);
    const onDisk = Buffer.concat(names.map((name) => readFileSync(join(folder.path, name))));
    for (const secret of ["client-secret-value", "access-token-value", Buffer.from(dataKey).toString("base64"), identity.publicKeys.deviceID]) {
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
    expect(Buffer.from((await restarted.secret(SECRET_ACCOUNTS.clioClientSecret)) as Uint8Array).toString()).toBe("client-secret-value");
    expect((await restarted.oauthTokens("graph"))?.accessToken).toBe("access-token-value");
  });

  it("cannot read the folder with another OS keystore, or after tampering", async () => {
    const vault = createSealedFileKeyVault({ directory: folder.path, sealer: safeStorageSealer(fakeSafeStorage()) });
    await vault.dataKey();
    const elsewhere = createSealedFileKeyVault({ directory: folder.path, sealer: safeStorageSealer(fakeSafeStorage()) });
    await expect(elsewhere.dataKey()).rejects.toThrow(expect.objectContaining({ kind: "corrupt", subject: "datakey.gateway" }));

    const osKey = randomBytes(32);
    const owner = createSealedFileKeyVault({ directory: folder.path, sealer: safeStorageSealer(fakeSafeStorage(osKey)) });
    await owner.setSecret("probe", Buffer.from("x"));
    const path = join(folder.path, "secret.probe.sealed");
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    writeFileSync(path, bytes);
    await expect(owner.secret("probe")).rejects.toThrow(expect.objectContaining({ kind: "corrupt" }));
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
