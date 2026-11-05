import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSafeEntry, SPEECH_PACKAGES, SpeechModelStore, type FetchLike, type SpeechModelPackage } from "../../src/model/index.js";

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

/** The mirror is unreachable; upstream serves `files`. */
function upstreamOnly(files: Record<string, Uint8Array>): FetchLike {
  const upstream = serve(files);
  return async (url, init) => {
    if (url.startsWith(MIRROR)) return { status: 503, body: null };
    return upstream.fetch(url, init);
  };
}

/** A tar.bz2 of `folder` made with the system tar, plus extra arguments (for hostile archives). */
function archive(source: string, entries: string[], extra: string[] = []): Uint8Array {
  const out = join(root, `a-${Math.random().toString(16).slice(2)}.tar.bz2`);
  execFileSync("tar", ["-cjf", out, ...extra, "-C", source, ...entries]);
  return new Uint8Array(readFileSync(out));
}

function sourceFolder(): { source: string; pkg: SpeechModelPackage; vad: SpeechModelPackage; files: Record<string, string> } {
  const source = join(root, "src");
  mkdirSync(join(source, "tiny-model", "sub"), { recursive: true });
  const files = { "tiny-model/model.onnx": "weights ".repeat(500), "tiny-model/tokens.txt": "a 0\nb 1\n", "tiny-model/sub/extra.txt": "extra" };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(source, path), text);
  const pkg: SpeechModelPackage = {
    id: "parakeet", url: "https://example.test/tiny-model.tar.bz2", downloadBytes: 0, format: "tar.bz2", target: "tiny-model",
    files: ["tiny-model/model.onnx", "tiny-model/tokens.txt"].map((path) => ({
      path, bytes: Buffer.byteLength(files[path as keyof typeof files]), sha256: sha(files[path as keyof typeof files]), url: `${MIRROR}/parakeet/v1/${path}`,
    })),
  };
  const vadText = "silero";
  const vad: SpeechModelPackage = {
    id: "vad", url: "https://example.test/vad.onnx", downloadBytes: vadText.length, format: "file", target: "vad.onnx",
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

  it("falls back to the upstream archive only when told to and the mirror is unreachable, unpacking in a staging folder of its own", async () => {
    const { source, pkg: base } = sourceFolder();
    const bytes = archive(source, ["tiny-model"]);
    const pkg = { ...base, downloadBytes: bytes.length };
    const upstream = serve({ [pkg.url]: bytes });
    const offline: FetchLike = async (url, init) => {
      if (url.startsWith(MIRROR)) throw new TypeError("fetch failed");
      return upstream.fetch(url, init);
    };
    const directory = join(root, "models");
    await expect(new SpeechModelStore({ directory, packages: [pkg], fetch: offline }).install("parakeet")).rejects.toBeInstanceOf(TypeError);
    expect(upstream.fetched).toEqual([]);

    const store = new SpeechModelStore({ directory, packages: [pkg], fetch: offline, fallback: true });
    await store.install("parakeet");
    expect(store.isInstalled("parakeet")).toBe(true);
    expect(upstream.fetched).toEqual([pkg.url]);
    expect(readFileSync(join(directory, "tiny-model/sub/extra.txt"), "utf8")).toBe("extra");
    expect(readdirSync(directory).filter((name) => name.startsWith(".staging"))).toEqual([]);
    expect(existsSync(join(directory, ".downloads", "parakeet.tar.bz2"))).toBe(false);
  });

  it("adopts a complete copy already in the folder without any network call", async () => {
    const { source, pkg } = sourceFolder();
    const server = serve({});
    const store = new SpeechModelStore({ directory: source, packages: [pkg], fetch: server.fetch });
    await store.install("parakeet");
    expect(store.isInstalled("parakeet")).toBe(true);
    expect(server.fetched).toEqual([]);
  });

  it("refuses an archive that climbs out of its folder and leaves nothing outside", async () => {
    const { source, pkg: base } = sourceFolder();
    writeFileSync(join(root, "outside.txt"), "escape");
    // -P keeps the `..` in the stored name.
    const bytes = archive(join(source, "tiny-model"), ["../../outside.txt"], ["-P"]);
    const pkg = { ...base, downloadBytes: bytes.length };
    const directory = join(root, "models");
    const store = new SpeechModelStore({ directory, packages: [pkg], fetch: upstreamOnly({ [pkg.url]: bytes }), fallback: true });
    await expect(store.install("parakeet")).rejects.toMatchObject({ code: "unsafe_archive" });
    expect(existsSync(join(root, "models", "..", "outside.txt"))).toBe(true);
    // Only the empty folder the mirror attempt made: nothing was unpacked into place.
    expect(existsSync(join(directory, "tiny-model", "model.onnx"))).toBe(false);
    expect(store.isInstalled("parakeet")).toBe(false);
  });

  it("refuses an archive with a link in it", async () => {
    const { source, pkg: base } = sourceFolder();
    symlinkSync("/etc/hosts", join(source, "tiny-model", "link"));
    const bytes = archive(source, ["tiny-model"]);
    const pkg = { ...base, downloadBytes: bytes.length };
    const store = new SpeechModelStore({ directory: join(root, "models"), packages: [pkg], fetch: upstreamOnly({ [pkg.url]: bytes }), fallback: true });
    await expect(store.install("parakeet")).rejects.toMatchObject({ code: "unsafe_archive" });
    expect(existsSync(join(root, "models", "tiny-model", "link"))).toBe(false);
    expect(existsSync(join(root, "models", "tiny-model", "model.onnx"))).toBe(false);
  });

  it("does not mark a package installed when a file does not match its hash", async () => {
    const { source, pkg: base } = sourceFolder();
    const bytes = archive(source, ["tiny-model"]);
    const pkg = { ...base, downloadBytes: bytes.length, files: [{ ...base.files[0]!, sha256: "0".repeat(64) }] };
    const store = new SpeechModelStore({ directory: join(root, "models"), packages: [pkg], fetch: upstreamOnly({ [pkg.url]: bytes }), fallback: true });
    await expect(store.install("parakeet")).rejects.toMatchObject({ code: "incomplete" });
    expect(store.isInstalled("parakeet")).toBe(false);
  });

  it("accepts only relative entries inside the top folder", () => {
    expect(isSafeEntry("kokoro/model.onnx", "kokoro")).toBe(true);
    expect(isSafeEntry("./kokoro/dict/", "kokoro")).toBe(true);
    for (const name of ["/etc/passwd", "kokoro/../../x", "..\\x", "C:\\x", "other/model.onnx", "\\\\server\\x", "kokoro/a\0b"]) {
      expect(isSafeEntry(name, "kokoro"), name).toBe(false);
    }
  });

  it("downloads from models.lanaai.io, with the official sherpa-onnx release files as the upstream", () => {
    for (const pkg of SPEECH_PACKAGES) {
      expect(pkg.url.startsWith("https://github.com/k2-fsa/sherpa-onnx/releases/download/")).toBe(true);
      for (const file of pkg.files) expect(file.url.startsWith(`https://models.lanaai.io/briefs/speech/${pkg.id}/`)).toBe(true);
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
    const store = new SpeechModelStore({ directory: source, fetch: async () => { throw new Error("no network in this test"); } });
    for (const pkg of SPEECH_PACKAGES) expect(await store.verify(pkg), pkg.id).toBe(true);
  }, 120_000);
});
