import type { ClioRegion, ConnectionsApi, ConnectionsState, ConnectorID, ConnectorSnapshot } from "../../../shared/api.js";
import type { MainLog } from "../../log.js";
import type { ConnectorService } from "./connectorService.js";
import type { OAuthRedirects } from "./oauthRedirects.js";

const CONNECTORS: readonly ConnectorID[] = ["clio", "microsoft"];
const REGIONS: readonly ClioRegion[] = ["us", "ca", "eu", "au"];

const DESCRIPTIONS: Record<ConnectorID, { name: string; shortName: string; summary: string }> = {
  clio: { name: "Clio Manage", shortName: "Clio", summary: "Notes and tasks on matters and contacts" },
  microsoft: { name: "Microsoft 365", shortName: "Microsoft 365", summary: "Email drafts in Outlook. LANA never sends mail." },
};

/**
 * Connections (Swift `ConnectionsViewModel`): connect opens the provider's sign-in in the
 * system browser and waits for the `lananotes-auth://` redirect the app registers, then
 * hands it to the `ConnectorService`; disconnect, the Clio region and the mirror sync go
 * straight to the service. Messages are the last outcome per connector.
 */
export class ConnectionsService implements ConnectionsApi {
  private readonly messages = new Map<ConnectorID, { text: string; isError: boolean }>();

  constructor(
    private readonly service: () => ConnectorService,
    private readonly redirects: OAuthRedirects,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly log: MainLog,
    private readonly onChange: () => void = () => undefined,
  ) {}

  async state(): Promise<ConnectionsState> {
    const service = this.service();
    const connectors: ConnectorSnapshot[] = [];
    for (const id of CONNECTORS) {
      const snapshot = await service.snapshot(id);
      const message = this.messages.get(id) ?? null;
      connectors.push({
        id,
        ...DESCRIPTIONS[id],
        status: snapshot.status,
        lastSync: snapshot.lastSync?.toISOString() ?? null,
        mirroredRecords: snapshot.mirroredRecords,
        message: message?.text ?? null,
        messageIsError: message?.isError ?? false,
      });
    }
    return { region: await service.clioRegion(), connectors };
  }

  async connect(id: ConnectorID): Promise<ConnectionsState> {
    if (!CONNECTORS.includes(id)) return this.state();
    this.messages.delete(id);
    const service = this.service();
    try {
      const url = await service.authorizationURL(id);
      const redirect = this.redirects.waitFor(id);
      this.log.info("connections.authorize_opened", { connector: id });
      await this.openExternal(url);
      const callback = await redirect;
      await service.completeAuthorization(id, callback);
      this.log.info("connections.linked", { connector: id });
      this.onChange();
      if (id === "clio") await this.runSync();
    } catch (error) {
      this.redirects.cancel(id);
      this.log.notice("connections.connect_failed", { connector: id, kind: error instanceof Error ? error.name : "unknown" });
      this.messages.set(id, { text: error instanceof Error && error.message !== "" ? error.message : "Sign-in did not finish. Try again.", isError: true });
    }
    return this.state();
  }

  async disconnect(id: ConnectorID): Promise<ConnectionsState> {
    if (!CONNECTORS.includes(id)) return this.state();
    this.messages.delete(id);
    try {
      await this.service().disconnect(id);
      this.log.info("connections.unlinked", { connector: id });
      this.onChange();
    } catch {
      this.messages.set(id, { text: "LANA could not remove this connection. Try again.", isError: true });
    }
    return this.state();
  }

  async syncNow(): Promise<ConnectionsState> {
    await this.runSync();
    return this.state();
  }

  async setRegion(region: ClioRegion): Promise<ConnectionsState> {
    const service = this.service();
    const clio = await service.snapshot("clio");
    if (REGIONS.includes(region) && clio.status.kind !== "connected") await service.setClioRegion(region);
    return this.state();
  }

  private async runSync(): Promise<void> {
    try {
      const count = await this.service().syncMirror();
      this.messages.set("clio", { text: `Synced ${count} matters and contacts.`, isError: false });
      this.log.info("connections.synced", { records: count });
    } catch (error) {
      this.messages.set("clio", { text: error instanceof Error && error.message !== "" ? error.message : "The sync did not finish. LANA will try again in six hours.", isError: true });
    }
  }
}
