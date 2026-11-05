import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SILENT_LOG, type HandoffLog } from "../handoff/log.js";
import { BRIEFS_MANIFEST } from "./briefsManifest.js";
import { isMirrorUnreachable, isTrustedManifest, manifestPackage, trustedURL, UntrustedManifestError, UPSTREAM_FALLBACK, type BriefsManifest } from "./briefsMirror.js";
import { downloadFile, fileSha256, type FetchLike } from "./modelDownloader.js";

/**
 * The speech models Talk and meeting transcription use, downloaded once on request from
 * RedRooster's mirror (models.lanaai.io, the sherpa-onnx release files unpacked and checked
 * against the pinned manifest) into the app's models folder: Silero voice detection
 * and Parakeet TDT (the listener), Kokoro multi-lang v1.0 with its lexicon (the LANA voice),
 * and for meetings recorded here the pyannote segmentation 3.0 and TitaNet small speaker
 * models that tell voices apart (LANA transcription, with the listener's two).
 */
export type SpeechPackageID = "vad" | "parakeet" | "kokoro" | "segmentation" | "embedding";

/** A file that must be in place, with this size and SHA-256, for a package to count as installed. */
export interface SpeechModelFile {
  /** Relative to the models folder, with forward slashes. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Where the file is downloaded from: its immutable key on models.lanaai.io. */
  readonly url: string;
}

export interface SpeechModelPackage {
  readonly id: SpeechPackageID;
  /** The upstream download (GitHub releases), used only by the fallback. */
  readonly url: string;
  /** Size of the upstream download (the file itself, or the archive). */
  readonly downloadBytes: number;
  /** Upstream `file`: the download is the model file. `tar.bz2`: an archive with one top-level folder. */
  readonly format: "file" | "tar.bz2";
  /** The file name, or the archive's top-level folder, in the models folder. */
  readonly target: string;
  readonly files: readonly SpeechModelFile[];
}

const SPEECH_IDS: readonly SpeechPackageID[] = ["vad", "parakeet", "kokoro", "segmentation", "embedding"];

/**
 * A speech package from the pinned manifest: its files come one by one from the mirror. The
 * manifest's signature is checked first; when it does not verify, every URL is empty and the
 * store refuses to download.
 */
export function speechPackage(manifest: BriefsManifest, id: SpeechPackageID): SpeechModelPackage {
  const entry = manifestPackage(manifest, id);
  if (entry.kind !== "speech") throw new Error(`briefs_manifest_kind(${id})`);
  return {
    id,
    url: isTrustedManifest(manifest) ? entry.upstream.url : "",
    downloadBytes: entry.upstream.bytes,
    format: entry.upstream.format,
    target: entry.target,
    files: entry.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256, url: trustedURL(manifest, file.key) })),
  };
}

export const SPEECH_PACKAGES: readonly SpeechModelPackage[] = SPEECH_IDS.map((id) => speechPackage(BRIEFS_MANIFEST, id));

/**
 * The listener (voice detection and speech to text), the LANA voice, and LANA transcription
 * (the listener plus the speaker models) for meetings recorded here, as Settings, the Talk
 * intro and New meeting offer them. Packages two groups share are downloaded once.
 */
export const SPEECH_GROUPS = {
  listener: ["vad", "parakeet"],
  voice: ["kokoro"],
  transcription: ["vad", "parakeet", "segmentation", "embedding"],
} as const satisfies Record<string, readonly SpeechPackageID[]>;
export type SpeechGroup = keyof typeof SPEECH_GROUPS;

export class SpeechModelError extends Error {
  constructor(readonly code: "unsafe_archive" | "extract_failed" | "incomplete" | "unknown_package") {
    super(code);
    this.name = "SpeechModelError";
  }
}

export interface SpeechModelStoreOptions {
  /** The models folder (the app passes `userData/Models/speech`). */
  readonly directory: string;
  readonly packages?: readonly SpeechModelPackage[];
  readonly fetch?: FetchLike;
  /** The system `tar` (bsdtar on macOS and Windows 10 and later), for the upstream fallback. */
  readonly tar?: string;
  readonly log?: HandoffLog;
  /** Fetch the upstream archive when the mirror is unreachable (default `UPSTREAM_FALLBACK`, off). */
  readonly fallback?: boolean;
}

export interface InstallOptions {
  readonly progress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/** One package install in progress, shared by every caller that asks for it meanwhile. */
interface Flight {
  readonly done: Promise<void>;
  readonly controller: AbortController;
  readonly listeners: Set<(fraction: number) => void>;
  members: number;
  last: number;
}

/**
 * Installs, checks and removes the speech models. A package counts as installed only after
 * every one of its files was checked for size and SHA-256 (a marker records that); a
 * complete copy already in the folder is adopted without any network call. Each file is
 * downloaded on its own from the mirror into `<file>.part`, which a later attempt resumes.
 * One install per package runs at a time: a second request for a package already on its way
 * (LANA listening and LANA transcription both need Parakeet) waits on the first, and the
 * download stops only when every caller has cancelled. With the fallback on, archives from
 * upstream are listed before they are unpacked, refused if any entry is absolute, climbs
 * out with `..`, leaves the archive's one top-level folder or is a link, unpacked into a
 * staging folder of the attempt's own, checked, and only then moved into place.
 */
export class SpeechModelStore {
  readonly directory: string;
  private readonly packages: readonly SpeechModelPackage[];
  private readonly fetcher: FetchLike | undefined;
  private readonly tar: string;
  private readonly log: HandoffLog;
  private readonly fallback: boolean;
  private readonly flights = new Map<SpeechPackageID, Flight>();

  constructor(options: SpeechModelStoreOptions) {
    this.directory = options.directory;
    this.packages = options.packages ?? SPEECH_PACKAGES;
    this.fetcher = options.fetch;
    this.tar = options.tar ?? systemTar();
    this.log = options.log ?? SILENT_LOG;
    this.fallback = options.fallback ?? UPSTREAM_FALLBACK;
  }

  package(id: SpeechPackageID): SpeechModelPackage {
    const found = this.packages.find((candidate) => candidate.id === id);
    if (found === undefined) throw new SpeechModelError("unknown_package");
    return found;
  }

  /** Bytes to download for these packages from the mirror (the ones already installed included). */
  downloadBytes(ids: readonly SpeechPackageID[]): number {
    return ids.reduce((sum, id) => sum + filesBytes(this.package(id)), 0);
  }

  /** Whether this store's catalog has `id` (tests pass smaller catalogs). */
  knows(id: SpeechPackageID): boolean {
    return this.packages.some((candidate) => candidate.id === id);
  }

  /** Cheap check for screens: the marker plus every file present at its size. Unknown packages are not installed. */
  isInstalled(id: SpeechPackageID): boolean {
    if (!this.knows(id)) return false;
    const pkg = this.package(id);
    if (!existsSync(this.markerPath(id))) return false;
    return pkg.files.every((file) => statSync(join(this.directory, file.path), { throwIfNoEntry: false })?.size === file.bytes);
  }

  areInstalled(ids: readonly SpeechPackageID[]): boolean {
    return ids.every((id) => this.isInstalled(id));
  }

  /** True when a download of `id` was cut off and left a `.part` to resume. */
  hasPartial(id: SpeechPackageID): boolean {
    if (!this.knows(id) || this.isInstalled(id)) return false;
    const pkg = this.package(id);
    return pkg.files.some((file) => existsSync(join(this.directory, `${file.path}.part`))) || existsSync(join(this.directory, ".downloads", `${id}.tar.bz2.part`));
  }

  /** Installs every package in `ids` that is missing; progress runs 0 to 1 over their download sizes. */
  async installAll(ids: readonly SpeechPackageID[], options: InstallOptions = {}): Promise<void> {
    // Everything already installed and checked: ready at once, nothing fetched or unpacked.
    if (this.areInstalled(ids)) {
      options.progress?.(1);
      return;
    }
    const total = this.downloadBytes(ids);
    let done = 0;
    options.progress?.(0);
    for (const id of ids) {
      const weight = filesBytes(this.package(id));
      const base = done;
      await this.install(id, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        progress: (fraction) => options.progress?.(Math.min((base + fraction * weight) / total, 0.999)),
      });
      done += weight;
    }
    options.progress?.(1);
  }

  /** Installs one package, joining the install already on its way when there is one. */
  async install(id: SpeechPackageID, options: InstallOptions = {}): Promise<void> {
    const pkg = this.package(id);
    if (this.isInstalled(id)) {
      options.progress?.(1);
      return;
    }
    let flight = this.flights.get(id);
    // Every caller of that one cancelled: let it unwind, then start afresh.
    if (flight !== undefined && flight.controller.signal.aborted) {
      await flight.done.catch(() => undefined);
      flight = this.flights.get(id);
    }
    if (flight === undefined) {
      if (this.isInstalled(id)) {
        options.progress?.(1);
        return;
      }
      const controller = new AbortController();
      const listeners = new Set<(fraction: number) => void>();
      const started: Flight = {
        controller, listeners, members: 0, last: 0,
        done: this.installOnce(pkg, (fraction) => {
          started.last = fraction;
          for (const listener of listeners) listener(fraction);
        }, controller.signal).finally(() => {
          if (this.flights.get(id) === started) this.flights.delete(id);
        }),
      };
      // The flight's own rejection is observed by every member; this keeps an all-cancelled one quiet.
      started.done.catch(() => undefined);
      this.flights.set(id, started);
      flight = started;
    }
    return this.join(flight, options);
  }

  /** Deletes a package and any partial download of it. */
  async remove(id: SpeechPackageID): Promise<void> {
    const pkg = this.package(id);
    await rm(this.markerPath(id), { force: true });
    await rm(join(this.directory, pkg.target), { recursive: true, force: true });
    await rm(join(this.directory, `${pkg.target}.part`), { force: true });
    await rm(join(this.directory, ".downloads", `${pkg.id}.tar.bz2.part`), { force: true });
    await rm(join(this.directory, ".downloads", `${pkg.id}.tar.bz2`), { force: true });
    for (const name of await readdir(this.directory).catch(() => [] as string[])) {
      if (name === `.staging-${pkg.id}` || name.startsWith(`.staging-${pkg.id}-`)) await rm(join(this.directory, name), { recursive: true, force: true });
    }
  }

  /** True when every file of the package is in place with its size and SHA-256. */
  async verify(pkg: SpeechModelPackage, signal?: AbortSignal): Promise<boolean> {
    for (const file of pkg.files) {
      const path = join(this.directory, file.path);
      if (statSync(path, { throwIfNoEntry: false })?.size !== file.bytes) return false;
      if ((await fileSha256(path, signal)) !== file.sha256) return false;
    }
    return true;
  }

  private markerPath(id: SpeechPackageID): string {
    return join(this.directory, `.ready-speech-${id}`);
  }

  /** Follows a flight with this caller's progress and cancel; the flight stops when its last member cancels. */
  private join(flight: Flight, options: InstallOptions): Promise<void> {
    const { progress, signal } = options;
    flight.members += 1;
    if (progress !== undefined) {
      flight.listeners.add(progress);
      progress(flight.last);
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const leave = (): void => {
        settled = true;
        flight.members -= 1;
        if (progress !== undefined) flight.listeners.delete(progress);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = (): void => {
        if (settled) return;
        leave();
        if (flight.members === 0) flight.controller.abort();
        reject(signal?.reason ?? new DOMException("The download was cancelled.", "AbortError"));
      };
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      flight.done.then(
        () => {
          if (settled) return;
          leave();
          progress?.(1);
          resolve();
        },
        (error: unknown) => {
          if (settled) return;
          leave();
          reject(error);
        },
      );
    });
  }

  private async installOnce(pkg: SpeechModelPackage, report: (fraction: number) => void, signal: AbortSignal): Promise<void> {
    const id = pkg.id;
    await mkdir(this.directory, { recursive: true });
    if (await this.verify(pkg, signal)) {
      // A complete copy is already here (for example from an earlier install): adopt it.
      await writeFile(this.markerPath(id), "");
      report(1);
      this.log.info("speech_model.adopted", { model: id });
      return;
    }
    const capped = (fraction: number): void => report(Math.min(fraction, 0.99));
    try {
      try {
        await this.fromMirror(pkg, capped, signal);
      } catch (error) {
        if (!this.fallback || signal.aborted || !isMirrorUnreachable(error)) throw error;
        this.log.notice("speech_model.mirror_unreachable", { model: id });
        await this.fromUpstream(pkg, capped, signal);
      }
      if (!(await this.verify(pkg, signal))) throw new SpeechModelError("incomplete");
    } catch (error) {
      this.log.error("speech_model.install_failed", { model: id, reason: error instanceof Error ? error.message.slice(0, 40) : "unknown" });
      throw error;
    }
    await writeFile(this.markerPath(id), "");
    // An archive an earlier version was fetching is not needed any more.
    await rm(join(this.directory, ".downloads", `${id}.tar.bz2.part`), { force: true });
    await rm(join(this.directory, ".downloads", `${id}.tar.bz2`), { force: true });
    report(1);
    this.log.info("speech_model.installed", { model: id });
  }

  /** Each file on its own from the mirror, resuming its `.part`, checked for size and SHA-256. */
  private async fromMirror(pkg: SpeechModelPackage, report: (fraction: number) => void, signal: AbortSignal): Promise<void> {
    const total = Math.max(filesBytes(pkg), 1);
    let done = 0;
    if (pkg.files.some((file) => file.url === "")) throw new UntrustedManifestError();
    for (const file of pkg.files) {
      const path = join(this.directory, file.path);
      await mkdir(dirname(path), { recursive: true });
      const base = done;
      await downloadFile(
        { url: file.url, path, bytes: file.bytes, sha256: file.sha256 },
        { ...(this.fetcher === undefined ? {} : { fetch: this.fetcher }), signal, progress: (fraction) => report((base + fraction * file.bytes) / total) },
      );
      done += file.bytes;
    }
  }

  /** The fallback: the upstream file or archive, as before the mirror. */
  private async fromUpstream(pkg: SpeechModelPackage, report: (fraction: number) => void, signal: AbortSignal): Promise<void> {
    if (pkg.url === "") throw new UntrustedManifestError();
    const shared = { ...(this.fetcher === undefined ? {} : { fetch: this.fetcher }), signal, progress: report };
    if (pkg.format === "file") {
      const file = pkg.files[0]!;
      await downloadFile({ url: pkg.url, path: join(this.directory, file.path), bytes: file.bytes, sha256: file.sha256 }, shared);
      return;
    }
    const downloads = join(this.directory, ".downloads");
    await mkdir(downloads, { recursive: true });
    const archive = join(downloads, `${pkg.id}.tar.bz2`);
    await downloadFile({ url: pkg.url, path: archive, bytes: pkg.downloadBytes }, shared);
    await this.unpack(pkg, archive);
    await rm(archive, { force: true });
  }

  private async unpack(pkg: SpeechModelPackage, archive: string): Promise<void> {
    const names = (await run(this.tar, ["-tjf", archive])).split("\n").filter((line) => line.length > 0);
    const verbose = (await run(this.tar, ["-tvjf", archive])).split("\n").filter((line) => line.length > 0);
    if (names.length === 0 || !names.every((name) => isSafeEntry(name, pkg.target))) throw new SpeechModelError("unsafe_archive");
    // Regular files and folders only: no symbolic or hard links, devices or fifos.
    if (!verbose.every((line) => line.startsWith("-") || line.startsWith("d"))) throw new SpeechModelError("unsafe_archive");
    // A staging folder of this attempt's own.
    const staging = await mkdtemp(join(this.directory, `.staging-${pkg.id}-`));
    try {
      await run(this.tar, ["-xjf", archive, "-C", staging]);
      if (await containsLink(staging)) throw new SpeechModelError("unsafe_archive");
      const destination = join(this.directory, pkg.target);
      await rm(destination, { recursive: true, force: true });
      await rename(join(staging, pkg.target), destination);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

function filesBytes(pkg: SpeechModelPackage): number {
  return pkg.files.reduce((sum, file) => sum + file.bytes, 0);
}

/** An archive entry that stays inside `top`: relative, no `..`, no drive letters or backslash roots. */
export function isSafeEntry(name: string, top: string): boolean {
  if (name.includes("\0")) return false;
  if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.split(/[\\/]+/).filter((part) => part.length > 0 && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) return false;
  return parts[0] === top;
}

async function containsLink(folder: string): Promise<boolean> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) return true;
    if (info.isDirectory() && (await containsLink(path))) return true;
  }
  return false;
}

function systemTar(): string {
  if (process.platform === "win32") return join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe");
  return existsSync("/usr/bin/tar") ? "/usr/bin/tar" : "tar";
}

/** Runs a program with arguments (no shell) and returns its standard output. */
function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.resume();
    child.on("error", () => reject(new SpeechModelError("extract_failed")));
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out).toString("utf8")) : reject(new SpeechModelError("extract_failed"))));
  });
}
