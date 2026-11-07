import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientSettingsKey, readClientToken, type ClientTokenDeps } from "../src/clientToken.js";

// The import tool reads the LANA client's sign-in without ever changing the client's files:
// on 2026-11-05 loading the client's own settings module from a tool deleted its settings
// file. These pin that the original is only ever copied, whatever fails.

let root: string;
let userData: string;
let tempRoot: string;
const original = () => join(userData, "server-config.json");
const digest = () => createHash("sha256").update(readFileSync(original())).digest("hex");

/** electron-store stand-in: reads `<cwd>/<name>.json`, and like a careless store, wipes it when it cannot parse it. */
class FakeStore {
  private readonly data: Record<string, unknown>;
  constructor(options: { configName: string; cwd: string }) {
    const path = join(options.cwd, `${options.configName}.json`);
    try {
      this.data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch (error) {
      rmSync(path, { force: true });
      throw error;
    }
  }
  get(key: string): unknown {
    return this.data[key];
  }
}

const deps = (change: Partial<ClientTokenDeps> = {}): ClientTokenDeps => ({
  userData,
  Conf: FakeStore,
  decrypt: (ciphertext) => ciphertext.toString("utf8").replace(/^sealed:/, ""),
  tempRoot,
  ...change,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "client-token-"));
  userData = join(root, "Lana AI");
  tempRoot = join(root, "tmp");
  mkdirSync(userData, { recursive: true });
  mkdirSync(tempRoot, { recursive: true });
  writeFileSync(original(), JSON.stringify({ server: { orgId: "harlow" }, authTokenEncrypted: Buffer.from("sealed:client-token").toString("base64") }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("reading the client's sign-in for the import tool", () => {
  it("reads the token from a copy and leaves the client's file and the temp folder as they were", () => {
    const before = digest();
    expect(readClientToken(deps())).toBe("client-token");
    expect(digest()).toBe(before);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it("a settings file the store cannot read: null, and the client's file is still there, unchanged", () => {
    writeFileSync(original(), "not json");
    const before = digest();
    expect(readClientToken(deps())).toBeNull();
    expect(existsSync(original())).toBe(true);
    expect(digest()).toBe(before);
  });

  it("a token that does not decrypt: null, and nothing is removed", () => {
    const before = digest();
    expect(readClientToken(deps({ decrypt: () => { throw new Error("other keychain"); } }))).toBeNull();
    expect(digest()).toBe(before);
  });

  it("no settings file or no token: null", () => {
    writeFileSync(original(), JSON.stringify({ server: null }));
    expect(readClientToken(deps())).toBeNull();
    rmSync(original());
    expect(readClientToken(deps())).toBeNull();
  });

  it("uses the client's settings key formula", () => {
    expect(clientSettingsKey("host.local", "/Users/x")).toBe(createHash("sha256").update("host.local-/Users/x-lana-ai-client-stable").digest("hex"));
  });
});
