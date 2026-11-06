import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SecretSealer } from "@lana/core/keys";
import { chromiumMacSealer, IMPORT_MARKER, importStandalone, standaloneSources, type StandaloneImportOptions } from "../src/main/import/standaloneImport.js";

// The one-time import from the standalone LANA Briefs app (1e): it moves this computer's
// identity, the store key and the store, re-sealed for the client, only for the same
// person, only into a folder that does not exist yet, and never changes the old folder.

const PASSWORD = "old-app-keychain-password";
const IDENTITY = new Uint8Array(Buffer.from("identity-key-material"));
const DATA_KEY = new Uint8Array(32).fill(7);

/** Chromium's macOS safeStorage seal, with the base64 the Briefs vault puts inside. */
function chromiumSeal(plain: Uint8Array, password = PASSWORD): Buffer {
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), cipher.update(Buffer.from(Buffer.from(plain).toString("base64"))), cipher.final()]);
}

/** The client's own sealer in tests: reversible and marked. */
const clientSealer: SecretSealer = {
  seal: (plain) => new Uint8Array(Buffer.concat([Buffer.from("client:"), Buffer.from(plain)])),
  unseal: (sealed) => new Uint8Array(Buffer.from(sealed).subarray(7)),
};

let root: string;
let appSupport: string;
let old: string;
let target: string;

function fingerprint(folder: string): string {
  const hash = createHash("sha256");
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true }).sort((a, b) => join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name)))) {
    const path = join(entry.parentPath, entry.name);
    hash.update(path);
    if (entry.isFile()) hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "briefs-import-"));
  appSupport = join(root, "Application Support");
  old = join(appSupport, "@lana", "app");
  mkdirSync(join(old, "keys"), { recursive: true });
  mkdirSync(join(old, "Lana", "audio"), { recursive: true });
  mkdirSync(join(old, "Models", "speech", "kokoro"), { recursive: true });
  writeFileSync(join(old, "keys", "identity.mac.sealed"), chromiumSeal(IDENTITY));
  writeFileSync(join(old, "keys", "datakey.gateway.sealed"), chromiumSeal(DATA_KEY));
  writeFileSync(join(old, "keys", "secret.lana.session.sealed"), chromiumSeal(new Uint8Array(Buffer.from(JSON.stringify({ token: "old-token", user: { id: "7", email: "Dana@Firm.test" }, server: { organizationID: "harlow" } })))));
  writeFileSync(join(old, "keys", "secret.lana.entitlement.sealed"), chromiumSeal(new Uint8Array(Buffer.from("{}"))));
  writeFileSync(join(old, "Lana", "gateway.sqlite"), "sealed store rows");
  writeFileSync(join(old, "Lana", "audio", "part-1.bin"), "sealed audio");
  writeFileSync(join(old, "Models", "speech", "kokoro", "model.onnx"), "speech weights");
  target = join(root, "client", "briefs", "people", "abc123");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function options(change: Partial<StandaloneImportOptions> = {}): StandaloneImportOptions {
  return {
    sources: standaloneSources(appSupport),
    target,
    person: { id: "7", email: "dana@firm.test" },
    readOldKey: async (service) => (service === "@lana/app Safe Storage" ? PASSWORD : null),
    sealer: clientSealer,
    platform: "darwin",
    isAlive: () => false,
    ...change,
  };
}

describe("import from the standalone LANA Briefs app", () => {
  it("moves the identity and store key re-sealed for the client, the store, and the speech models, leaving the old folder as it was", async () => {
    const before = fingerprint(old);
    expect(await importStandalone(options())).toBe("imported");
    expect(fingerprint(old)).toBe(before);
    expect(readdirSync(join(target, "keys")).sort()).toEqual(["datakey.gateway.sealed", "identity.mac.sealed"]);
    expect(clientSealer.unseal(new Uint8Array(readFileSync(join(target, "keys", "identity.mac.sealed"))))).toEqual(IDENTITY);
    expect(clientSealer.unseal(new Uint8Array(readFileSync(join(target, "keys", "datakey.gateway.sealed"))))).toEqual(DATA_KEY);
    expect(readFileSync(join(target, "Lana", "audio", "part-1.bin"), "utf8")).toBe("sealed audio");
    const speech = join(target, "Models", "speech", "kokoro", "model.onnx");
    expect(readFileSync(speech, "utf8")).toBe("speech weights");
    expect(statSync(speech).ino).toBe(statSync(join(old, "Models", "speech", "kokoro", "model.onnx")).ino);
    // The old sign-in, entitlement answer and token do not come over: there is one session, the client's.
    const everything = readdirSync(target, { recursive: true }).map(String);
    expect(everything.some((name) => name.includes("session") || name.includes("entitlement"))).toBe(false);
    expect(fingerprint(target)).not.toContain("old-token");
    expect(JSON.parse(readFileSync(join(target, IMPORT_MARKER), "utf8"))).toMatchObject({ from: "standalone", audited: false });
    expect(existsSync(`${target}.importing`)).toBe(false);
  });

  it("matches the person by email when the user id differs (case and spaces aside)", async () => {
    expect(await importStandalone(options({ person: { id: "uuid-not-7", email: "  DANA@firm.test " } }))).toBe("imported");
  });

  it("refuses another person's meetings, or an old app that was signed out, and writes nothing", async () => {
    expect(await importStandalone(options({ person: { id: "8", email: "sam@firm.test" } }))).toBe("otherPerson");
    rmSync(join(old, "keys", "secret.lana.session.sealed"));
    expect(await importStandalone(options())).toBe("otherPerson");
    expect(existsSync(target)).toBe(false);
  });

  it("never overwrites: a person folder that exists is left alone", async () => {
    mkdirSync(join(target, "keys"), { recursive: true });
    writeFileSync(join(target, "keys", "identity.mac.sealed"), "existing");
    expect(await importStandalone(options())).toBe("targetExists");
    expect(readFileSync(join(target, "keys", "identity.mac.sealed"), "utf8")).toBe("existing");
  });

  it("waits while the old app is open (its lock names a live process here); a stale lock does not block (control)", async () => {
    symlinkSync(`${hostname()}-4242`, join(old, "SingletonLock"));
    expect(await importStandalone(options({ isAlive: (pid) => pid === 4242 }))).toBe("running");
    expect(existsSync(target)).toBe(false);
    expect(await importStandalone(options({ isAlive: () => false }))).toBe("imported");
  });

  it("does nothing when the person does not allow the old keystore entry, or the password is wrong", async () => {
    expect(await importStandalone(options({ readOldKey: async () => null }))).toBe("keyUnavailable");
    expect(await importStandalone(options({ readOldKey: async () => "wrong-password" }))).toBe("keyUnavailable");
    expect(existsSync(target)).toBe(false);
  });

  it("only on macOS, and only when the old app's data is there", async () => {
    expect(await importStandalone(options({ platform: "win32" }))).toBe("unsupported");
    rmSync(old, { recursive: true, force: true });
    expect(await importStandalone(options())).toBe("notFound");
  });

  it("opens Chromium's macOS seal and refuses anything else", () => {
    const sealer = chromiumMacSealer(PASSWORD);
    expect(sealer.unseal(new Uint8Array(chromiumSeal(IDENTITY)))).toEqual(IDENTITY);
    expect(() => sealer.unseal(new Uint8Array(Buffer.from("v11garbage")))).toThrow();
    expect(() => chromiumMacSealer("other").unseal(new Uint8Array(chromiumSeal(IDENTITY)))).toThrow();
  });
});
