/**
 * The typed bridge between the renderer and the main process. The renderer has no Node
 * access: everything it can do is a method below, carried over IPC by the preload.
 * Every method returns a Promise; failures the person should read come back as a
 * `Result` with a plain message, never as a thrown error.
 *
 * Real mode answers from `@lana/core` (store, keys, handoff, account) through
 * `src/main/gateway` and `src/main/services`; demo mode answers from the in-memory demo
 * services (`src/main/demo`) behind the same interface.
 */

import type { AuditCategory } from "./auditDisplay.js";

// MARK: - Results

export interface AppError {
  /** Stable identifier, for example `invalidCredentials`. */
  code: string;
  /** Short, plain, user-facing sentence. */
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

// MARK: - Platform

export interface PlatformInfo {
  os: "mac" | "windows" | "linux";
  /** What the copy calls this computer. Always "computer": the copy is the same on every platform. */
  deviceNoun: "computer";
  appVersion: string;
  /** True when the services behind the bridge are the demo fakes. */
  isDemo: boolean;
  /** Screens whose engine is not in this build yet say so instead of showing made-up data. */
  features: { ask: boolean; talk: boolean };
}

// MARK: - Account

export interface LanaServer {
  baseURL: string;
  host: string;
  organizationID: string;
  organizationName: string;
  /** The firm's domain at the LANA directory; empty for a server typed under Advanced. */
  domain: string;
  isSecure: boolean;
}

export interface LanaUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
}

export type SignedOutReason = "notSignedIn" | "signedOut" | "expired";

export type AccountState =
  | { kind: "restoring" }
  | { kind: "signedOut"; reason: SignedOutReason; lastServer: LanaServer | null }
  | { kind: "signedIn"; user: LanaUser; server: LanaServer };

/**
 * The LANA client's session, read only. There is one session, the client's: signing in and
 * out happen in the client, never in Briefs.
 */
export interface AccountApi {
  state(): Promise<AccountState>;
}

// MARK: - Access

/**
 * Whether LANA Briefs is turned on for the signed-in person's organization. LANA's discovery
 * lists the organization's apps; nothing in the app works unless this is `entitled`.
 */
export type AccessState =
  | { kind: "signedOut" }
  | { kind: "checking" }
  /** `offline`: the last answer, used because LANA could not be reached (up to 7 days). */
  | { kind: "entitled"; offline: boolean }
  | { kind: "notEntitled"; organizationName: string }
  /** LANA could not be reached and there is no recent answer to use. */
  | { kind: "unreachable"; organizationName: string }
  /** Signed in with a server address and no Organization ID, so LANA cannot be asked. */
  | { kind: "noOrganization" };

export interface AccessApi {
  state(): Promise<AccessState>;
  /** Asks LANA again now. */
  checkAgain(): Promise<AccessState>;
}

// MARK: - Devices and pairing

export interface PairedDevice {
  id: string;
  displayName: string;
  /** ISO 8601. */
  pairedAt: string;
}

export type PairingState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "showingCode"; qrText: string; serviceName: string; expiresAt: string }
  | { kind: "confirming"; code: string; phoneName: string }
  | { kind: "saving" }
  | { kind: "paired"; phoneName: string }
  | { kind: "expired" }
  | { kind: "failed"; message: string };

export type ListenerStatus =
  | { kind: "signedOut" }
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "waitingForPairing" }
  | { kind: "listening" }
  | { kind: "failed"; message: string };

export interface GatewayStatus {
  listener: ListenerStatus;
  /** A phone is handing off a meeting right now. */
  receiving: boolean;
}

export interface DevicesApi {
  list(): Promise<Result<PairedDevice[]>>;
  revoke(id: string): Promise<Result<null>>;
  pairingState(): Promise<PairingState>;
  startPairing(): Promise<PairingState>;
  cancelPairing(): Promise<PairingState>;
  /** The person's answer to "Does the phone show this code?". */
  answerPairing(matches: boolean): Promise<PairingState>;
  resetPairing(): Promise<PairingState>;
  gatewayStatus(): Promise<GatewayStatus>;
}

// MARK: - Meetings

export interface Speaker {
  id: string;
  name: string;
}

export interface TranscriptSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

export type KeyPointKind = "summary" | "decision" | "openQuestion";

export interface SourceSpan {
  start: number;
  end: number;
  speaker: string | null;
}

export interface KeyPoint {
  id: string;
  kind: KeyPointKind;
  text: string;
  sources: SourceSpan[];
  precision: "exact" | "approximate";
}

export interface NotesGap {
  start: number;
  end: number;
  reason: "refused" | "failed";
}

export interface UserNote {
  id: string;
  text: string;
  createdAt: string;
  /** Seconds into the meeting, or null for a note written afterwards. */
  anchor: number | null;
}

export interface TranscriptClip {
  id: string;
  start: number;
  end: number;
}

/** How a meeting got here: proven by the phone (tone, QR code, approval here), or recorded on this computer. */
export type AttestationMethod = "acoustic" | "qr" | "macApproval" | "recordedHere";

export interface MeetingSummary {
  id: string;
  title: string;
  startedAt: string;
  durationSeconds: number;
  openIntents: number;
  /** Actions on this meeting the person has not read: the count on its sidebar row. */
  unreadActions: number;
  attestationMethod: AttestationMethod;
}

/** A proposed action on the replay timeline. */
export interface ActionMarker {
  id: string;
  title: string;
  at: number;
  /** Confirmed or done, not just proposed. */
  confirmed: boolean;
}

export interface MeetingRecord {
  id: string;
  title: string;
  startedAt: string;
  durationSeconds: number;
  speakers: Speaker[];
  transcript: TranscriptSegment[];
  keyPoints: KeyPoint[];
  gaps: NotesGap[];
  userNotes: UserNote[];
  clips: TranscriptClip[];
  actions: ActionMarker[];
  consent: "announced" | "allPartiesConfirmed";
  attestationMethod: AttestationMethod;
  /** False when the replay audio was removed by the retention setting. */
  hasAudio: boolean;
}

/**
 * The meeting's recorded audio for replay, as one URL per stored part in recording order.
 * The URLs carry a random grant that main issued for this window and this meeting only;
 * main decrypts each part from the store as it is read. No audio leaves the computer.
 */
export interface MeetingAudio {
  parts: Array<{ url: string; byteCount: number }>;
}

export interface MeetingsApi {
  list(): Promise<Result<MeetingSummary[]>>;
  get(id: string): Promise<Result<MeetingRecord>>;
  /** Grants playback of the meeting's audio. `noAudio` when retention removed it or none came. */
  audio(id: string): Promise<Result<MeetingAudio>>;
}

// MARK: - Shared meeting record

/** One change both the phone and this computer made to the same thing, waiting for the person. */
export interface RecordConflictView {
  /** The record unit, for example `title`, `note/<id>` or `segment/3`. Passed back to resolve. */
  unit: string;
  kind: "title" | "speaker" | "line" | "note" | "keyPoint" | "clip" | "action" | "other";
  /** What it is, for example "Transcript line 4 (Dana)". */
  label: string;
  /** Each side's version as text; null when that side deleted it. */
  phone: string | null;
  desktop: string | null;
  /** A merged value can be typed (titles, names, lines, notes). */
  editable: boolean;
  /** False for an action this computer can no longer change (it ran, or was dismissed). */
  phoneAllowed: boolean;
}

export interface SharedRecordPhone {
  id: string;
  name: string;
  /** The phone holds this meeting (it sent it, or it was sent there). */
  shared: boolean;
  /** "Send to phone" is waiting for that phone's next sync. */
  queued: boolean;
  /** When the person declined this meeting on that phone (ISO time); null otherwise. */
  declinedAt?: string | null;
  /** When the person said "Not now" to this meeting on that phone (ISO time); null otherwise. */
  snoozedAt?: string | null;
  /** When this meeting last reached that phone (ISO time): handed off from it, or an update sent there. Null if never. */
  lastSyncedAt?: string | null;
}

/** "Cancel send": taken off the queue, already being delivered (not stopped), or nothing was queued. */
export type CancelSendStatus = "cancelled" | "delivering" | "not_queued";

export interface CancelSendView {
  status: CancelSendStatus;
  record: SharedRecordView;
}

export interface SharedRecordView {
  meetingID: string;
  revision: number;
  conflicts: RecordConflictView[];
  phones: SharedRecordPhone[];
}

export type ConflictChoiceView = { kind: "phone" } | { kind: "desktop" } | { kind: "edited"; text: string };

/** The meeting as a record shared with the phone: reconcile, send, and edits made here. */
export interface RecordsApi {
  state(meetingID: string): Promise<Result<SharedRecordView>>;
  resolve(meetingID: string, unit: string, choice: ConflictChoiceView): Promise<Result<SharedRecordView>>;
  /** Queues the meeting for that phone; it goes in the phone's next sync. */
  sendToPhone(meetingID: string, phoneID: string): Promise<Result<SharedRecordView>>;
  /** Takes a queued meeting back before that phone's sync; never stops one being delivered. */
  cancelSend(meetingID: string, phoneID: string): Promise<Result<CancelSendView>>;
  rename(meetingID: string, title: string): Promise<Result<null>>;
  renameSpeaker(meetingID: string, speakerID: string, name: string): Promise<Result<null>>;
  correctLine(meetingID: string, index: number, text: string): Promise<Result<null>>;
  /** Saves lines `first` to `last` as a clip (a highlight). Returns the clip, or the one already covering exactly those lines. */
  saveClip(meetingID: string, first: number, last: number): Promise<Result<TranscriptClip>>;
  removeClip(meetingID: string, clipID: string): Promise<Result<null>>;
  /**
   * Clips the lines and queues LANA to draft one action or decision from them in the
   * background (clip.draft.v1). With `questionID` (an open question's key point id) the
   * action is a follow-up task for that question. The draft lands in the Inbox; leaving the
   * page never stops it. Asking again for the same open question returns the draft already queued.
   */
  requestDraft(meetingID: string, kind: DraftKind, first: number, last: number, questionID?: string): Promise<Result<DraftCard>>;
  /** Drafts not yet settled for this meeting (waiting, drafting, or a decision to add). */
  drafts(meetingID: string): Promise<Result<DraftCard[]>>;
  /** Stops a waiting or drafting draft, or dismisses a drafted decision. Nothing is added. */
  cancelDraft(draftID: string): Promise<Result<null>>;
  /** Adds a drafted decision, as the person edited it, to the meeting's key points. */
  addDecision(draftID: string, text: string): Promise<Result<null>>;
}

export type DraftKind = "action" | "decision";

export type DraftState =
  /** In the queue behind `ahead` other drafts. */
  | { kind: "waiting"; ahead: number }
  | { kind: "drafting" }
  /** A decision to check and add. An action, once drafted, is a proposed action card instead. */
  | { kind: "ready"; text: string; drafted: boolean };

/** A draft LANA is writing in the background, as the Inbox and the meeting show it. */
export interface DraftCard {
  id: string;
  meetingID: string;
  meetingTitle: string;
  kind: DraftKind;
  /** The open question it answers, as the notes say it; null for a clip. */
  question: string | null;
  questionID: string | null;
  /** The clip it came from, in seconds. */
  start: number;
  end: number;
  state: DraftState;
}

// MARK: - Inbox

export type ActionKind = "note" | "task" | "email" | "unsupported";

export interface ProposedAction {
  id: string;
  meetingID: string;
  meetingTitle: string;
  kind: ActionKind;
  title: string;
  /** "Clio" or "Outlook". */
  destination: string;
  status: "ready" | "needsChoice" | "failed" | "executed";
}

export interface InboxApi {
  /** Actions waiting for the person: the tray and the Inbox summary line. */
  pendingCount(): Promise<number>;
  /** Actions the person has not read: the Inbox badge. */
  unreadCount(): Promise<number>;
  list(): Promise<Result<ProposedAction[]>>;
}

// MARK: - Audit

export interface AuditEntry {
  at: string;
  event: string;
  subject: string;
}

export interface AuditApi {
  list(): Promise<Result<AuditEntry[]>>;
  verify(): Promise<Result<{ intact: boolean; entries: number }>>;
}

// MARK: - Settings

export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  theme: ThemePreference;
}

export interface SettingsApi {
  get(): Promise<AppSettings>;
  /** Light, dark, or follow the OS. Applied to every window at once. */
  setTheme(theme: ThemePreference): Promise<AppSettings>;
  walkthroughCompleted(userID: string): Promise<boolean>;
  setWalkthroughCompleted(userID: string): Promise<void>;
}

// MARK: - Platform and demo

export interface AppApi {
  platform(): Promise<PlatformInfo>;
  /** Shows and focuses the main window (tray: Open LANA, Sign in). */
  showWindow(): Promise<void>;
  /** Quits LANA (tray: Quit). */
  quit(): Promise<void>;
}

/**
 * Screenshot harness only (demo builds). `prepare` puts the demo services in the state a
 * named scenario needs; `rendered` tells the main process the page is ready to capture.
 */
export interface DemoApi {
  prepare(scenario: string): Promise<void>;
  rendered(): Promise<void>;
}

// MARK: - Events

export type LanaEvent =
  | { type: "account"; state: AccountState }
  | { type: "access"; state: AccessState }
  | { type: "pairing"; state: PairingState }
  | { type: "gateway"; status: GatewayStatus }
  | { type: "inbox"; pending: number; unread: number }
  | { type: "settings"; settings: AppSettings }
  | LanaScreenEvent
  | LanaGatewayEvent;

// MARK: - Bridge

export interface LanaServices extends LanaScreenServices {
  app: AppApi;
  account: AccountApi;
  access: AccessApi;
  devices: DevicesApi;
  meetings: MeetingsApi;
  records: RecordsApi;
  inbox: InboxApi;
  audit: AuditApi;
  settings: SettingsApi;
  demo: DemoApi;
}

/** What `window.lana` exposes in the renderer. */
export interface LanaBridge extends LanaServices, LanaGatewayServices {
  /** Subscribes to pushes from the main process. Returns the unsubscribe function. */
  onEvent(listener: (event: LanaEvent) => void): () => void;
  /** One microphone frame for the talk in progress (`TALK_FRAME_CHANNEL`). */
  sendTalkFrame(frame: Float32Array): void;
  /** Audio for the recording in progress (`RECORDING_FRAME_CHANNEL`). */
  sendRecordingFrame(frame: RecordingFrame): void;
}

/** Every invocable method, by namespace. The preload and main build channels from this. */
export const API_METHODS = {
  app: ["platform", "showWindow", "quit"],
  account: ["state"],
  access: ["state", "checkAgain"],
  devices: ["list", "revoke", "pairingState", "startPairing", "cancelPairing", "answerPairing", "resetPairing", "gatewayStatus"],
  meetings: ["list", "get", "audio"],
  records: ["state", "resolve", "sendToPhone", "cancelSend", "rename", "renameSpeaker", "correctLine", "saveClip", "removeClip", "requestDraft", "drafts", "cancelDraft", "addDecision"],
  inbox: ["pendingCount", "unreadCount", "list"],
  audit: ["list", "verify"],
  settings: ["get", "setTheme", "walkthroughCompleted", "setWalkthroughCompleted"],
  demo: ["prepare", "rendered"],
  ...screenApiMethods(),
} as const satisfies { [K in keyof LanaServices]: ReadonlyArray<keyof LanaServices[K]> };

/** Compile time check that API_METHODS lists every method of every namespace. */
type MissingMethods = {
  [K in keyof LanaServices]: Exclude<keyof LanaServices[K], (typeof API_METHODS)[K][number]>;
}[keyof LanaServices];
const everyMethodListed: [MissingMethods] extends [never] ? true : never = true;
void everyMethodListed;

export const EVENT_CHANNEL = "briefs:event";

export function channelName(namespace: string, method: string): string {
  return `briefs:${namespace}.${method}`;
}

// MARK: - P2 batch 2: action cards, audit log, preferences, connections, Ask, Talk, my notes

/** A firm record the person can pick for an action card, with why it was suggested (TargetChoice). */
export interface TargetChoice {
  /** "matter:4201" or "contact:9001". */
  id: string;
  kind: "matter" | "contact";
  /** Matters read as number and client ("00042 Acme Logistics"); contacts by name. */
  displayName: string;
  /** The matter description and client, or the contact's email. */
  detail: string | null;
  email: string | null;
  reasons: string[];
}

export type TargetState =
  | { kind: "notRequired" }
  | { kind: "resolving" }
  | { kind: "resolved"; choice: TargetChoice; chosenByPerson: boolean }
  | { kind: "ambiguous"; choices: TargetChoice[] }
  | { kind: "noMatch" }
  | { kind: "failed"; message: string };

export type RecipientState =
  | { kind: "resolving" }
  | { kind: "resolved"; address: string; name: string; reason: string }
  | { kind: "ambiguous"; choices: TargetChoice[] }
  | { kind: "unresolved" };

export interface RecipientRow {
  id: number;
  /** The name heard in the meeting. */
  name: string;
  state: RecipientState;
}

/** A quote behind an action, with exactly its stretch of audio. */
export interface EvidenceItem {
  id: number;
  speaker: string;
  quote: string;
  start: number;
  end: number;
}

/** Method, URL and canonical JSON body the action will send. Authorization is never shown. */
export interface PlannedRequestView {
  method: string;
  url: string;
  body: string | null;
  planHash: string;
}

export type ActionPhase =
  | { kind: "review" }
  | { kind: "executed"; externalID: string; deduplicated: boolean; undoExpiresAt: string }
  | { kind: "undone" }
  /** Plain reason; Retry is offered. */
  | { kind: "failed"; reason: string }
  /** Stopped between confirm and result; Retry searches before resending. */
  | { kind: "interrupted" }
  | { kind: "dismissed" }
  /** A type from a newer phone app. Shown read only, never executed. */
  | { kind: "unsupported" };

export interface ActionDraft {
  title: string;
  body: string;
  /** yyyy-MM-dd, tasks only. */
  dueDate: string | null;
}

/** One proposed action as its card shows it. Rules (block reasons, titles) are computed in main. */
export interface ActionCard {
  id: string;
  meetingID: string;
  type: ActionKind;
  /** "Log a note", "Create a task", "Draft an email", "Needs a newer LANA". */
  typeTitle: string;
  /** "Clio", "Outlook draft, not sent", or the unknown type's name. */
  destinationLabel: string;
  titleLabel: string;
  bodyLabel: string;
  draft: ActionDraft;
  phase: ActionPhase;
  target: TargetState;
  /** What the meeting called the target ("Acme Logistics lease"). */
  spokenTarget: string | null;
  recipients: RecipientRow[];
  evidence: EvidenceItem[];
  unsupportedFields: Array<{ label: string; value: string }>;
  plan: PlannedRequestView | null;
  isEditable: boolean;
  canDismiss: boolean;
  /** "Add note to 00042 Acme Logistics". */
  confirmTitle: string;
  /** Why Confirm is disabled, in plain words. Null when it may be pressed. */
  confirmBlockReason: string | null;
  actionError: string | null;
  /** LANA could not draft it, so it starts from the clip (a background draft that fell back). */
  startingPoint: boolean;
}

/** One received meeting with the cards still open on it, and the drafts LANA is writing for it. */
export interface InboxMeeting {
  id: string;
  title: string;
  startedAt: string;
  durationSeconds: number;
  attestationMethod: AttestationMethod;
  gaps: NotesGap[];
  cards: ActionCard[];
  drafts: DraftCard[];
}

// MARK: - Inbox list and action pages (docs/INBOX_AND_LANA_PLAN.md, the shared contract)

/** Where an action came from: a meeting from the phone, a background draft, or the person. */
export type ActionOrigin = "meeting" | "draft" | "manual";

/**
 * One status per row. `waiting` and `drafting` are background drafts LANA is still
 * writing; `interrupted` stopped between confirm and result; `ran` ran on LANA.
 */
/** `unsupported`: a type this version cannot run, where a runnable one would read review. */
export type ActionRowStatus = "waiting" | "drafting" | "review" | "unsupported" | "interrupted" | "failed" | "ran" | "undone" | "dismissed";

/** Every column sorts. `kind` is the type column. */
export type ActionSortKey = "created" | "updated" | "title" | "meeting" | "matter" | "status" | "kind";

/** A matter on the firm's LANA server, as matter search returns it (access checked by LANA). */
export interface MatterHit {
  /** LANA's matter id. */
  id: string;
  /** Number and client, "00042 Acme Logistics". */
  label: string;
  /** The matter name or client, for search results. Null when LANA has none. */
  detail: string | null;
}

export interface ActionListFilters {
  /** Empty means every status. */
  status: ActionRowStatus[];
  /** Empty means every type. */
  kind: ActionKind[];
  meetingID?: string;
  matterID?: string;
  /** True lists only deleted actions; false or absent hides them. */
  deleted?: boolean;
  /** True lists only unread actions, together with any status filter. */
  unread?: boolean;
}

export interface ActionListRequest {
  /** Free text over title, detail, meeting and matter. Empty lists everything. */
  query: string;
  filters: ActionListFilters;
  sort: { by: ActionSortKey; dir: "asc" | "desc" };
  /** 1 based. A page past the end returns the last page. */
  page: number;
  pageSize: number;
}

/** One row of the Inbox list. */
export interface ActionRow {
  /** An action id, or a draft id for a background draft (origin "draft"). */
  id: string;
  /** Null for a background draft not yet written. */
  kind: ActionKind | null;
  title: string;
  meetingID: string | null;
  meetingTitle: string | null;
  matter: MatterHit | null;
  status: ActionRowStatus;
  origin: ActionOrigin;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** The person has not opened it since it arrived or last needed them. Never true for a draft. */
  unread: boolean;
}

export interface ActionPage {
  rows: ActionRow[];
  /** Rows matching the request across every page. */
  total: number;
  page: number;
  pageSize: number;
  /** Every meeting and matter the actions mention (deleted or live side, other filters ignored), A to Z, for search suggestions. */
  facets: ActionListFacets;
}

export interface ActionListFacets {
  meetings: Array<{ id: string; title: string }>;
  matters: Array<{ id: string; label: string }>;
}

/** The editable fields of an action. */
export interface ActionFields extends ActionDraft {
  /** The matter it goes to on LANA. Null until chosen. */
  matter: MatterHit | null;
}

/** New action by hand: a task or a note, optionally linked to a meeting. Its origin is "manual". */
export interface NewActionDraft extends ActionFields {
  kind: "task" | "note";
  meetingID: string | null;
}

/** One step in an action's history, from the audit log entries for this action. */
export interface ActionHistoryItem {
  seq: number;
  at: string;
  /** The stored event key. */
  event: string;
  /** The audit display sentence. */
  sentence: string;
}

/** One action as its page shows it. Rules (what may be pressed and why not) are computed in main and core. */
export interface ActionDetail {
  id: string;
  kind: ActionKind;
  /** "Create a task", "Log a note", "Draft an email", "Needs a newer LANA". */
  typeTitle: string;
  titleLabel: string;
  bodyLabel: string;
  fields: ActionFields;
  /** What the meeting called the matter, "Acme Logistics lease". */
  spokenMatter: string | null;
  origin: Exclude<ActionOrigin, "draft">;
  /** "From Weekly case review" or "Added by you". */
  originLabel: string;
  meetingID: string | null;
  meetingTitle: string | null;
  evidence: EvidenceItem[];
  status: ActionRowStatus;
  phase: ActionPhase;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isEditable: boolean;
  canRun: boolean;
  /** "Create task on 00042 Acme Logistics". */
  runTitle: string;
  /** Why Run is off, in plain words. Null when it may be pressed. */
  runBlockReason: string | null;
  canUndo: boolean;
  canDelete: boolean;
  canRestore: boolean;
  /** For an action that already ran: deleting here does not remove the LANA record. */
  deleteNote: string | null;
  /** The item in LANA once it ran, for Open in LANA. */
  lanaURL: string | null;
  /** The type's fields from a newer phone app, read only. */
  unsupportedFields: Array<{ label: string; value: string }>;
  /** LANA could not draft it, so it starts from the clip. */
  startingPoint: boolean;
  actionError: string | null;
  history: ActionHistoryItem[];
  /** Not read yet. The open page marks it read (`markRead`). */
  unread: boolean;
}

export interface ActionsApi {
  list(request: ActionListRequest): Promise<Result<ActionPage>>;
  /** Includes the history (audit entries for this action). */
  get(id: string): Promise<Result<ActionDetail>>;
  /** New action by hand, origin "manual". */
  create(draft: NewActionDraft): Promise<Result<ActionDetail>>;
  /** Saves edits without running. */
  save(id: string, fields: ActionFields): Promise<Result<ActionDetail>>;
  /** Runs this one action on LANA, after the person confirmed. There is no bulk run. */
  run(id: string): Promise<Result<ActionDetail>>;
  undo(id: string): Promise<Result<ActionDetail>>;
  /** Soft delete: sets deleted_at. Never removes anything on LANA. */
  remove(id: string): Promise<Result<ActionDetail>>;
  restore(id: string): Promise<Result<ActionDetail>>;
  /** The person opened it. Only the open action page calls this; the list never does. */
  markRead(id: string): Promise<Result<null>>;
  /** Mark all as read: every unread action that is not deleted. */
  markAllRead(): Promise<Result<null>>;
}

export interface MattersApi {
  /** Matter search on LANA with the person's session; at least 2 characters. */
  search(query: string): Promise<Result<MatterHit[]>>;
}

export interface AuditRow {
  seq: number;
  at: string;
  /** The stored event key, "record.send_declined". */
  event: string;
  /** Plain language with names resolved, "Mike's iPhone declined Social Work Practice". */
  sentence: string;
  category: AuditCategory;
  subject: string;
  /** The stored detail, raw keys in key order, for the Details disclosure. */
  detail: Array<{ key: string; value: string }>;
  hash: string;
}

export type AuditVerification = { kind: "intact"; entries: number } | { kind: "broken"; seq: number; entries: number };

export interface AuditLogApi {
  entries(): Promise<Result<AuditRow[]>>;
  verify(): Promise<Result<AuditVerification>>;
  /** Saves the log as JSON Lines. Null when the person cancelled. */
  export(): Promise<Result<{ message: string } | null>>;
}

export type StatusTone = "neutral" | "good" | "warning" | "danger";

export interface StatusText {
  text: string;
  tone: StatusTone;
}

/** "off": LANA does not speak (Talk shows answers as text). "lana": the LANA voice. */
export type VoiceOption = "off" | "lana";

export type VoiceDownload =
  | { kind: "needed" }
  | { kind: "downloading"; progress: number }
  | { kind: "ready" }
  | { kind: "failed"; message: string }
  | { kind: "unavailable"; reason: string };

export interface Preferences {
  listener: StatusText;
  bluetooth: StatusText;
  listenerError: string | null;
  requireMacClick: boolean;
  allowQR: boolean;
  allowMacApproval: boolean;
  /** "Let paired phones receive updates in the background" (off by default) and the lease length. */
  backgroundUpdates: BackgroundUpdatesPreference;
  retentionDays: number;
  retentionRange: { min: number; max: number };
  askThreadCount: number;
  voice: {
    option: VoiceOption;
    endTalkWhenInactive: boolean;
    download: VoiceDownload;
    /** "240 MB". */
    downloadSizeText: string;
  };
  hasClioSecret: boolean;
  pendingOutbox: number;
  version: string;
}

export interface BackgroundUpdatesPreference {
  enabled: boolean;
  /** How long each lease lasts after a tone or QR checked sync: 1, 4, 8 or 24. */
  leaseHours: number;
  leaseHourChoices: number[];
}

/** A change and the plain line to show next to it, if any. */
export interface PreferencesUpdate {
  preferences: Preferences;
  message: string | null;
}

export interface PreferencesApi {
  get(): Promise<Preferences>;
  setHandoff(patch: { requireMacClick?: boolean; allowQR?: boolean; allowMacApproval?: boolean }): Promise<PreferencesUpdate>;
  setRetentionDays(days: number): Promise<PreferencesUpdate>;
  setBackgroundUpdates(patch: { enabled?: boolean; leaseHours?: number }): Promise<PreferencesUpdate>;
  clearAskHistory(): Promise<PreferencesUpdate>;
  setVoice(option: VoiceOption): Promise<PreferencesUpdate>;
  setEndTalkWhenInactive(value: boolean): Promise<PreferencesUpdate>;
  downloadVoice(): Promise<PreferencesUpdate>;
  removeVoiceDownload(): Promise<PreferencesUpdate>;
  saveClioSecret(secret: string): Promise<PreferencesUpdate>;
  removeClioSecret(): Promise<PreferencesUpdate>;
}

export type ConnectorID = "clio" | "microsoft";
export type ClioRegion = "us" | "ca" | "eu" | "au";

export type ConnectorStatus = { kind: "connected"; account: string } | { kind: "disconnected" } | { kind: "notConfigured"; reason: string };

export interface ConnectorSnapshot {
  id: ConnectorID;
  /** "Clio Manage", "Microsoft 365". */
  name: string;
  /** "Clio", "Microsoft 365". */
  shortName: string;
  summary: string;
  status: ConnectorStatus;
  lastSync: string | null;
  mirroredRecords: number | null;
  /** The last connect, sync or disconnect outcome, in plain words. */
  message: string | null;
  /** True when that outcome is a failure. */
  messageIsError: boolean;
}

export interface ConnectionsState {
  region: ClioRegion;
  connectors: ConnectorSnapshot[];
}

export interface ConnectionsApi {
  state(): Promise<ConnectionsState>;
  connect(id: ConnectorID): Promise<ConnectionsState>;
  disconnect(id: ConnectorID): Promise<ConnectionsState>;
  syncNow(): Promise<ConnectionsState>;
  setRegion(region: ClioRegion): Promise<ConnectionsState>;
}

export type AskScope = { kind: "all" } | { kind: "meeting"; meetingID: string };

/** A passage an answer rests on, shaped for a chip. */
export interface AskCitation {
  id: string;
  /** "Helen Park at 5:12", "Decision at 2:10", "Your note at 3:40". */
  title: string;
  meetingID: string;
  /** Set only when the conversation spans several meetings. */
  meetingTitle: string | null;
  start: number;
  end: number;
  audio: "available" | "removed" | "none";
}

export type AskOutcome =
  | { kind: "thinking" }
  | { kind: "answered"; status: "answered" | "notFound" | "suggested" | "declined" | "passagesOnly"; statusMessage: string | null; text: string; citations: AskCitation[] }
  | { kind: "failed"; message: string };

export interface AskExchange {
  id: number;
  question: string;
  outcome: AskOutcome;
}

/** The answer as the model writes it. A fact stays muted until checked; a suggestion is labelled. */
export interface AskDraft {
  exchangeID: number;
  text: string;
  kind: "fact" | "suggestion" | "unknown";
  /** The label above a suggestion. */
  label: string | null;
}

export interface AskThreadSummary {
  id: string;
  meetingID: string | null;
  /** The first question asked. */
  title: string;
  updatedAt: string;
  questionCount: number;
}

/** One conversation: `screen` for the Ask screen, `meeting:<id>` for the meeting panel. */
export interface AskConversation {
  key: string;
  scope: AskScope;
  scopeTitle: string;
  threadID: string | null;
  exchanges: AskExchange[];
  draft: AskDraft | null;
  starters: string[];
  /** The clip this conversation is about (read first), or null. */
  pinned: AskPinnedClip | null;
}

/** A clip of the transcript pinned to a conversation: when it was said and its lines. */
export interface AskPinnedClip {
  meetingID: string;
  clipID: string;
  start: number;
  end: number;
  /** `Name: words` per line. */
  text: string;
}

export interface AskApi {
  conversation(key: string): Promise<AskConversation>;
  setScope(key: string, scope: AskScope): Promise<AskConversation>;
  send(key: string, question: string): Promise<AskConversation>;
  newConversation(key: string): Promise<AskConversation>;
  openThread(key: string, threadID: string): Promise<AskConversation>;
  threads(): Promise<Result<AskThreadSummary[]>>;
  deleteThread(id: string): Promise<Result<AskThreadSummary[]>>;
  cancel(key: string): Promise<void>;
  /** Starts a conversation about a saved clip (LANA reads it first), or clears the pin with null. */
  pinClip(key: string, clip: { meetingID: string; clipID: string } | null): Promise<AskConversation>;
}

export type TalkOrbPhase = "listening" | "hearing" | "thinking" | "speaking";

export interface TalkExchange {
  id: number;
  question: string;
  /** The answer, or the plain status line. */
  text: string;
  citations: AskCitation[];
  interrupted: boolean;
}

export type TalkState =
  | { kind: "idle" }
  | { kind: "intro"; intro: { kind: "ready" } | { kind: "downloading"; progress: number | null } | { kind: "failed"; message: string } }
  | { kind: "starting" }
  | { kind: "failed"; message: string }
  | { kind: "running"; orb: TalkOrbPhase; muted: boolean; level: number; caption: string | null; current: TalkExchange | null; history: TalkExchange[] };

/** What Talk still has to download before it can start. */
export interface TalkDownloads {
  listener: boolean;
  voice: boolean;
}

export interface TalkSession {
  scope: AskScope;
  /** "All meetings" or the meeting's title. */
  scopeTitle: string;
  state: TalkState;
  /** True once the person has seen the first-use intro. */
  introSeen: boolean;
  /** "off" shows answers as text; "lana" speaks them. */
  voice: VoiceOption;
  needs: TalkDownloads;
  /** The size of what `needs` names, "833 MB". Empty when nothing is needed. */
  downloadSizeText: string;
}

export interface TalkApi {
  session(): Promise<TalkSession>;
  start(scope: AskScope): Promise<TalkSession>;
  acceptIntro(): Promise<TalkSession>;
  toggleMute(): Promise<TalkSession>;
  end(): Promise<TalkSession>;
}

export interface UserNotesApi {
  /** Replaces the meeting's own notes (empty ones are dropped). Note text is never logged. */
  save(meetingID: string, notes: UserNote[]): Promise<Result<null>>;
}

/** Pushes for the batch 2 screens. */
export type LanaScreenEvent =
  | { type: "ask"; conversation: AskConversation }
  | { type: "askThreads"; threads: AskThreadSummary[] }
  | { type: "talk"; session: TalkSession }
  | { type: "preferences"; preferences: Preferences }
  | { type: "models"; status: ModelsStatus };

export interface LanaScreenServices {
  actions: ActionsApi;
  matters: MattersApi;
  auditLog: AuditLogApi;
  preferences: PreferencesApi;
  connections: ConnectionsApi;
  ask: AskApi;
  talk: TalkApi;
  userNotes: UserNotesApi;
  models: ModelsApi;
}

/** A function so it is hoisted: `API_METHODS` above spreads it in. */
export function screenApiMethods() {
  return {
  actions: ["list", "get", "create", "save", "run", "undo", "remove", "restore", "markRead", "markAllRead"],
  matters: ["search"],
  auditLog: ["entries", "verify", "export"],
  preferences: [
    "get",
    "setHandoff",
    "setRetentionDays",
    "setBackgroundUpdates",
    "clearAskHistory",
    "setVoice",
    "setEndTalkWhenInactive",
    "downloadVoice",
    "removeVoiceDownload",
    "saveClioSecret",
    "removeClioSecret",
  ],
  connections: ["state", "connect", "disconnect", "syncNow", "setRegion"],
  ask: ["conversation", "setScope", "send", "newConversation", "openThread", "threads", "deleteThread", "cancel", "pinClip"],
  talk: ["session", "start", "acceptIntro", "toggleMute", "end"],
  userNotes: ["save"],
  models: ["status", "download", "remove"],
  } as const satisfies { [K in keyof LanaScreenServices]: ReadonlyArray<keyof LanaScreenServices[K]> };
}

type MissingScreenMethods = {
  [K in keyof LanaScreenServices]: Exclude<keyof LanaScreenServices[K], ReturnType<typeof screenApiMethods>[K][number]>;
}[keyof LanaScreenServices];
const everyScreenMethodListed: [MissingScreenMethods] extends [never] ? true : never = true;
void everyScreenMethodListed;

// MARK: - P4: on-device models

/**
 * The LANA model for Ask, the Talk listener (voice detection and speech to text), the LANA
 * voice, and LANA transcription (the listener plus the models that tell speakers apart, for
 * meetings recorded on this computer).
 */
export type ModelID = "ask" | "listener" | "voice" | "transcription";

export type ModelState =
  | { kind: "notDownloaded" }
  | { kind: "downloading"; progress: number }
  | { kind: "ready" }
  | { kind: "failed"; message: string };

export interface ModelStatus {
  id: ModelID;
  /** "LANA model", "LANA listening", "LANA voice", "LANA transcription". Never the underlying model's name. */
  title: string;
  /** Why this one, in plain words ("Chosen for this Mac's 16 GB of memory."). */
  detail: string;
  /** "2.5 GB": what a download fetches (for LANA transcription, only the parts not already here). */
  sizeText: string;
  state: ModelState;
  /** The file is LANA's own copy on this computer, used in place (never removed by Notes). */
  shared: boolean;
}

export interface ModelsStatus {
  ask: ModelStatus;
  listener: ModelStatus;
  voice: ModelStatus;
  transcription: ModelStatus;
}

/**
 * Downloads happen only when the person asks, once, from the model's official source. They
 * run in main; progress arrives as `models` events. Nothing about the person is sent.
 */
export interface ModelsApi {
  status(): Promise<ModelsStatus>;
  /** Starts a download (or resumes a partial one) and returns at once. */
  download(id: ModelID): Promise<ModelsStatus>;
  /** Deletes the download to free space; a running download is cancelled. */
  remove(id: ModelID): Promise<ModelsStatus>;
}

// MARK: - Gateway: handoff prompts and tone playback (the real gateway in main; demo answers idle)

/** One tone burst for the speaker (core `ToneRequest`): mono Float32 PCM at `sampleRate`, played once. */
export interface ToneRequest {
  id: string;
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
}

/** What the handoff prompt shows while a phone hands off a meeting. */
export type HandoffView =
  | { kind: "idle" }
  /** Connected; the transfer runs with nothing for the person to do. */
  | { kind: "receiving"; handoffId: string }
  /** The proximity tone is playing (play 1, 2 or 3). */
  | { kind: "tone"; handoffId: string; play: number }
  /** QR fallback: the phone scans this code from the screen. */
  | { kind: "qr"; handoffId: string; qrText: string }
  /** The firm asks the person at this computer to approve the phone. */
  | { kind: "approval"; handoffId: string; phoneName: string }
  | { kind: "received"; handoffId: string; bundles: number }
  | { kind: "failed"; handoffId: string; message: string };

export interface ToneApi {
  /** The renderer finished playing burst `id` (the source node ended). */
  played(id: string): Promise<void>;
  /** The renderer could not play burst `id`. */
  failed(id: string): Promise<void>;
}

export interface HandoffApi {
  state(): Promise<HandoffView>;
  /** The person's answer to the approval prompt. */
  answerApproval(handoffId: string, approved: boolean): Promise<HandoffView>;
  /** Closes a finished or failed prompt. */
  dismiss(): Promise<HandoffView>;
}

/**
 * What main asks of the window during a talk. The window owns the microphone and the
 * speakers: it captures with echo cancellation and noise suppression on and sends 16 kHz
 * mono frames back over `TALK_FRAME_CHANNEL`; it plays the LANA voice with Web Audio and
 * stops at once on `stopPlayback`.
 */
export type TalkAudioCommand =
  | { kind: "startCapture" }
  | { kind: "stopCapture" }
  /** Muted: the track is disabled, so nothing is captured at all. */
  | { kind: "mute"; muted: boolean }
  | { kind: "play"; id: string; samples: Float32Array; sampleRate: number }
  | { kind: "stopPlayback" };

export interface TalkAudioApi {
  /** The microphone is open and frames are flowing. */
  captureStarted(): Promise<void>;
  /** The microphone could not be opened: refused, or no input device. */
  captureFailed(reason: "denied" | "unavailable"): Promise<void>;
  /** Playback `id` (samples or system voice) finished. */
  played(id: string): Promise<void>;
  playFailed(id: string): Promise<void>;
}

/** Microphone frames from the window to main: mono Float32 PCM at 16 kHz, fire and forget. */
export const TALK_FRAME_CHANNEL = "briefs:talk.frame";
export const TALK_SAMPLE_RATE = 16_000;

// MARK: - Recording a meeting on this computer

/** Where a recording on this computer is. */
export type RecordingPhase =
  /** Nothing is recording. */
  | "idle"
  /** Opening the microphone and the meeting audio. */
  | "starting"
  | "recording"
  | "paused"
  /** Reading an audio file the person picked ("Import a recording"). */
  | "importing"
  /** Stopped: the audio is going into the meetings store. */
  | "saving"
  /** Saved; LANA is transcribing on this computer and telling the speakers apart. */
  | "transcribing"
  /** Transcribed; LANA is writing the notes. */
  | "writingNotes"
  /** On the meeting page now. */
  | "done"
  | "failed";

export interface RecordingView {
  phase: RecordingPhase;
  /** Set from `starting` on. */
  meetingID: string | null;
  title: string;
  /** Recorded time, without pauses. */
  elapsedSeconds: number;
  /** Whether the meeting audio (the other people in the call) is being recorded. */
  meetingAudio: "on" | "off" | "pending";
  /** 0 to 1 while transcribing or writing notes. */
  progress: number;
  /** Plain guidance: why something failed, or what to do about missing meeting audio. */
  message: string | null;
}

export interface RecordingStart {
  title: string;
  consent: "announced" | "allPartiesConfirmed";
  /** Who confirmed (all parties confirmed) or who is in the meeting. */
  participants: string[];
  jurisdictionNote: string;
}

/** Operating system access a recording needs. */
export type AccessStatus = "granted" | "denied" | "notDetermined" | "unsupported";

export interface RecordingPermissions {
  microphone: AccessStatus;
  /** Screen and system audio recording (macOS): what lets LANA hear the other people in a call. */
  meetingAudio: AccessStatus;
}

/** What main asks of the window while recording. */
export type RecordingAudioCommand =
  | { kind: "start" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "stop" };

/**
 * Recording on this computer: microphone plus the meeting audio, mixed and AAC encoded in
 * the window, written by main to an encrypted journal as it arrives, then stored as a
 * meeting recorded here and transcribed on this computer. Nothing leaves the computer.
 */
export interface RecordingApi {
  state(): Promise<RecordingView>;
  permissions(): Promise<RecordingPermissions>;
  /** Opens the system settings page for that access. */
  openPrivacySettings(kind: "microphone" | "meetingAudio"): Promise<void>;
  start(request: RecordingStart): Promise<Result<RecordingView>>;
  pause(): Promise<RecordingView>;
  resume(): Promise<RecordingView>;
  stop(): Promise<RecordingView>;
  /** The scratch pad while recording (kept encrypted with the recording). Text is never logged. */
  saveNotes(notes: Array<{ id: string; text: string; anchor: number }>): Promise<void>;
  /** After `done` or `failed`: back to idle. */
  dismiss(): Promise<RecordingView>;
  /**
   * "Import a recording": the window decodes the file the person picked and sends it as
   * frames (mono, so no meeting audio channel), then calls `finishImport`. The same path as
   * Stop from there: stored as a meeting recorded here, then transcribed.
   */
  beginImport(request: RecordingStart): Promise<Result<RecordingView>>;
  /** 0 to 1 while the window reads the file. */
  importProgress(fraction: number): Promise<void>;
  finishImport(): Promise<RecordingView>;
  /** The file could not be read: nothing is kept. */
  cancelImport(reason: "unreadable" | "cancelled"): Promise<RecordingView>;
  /** "Write notes" on a meeting recorded here (again): resolves when the notes are in, or why not. */
  writeNotes(meetingID: string): Promise<Result<null>>;
  // The window's side.
  captureStarted(meetingAudio: boolean): Promise<void>;
  captureFailed(reason: "denied" | "unavailable"): Promise<void>;
  /** The window flushed its encoder after `stop`; every frame has been sent. */
  captureStopped(): Promise<void>;
}

/** Audio from the window to main, about every 85 ms while recording. */
export interface RecordingFrame {
  /** 16 kHz mono microphone, for transcription. */
  mic: Float32Array;
  /** 16 kHz meeting audio, the same length (silence when it is off). */
  system: Float32Array;
  /** AAC LC frames of the mix, 48 kHz mono, in order. */
  aac: Uint8Array[];
  /** The encoder's AudioSpecificConfig, sent with the first frames. */
  config?: Uint8Array;
}

export const RECORDING_FRAME_CHANNEL = "briefs:recording.frame";

export type LanaGatewayEvent =
  | { type: "tone"; request: ToneRequest }
  | { type: "recording"; view: RecordingView }
  | { type: "recordingAudio"; command: RecordingAudioCommand }
  | { type: "talkAudio"; command: TalkAudioCommand }
  | { type: "handoff"; view: HandoffView }
  /** A meeting was stored and receipted. Ids only. */
  | { type: "meetingReceived"; meetingID: string }
  /** A meeting already here changed: merged from the phone, reconciled or edited. Ids only. */
  | { type: "meetingChanged"; meetingID: string }
  /** What is queued for a phone changed (declined, "Not now" or delivered there): Send to phone refreshes. Ids only. */
  | { type: "recordsChanged"; meetingID: string };

export interface LanaGatewayServices {
  tone: ToneApi;
  handoff: HandoffApi;
  talkAudio: TalkAudioApi;
  recording: RecordingApi;
}

export const GATEWAY_API_METHODS = {
  tone: ["played", "failed"],
  handoff: ["state", "answerApproval", "dismiss"],
  talkAudio: ["captureStarted", "captureFailed", "played", "playFailed"],
  recording: ["state", "permissions", "openPrivacySettings", "start", "pause", "resume", "stop", "saveNotes", "dismiss", "beginImport", "importProgress", "finishImport", "cancelImport", "writeNotes", "captureStarted", "captureFailed", "captureStopped"],
} as const satisfies { [K in keyof LanaGatewayServices]: ReadonlyArray<keyof LanaGatewayServices[K]> };

type MissingGatewayMethods = {
  [K in keyof LanaGatewayServices]: Exclude<keyof LanaGatewayServices[K], (typeof GATEWAY_API_METHODS)[K][number]>;
}[keyof LanaGatewayServices];
const everyGatewayMethodListed: [MissingGatewayMethods] extends [never] ? true : never = true;
void everyGatewayMethodListed;

/** Every bridge namespace: the screens' services plus the gateway's. The preload and main register all of them. */
export const ALL_API_METHODS = { ...API_METHODS, ...GATEWAY_API_METHODS } as const;

export type AllLanaServices = LanaServices & LanaGatewayServices;
