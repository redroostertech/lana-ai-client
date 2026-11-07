import { hostname } from "node:os";
import { join } from "node:path";
import { GatewayOpenError, HandoffGateway, ToneBridge } from "@lana/core/gateway";
import type { LanaSessionAccess } from "@lana/core/lana";
import { createSealedFileKeyVault, KeyVaultError, safeStorageSealer, type KeyVault, type SafeStorageLike } from "@lana/core/keys";
import type { GatewayStore } from "@lana/core/store";
import type { AccessApi, AccountApi, DevicesApi, HandoffApi, LanaEvent, MeetingsApi, ToneApi } from "../../shared/api.js";
import type { MainLog } from "../log.js";
import { ClientSession, type ClientSessionSnapshot } from "./clientSession.js";
import { GatewayBridge } from "./gatewayBridge.js";
import { MeetingsBridge } from "./meetingsBridge.js";
import { RecordsService } from "./recordsService.js";

export const KEYSTORE_UNAVAILABLE =
  "LANA keeps its keys in this computer's secure storage, and it is not available. Sign in to this computer with your own account, unlock the keystore, then open LANA again.";

/** Startup failures shown on the error screen instead of the app. */
export class StartupError extends Error {
  override readonly name = "StartupError";
  constructor(readonly kind: "keystore" | "identity" | "store", message: string) {
    super(message);
  }
}

export interface GatewayRuntimeOptions {
  /** `app.getPath("userData")`. Keys go in `keys/`, the store in `Lana/`. */
  readonly userData: string;
  readonly safeStorage: SafeStorageLike;
  /** Pushes to the renderer (the tone request goes through here too). */
  readonly emit: (event: LanaEvent) => void;
  readonly log: MainLog;
  /** The LANA client's session, read when needed: the only session there is. */
  readonly session: () => ClientSessionSnapshot | null;
  /**
   * Bind address, fixed port and Bonjour (`false` turns it off). The app listens on every
   * interface on a port the system picks, with Bonjour; `LANA_GATEWAY_PORT` fixes the port.
   */
  readonly listen?: { readonly host?: string; readonly port?: number; readonly bonjour?: false };
}

/** The real services behind the bridge for the namespaces main owns. */
export interface GatewayRuntime {
  /** The client's session, read only. */
  readonly account: AccountApi;
  /** Signed in (the client runs Briefs only while discovery lists it for the firm). */
  readonly access: AccessApi;
  readonly devices: DevicesApi;
  readonly meetings: Omit<MeetingsApi, "audio">;
  /** The shared meeting record: reconcile, Send to phone, edits made here. */
  readonly records: RecordsService;
  readonly tone: ToneApi;
  readonly handoff: HandoffApi;
  /** For the services in `src/main/services`: the vault, the store and the account gate. */
  readonly vault: KeyVault;
  readonly store: GatewayStore;
  /** BLE wake (docs/ARCHITECTURE.md): the daily wake UUIDs of phones with something queued. */
  bleWakeUuids(at: Date): string[];
  /** The queued phones changed; returns the unsubscribe function. */
  onWakeChanged(listener: () => void): () => void;
  isSignedIn(): boolean;
  /** The signed-in session for calls to the firm's LANA server (refreshes once on a 401). Absent in tests that never call LANA. */
  readonly lanaSession?: LanaSessionAccess;
  /** Called with the signed-in flag whenever the account changes. */
  onAccount(listener: (signedIn: boolean) => void): void;
  /** Signed in: the gate for receiving, Ask, Talk and actions. */
  hasAccess(): boolean;
  /** Called with the access gate whenever it opens or closes. */
  onAccess(listener: (open: boolean) => void): void;
  /** The client's session changed (sign-in, a refreshed token, sign-out): read it again. */
  sessionChanged(): void;
  /**
   * The person's session ended (sign-out, or another person signing in): revokes every phone
   * background lease at once, before Briefs stops.
   */
  endSession(): Promise<void>;
  /**
   * Reads the client's session and, when someone is signed in, opens the gateway. Call it
   * once a client page has loaded, so it is there to play the tone and show prompts.
   */
  restore(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Opens the sealed-file KeyVault (safeStorage), the HandoffGateway with a ToneBridge to the
 * renderer, and the LANA account, and gates the listener on the session (`restore` reads it).
 * Throws `StartupError` when the keystore, identity or store cannot be opened.
 */
export async function openGatewayRuntime(options: GatewayRuntimeOptions): Promise<GatewayRuntime> {
  const { log, emit } = options;
  let sealer;
  try {
    sealer = safeStorageSealer(options.safeStorage);
  } catch (error) {
    log.error("startup.keystore_unavailable", { kind: error instanceof KeyVaultError ? error.kind : "unknown" });
    throw new StartupError("keystore", KEYSTORE_UNAVAILABLE);
  }
  const vault = createSealedFileKeyVault({ directory: join(options.userData, "keys"), sealer });
  const toneBridge = new ToneBridge((request) => {
    log.info("tone.request", { samples: request.samples.length, rate: request.sampleRate, ms: request.durationMs });
    emit({ type: "tone", request: { id: request.id, samples: request.samples, sampleRate: request.sampleRate, durationMs: request.durationMs } });
  });
  let gateway: HandoffGateway;
  try {
    gateway = await HandoffGateway.open({
      directory: join(options.userData, "Lana"),
      vault,
      displayName: computerName(),
      tone: toneBridge,
      log,
      ...(options.listen?.host === undefined ? {} : { host: options.listen.host }),
      ...(options.listen?.port === undefined ? {} : { port: options.listen.port }),
      ...(options.listen?.bonjour === undefined ? {} : { bonjour: options.listen.bonjour }),
    });
  } catch (error) {
    if (error instanceof GatewayOpenError) {
      log.error("startup.gateway_open_failed", { kind: error.kind });
      throw new StartupError(error.kind, error.message);
    }
    throw error;
  }
  log.info("startup.gateway_opened", { mac: gateway.identity.publicKeys.deviceID, service: gateway.serviceName });

  const session = new ClientSession(options.session);
  const publish = (): void => {
    emit({ type: "account", state: session.accountState() });
    emit({ type: "access", state: session.accessState() });
  };
  // Signing out of the client ends the person's session here too: every background lease goes at once.
  session.addObserver((signedIn) => {
    publish();
    if (!signedIn) void gateway.revokeLeasesOnSignOut().catch(() => log.error("gateway.lease_revoke_failed"));
  });
  // The paired phone shows who is signed in here (display only; it never signs in).
  gateway.setAccountInfoSource(() => session.accountInfo());
  const devices = new GatewayBridge(gateway, session, toneBridge, emit, log);
  const meetings = new MeetingsBridge(gateway.store, log);
  const records = new RecordsService(gateway, emit, log);
  return {
    account: { state: async () => session.accountState() },
    access: { state: async () => session.accessState(), checkAgain: async () => (session.refresh(), session.accessState()) },
    devices,
    meetings,
    records,
    tone: devices.tone,
    handoff: devices.handoff,
    vault,
    store: gateway.store,
    bleWakeUuids: (at) => gateway.bleWakeUuids(at),
    onWakeChanged: (listener) => gateway.on("wakeChanged", () => listener()),
    isSignedIn: () => session.isSignedIn,
    lanaSession: session,
    onAccount: (listener) => {
      session.addObserver(listener);
    },
    hasAccess: () => session.isSignedIn,
    onAccess: (listener) => {
      session.addObserver(listener);
    },
    sessionChanged: () => session.refresh(),
    async endSession() {
      await gateway.revokeLeasesOnSignOut().catch(() => log.error("gateway.lease_revoke_failed"));
      log.info("session.ended");
    },
    async restore() {
      session.refresh();
      publish();
      log.info("startup.session_read", { signedIn: session.isSignedIn });
      if (session.isSignedIn) await devices.applyGate(true);
    },
    async close() {
      toneBridge.cancelAll();
      await gateway.close();
    },
  };
}

/** What the phone shows for this computer when pairing: its network name without `.local`. */
function computerName(): string {
  const name = hostname().replace(/\.local$/i, "").trim();
  return name === "" ? "LANA desktop" : name;
}
