import { existsSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SILENT_LOG, type HandoffLog } from "../handoff/log.js";
import { downloadFile, fileSha256, type FetchLike } from "./modelDownloader.js";

/**
 * The speech models Talk and meeting transcription use, downloaded once on request into the
 * app's models folder: voice detection and speech to text (the listener), the LANA voice,
 * and for meetings recorded here the two speaker models that tell voices apart (LANA
 * transcription, with the listener's two). The packages, their files and their pins come
 * from the LANA client's model catalog (electron-local-models.js SPEECH_CATALOG): one list
 * for every model the client downloads, each file on models.lanaai.io with its size and
 * SHA-256.
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
  /** The file, or the folder its files live in, in the models folder. */
  readonly target: string;
  readonly files: readonly SpeechModelFile[];
}

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
  constructor(readonly code: "incomplete" | "unknown_package" | "unpinned") {
    super(code);
    this.name = "SpeechModelError";
  }
}

export interface SpeechModelStoreOptions {
  /** The models folder (the app passes `userData/Models/speech`). */
  readonly directory: string;
  /** The client's catalog (`speechPackages()` in electron-local-models.js). */
  readonly packages: readonly SpeechModelPackage[];
  readonly fetch?: FetchLike;
  readonly log?: HandoffLog;
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
 * download stops only when every caller has cancelled.
 */
export class SpeechModelStore {
  readonly directory: string;
  private readonly packages: readonly SpeechModelPackage[];
  private readonly fetcher: FetchLike | undefined;
  private readonly log: HandoffLog;
  private readonly flights = new Map<SpeechPackageID, Flight>();

  constructor(options: SpeechModelStoreOptions) {
    this.directory = options.directory;
    this.packages = options.packages;
    this.fetcher = options.fetch;
    this.log = options.log ?? SILENT_LOG;
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
    return pkg.files.some((file) => existsSync(join(this.directory, `${file.path}.part`)));
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
      await this.download(pkg, capped, signal);
      if (!(await this.verify(pkg, signal))) throw new SpeechModelError("incomplete");
    } catch (error) {
      this.log.error("speech_model.install_failed", { model: id, reason: error instanceof Error ? error.message.slice(0, 40) : "unknown" });
      throw error;
    }
    await writeFile(this.markerPath(id), "");
    report(1);
    this.log.info("speech_model.installed", { model: id });
  }

  /** Each file on its own from models.lanaai.io, resuming its `.part`, checked for size and SHA-256. */
  private async download(pkg: SpeechModelPackage, report: (fraction: number) => void, signal: AbortSignal): Promise<void> {
    const total = Math.max(filesBytes(pkg), 1);
    let done = 0;
    // Only files the catalog pins (an https URL, a size and a SHA-256) are fetched.
    if (!pkg.files.every(isPinned)) throw new SpeechModelError("unpinned");
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
}

function filesBytes(pkg: SpeechModelPackage): number {
  return pkg.files.reduce((sum, file) => sum + file.bytes, 0);
}

/** A file the catalog pins: an https URL, a size and a SHA-256 (the client's catalog is in its signed code). */
function isPinned(file: SpeechModelFile): boolean {
  try {
    const url = new URL(file.url);
    return url.protocol === "https:" && /^[a-f0-9]{64}$/.test(file.sha256) && file.bytes > 0;
  } catch {
    return false;
  }
}
