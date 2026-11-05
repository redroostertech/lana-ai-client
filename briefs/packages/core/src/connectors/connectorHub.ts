import { fromUtf8 } from "../bytes/utf8.js";
import { SILENT_LOG, type HandoffLog } from "../handoff/log.js";
import { SYSTEM_CLOCK, type Clock } from "../handoff/ports.js";
import { LanaDate } from "../json/lanaDate.js";
import { SECRET_ACCOUNTS } from "../keys/keyVault.js";
import { AUDIT_EVENTS, type AuditDetail, type AuditEvent } from "../store/auditLog.js";
import type { MirrorEntity, MirrorKind } from "../store/types.js";
import { ClioCandidateSource } from "../executors/clio/clioCandidateSource.js";
import { ClioClient } from "../executors/clio/clioClient.js";
import { ClioNoteExecutor } from "../executors/clio/clioNoteExecutor.js";
import { clioOAuthConfiguration, parseClioRegion, type ClioRegion } from "../executors/clio/clioRegion.js";
import { ClioTaskExecutor } from "../executors/clio/clioTaskExecutor.js";
import type { ActionExecutor } from "../executors/execution/actionExecutor.js";
import { AuthorizedHTTPClient } from "../executors/execution/authorizedHTTPClient.js";
import { obj, optStr, parseResponse } from "../executors/execution/responseJson.js";
import { GraphConfiguration } from "../executors/graph/graphConfiguration.js";
import { GraphDraftExecutor } from "../executors/graph/graphDraftExecutor.js";
import type { HTTPTransport } from "../executors/http/httpTransport.js";
import { RateLimitedClient } from "../executors/http/rateLimitedClient.js";
import { timerSleeper, type Sleeper } from "../executors/http/sleeper.js";
import { RateLimitConfiguration } from "../executors/http/tokenBucket.js";
import { OAuthClient } from "../executors/oauth/oauthClient.js";
import { CLIO_REDIRECT_URI, MICROSOFT_REDIRECT_URI, type OAuthConfiguration } from "../executors/oauth/oauthConfiguration.js";
import type { TokenStore } from "../executors/oauth/tokenStore.js";
import type { CandidateSource } from "../executors/resolver/candidate.js";
import { withQuery } from "../executors/url.js";
import {
  CONNECTOR_NAMES, CONNECTOR_SETTING_KEYS, ConnectorError, ExecutorUnavailable, type Connector, type ConnectorSnapshot,
} from "./connector.js";

/** The client ids this build carries (non-secret; `lana.config.json` or the environment). */
export interface ConnectorConfiguration {
  readonly clioClientID: string | null;
  readonly microsoftClientID: string | null;
}

/** What the hub needs from the gateway store (`GatewayStore` satisfies it). */
export interface ConnectorStore {
  readonly settings: { get(key: string): string | null; set(key: string, value: string): void };
  readonly mirror: {
    replace(source: string, entities: readonly MirrorEntity[]): void;
    search(query: string, kind?: MirrorKind, limit?: number): MirrorEntity[];
  };
  appendAudit(event: AuditEvent, subject: string, detail?: AuditDetail): Promise<void>;
}

/** Where the Clio client secret lives (the KeyVault). */
export interface ConnectorSecrets {
  secret(account: string): Promise<Uint8Array | null>;
}

export interface ConnectorHubOptions {
  readonly configuration: ConnectorConfiguration;
  readonly secrets: ConnectorSecrets;
  readonly tokens: TokenStore;
  readonly transport: HTTPTransport;
  readonly store: ConnectorStore;
  readonly clock?: Clock;
  readonly sleeper?: Sleeper;
  readonly log?: HandoffLog;
}

const MIRROR_SOURCE = "clio";
const MIRROR_MAX_PAGES = 50;
const SEARCH_MAX_PAGES = 2;
const FALLBACK_ACCOUNT = "Connected account";

/**
 * The only place OAuth tokens are used (Swift `ConnectorHub`). Builds executors and live
 * candidate sources for what is connected, links and unlinks accounts, and syncs the Clio
 * mirror. The interactive sign-in step stays with the shell: it opens `authorizationURL`
 * in the system browser and hands the `lananotes-auth://` redirect to
 * `completeAuthorization`. Logs carry connector ids and counts only.
 */
export class ConnectorHub {
  private readonly configuration: ConnectorConfiguration;
  private readonly secrets: ConnectorSecrets;
  private readonly tokens: TokenStore;
  private readonly transport: HTTPTransport;
  private readonly store: ConnectorStore;
  private readonly clock: Clock;
  private readonly log: HandoffLog;
  private readonly oauthClients = new Map<Connector, OAuthClient>();
  private readonly accountNames = new Map<Connector, string>();
  private mirrorCount: number | null = null;
  private syncing: Promise<number> | undefined;
  private readonly clioHTTP: RateLimitedClient;
  private readonly graphHTTP: RateLimitedClient;

  constructor(options: ConnectorHubOptions) {
    this.configuration = options.configuration;
    this.secrets = options.secrets;
    this.tokens = options.tokens;
    this.transport = options.transport;
    this.store = options.store;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.log = options.log ?? SILENT_LOG;
    const sleeper = options.sleeper ?? timerSleeper;
    this.clioHTTP = new RateLimitedClient({ transport: this.transport, rateLimit: RateLimitConfiguration.clio, clock: this.clock, sleeper, log: this.log });
    this.graphHTTP = new RateLimitedClient({ transport: this.transport, rateLimit: RateLimitConfiguration.graph, clock: this.clock, sleeper, log: this.log });
  }

  // MARK: - Connections

  async snapshot(connector: Connector): Promise<ConnectorSnapshot> {
    const raw = connector === "clio" ? this.store.settings.get(CONNECTOR_SETTING_KEYS.clioLastSync) : null;
    const lastSync = raw === null ? null : LanaDate.parse(raw);
    const reason = this.notConfiguredReason(connector);
    if (reason !== null) return { status: { kind: "notConfigured", reason }, lastSync, mirroredRecords: null };
    if (!(await this.isConnected(connector))) return { status: { kind: "disconnected" }, lastSync, mirroredRecords: null };
    return {
      status: { kind: "connected", account: await this.accountName(connector) },
      lastSync,
      mirroredRecords: connector === "clio" ? this.mirrorCount : null,
    };
  }

  async clioRegion(): Promise<ClioRegion> {
    return parseClioRegion(this.store.settings.get(CONNECTOR_SETTING_KEYS.clioRegion)) ?? "us";
  }

  async setClioRegion(region: ClioRegion): Promise<void> {
    this.store.settings.set(CONNECTOR_SETTING_KEYS.clioRegion, region);
    this.oauthClients.delete("clio");
    this.accountNames.delete("clio");
  }

  /** A fresh client per attempt, so a changed region or client secret applies. */
  async authorizationURL(connector: Connector): Promise<string> {
    const client = await this.makeOAuthClient(connector);
    this.oauthClients.set(connector, client);
    return client.authorizationURL();
  }

  /** Exchanges the redirect for tokens (saved in the token store), audits, and returns the account name. */
  async completeAuthorization(connector: Connector, callbackURL: string): Promise<string> {
    const client = await this.oauthClient(connector);
    await client.handleCallback(callbackURL);
    this.accountNames.delete(connector);
    const name = await this.accountName(connector);
    const detail: Record<string, string> = { connector };
    if (connector === "clio") detail["region"] = await this.clioRegion();
    await this.store.appendAudit(AUDIT_EVENTS.connectorLinked, connector, detail).catch(() => undefined);
    this.log.info("connectors.linked", { connector });
    return name;
  }

  /** Deletes the tokens, clears the Clio mirror and audits. */
  async disconnect(connector: Connector): Promise<void> {
    await this.tokens.delete(connector);
    this.oauthClients.delete(connector);
    this.accountNames.delete(connector);
    if (connector === "clio") {
      this.store.mirror.replace(MIRROR_SOURCE, []);
      this.mirrorCount = null;
    }
    await this.store.appendAudit(AUDIT_EVENTS.connectorUnlinked, connector, { connector }).catch(() => undefined);
    this.log.info("connectors.unlinked", { connector });
  }

  /** Pages Clio matters and contacts into the local mirror. Returns the record count. One sync at a time. */
  syncMirror(): Promise<number> {
    if (this.syncing !== undefined) return this.syncing;
    const task = this.performSync();
    this.syncing = task;
    const clear = (): void => {
      if (this.syncing === task) this.syncing = undefined;
    };
    task.then(clear, clear);
    return task;
  }

  // MARK: - Executors

  /** The executor for an intent type given what is connected; throws `ExecutorUnavailable`. */
  async executor(type: string): Promise<ActionExecutor> {
    switch (type) {
      case "note.log":
      case "task.create": {
        const clio = await this.connectedClio(SEARCH_MAX_PAGES);
        if (clio === null) throw ExecutorUnavailable.notConnected(CONNECTOR_NAMES.clio.shortName);
        return type === "note.log" ? new ClioNoteExecutor(clio, this.clock, this.log) : new ClioTaskExecutor(clio, this.clock, this.log);
      }
      case "email.draft": {
        if (!(await this.isConnected("microsoft"))) throw ExecutorUnavailable.notConnected(CONNECTOR_NAMES.microsoft.shortName);
        let client: OAuthClient;
        try {
          client = await this.oauthClient("microsoft");
        } catch {
          throw ExecutorUnavailable.notConnected(CONNECTOR_NAMES.microsoft.shortName);
        }
        return new GraphDraftExecutor(this.graphHTTP, client, this.clock, this.log);
      }
      default:
        throw ExecutorUnavailable.unsupported();
    }
  }

  /** Live candidate sources for the resolver: Clio search when Clio is connected. */
  async liveSources(): Promise<CandidateSource[]> {
    const clio = await this.connectedClio(SEARCH_MAX_PAGES);
    return clio === null ? [] : [new ClioCandidateSource(clio)];
  }

  // MARK: - Private

  private notConfiguredReason(connector: Connector): string | null {
    if (connector === "clio") return this.configuration.clioClientID === null ? "Add your Clio client ID to lana.config.json (clioClientID)." : null;
    return this.configuration.microsoftClientID === null ? "Add your Microsoft application ID to lana.config.json (microsoftClientID)." : null;
  }

  private async isConnected(connector: Connector): Promise<boolean> {
    if (this.notConfiguredReason(connector) !== null) return false;
    let stored;
    try {
      stored = await this.tokens.load(connector);
    } catch {
      return false;
    }
    if (stored === null) return false;
    if (connector === "clio" && stored.region !== undefined) return stored.region === (await this.clioRegion());
    return true;
  }

  private async performSync(): Promise<number> {
    if (!(await this.isConnected("clio"))) throw ConnectorError.notConnected();
    const clio = await this.clioClient(MIRROR_MAX_PAGES);
    const matters = await clio.allMatters();
    const contacts = await clio.allContacts();
    const entities: MirrorEntity[] = [
      ...matters.map((matter): MirrorEntity => ({
        source: MIRROR_SOURCE,
        externalID: matter.id,
        kind: "matter",
        name: matter.description ?? matter.displayNumber ?? "",
        displayNumber: matter.displayNumber,
        clientName: matter.client?.name,
      })),
      ...contacts.map((contact): MirrorEntity => ({
        source: MIRROR_SOURCE,
        externalID: contact.id,
        kind: "contact",
        name: contact.name ?? "",
        email: contact.primaryEmailAddress,
      })),
    ];
    this.store.mirror.replace(MIRROR_SOURCE, entities);
    this.store.settings.set(CONNECTOR_SETTING_KEYS.clioLastSync, LanaDate.format(this.clock.now()));
    this.mirrorCount = entities.length;
    this.log.info("connectors.mirror_synced", { records: entities.length });
    return entities.length;
  }

  private async makeOAuthClient(connector: Connector): Promise<OAuthClient> {
    let oauth: OAuthConfiguration;
    if (connector === "clio") {
      const clientID = this.configuration.clioClientID;
      if (clientID === null) throw ConnectorError.notConfigured("Add your Clio client ID to lana.config.json (clioClientID).");
      let secret: string | undefined;
      try {
        const data = await this.secrets.secret(SECRET_ACCOUNTS.clioClientSecret);
        secret = data === null ? undefined : fromUtf8(data);
      } catch {
        secret = undefined;
      }
      oauth = clioOAuthConfiguration(await this.clioRegion(), clientID, secret, CLIO_REDIRECT_URI);
    } else {
      const clientID = this.configuration.microsoftClientID;
      if (clientID === null) throw ConnectorError.notConfigured("Add your Microsoft application ID to lana.config.json (microsoftClientID).");
      oauth = GraphConfiguration.oauthConfiguration(clientID, MICROSOFT_REDIRECT_URI);
    }
    return new OAuthClient({ configuration: oauth, account: connector, store: this.tokens, transport: this.transport, clock: this.clock, log: this.log });
  }

  private async oauthClient(connector: Connector): Promise<OAuthClient> {
    const existing = this.oauthClients.get(connector);
    if (existing !== undefined) return existing;
    const client = await this.makeOAuthClient(connector);
    this.oauthClients.set(connector, client);
    return client;
  }

  private async clioClient(maxPages: number): Promise<ClioClient> {
    return new ClioClient({ region: await this.clioRegion(), client: this.clioHTTP, tokens: await this.oauthClient("clio"), maxPages });
  }

  private async connectedClio(maxPages: number): Promise<ClioClient | null> {
    if (!(await this.isConnected("clio"))) return null;
    try {
      return await this.clioClient(maxPages);
    } catch {
      return null;
    }
  }

  private async accountName(connector: Connector): Promise<string> {
    const cached = this.accountNames.get(connector);
    if (cached !== undefined) return cached;
    let name: string | undefined;
    try {
      name = connector === "clio" ? (await (await this.clioClient(1)).whoAmI()).name : await this.graphMe();
    } catch {
      name = undefined;
    }
    if (name === undefined) return FALLBACK_ACCOUNT;
    this.accountNames.set(connector, name);
    return name;
  }

  private async graphMe(): Promise<string | undefined> {
    const http = new AuthorizedHTTPClient(this.graphHTTP, await this.oauthClient("microsoft"), GraphConfiguration.host);
    const response = await http.get(withQuery(`${GraphConfiguration.baseURL}/me`, [["$select", "displayName,mail"]]));
    response.requireSuccess(this.clock.now());
    const me = obj(parseResponse(response.body), "$");
    return optStr(me, "displayName", "$") ?? optStr(me, "mail", "$");
  }
}
