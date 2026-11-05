import { makeLanaId, parseLanaId, type LanaId } from "@lana/core/ids";
import type { ConsentRecord, Speaker, TranscriptSegment, UserNote } from "@lana/core/intent";
import {
  AAC_SAMPLES_PER_FRAME, audioParts, localMeetingRecord, packFrames, packPcm, RECORDING_SAMPLE_RATE, RecordingJournal, TRANSCRIPTION_SAMPLE_RATE, unpackFrames,
  type RecordingSealer, type TranscriptionModelPaths,
} from "@lana/core/recording";
import type { GatewayStore } from "@lana/core/store";
import { join } from "node:path";
import type {
  LanaEvent, RecordingApi, RecordingAudioCommand, RecordingFrame, RecordingPermissions, RecordingStart, RecordingView, Result,
} from "../../../shared/api.js";
import type { MainLog } from "../../log.js";
import type { NotesOutcome, NotesWriting } from "./notesWriter.js";

/** How long the window has to open the microphone and the meeting audio. */
const CAPTURE_TIMEOUT_MS = 20_000;
/** How long the window has to flush its encoder after Stop. */
const STOP_TIMEOUT_MS = 5_000;
/** Audio is sealed into the journal about this often, so a crash loses at most this much. */
const FLUSH_SAMPLES = TRANSCRIPTION_SAMPLE_RATE;
/** Recording stops on its own here (memory for transcribing the whole meeting at once). */
export const MAXIMUM_RECORDING_SECONDS = 3 * 60 * 60;
const TICK_MS = 1_000;

const NO_TRANSCRIPTION = "LANA transcription is needed to record. Get it in Settings, Voice and speech.";
const MIC_DENIED = "LANA cannot use the microphone. Allow LANA Briefs in System Settings, Privacy and Security, Microphone, then try again.";
const MIC_UNAVAILABLE = "LANA could not open the microphone. Check that one is connected, then try again.";
const MEETING_AUDIO_OFF = "Only your microphone is being recorded. To record the other people in the call, allow LANA Briefs in System Settings, Privacy and Security, Screen and System Audio Recording, then quit and reopen LANA Briefs.";
const SAVE_FAILED = "LANA could not save this recording. It is kept encrypted on this computer and LANA tries again the next time it opens.";
const TRANSCRIBE_FAILED = "The meeting and its audio are saved. LANA could not make the transcript; it tries again the next time it opens.";
const UNREADABLE_FILE = "LANA could not read that file. Pick an audio recording: m4a, mp3, wav or caf.";
const NOTES_UNAVAILABLE = "The transcript is ready. The LANA model is needed to write notes: get it in Settings, Ask, then click Write notes on the meeting.";
const NOTES_FAILED = "The transcript is ready. LANA could not write the notes; click Write notes on the meeting to try again.";
const NOTES_BUSY = { code: "busy", message: "LANA is already writing notes. Try again when it finishes." } as const;
const BUSY = { code: "busy", message: "A recording is already in progress." } as const;

/** Whole-meeting transcription, in a worker thread in the app. */
export interface MeetingTranscription {
  transcribe(models: TranscriptionModelPaths, pcm: Uint8Array[], progress: (fraction: number) => void): Promise<{ speakers: Speaker[]; transcript: TranscriptSegment[] }>;
}

export interface RecordingServiceOptions {
  readonly store: GatewayStore;
  /** Where journals of recordings in progress live (next to the store). */
  readonly directory?: string;
  readonly emit: (event: LanaEvent) => void;
  readonly log: MainLog;
  readonly appVersion: string;
  readonly transcription: MeetingTranscription;
  /** LANA transcription: whether it is downloaded, where its files are, and memory to free before it loads. */
  readonly models: { isReady(): boolean; paths(): TranscriptionModelPaths };
  readonly permissions: () => RecordingPermissions;
  readonly openPrivacySettings: (kind: "microphone" | "meetingAudio") => Promise<void>;
  readonly requestMicrophone: () => Promise<boolean>;
  /** While true, the window's display-media request gets the system audio (loopback). */
  readonly armMeetingAudio: (armed: boolean) => void;
  /** A meeting recorded here was stored or changed (ids only): the sidebar and the Inbox refresh. */
  readonly meetingStored: (meetingID: string) => void;
  /** LANA's notes after transcription. Absent: the meeting is done once transcribed. */
  readonly notes?: NotesWriting;
  readonly now?: () => Date;
}

/** What the journal's metadata holds. Sealed; never logged. */
interface JournalMeta {
  state: "recording" | "stopped" | "stored";
  title: string;
  startedAt: string;
  consent: { method: ConsentRecord["method"]; confirmedBy: string[]; confirmedAt: string; jurisdictionNote?: string };
  /** The encoder's AudioSpecificConfig, base64. */
  config?: string;
}

interface Active {
  id: LanaId;
  journal: RecordingJournal;
  meta: JournalMeta;
  pcmMic: Float32Array[];
  pcmSystem: Float32Array[];
  pendingSamples: number;
  aac: Uint8Array[];
  samples: number;
  notes: Array<{ id: string; text: string; anchor: number }>;
}

/**
 * Records a meeting on this computer (the phone's recorder, consent and refine). The window
 * captures the microphone and the meeting audio and sends 16 kHz frames plus AAC frames;
 * this seals them into a journal as they arrive. Stop stores the meeting (origin computer,
 * audio in the phone's format), then transcribes it in a worker. A crash leaves the journal,
 * which is stored and transcribed at the next launch. Logs carry ids and states only.
 */
export class RecordingService implements RecordingApi {
  private view: RecordingView = idleView();
  private active: Active | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout | null = null;
  private stopWaiter: (() => void) | null = null;
  private readonly directory: string;
  private readonly sealer: RecordingSealer;
  private work: Promise<void> = Promise.resolve();
  /** The meeting LANA is writing notes for, if any (one at a time: one model in memory). */
  private writing: string | null = null;
  /** Recordings queued to store and transcribe, so a recovery never runs one twice. */
  private readonly queued = new Set<string>();

  constructor(private readonly options: RecordingServiceOptions) {
    this.directory = options.directory ?? join(options.store.directory, "recordings");
    this.sealer = { seal: (data, context) => options.store.seal(data, context), open: (data, context) => options.store.open(data, context) };
  }

  // MARK: - Lifecycle

  /** Stores and transcribes recordings a crash or quit left behind. Runs in the background. */
  recover(): Promise<void> {
    const ids = RecordingJournal.list(this.directory).filter((id) => parseLanaId(id, "meeting") !== null && id !== this.active?.id && !this.queued.has(id));
    for (const id of ids) this.enqueue(id as LanaId, true);
    return this.work;
  }

  /** Resolves when every stored recording has been saved and transcribed (tests). */
  idle(): Promise<void> {
    return this.work;
  }

  /** Quitting: a recording in progress stops and is stored now; transcription waits for the next launch. */
  async shutdown(): Promise<void> {
    this.clearTimers();
    const active = this.active;
    if (active === null) return;
    this.active = null;
    try {
      this.flush(active);
      active.meta.state = "stopped";
      active.journal.writeMeta(active.meta);
      active.journal.close();
      this.options.log.info("recording.stopped_on_quit", { meeting: active.id });
    } catch {
      this.options.log.error("recording.quit_flush_failed", { meeting: active.id });
    }
  }

  // MARK: - RecordingApi

  async state(): Promise<RecordingView> {
    return this.view;
  }

  async permissions(): Promise<RecordingPermissions> {
    return this.options.permissions();
  }

  async openPrivacySettings(kind: "microphone" | "meetingAudio"): Promise<void> {
    await this.options.openPrivacySettings(kind === "meetingAudio" ? "meetingAudio" : "microphone");
  }

  async start(request: RecordingStart): Promise<Result<RecordingView>> {
    if (!(await this.options.requestMicrophone())) return { ok: false, error: { code: "microphoneDenied", message: MIC_DENIED } };
    const opened = this.open(request, "starting");
    if (!opened.ok) return opened;
    this.options.armMeetingAudio(true);
    this.command({ kind: "start" });
    this.captureTimer = setTimeout(() => void this.captureFailed("unavailable"), CAPTURE_TIMEOUT_MS);
    return opened;
  }

  async beginImport(request: RecordingStart): Promise<Result<RecordingView>> {
    const opened = this.open(request, "importing");
    if (opened.ok) this.options.log.info("recording.import_started", { meeting: this.active!.id });
    return opened;
  }

  async importProgress(fraction: number): Promise<void> {
    if (this.view.phase !== "importing" || !Number.isFinite(fraction)) return;
    this.publish({ ...this.view, progress: Math.max(0, Math.min(1, fraction)), elapsedSeconds: Math.floor((this.active?.samples ?? 0) / TRANSCRIPTION_SAMPLE_RATE) });
  }

  async finishImport(): Promise<RecordingView> {
    const active = this.active;
    if (active === null || this.view.phase !== "importing") return this.view;
    if (active.samples === 0) return this.cancelImport("unreadable");
    this.active = null;
    this.close(active);
    this.options.log.info("recording.imported", { meeting: active.id, seconds: Math.round(active.samples / TRANSCRIPTION_SAMPLE_RATE) });
    this.enqueue(active.id, false);
    return this.view;
  }

  async cancelImport(reason: "unreadable" | "cancelled"): Promise<RecordingView> {
    const active = this.active;
    if (active === null || this.view.phase !== "importing") return this.view;
    this.active = null;
    active.journal.remove();
    this.publish(reason === "unreadable" ? { ...idleView(), phase: "failed", message: UNREADABLE_FILE } : idleView());
    this.options.log.notice("recording.import_cancelled", { meeting: active.id, reason });
    return this.view;
  }

  /** A new journal for a recording or an import. */
  private open(request: RecordingStart, phase: "starting" | "importing"): Result<RecordingView> {
    if (this.view.phase !== "idle" && this.view.phase !== "done" && this.view.phase !== "failed") return { ok: false, error: BUSY };
    if (!this.options.models.isReady()) return { ok: false, error: { code: "transcriptionMissing", message: NO_TRANSCRIPTION } };
    const now = this.now();
    const id = makeLanaId("meeting", now);
    const title = String(request.title ?? "").trim().slice(0, 200) || defaultTitle(now);
    const participants = (Array.isArray(request.participants) ? request.participants : []).map((name) => String(name).trim().slice(0, 120)).filter((name) => name !== "");
    const note = String(request.jurisdictionNote ?? "").trim().slice(0, 280);
    const meta: JournalMeta = {
      state: "recording",
      title,
      startedAt: now.toISOString(),
      consent: {
        method: request.consent === "allPartiesConfirmed" ? "all_parties_confirmed" : "verbal_announced",
        confirmedBy: participants,
        confirmedAt: now.toISOString(),
        ...(note === "" ? {} : { jurisdictionNote: note }),
      },
    };
    let journal: RecordingJournal;
    try {
      journal = RecordingJournal.create(this.directory, id, this.sealer);
      journal.writeMeta(meta);
    } catch {
      this.options.log.error("recording.journal_failed", { meeting: id });
      return { ok: false, error: { code: "store", message: "LANA could not start an encrypted recording on this computer." } };
    }
    this.active = { id, journal, meta, pcmMic: [], pcmSystem: [], pendingSamples: 0, aac: [], samples: 0, notes: [] };
    this.publish({ phase, meetingID: id, title, elapsedSeconds: 0, meetingAudio: phase === "importing" ? "off" : "pending", progress: 0, message: null });
    this.options.log.info("recording.opened", { meeting: id, consent: meta.consent.method, kind: phase });
    return { ok: true, value: this.view };
  }

  /** Seals what is buffered and marks the journal stopped, ready to store. */
  private close(active: Active): void {
    this.publish({ ...this.view, phase: "saving", elapsedSeconds: active.samples / TRANSCRIPTION_SAMPLE_RATE, progress: 0 });
    try {
      this.flush(active);
      active.meta.state = "stopped";
      active.journal.writeMeta(active.meta);
      active.journal.writeNotes(active.notes);
      active.journal.close();
    } catch {
      this.options.log.error("recording.stop_flush_failed", { meeting: active.id });
    }
  }

  async captureStarted(meetingAudio: boolean): Promise<void> {
    if (this.active === null || this.view.phase !== "starting") return;
    this.clearCaptureTimer();
    this.options.armMeetingAudio(false);
    this.publish({ ...this.view, phase: "recording", meetingAudio: meetingAudio ? "on" : "off", message: meetingAudio ? null : MEETING_AUDIO_OFF });
    this.tick = setInterval(() => this.onTick(), TICK_MS);
    this.tick.unref();
    this.options.log.info("recording.started", { meeting: this.active.id, meeting_audio: meetingAudio });
  }

  async captureFailed(reason: "denied" | "unavailable"): Promise<void> {
    const active = this.active;
    if (active === null || this.view.phase !== "starting") return;
    this.clearTimers();
    this.options.armMeetingAudio(false);
    this.active = null;
    active.journal.remove();
    this.command({ kind: "stop" });
    this.publish({ ...idleView(), phase: "failed", message: reason === "denied" ? MIC_DENIED : MIC_UNAVAILABLE });
    this.options.log.notice("recording.capture_failed", { meeting: active.id, reason });
  }

  /** One frame from `RECORDING_FRAME_CHANNEL`. Dropped unless recording (not paused). */
  frame(frame: RecordingFrame): void {
    const active = this.active;
    if (active === null || (this.view.phase !== "recording" && this.view.phase !== "importing")) return;
    if (!(frame.mic instanceof Float32Array) || !(frame.system instanceof Float32Array) || frame.mic.length !== frame.system.length) return;
    if (frame.config instanceof Uint8Array && active.meta.config === undefined) {
      active.meta.config = Buffer.from(frame.config).toString("base64");
      active.journal.writeMeta(active.meta);
    }
    active.pcmMic.push(frame.mic);
    active.pcmSystem.push(frame.system);
    active.pendingSamples += frame.mic.length;
    active.samples += frame.mic.length;
    for (const chunk of Array.isArray(frame.aac) ? frame.aac : []) if (chunk instanceof Uint8Array && chunk.length > 0) active.aac.push(chunk);
    if (active.pendingSamples >= FLUSH_SAMPLES) this.flushSafely(active);
    if (active.samples / TRANSCRIPTION_SAMPLE_RATE >= MAXIMUM_RECORDING_SECONDS) {
      if (this.view.phase === "importing") void this.finishImport();
      else void this.stop();
    }
  }

  async pause(): Promise<RecordingView> {
    if (this.active === null || this.view.phase !== "recording") return this.view;
    this.flushSafely(this.active);
    this.command({ kind: "pause" });
    this.publish({ ...this.view, phase: "paused" });
    return this.view;
  }

  async resume(): Promise<RecordingView> {
    if (this.active === null || this.view.phase !== "paused") return this.view;
    this.command({ kind: "resume" });
    this.publish({ ...this.view, phase: "recording" });
    return this.view;
  }

  async stop(): Promise<RecordingView> {
    const active = this.active;
    if (active === null || (this.view.phase !== "recording" && this.view.phase !== "paused")) return this.view;
    // Frames still in flight are kept until the window says its encoder is flushed.
    this.publish({ ...this.view, phase: "recording" });
    this.clearTimers();
    const stopped = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, STOP_TIMEOUT_MS);
      this.stopWaiter = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.command({ kind: "stop" });
    await stopped;
    this.stopWaiter = null;
    this.active = null;
    this.close(active);
    this.options.log.info("recording.stopped", { meeting: active.id, seconds: Math.round(active.samples / TRANSCRIPTION_SAMPLE_RATE) });
    this.enqueue(active.id, false);
    return this.view;
  }

  async captureStopped(): Promise<void> {
    this.stopWaiter?.();
  }

  async saveNotes(notes: Array<{ id: string; text: string; anchor: number }>): Promise<void> {
    const active = this.active;
    if (active === null || !Array.isArray(notes)) return;
    active.notes = notes
      .filter((note) => typeof note?.text === "string" && note.text.trim() !== "")
      .slice(0, 500)
      .map((note) => ({ id: String(note.id).slice(0, 64), text: note.text.slice(0, 10_000), anchor: Number.isFinite(note.anchor) ? Math.max(0, note.anchor) : 0 }));
    try {
      active.journal.writeNotes(active.notes);
    } catch {
      this.options.log.error("recording.notes_failed", { meeting: active.id });
    }
  }

  async dismiss(): Promise<RecordingView> {
    if (this.view.phase === "done" || this.view.phase === "failed") this.publish(idleView());
    return this.view;
  }

  // MARK: - After Stop

  /** Stores the journal as a meeting (if not yet), then transcribes it. `recovered`: found at launch. */
  private async finish(id: LanaId, recovered: boolean): Promise<void> {
    const journal = RecordingJournal.reopen(this.directory, id, this.sealer);
    const meta = journal.readMeta() as JournalMeta | null;
    if (meta === null) {
      journal.close();
      this.options.log.error("recording.journal_unreadable", { meeting: id });
      return;
    }
    const show = !recovered;
    if (meta.state !== "stored") {
      try {
        this.store(id, journal, meta);
        meta.state = "stored";
        journal.writeMeta(meta);
        this.options.meetingStored(id);
        this.options.log.info("recording.stored", { meeting: id, recovered });
      } catch {
        journal.close();
        this.options.log.error("recording.store_failed", { meeting: id });
        if (show) this.publish({ ...this.view, phase: "failed", meetingID: null, message: SAVE_FAILED });
        return;
      }
    }
    if (!this.options.models.isReady()) {
      journal.close();
      if (show) this.publish({ ...this.view, phase: "done", meetingID: id, progress: 1, message: TRANSCRIBE_FAILED });
      return;
    }
    if (show) this.publish({ ...this.view, phase: "transcribing", meetingID: id, progress: 0 });
    try {
      const pcm = journal.read("pcm");
      journal.close();
      const result = await this.options.transcription.transcribe(this.options.models.paths(), pcm, (fraction) => {
        if (show) this.publish({ ...this.view, phase: "transcribing", progress: fraction });
      });
      this.options.store.shared.edit(id, (record) => ({ ...record, speakers: result.speakers, transcript: result.transcript }), "meeting.transcribed");
      journal.remove();
      this.options.meetingStored(id);
      this.options.log.info("recording.transcribed", { meeting: id, lines: result.transcript.length, speakers: result.speakers.length });
      const outcome = await this.notes(id, show);
      const message = outcome === "unavailable" ? NOTES_UNAVAILABLE : outcome === "failed" ? NOTES_FAILED : null;
      if (show) this.publish({ ...this.view, phase: "done", meetingID: id, progress: 1, message });
    } catch (error) {
      journal.close();
      this.options.log.error("recording.transcribe_failed", { meeting: id, kind: error instanceof Error ? error.name : "unknown" });
      if (show) this.publish({ ...this.view, phase: "done", meetingID: id, progress: 1, message: TRANSCRIBE_FAILED });
    }
  }

  async writeNotes(meetingID: string): Promise<Result<null>> {
    const id = parseLanaId(String(meetingID), "meeting");
    if (id === null || !this.options.store.local.isLocal(id)) return { ok: false, error: { code: "notFound", message: "That meeting is no longer on this computer." } };
    if (this.writing !== null || this.options.notes === undefined) return { ok: false, error: NOTES_BUSY };
    const outcome = await this.notes(id, false);
    if (outcome === "written") return { ok: true, value: null };
    if (outcome === "empty") return { ok: false, error: { code: "empty", message: "This meeting has no transcript yet, so there is nothing to write notes from." } };
    return { ok: false, error: { code: outcome, message: outcome === "unavailable" ? "The LANA model is needed to write notes. Get it in Settings, Ask." : "LANA could not write the notes. Try again." } };
  }

  /** Notes after the transcript; never throws, and the meeting stays saved whatever happens. */
  private async notes(id: LanaId, show: boolean): Promise<NotesOutcome> {
    const writer = this.options.notes;
    if (writer === undefined) return "written";
    if (this.writing !== null) return "failed";
    this.writing = id;
    if (show) this.publish({ ...this.view, phase: "writingNotes", meetingID: id, progress: 0 });
    try {
      const outcome = await writer.write(id, (fraction) => {
        if (show) this.publish({ ...this.view, phase: "writingNotes", progress: fraction });
      });
      if (outcome === "written") this.options.meetingStored(id);
      return outcome;
    } catch {
      this.options.log.error("recording.notes_failed", { meeting: id });
      return "failed";
    } finally {
      this.writing = null;
    }
  }

  private store(id: LanaId, journal: RecordingJournal, meta: JournalMeta): void {
    if (this.options.store.meetings.exists(id)) return;
    const frames = journal.read("aac").flatMap(unpackFrames);
    const pcmSamples = journal.read("pcm").reduce((sum, record) => sum + record.length / 4, 0);
    const duration = Math.max(pcmSamples / TRANSCRIPTION_SAMPLE_RATE, (frames.length * AAC_SAMPLES_PER_FRAME) / RECORDING_SAMPLE_RATE);
    const config = meta.config === undefined ? undefined : new Uint8Array(Buffer.from(meta.config, "base64"));
    const startedAt = new Date(meta.startedAt);
    const notes = journal.readNotes();
    const userNotes: UserNote[] = (Array.isArray(notes) ? notes : []).flatMap((note: unknown) => {
      const value = note as { id?: unknown; text?: unknown; anchor?: unknown };
      if (typeof value.text !== "string" || value.text.trim() === "") return [];
      const anchor = typeof value.anchor === "number" ? value.anchor : undefined;
      const at = new Date(startedAt.getTime() + (anchor ?? 0) * 1_000);
      return [{ id: typeof value.id === "string" ? value.id : crypto.randomUUID(), text: value.text, createdAt: at, updatedAt: at, anchor }];
    });
    const record = localMeetingRecord({
      id,
      title: meta.title,
      startedAt,
      durationSeconds: duration,
      consent: {
        method: meta.consent.method,
        confirmedBy: meta.consent.confirmedBy,
        confirmedAt: new Date(meta.consent.confirmedAt),
        jurisdictionNote: meta.consent.jurisdictionNote,
      },
      userNotes,
      appVersion: this.options.appVersion,
    });
    this.options.store.local.insert(record, audioParts(frames, config));
  }

  // MARK: - Private

  private flush(active: Active): void {
    if (active.aac.length > 0) {
      active.journal.append("aac", packFrames(active.aac));
      active.aac = [];
    }
    if (active.pendingSamples > 0) {
      active.journal.append("pcm", packPcm({ mic: joined(active.pcmMic), system: joined(active.pcmSystem) }));
      active.pcmMic = [];
      active.pcmSystem = [];
      active.pendingSamples = 0;
    }
  }

  private flushSafely(active: Active): void {
    try {
      this.flush(active);
    } catch {
      this.options.log.error("recording.flush_failed", { meeting: active.id });
    }
  }

  private onTick(): void {
    const active = this.active;
    if (active === null || (this.view.phase !== "recording" && this.view.phase !== "paused")) return;
    const elapsed = Math.floor(active.samples / TRANSCRIPTION_SAMPLE_RATE);
    if (elapsed !== this.view.elapsedSeconds) this.publish({ ...this.view, elapsedSeconds: elapsed });
  }

  private enqueue(id: LanaId, recovered: boolean): void {
    this.queued.add(id);
    const job = () => this.finish(id, recovered).finally(() => this.queued.delete(id));
    this.work = this.work.then(job, job).catch(() => undefined);
  }

  private command(command: RecordingAudioCommand): void {
    this.options.emit({ type: "recordingAudio", command });
  }

  private publish(view: RecordingView): void {
    this.view = view;
    this.options.emit({ type: "recording", view });
  }

  private clearCaptureTimer(): void {
    if (this.captureTimer !== null) clearTimeout(this.captureTimer);
    this.captureTimer = null;
  }

  private clearTimers(): void {
    this.clearCaptureTimer();
    if (this.tick !== null) clearInterval(this.tick);
    this.tick = null;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function idleView(): RecordingView {
  return { phase: "idle", meetingID: null, title: "", elapsedSeconds: 0, meetingAudio: "pending", progress: 0, message: null };
}

/** "Meeting on Nov 3, 2:30 PM", as the phone names an untitled recording. */
export function defaultTitle(date: Date): string {
  return `Meeting on ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)}`;
}

function joined(parts: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
