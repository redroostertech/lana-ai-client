import { parseLanaId } from "@lana/core/ids";
import { MeetingAskService, storeAskSource } from "@lana/core/ask";
import type { RuntimePurpose, SpeechModelPackage } from "@lana/core/model";
import { ClipDrafter, RuntimeAnswerBackend, type TextModel } from "@lana/core/runtime";
import type { AllLanaServices, LanaEvent, ModelState, PlatformInfo, ThemePreference, VoiceDownload } from "../../shared/api.js";
import type { GatewayRuntime } from "../gateway/gatewayRuntime.js";
import type { MainLog } from "../log.js";
import { ActionPagesService } from "./actions/actionPagesService.js";
import { LanaActionExecutor, LanaClient, LanaError, fetchLanaTransport } from "@lana/core/lana";
import { LanaActionRunner } from "./actions/lanaActionRunner.js";
import { DraftDiagnostics } from "./draftDiagnostics.js";
import { MattersService } from "./mattersService.js";
import { AuditService, type SavePicker } from "./auditService.js";
import { MeetingAudioService } from "./meetingAudio.js";
import { MeetingExportService, type ExportFiles } from "./meetingExportService.js";
import { PreferencesService } from "./preferencesService.js";
import { SettingsService } from "./settingsService.js";
import { AskService } from "./ask/askService.js";
import { ModelService, type LanaRuntimeAccess } from "./models/modelService.js";
import { DeviceTalkFactory } from "./talk/deviceTalkFactory.js";
import { RendererAudio } from "./talk/rendererAudio.js";
import { RecordingService, type MeetingTranscription, type RecordingServiceOptions } from "./recording/recordingService.js";
import { NotesWriter } from "./recording/notesWriter.js";
import { TalkService, type TalkPartsFactory } from "./talk/talkService.js";
import { UserNotesService } from "./userNotesService.js";
import { BleWakeAdvertiser, type BleHelperProcess } from "./bleWake/bleWakeAdvertiser.js";

export interface RealServicesOptions {
  readonly runtime: GatewayRuntime;
  readonly platform: PlatformInfo;
  readonly emit: (event: LanaEvent) => void;
  readonly log: MainLog;
  readonly applyTheme: (theme: ThemePreference) => void;
  readonly pickSavePath: SavePicker;
  /** Export on the meeting page: the save dialog, printing to PDF and Show in Finder. */
  readonly exportFiles: ExportFiles;
  readonly showWindow: () => void;
  readonly quit: () => void;
  /** `walkthrough.json` from an earlier build, imported into the store once. */
  readonly legacyWalkthroughFile: string | null;
  readonly rendered: () => void;
  /** `userData/Models`: the speech models. */
  readonly modelsDirectory: string;
  /** The speech packages from the LANA client's model catalog. */
  readonly speechPackages: readonly SpeechModelPackage[];
  /** LANA's runtime (the local AI engine and the person's session): every language model call goes there. */
  readonly lanaRuntime: LanaRuntimeAccess;
  /** The OS microphone permission, asked before a talk starts. */
  readonly requestMicrophone: () => Promise<boolean>;
  /** Starts the BLE wake helper (macOS); absent or null where there is none (tests, other OSes until P5). */
  readonly bleHelper?: () => BleHelperProcess | null;
  /** Tests: the model every kind of work answers with instead of LANA's runtime. */
  readonly textModel?: TextModel;
  /** Tests: the models (a fake engine, a folder with the files already in it). */
  readonly models?: ModelService;
  /** Tests: fake listener, speaker and answerer instead of the device ones. */
  readonly talkFactory?: TalkPartsFactory;
  /** Recording on this computer: what the OS side provides (permissions, the meeting audio, the worker). */
  readonly recording: RecordingHost;
}

export interface RecordingHost {
  readonly permissions: RecordingServiceOptions["permissions"];
  readonly openPrivacySettings: RecordingServiceOptions["openPrivacySettings"];
  readonly armMeetingAudio: RecordingServiceOptions["armMeetingAudio"];
  readonly transcription: MeetingTranscription;
}

export interface RealServices {
  readonly services: AllLanaServices;
  readonly audio: MeetingAudioService;
  readonly ask: AskService;
  readonly talk: TalkService;
  readonly models: ModelService;
  /** The window's microphone frames and playback answers for Talk. */
  readonly talkAudio: RendererAudio;
  /** Recording on this computer; frames arrive over `RECORDING_FRAME_CHANNEL`. */
  readonly recording: RecordingService;
  /** Starts upkeep (audio retention). */
  start(): void;
  stop(): void;
}

function voiceDownload(state: ModelState): VoiceDownload {
  switch (state.kind) {
    case "notDownloaded":
      return { kind: "needed" };
    case "downloading":
      return { kind: "downloading", progress: state.progress };
    case "ready":
      return { kind: "ready" };
    case "failed":
      return { kind: "failed", message: state.message };
  }
}

/**
 * Every bridge namespace in real mode: the gateway runtime's account, devices, meetings
 * and handoff, plus the store-backed services here, Ask and Talk on the on-device models.
 */
export function createRealServices(options: RealServicesOptions): RealServices {
  const { runtime, platform, emit, log } = options;
  const store = runtime.store;
  let publishPreferences = (): void => undefined;
  const models = options.models ?? new ModelService({
    directory: options.modelsDirectory,
    runtime: options.lanaRuntime,
    speechPackages: options.speechPackages,
    platform,
    emit: (status) => {
      emit({ type: "models", status });
      publishPreferences();
    },
    log,
  });
  // Each kind of work goes to LANA's runtime with its own purpose (tests pass one model for all).
  const modelFor = (purpose: RuntimePurpose): TextModel => options.textModel ?? models.textModel(purpose);
  const asking = new MeetingAskService(storeAskSource(store), new RuntimeAnswerBackend(modelFor("briefs.ask"), log), { log });
  // Clip drafts (clip.draft.v1) run on LANA's runtime too.
  // LANA_DRAFT_DIAGNOSTICS=1: every draft attempt's sizes and states in logs/draft-diagnostics.jsonl, never text.
  const draftDiagnostics = DraftDiagnostics.fromEnvironment(process.env, log.path);
  runtime.records.useDrafter(new ClipDrafter(modelFor("briefs.clips"), log, draftDiagnostics === null ? undefined : (attempt) => draftDiagnostics.attempt(attempt)), draftDiagnostics);
  const ask = new AskService({ store, asking, platform, emit, log, allowed: () => runtime.hasAccess() });
  const talkAudio = new RendererAudio((command) => emit({ type: "talkAudio", command }));
  const talk = new TalkService({
    factory: options.talkFactory ?? new DeviceTalkFactory({ models, audio: talkAudio, asking, requestMicrophone: options.requestMicrophone, log }),
    ask,
    settings: store.settings,
    platform,
    emit: (session) => emit({ type: "talk", session }),
    log,
    allowed: () => runtime.hasAccess(),
  });

  const recording = new RecordingService({
    store,
    emit,
    log,
    appVersion: platform.appVersion,
    transcription: options.recording.transcription,
    models: { isReady: () => models.isReady("transcription"), paths: () => models.transcriptionPaths() },
    permissions: options.recording.permissions,
    openPrivacySettings: options.recording.openPrivacySettings,
    requestMicrophone: options.requestMicrophone,
    armMeetingAudio: options.recording.armMeetingAudio,
    // Not `meetingReceived`: that one says a phone handed a meeting over.
    notes: new NotesWriter(store, modelFor("briefs.notes"), log),
    meetingStored: (meetingID) => {
      const id = parseLanaId(meetingID, "meeting");
      if (id !== null) asking.meetingChanged(id);
      emit({ type: "meetingChanged", meetingID });
      emitInbox();
    },
  });

  const bleWake = new BleWakeAdvertiser({
    uuids: (at) => runtime.bleWakeUuids(at),
    onWakeChanged: (listener) => runtime.onWakeChanged(listener),
    spawn: options.bleHelper ?? (() => null),
    onStatus: () => publishPreferences(),
    log,
  });
  const preferences = new PreferencesService({
    store,
    bluetooth: () => bleWake.status(),
    platform,
    gatewayStatus: () => runtime.devices.gatewayStatus(),
    pairedPhones: async () => (await store.pairedDevices()).length,
    emit: (value) => emit({ type: "preferences", preferences: value }),
    log,
    voice: {
      download: () => voiceDownload(models.snapshotState("voice")),
      sizeText: () => models.sizeTextFor("voice"),
      start: () => void models.download("voice"),
      remove: async () => void (await models.remove("voice")),
    },
    onAskHistoryCleared: () => ask.historyCleared(),
  });
  publishPreferences = () => void preferences.publish();
  // Actions run on the firm's LANA server with the client's session; LANA's connectors carry them on.
  const lana = new LanaClient({ session: runtime.lanaSession ?? { authorized: async () => { throw new LanaError("signedOut", 401); } }, transport: fetchLanaTransport });
  const runner = new LanaActionRunner({ store, executor: () => new LanaActionExecutor(lana), isSignedIn: () => runtime.isSignedIn(), isEntitled: () => runtime.hasAccess(), deviceNoun: platform.deviceNoun, log });
  const matters: AllLanaServices["matters"] = new MattersService({ client: () => lana, isSignedIn: () => runtime.isSignedIn(), log });
  const pages = new ActionPagesService({
    store,
    runner: () => runner,
    drafts: runtime.records.drafting,
    deviceNoun: platform.deviceNoun,
    onChange: (counts) => emit({ type: "inbox", ...counts }),
    log,
  });
  const emitInbox = () => emit({ type: "inbox", ...pages.counts() });
  const settings = new SettingsService(store.settings, options.applyTheme, emit, log);
  const audit = new AuditService(store, options.pickSavePath, log);
  const audio = new MeetingAudioService(store, log);
  const meetingExport = new MeetingExportService(store.meetings, options.exportFiles, log);
  const notes = new UserNotesService(store, platform.deviceNoun, log);
  const userNotes: AllLanaServices["userNotes"] = {
    save: async (meetingID, list) => {
      const result = await notes.save(meetingID, list);
      // The next question reads the meeting's notes again.
      const id = parseLanaId(String(meetingID), "meeting");
      if (result.ok && id !== null) asking.meetingChanged(id);
      return result;
    },
  };

  runtime.onAccount((signedIn) => {
    if (!signedIn) {
      void talk.end();
      audio.revokeAll();
    }
    void preferences.publish();
  });
  // No access (signed out of the client) ends any talk.
  runtime.onAccess((open) => {
    if (!open) void talk.end();
  });

  settings.start(options.legacyWalkthroughFile);

  const services: AllLanaServices = {
    app: {
      platform: async () => platform,
      showWindow: async () => options.showWindow(),
      quit: async () => options.quit(),
    },
    account: runtime.account,
    access: runtime.access,
    devices: runtime.devices,
    meetings: {
      list: () => runtime.meetings.list(),
      get: (id) => runtime.meetings.get(id),
      audio: (id) => audio.audio(id),
    },
    records: runtime.records,
    inbox: pages.inbox,
    audit: audit.legacy,
    settings,
    actions: pages,
    matters,
    auditLog: audit,
    preferences,
    ask,
    talk,
    userNotes,
    models,
    meetingExport,
    talkAudio,
    recording,
    tone: runtime.tone,
    handoff: runtime.handoff,
    demo: { prepare: async () => undefined, rendered: async () => options.rendered() },
  };

  return {
    services,
    audio,
    ask,
    talk,
    models,
    talkAudio,
    recording,
    start() {
      // Background drafts: the Inbox count follows them; one cut off by quitting resumes.
      runtime.records.onInboxChanged(() => emitInbox());
      runtime.records.drafting.start();
      preferences.startRetention();
      bleWake.start();
      void recording.recover();
      // Model downloads cut off by quitting pick up from their `.part` files.
      models.resumePending();
    },
    stop() {
      preferences.stopRetention();
      bleWake.stop();
      void talk.end();
      void recording.shutdown();
      runtime.records.drafting.stop();
      void models.stop();
    },
  };
}
