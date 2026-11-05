/** Firm systems the gateway can act in (Swift `Connector`). The raw values are the token store accounts. */
export const CONNECTORS = ["clio", "microsoft"] as const;
export type Connector = (typeof CONNECTORS)[number];

export const CONNECTOR_NAMES: Readonly<Record<Connector, { readonly displayName: string; readonly shortName: string }>> = {
  clio: { displayName: "Clio Manage", shortName: "Clio" },
  microsoft: { displayName: "Microsoft 365", shortName: "Microsoft 365" },
};

/** Swift `ConnectorStatus`. */
export type ConnectorStatus =
  /** The client id is missing from the configuration. */
  | { readonly kind: "notConfigured"; readonly reason: string }
  | { readonly kind: "disconnected" }
  | { readonly kind: "connected"; readonly account: string };

/** Swift `ConnectorSnapshot`. */
export interface ConnectorSnapshot {
  readonly status: ConnectorStatus;
  readonly lastSync: Date | null;
  /** Records the last sync in this session put in the mirror (Clio only), null before one. */
  readonly mirroredRecords: number | null;
}

/** Swift `ConnectorError`. */
export class ConnectorError extends Error {
  override readonly name = "ConnectorError";

  private constructor(readonly kind: "notConfigured" | "notConnected", message: string) {
    super(message);
  }

  static notConfigured = (reason: string): ConnectorError => new ConnectorError("notConfigured", reason);
  static notConnected = (): ConnectorError => new ConnectorError("notConnected", "Connect this service first.");
}

/** Why no executor is available for an intent type right now (Swift `ExecutorUnavailable`). */
export class ExecutorUnavailable extends Error {
  override readonly name = "ExecutorUnavailable";

  private constructor(readonly kind: "unsupported" | "notConnected", message: string) {
    super(message);
  }

  static unsupported = (): ExecutorUnavailable => new ExecutorUnavailable("unsupported", "This action needs a newer LANA.");
  static notConnected = (service: string): ExecutorUnavailable => new ExecutorUnavailable("notConnected", `Connect ${service} in Connections to run this action.`);
}

/** Swift `SettingKey` strings for the connectors, shared with the native app's store. */
export const CONNECTOR_SETTING_KEYS = { clioRegion: "clio.region", clioLastSync: "clio.last_sync" } as const;

/** Swift `RecurringJob.mirrorSync`: the Clio mirror refreshes every six hours (and at launch). */
export const MIRROR_SYNC_INTERVAL_SECONDS = 6 * 60 * 60;
