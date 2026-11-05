import { LanaRuntimeTextModel, SPEECH_GROUPS, SpeechModelStore, type RuntimePurpose, type SpeechPackageID } from "@lana/core/model";
import { transcriptionModelPaths, type TranscriptionModelPaths } from "@lana/core/recording";
import type { TextModel } from "@lana/core/runtime";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelID, ModelState, ModelStatus, ModelsApi, ModelsStatus, PlatformInfo } from "../../../shared/api.js";
import type { MainLog } from "../../log.js";

const PROGRESS_STEP = 0.005;

const FAILED: Record<Exclude<ModelID, "ask">, string> = {
  listener: "The listener could not be downloaded. Check the connection and try again.",
  voice: "The LANA voice could not be downloaded. Check the connection and try again.",
  transcription: "LANA transcription could not be downloaded. Check the connection and try again.",
};

/** Removing LANA transcription keeps the listener's models, which Talk also uses. */
const TRANSCRIPTION_ONLY: readonly SpeechPackageID[] = ["segmentation", "embedding"];

/** The models this service downloads. The language model is LANA's (see `textModel`). */
const SPEECH_MODEL_IDS: readonly SpeechModelID[] = ["listener", "voice", "transcription"];

type SpeechModelID = Exclude<ModelID, "ask">;

/**
 * For a `.part` left without a pending mark (a download an earlier version started): the
 * model a cut-off package belongs to. Parakeet resumes as LANA listening, which LANA
 * transcription then finds installed.
 */
const PACKAGE_MODEL: Readonly<Record<SpeechPackageID, Exclude<ModelID, "ask">>> = {
  vad: "listener",
  parakeet: "listener",
  kokoro: "voice",
  segmentation: "transcription",
  embedding: "transcription",
};

/** LANA's runtime, as the client knows it: the local AI engine's address and the person's session. */
export interface LanaRuntimeAccess {
  engineBase(): string | null;
  token(): string | null;
}

export interface ModelServiceOptions {
  /** `userData/Models`: `speech` lives under it. */
  readonly directory: string;
  readonly platform: PlatformInfo;
  readonly emit: (status: ModelsStatus) => void;
  readonly log: MainLog;
  /** Where Briefs' language model work goes: LANA's runtime (Workstream R). */
  readonly runtime: LanaRuntimeAccess;
  readonly speech?: SpeechModelStore;
}

/** "2.5 GB", "480 MB" (decimal, like the Mac's ByteCountFormatter). */
export function sizeText(bytes: number): string {
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

/**
 * Owns the speech models (the Talk listener, the LANA voice, LANA transcription): downloads
 * start only on request, report progress and resume after a cut-off. The language model is
 * LANA's: `textModel` sends Briefs' work to LANA's runtime, which picks the model on this
 * computer or Forge under the matter's AI policy, so there is nothing to download, load or
 * unload here.
 */
export class ModelService implements ModelsApi {
  readonly speech: SpeechModelStore;
  private readonly transient = new Map<SpeechModelID, ModelState>();
  private readonly running = new Map<SpeechModelID, { controller: AbortController; done: Promise<void> }>();

  constructor(private readonly options: ModelServiceOptions) {
    this.speech = options.speech ?? new SpeechModelStore({ directory: join(options.directory, "speech"), log: options.log });
  }

  // MARK: - ModelsApi

  async status(): Promise<ModelsStatus> {
    return this.snapshot();
  }

  /** LANA's model has nothing to download here; the speech models download on request. */
  async download(id: ModelID): Promise<ModelsStatus> {
    if (id !== "ask") void this.ensure(id).catch(() => undefined);
    return this.snapshot();
  }

  async remove(id: ModelID): Promise<ModelsStatus> {
    if (id === "ask") return this.snapshot();
    const running = this.running.get(id);
    running?.controller.abort();
    await running?.done.catch(() => undefined);
    for (const pkg of id === "transcription" ? TRANSCRIPTION_ONLY : this.packages(id)) await this.speech.remove(pkg);
    this.clearPending(id);
    this.transient.delete(id);
    this.options.log.info("models.removed", { model: id });
    return this.publish();
  }

  // MARK: - Public

  sizeTextFor(id: ModelID): string {
    return this.snapshot()[id].sizeText;
  }

  /** The speech downloads together, for "about 833 MB". */
  downloadSizeText(ids: ReadonlyArray<SpeechModelID>): string {
    return sizeText(this.speech.downloadBytes(ids.flatMap((id) => [...SPEECH_GROUPS[id]])));
  }

  /** Where LANA transcription's files are once downloaded. */
  transcriptionPaths(): TranscriptionModelPaths {
    return transcriptionModelPaths(join(this.options.directory, "speech"));
  }

  /** For "ask": whether LANA's runtime can be reached (the engine is running and this person is signed in). */
  isReady(id: ModelID): boolean {
    return id === "ask" ? this.runtimeReachable() : this.speech.areInstalled(this.packages(id));
  }

  /**
   * At launch: picks up every download that was cut off (the app quit, the computer slept
   * through it, the connection dropped), each from where its `.part` files stopped. A model
   * whose download was asked for and not finished carries a pending mark; a `.part` with no
   * mark resumes as the model its package belongs to.
   */
  resumePending(): SpeechModelID[] {
    const resumed = SPEECH_MODEL_IDS.filter((id) => !this.isReady(id) && (existsSync(this.pendingPath(id)) || this.hasPartial(id)));
    for (const id of resumed) {
      this.options.log.info("models.download_resumed", { model: id });
      void this.ensure(id).catch(() => undefined);
    }
    return resumed;
  }

  /** Downloads `id` if needed and resolves when it is ready (the Talk intro waits on the listener). */
  ensure(id: SpeechModelID, progress?: (fraction: number) => void): Promise<void> {
    if (this.isReady(id)) {
      this.clearPending(id);
      progress?.(1);
      return Promise.resolve();
    }
    const existing = this.running.get(id);
    if (existing !== undefined) return this.follow(id, existing.done, progress);
    const controller = new AbortController();
    let last = -1;
    const report = (fraction: number): void => {
      progress?.(fraction);
      if (fraction < 1 && fraction - last < PROGRESS_STEP) return;
      last = fraction;
      this.transient.set(id, { kind: "downloading", progress: fraction });
      this.publish();
    };
    this.transient.set(id, { kind: "downloading", progress: 0 });
    this.markPending(id);
    this.options.log.info("models.download_started", { model: id });
    const work = this.speech.installAll(this.packages(id), { progress: report, signal: controller.signal });
    const done = work.then(
      () => {
        this.transient.delete(id);
        this.clearPending(id);
        this.options.log.info("models.download_finished", { model: id });
      },
      (error: unknown) => {
        if (controller.signal.aborted) this.transient.delete(id);
        else this.transient.set(id, { kind: "failed", message: FAILED[id] });
        this.options.log.notice("models.download_failed", { model: id, reason: error instanceof Error ? error.message.slice(0, 40) : "unknown" });
        throw error;
      },
    ).finally(() => {
      this.running.delete(id);
      this.publish();
    });
    this.running.set(id, { controller, done });
    this.publish();
    return done;
  }

  /**
   * LANA's runtime as the `TextModel` for one kind of work. The purpose tells LANA what the
   * work is; background work (notes, drafts) waits behind what a person is waiting on.
   */
  textModel(purpose: RuntimePurpose): TextModel {
    const background = purpose === "briefs.notes" || purpose === "briefs.clips" || purpose === "briefs.actions";
    return new LanaRuntimeTextModel({
      engineBase: () => this.options.runtime.engineBase(),
      token: () => this.options.runtime.token(),
      purpose,
      priority: background ? "background" : "foreground",
    });
  }

  async stop(): Promise<void> {
    for (const running of this.running.values()) running.controller.abort();
  }

  // MARK: - Private

  private runtimeReachable(): boolean {
    return this.options.runtime.engineBase() !== null && this.options.runtime.token() !== null;
  }

  private packages(id: SpeechModelID): readonly SpeechPackageID[] {
    return SPEECH_GROUPS[id];
  }

  /** A cut-off download of `id` that no pending mark names (see `PACKAGE_MODEL`). */
  private hasPartial(id: SpeechModelID): boolean {
    return this.packages(id).some((pkg) => this.speech.knows(pkg) && PACKAGE_MODEL[pkg] === id && this.speech.hasPartial(pkg));
  }

  private pendingPath(id: ModelID): string {
    return join(this.options.directory, `.pending-${id}`);
  }

  private markPending(id: ModelID): void {
    try {
      mkdirSync(this.options.directory, { recursive: true });
      writeFileSync(this.pendingPath(id), "");
    } catch {
      // Best effort: the `.part` files still resume the download.
    }
  }

  private clearPending(id: ModelID): void {
    rmSync(this.pendingPath(id), { force: true });
  }

  /** What a download of `id` still fetches: the packages not already installed (all of them when none are). */
  private missingBytes(id: SpeechModelID): number {
    const known = this.packages(id).filter((pkg) => this.speech.knows(pkg));
    const missing = known.filter((pkg) => !this.speech.isInstalled(pkg));
    return this.speech.downloadBytes(missing.length === 0 ? known : missing);
  }

  private follow(id: SpeechModelID, done: Promise<void>, progress?: (fraction: number) => void): Promise<void> {
    if (progress === undefined) return done;
    const timer = setInterval(() => {
      const state = this.transient.get(id);
      if (state?.kind === "downloading") progress(state.progress);
    }, 250);
    return done.finally(() => clearInterval(timer)).then(() => progress(1));
  }

  /** The state one model shows on screen. */
  snapshotState(id: ModelID): ModelState {
    if (id === "ask") return this.runtimeReachable() ? { kind: "ready" } : { kind: "notDownloaded" };
    return this.transient.get(id) ?? (this.isReady(id) ? { kind: "ready" } : { kind: "notDownloaded" });
  }

  private snapshot(): ModelsStatus {
    const noun = this.options.platform.deviceNoun;
    const ask: ModelStatus = {
      id: "ask",
      title: "LANA model",
      detail: "LANA writes your notes and answers with the model LANA manages. Nothing to download here.",
      sizeText: "",
      state: this.snapshotState("ask"),
      shared: true,
    };
    return {
      ask,
      listener: { id: "listener", title: "LANA listening", detail: `Hears you in Talk with LANA: voice detection and speech to text, on this ${noun}.`, sizeText: sizeText(this.speech.downloadBytes(SPEECH_GROUPS.listener)), state: this.snapshotState("listener"), shared: false },
      voice: { id: "voice", title: "LANA voice", detail: `A natural voice that runs on this ${noun}.`, sizeText: sizeText(this.speech.downloadBytes(SPEECH_GROUPS.voice)), state: this.snapshotState("voice"), shared: false },
      transcription: {
        id: "transcription",
        title: "LANA transcription",
        detail: `Transcribes meetings you record here and tells the speakers apart, on this ${noun}.`,
        sizeText: sizeText(this.missingBytes("transcription")),
        state: this.snapshotState("transcription"),
        shared: false,
      },
    };
  }

  private publish(): ModelsStatus {
    const status = this.snapshot();
    this.options.emit(status);
    return status;
  }
}
