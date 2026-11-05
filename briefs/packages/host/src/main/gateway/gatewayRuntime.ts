import { hostname } from "node:os";
import { join } from "node:path";
import { AccountManager, EntitlementMonitor, HttpLanaAccountService, LanaAccountError, VaultAccountSessionStore, VaultEntitlementCache, type HttpTransport } from "@lana/core/account";
import { GatewayOpenError, HandoffGateway, ToneBridge } from "@lana/core/gateway";
import type { LanaSessionAccess } from "@lana/core/lana";
import { createSealedFileKeyVault, KeyVaultError, safeStorageSealer, type KeyVault, type SafeStorageLike } from "@lana/core/keys";
import { AUDIT_EVENTS, type GatewayStore } from "@lana/core/store";
import type { AccessApi, AccountApi, DevicesApi, HandoffApi, LanaEvent, MeetingsApi, RecordsApi, ToneApi } from "../../shared/api.js";
import type { MainLog } from "../log.js";
import { AccessBridge } from "./accessBridge.js";
import { AccountBridge, toAccountInfo } from "./accountBridge.js";
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
  /** Tests: a stub LANA server transport or directory. */
  readonly transport?: HttpTransport;
  readonly directoryURL?: string;
  /**
   * Bind address, fixed port and Bonjour (`false` turns it off). The app listens on every
   * interface on a port the system picks, with Bonjour; `LANA_GATEWAY_PORT` fixes the port.
   */
  readonly listen?: { readonly host?: string; readonly port?: number; readonly bonjour?: false };
}

/** The real services behind the bridge for the namespaces main owns. */
export interface GatewayRuntime {
  readonly account: AccountApi;
  /** Whether LANA Briefs is on for the organization (LANA discovery's `enabled_apps`). */
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
  /** Signed in and LANA Briefs on for the organization: the gate for receiving, Ask, Talk and actions. */
  hasAccess(): boolean;
  /** Called with the access gate whenever it opens or closes. */
  onAccess(listener: (open: boolean) => void): void;
  /** The window came forward: asks LANA again when the last check is a few minutes old. */
  recheckAccess(): void;
  /**
   * Reads the saved session and, when it is valid, opens the gateway. Call it once the
   * window has loaded, so the renderer is there to play the tone and show prompts.
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

  const service = new HttpLanaAccountService({
    ...(options.transport === undefined ? {} : { transport: options.transport }),
    ...(options.directoryURL === undefined ? {} : { directoryURL: options.directoryURL }),
  });
  const manager = new AccountManager({ service, sessions: new VaultAccountSessionStore(vault), log });
  const account = new AccountBridge(manager, service, log);
  manager.onState(() => emit({ type: "account", state: account.snapshot() }));
  // LANA Briefs is on when the organization's discovery reply lists it in enabled_apps.
  let access: AccessBridge | null = null;
  const monitor = new EntitlementMonitor({
    discover: (organizationID, domain) => service.discover(organizationID, domain),
    cache: new VaultEntitlementCache(vault),
    onChange: () => {
      if (access === null) return;
      access.update();
      emit({ type: "access", state: access.snapshot() });
    },
    onEntitlementChanged: (organizationID, entitled) =>
      gateway.store.appendAudit(AUDIT_EVENTS.entitlementChanged, organizationID, { state: entitled ? "enabled" : "disabled" }),
    log,
  });
  const gate = new AccessBridge(manager, monitor);
  access = gate;
  // Sign-in, a restored session at launch, and sign-out.
  manager.addObserver((signedIn) => {
    gate.update();
    if (signedIn) void monitor.check(manager.session);
    else void monitor.signedOut();
  });
  // Signing out (or the session ending) revokes every background lease at once.
  let wasSignedIn = false;
  manager.onState((state) => {
    if (state.kind === "signedIn") wasSignedIn = true;
    if (state.kind === "signedOut" && wasSignedIn) {
      wasSignedIn = false;
      void gateway.revokeLeasesOnSignOut().catch(() => log.error("gateway.lease_revoke_failed"));
    }
  });
  // The paired phone shows who is signed in here (display only; it never signs in).
  gateway.setAccountInfoSource(() => {
    const state = manager.state;
    return state.kind === "signedIn" ? toAccountInfo(state.session) : null;
  });
  const devices = new GatewayBridge(gateway, manager, gate, toneBridge, emit, log);
  const meetings = new MeetingsBridge(gateway.store, log);
  const records = new RecordsService(gateway, emit, log);
  return {
    account,
    access: gate,
    devices,
    meetings,
    records,
    tone: devices.tone,
    handoff: devices.handoff,
    vault,
    store: gateway.store,
    bleWakeUuids: (at) => gateway.bleWakeUuids(at),
    onWakeChanged: (listener) => gateway.on("wakeChanged", () => listener()),
    isSignedIn: () => manager.isSignedIn,
    lanaSession: lanaSessionAccess(manager),
    onAccount: (listener) => manager.addObserver(listener),
    hasAccess: () => gate.isOpen,
    onAccess: (listener) => gate.onChange(listener),
    recheckAccess: () => void monitor.checkIfStale(manager.session),
    async restore() {
      await manager.restore();
      log.info("startup.account_restored", { state: manager.state.kind });
      monitor.startPeriodic(() => manager.session);
    },
    async close() {
      monitor.stopPeriodic();
      manager.dispose();
      toneBridge.cancelAll();
      await gateway.close();
    },
  };
}

/** The account's session for the LANA client: the current server and token, refreshed once on a 401. */
export function lanaSessionAccess(manager: AccountManager): LanaSessionAccess {
  return {
    authorized: (call) => manager.authorized((token) => {
      const server = manager.session?.server;
      if (server === undefined) throw new LanaAccountError("sessionExpired");
      return call({ baseURL: server.baseURL, token });
    }),
  };
}

/** What the phone shows for this computer when pairing: its network name without `.local`. */
function computerName(): string {
  const name = hostname().replace(/\.local$/i, "").trim();
  return name === "" ? "LANA desktop" : name;
}
