import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRIEFS_MANIFEST, BRIEFS_MANIFEST_KIND, isMirrorUnreachable, MIRROR_BASE, mirrorURL, ModelDownloadError, releaseCanonical,
  SPEECH_PACKAGES, SpeechModelStore, speechPackage, UPSTREAM_FALLBACK, verifyBriefsManifest, type BriefsManifest,
} from "../../src/model/index.js";

/** A manifest signed with a throwaway key, for the rejection cases. */
function signedWithTestKey(): { manifest: BriefsManifest; keys: Record<string, string> } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const { sig: _sig, ...unsigned } = BRIEFS_MANIFEST;
  const value = sign(null, Buffer.from(releaseCanonical(unsigned), "utf8"), privateKey).toString("base64");
  return {
    manifest: { ...unsigned, sig: { alg: "Ed25519", keyId: "test-key", value } },
    keys: { "test-key": publicKey.export({ type: "spki", format: "pem" }).toString() },
  };
}

describe("the pinned Briefs manifest", () => {
  it("is signed with LANA's release key", () => {
    expect(BRIEFS_MANIFEST.kind).toBe(BRIEFS_MANIFEST_KIND);
    expect(BRIEFS_MANIFEST.sig?.keyId).toBe("lana-release-prod");
    expect(verifyBriefsManifest(BRIEFS_MANIFEST)).toBe(true);
  });

  it("rejects a manifest with a changed hash, an unknown key, another kind or no signature", () => {
    const { manifest, keys } = signedWithTestKey();
    expect(verifyBriefsManifest(manifest, keys)).toBe(true);
    const [first, ...rest] = manifest.packages;
    const badHash: BriefsManifest = { ...manifest, packages: [{ ...first!, files: [{ ...first!.files[0]!, sha256: "0".repeat(64) }, ...first!.files.slice(1)] }, ...rest] };
    expect(verifyBriefsManifest(badHash, keys)).toBe(false);
    expect(verifyBriefsManifest(manifest)).toBe(false);
    expect(verifyBriefsManifest({ ...manifest, kind: "lana.release/v1" }, keys)).toBe(false);
    const { sig: _sig, ...unsigned } = manifest;
    expect(verifyBriefsManifest(unsigned, keys)).toBe(false);
  });

  it("downloads nothing a manifest with a bad signature names", async () => {
    const [first, ...rest] = BRIEFS_MANIFEST.packages;
    const tampered: BriefsManifest = { ...BRIEFS_MANIFEST, packages: [{ ...first!, files: first!.files.map((file) => ({ ...file, sha256: "1".repeat(64) })) }, ...rest] };
    const vad = speechPackage(tampered, "vad");
    expect(vad.url).toBe("");
    expect(vad.files.every((file) => file.url === "")).toBe(true);
    const fetched: string[] = [];
    const folder = mkdtempSync(join(tmpdir(), "lana-untrusted-"));
    try {
      const store = new SpeechModelStore({ directory: folder, packages: [vad], fetch: async (url) => (fetched.push(url), { status: 404, body: null }), fallback: true });
      await expect(store.install("vad")).rejects.toMatchObject({ name: "UntrustedManifestError" });
      expect(fetched).toEqual([]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("pins every file the app downloads, under an immutable versioned key on models.lanaai.io", () => {
    expect(MIRROR_BASE).toBe("https://models.lanaai.io");
    expect(BRIEFS_MANIFEST.base).toBe(MIRROR_BASE);
    for (const pkg of BRIEFS_MANIFEST.packages) {
      expect(pkg.version).toMatch(/^[a-f0-9]{12}$/);
      for (const file of pkg.files) {
        expect(file.key).toBe(`briefs/${pkg.kind}/${pkg.id}/${pkg.version}/${file.path}`);
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(file.bytes).toBeGreaterThan(0);
      }
      expect(pkg.notices.map((notice) => notice.path)).toEqual(expect.arrayContaining(["LICENSE", "NOTICE"]));
    }
  });

  it("gives the speech packages their mirror URLs and pinned hashes", () => {
    const byKey = new Map(BRIEFS_MANIFEST.packages.flatMap((pkg) => pkg.files.map((file) => [mirrorURL(file.key), file] as const)));
    const speechFiles = SPEECH_PACKAGES.flatMap((pkg) => pkg.files);
    expect(speechFiles.length).toBeGreaterThan(0);
    for (const file of speechFiles) expect(byKey.get(file.url)).toMatchObject({ path: file.path, bytes: file.bytes, sha256: file.sha256 });
  });

  it("builds mirror URLs from keys and keeps the upstream fallback off", () => {
    expect(mirrorURL("briefs/speech/vad/abc/silero_vad.onnx")).toBe("https://models.lanaai.io/briefs/speech/vad/abc/silero_vad.onnx");
    expect(mirrorURL("briefs/a b/c", "https://mirror.test/")).toBe("https://mirror.test/briefs/a%20b/c");
    expect(UPSTREAM_FALLBACK).toBe(false);
  });

  it("treats only a lost connection or an HTTP error as an unreachable mirror", () => {
    expect(isMirrorUnreachable(new TypeError("fetch failed"))).toBe(true);
    expect(isMirrorUnreachable(new ModelDownloadError("http_status", 503))).toBe(true);
    expect(isMirrorUnreachable(new ModelDownloadError("checksum"))).toBe(false);
    expect(isMirrorUnreachable(new ModelDownloadError("incomplete"))).toBe(false);
    expect(isMirrorUnreachable(new DOMException("cancelled", "AbortError"))).toBe(false);
  });
});
