import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechModelStore, type FetchLike, type SpeechModelPackage } from "../../src/model/index.js";

// The LANA client's catalog: the one list of every model the client downloads.
const catalog = createRequire(import.meta.url)("../../../../../electron-local-models.js") as { speechPackages(): SpeechModelPackage[] };
const SPEECH_PACKAGES = catalog.speechPackages();

const sha = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const MIRROR = "https://models.lanaai.io/briefs/speech";
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
/** The mirror's copy of every file in `pkg`, keyed by its URL. */
function mirrorOf(pkg: SpeechModelPackage, texts: Record<string, string>): Record<string, Uint8Array> {
  return Object.fromEntries(pkg.files.map((file) => [file.url, bytesOf(texts[file.path]!)]));
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lana-speech-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Serves files from memory and records each URL fetched. */
function serve(files: Record<string, Uint8Array>): { fetch: FetchLike; fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    fetch: async (url) => {
      fetched.push(url);
      const body = files[url];
      if (body === undefined) return { status: 404, body: null };
      return { status: 200, body: new Response(new Uint8Array(body)).body };
    },
  };
}

function sourceFolder(): { source: string; pkg: SpeechModelPackage; vad: SpeechModelPackage; files: Record<string, string> } {
  const source = join(root, "src");
  mkdirSync(join(source, "tiny-model", "sub"), { recursive: true });
  const files = { "tiny-model/model.onnx": "weights ".repeat(500), "tiny-model/tokens.txt": "a 0\nb 1\n", "tiny-model/sub/extra.txt": "extra" };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(source, path), text);
  const pkg: SpeechModelPackage = {
    id: "parakeet", target: "tiny-model",
    files: ["tiny-model/model.onnx", "tiny-model/tokens.txt"].map((path) => ({
      path, bytes: Buffer.byteLength(files[path as keyof typeof files]), sha256: sha(files[path as keyof typeof files]), url: `${MIRROR}/parakeet/v1/${path}`,
    })),
  };
  const vadText = "silero";
  const vad: SpeechModelPackage = {
    id: "vad", target: "vad.onnx",
    files: [{ path: "vad.onnx", bytes: vadText.length, sha256: sha(vadText), url: `${MIRROR}/vad/v1/vad.onnx` }],
  };
  return { source, pkg, vad, files };
}

describe("SpeechModelStore", () => {
  it("downloads every file on its own from the mirror, checks each and reports progress", async () => {
    const { pkg, vad, files } = sourceFolder();
    const server = serve({ ...mirrorOf(pkg, files), ...mirrorOf(vad, { "vad.onnx": "silero" }) });
    const directory = join(root, "models");
    const store = new SpeechModelStore({ directory, packages: [vad, pkg], fetch: server.fetch });
    expect(store.areInstalled(["vad", "parakeet"])).toBe(false);

    const progress: number[] = [];
    await store.installAll(["vad", "parakeet"], { progress: (value) => progress.push(value) });
    expect(store.areInstalled(["vad", "parakeet"])).toBe(true);
    expect(readFileSync(join(directory, "tiny-model/model.onnx"), "utf8")).toBe(files["tiny-model/model.onnx"]);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);
    // Only the mirror, one request per file, nothing upstream and nothing to unpack.
    expect(server.fetched.sort()).toEqual([...pkg.files, ...vad.files].map((file) => file.url).sort());
    expect(existsSync(join(directory, ".downloads"))).toBe(false);

    // Installed: no second download.
    await store.installAll(["vad", "parakeet"]);
    expect(server.fetched).toHaveLength(3);
    expect(store.downloadBytes(["vad", "parakeet"])).toBe([...pkg.files, ...vad.files].reduce((sum, file) => sum + file.bytes, 0));

    await store.remove("parakeet");
    expect(store.isInstalled("parakeet")).toBe(false);
    expect(existsSync(join(directory, "tiny-model"))).toBe(false);
    expect(store.isInstalled("vad")).toBe(true);
  });

  it("rejects a mirror file whose SHA-256 is not the pinned one and does not mark the package installed", async () => {
    const { pkg, files } = sourceFolder();
    const tampered = { ...mirrorOf(pkg, files), [pkg.files[0]!.url]: bytesOf(files["tiny-model/model.onnx"]!.replace("w", "W")) };
    const directory = join(root, "models");
    const store = new SpeechModelStore({ directory, packages: [pkg], fetch: serve(tampered).fetch });
    await expect(store.install("parakeet")).rejects.toMatchObject({ code: "checksum" });
    expect(store.isInstalled("parakeet")).toBe(false);
    expect(existsSync(join(directory, "tiny-model/model.onnx"))).toBe(false);
    expect(existsSync(join(directory, "tiny-model/model.onnx.part"))).toBe(false);
  });

  it("resumes a file from its .part with a range request", async () => {
    const { vad } = sourceFolder();
    const directory = join(root, "models");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "vad.onnx.part"), "sil");
    const ranges: string[] = [];
    const fetch: FetchLike = async (_url, init) => {
      ranges.push(init.headers["Range"] ?? "");
      return { status: 206, body: new Response("ero").body };
    };
    const store = new SpeechModelStore({ directory, packages: [vad], fetch });
    expect(store.hasPartial("vad")).toBe(true);
    await store.install("vad");
    expect(ranges).toEqual(["bytes=3-"]);
    expect(store.isInstalled("vad")).toBe(true);
    expect(store.hasPartial("vad")).toBe(false);
  });

  it("installs a package two callers want at once with one download, and both end ready", async () => {
    const { pkg, vad, files } = sourceFolder();
    const server = serve({ ...mirrorOf(pkg, files), ...mirrorOf(vad, { "vad.onnx": "silero" }) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: FetchLike = async (url, init) => {
      await gate;
      return server.fetch(url, init);
    };
    const store = new SpeechModelStore({ directory: join(root, "models"), packages: [vad, pkg], fetch: slow });
    const listener: number[] = [];
    const transcription: number[] = [];
    const first = store.installAll(["vad", "parakeet"], { progress: (value) => listener.push(value) });
    const second = store.installAll(["vad", "parakeet"], { progress: (value) => transcription.push(value) });
    release();
    await Promise.all([first, second]);
    expect(store.areInstalled(["vad", "parakeet"])).toBe(true);
    expect(server.fetched.sort()).toEqual([...pkg.files, ...vad.files].map((file) => file.url).sort());
    expect(listener.at(-1)).toBe(1);
    expect(transcription.at(-1)).toBe(1);
  });

  it("keeps a shared install going when one caller cancels, and stops it when the last one does", async () => {
    const { vad } = sourceFolder();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let signalSeen: AbortSignal | undefined;
    const fetch: FetchLike = async (_url, init) => {
      signalSeen = init.signal;
      await gate;
      return { status: 200, body: new Response("silero").body };
    };
    const store = new SpeechModelStore({ directory: join(root, "models"), packages: [vad], fetch });
    const cancel = new AbortController();
    const leaving = store.install("vad", { signal: cancel.signal });
    const staying = store.install("vad");
    cancel.abort();
    await expect(leaving).rejects.toBeDefined();
    release();
    await staying;
    expect(signalSeen?.aborted).toBe(false);
    expect(store.isInstalled("vad")).toBe(true);

    await store.remove("vad");
    const only = new AbortController();
    const alone = store.install("vad", { signal: only.signal });
    only.abort();
    await expect(alone).rejects.toBeDefined();
    await vi.waitFor(() => expect(signalSeen?.aborted).toBe(true));
  });

  it("marks a group ready at once when all its packages are already installed", async () => {
    const { vad } = sourceFolder();
    const server = serve(mirrorOf(vad, { "vad.onnx": "silero" }));
    const store = new SpeechModelStore({ directory: join(root, "models"), packages: [vad], fetch: server.fetch });
    await store.installAll(["vad"]);
    const progress: number[] = [];
    await store.installAll(["vad"], { progress: (value) => progress.push(value) });
    expect(progress).toEqual([1]);
    expect(server.fetched).toHaveLength(1);
  });

  it("adopts a complete copy already in the folder without any network call", async () => {
    const { source, pkg } = sourceFolder();
    const server = serve({});
    const store = new SpeechModelStore({ directory: source, packages: [pkg], fetch: server.fetch });
    await store.install("parakeet");
    expect(store.isInstalled("parakeet")).toBe(true);
    expect(server.fetched).toEqual([]);
  });

  it("refuses a package with a file the catalog does not pin, and fetches nothing; a pinned one installs (control)", async () => {
    const { vad } = sourceFolder();
    const server = serve(mirrorOf(vad, { "vad.onnx": "silero" }));
    for (const file of [{ ...vad.files[0]!, url: "http://models.lanaai.io/briefs/speech/vad/v1/vad.onnx" }, { ...vad.files[0]!, sha256: "" }]) {
      const store = new SpeechModelStore({ directory: join(root, "unpinned"), packages: [{ ...vad, files: [file] }], fetch: server.fetch });
      await expect(store.install("vad")).rejects.toMatchObject({ code: "unpinned" });
    }
    expect(server.fetched).toEqual([]);
    await new SpeechModelStore({ directory: join(root, "models"), packages: [vad], fetch: server.fetch }).install("vad");
    expect(server.fetched).toHaveLength(1);
  });

  it("the client's catalog pins every speech file on models.lanaai.io with its size and SHA-256", () => {
    expect(SPEECH_PACKAGES.map((pkg) => pkg.id).sort()).toEqual(["embedding", "kokoro", "parakeet", "segmentation", "vad"]);
    for (const pkg of SPEECH_PACKAGES) {
      for (const file of pkg.files) {
        expect(file.url.startsWith(`https://models.lanaai.io/briefs/speech/${pkg.id}/`)).toBe(true);
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.path === pkg.target || file.path.startsWith(`${pkg.target}/`)).toBe(true);
      }
    }
  });
});

/**
 * The real release files (opt in): `LANA_RUN_SPEECH_TESTS=1 LANA_SPEECH_MODELS_DIR=<folder>` with
 * the unpacked models. Every pinned size and SHA-256 must match, so the folder is adopted as is.
 */
describe.skipIf(process.env["LANA_RUN_SPEECH_TESTS"] !== "1")("SpeechModelStore with the real models (opt in)", () => {
  it("adopts the unpacked release files", async () => {
    const source = process.env["LANA_SPEECH_MODELS_DIR"] ?? "";
    const store = new SpeechModelStore({ directory: source, packages: SPEECH_PACKAGES, fetch: async () => { throw new Error("no network in this test"); } });
    for (const pkg of SPEECH_PACKAGES) expect(await store.verify(pkg), pkg.id).toBe(true);
  }, 120_000);
});
