import type { ClioRegion, ConnectorID, ConnectorStatus } from "../../../shared/api.js";

export interface ConnectorState {
  readonly status: ConnectorStatus;
  readonly lastSync: Date | null;
  readonly mirroredRecords: number | null;
}

/** A sign-in in the browser that did not come back (the redirect side of Swift `ConnectorError`). */
export class ConnectorError extends Error {
  override readonly name = "ConnectorError";
  constructor(readonly code: "cancelled", message: string) {
    super(message);
  }
}

/**
 * Clio and Microsoft 365 behind Connections (Swift `ConnectorServicing`, implemented by
 * `ConnectorHub`): status, the Clio region, the OAuth authorization URL and its completion
 * from the `lananotes-auth://` redirect, disconnect and the Clio mirror sync. Tokens never
 * leave main. `ConnectorHub` (`@lana/core/connectors`) implements it.
 */
export interface ConnectorService {
  snapshot(id: ConnectorID): Promise<ConnectorState>;
  clioRegion(): Promise<ClioRegion>;
  setClioRegion(region: ClioRegion): Promise<void>;
  /** The provider's sign-in page (PKCE, state). Opened in the system browser. */
  authorizationURL(id: ConnectorID): Promise<string>;
  /** Exchanges the redirect's code for tokens, saves them in the vault, audits, and returns the account name. */
  completeAuthorization(id: ConnectorID, callbackURL: string): Promise<string>;
  disconnect(id: ConnectorID): Promise<void>;
  /** Syncs the Clio record mirror; returns how many records it holds. */
  syncMirror(): Promise<number>;
}
