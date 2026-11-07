import type { AccountInfo } from "@lana/core/handoff";
import type { LanaSessionAccess, LanaSessionCredentials } from "@lana/core/lana";
import { LanaError } from "@lana/core/lana";
import type { AccessState, AccountState, LanaServer, LanaUser } from "../../shared/api.js";

/**
 * The LANA client's session as Briefs reads it. There is one session, the client's: Briefs
 * never signs in, keeps no token and has no sign-out of its own. Never log any of it.
 */
export interface ClientSessionSnapshot {
  readonly token: string;
  /** Where LANA calls go: the client's API base (the local AI engine, which forwards to the firm's server, or the server itself). */
  readonly apiBase: string;
  readonly user: {
    readonly id: string;
    readonly organizationID: string;
    readonly organizationName: string;
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
  };
}

/**
 * Briefs' view of the client's session: whether someone is signed in, who, and the token for
 * calls to LANA. `refresh` re-reads it from the client (sign-in, a refreshed token, sign-out)
 * and tells observers when the signed-in state changes.
 *
 * Access: the client starts Briefs only while discovery lists it for the firm, so while
 * Briefs runs, a signed-in person has access.
 */
export class ClientSession implements LanaSessionAccess {
  private snapshot: ClientSessionSnapshot | null;
  private readonly observers = new Set<(signedIn: boolean) => void>();

  constructor(private readonly read: () => ClientSessionSnapshot | null) {
    this.snapshot = read();
  }

  get isSignedIn(): boolean {
    return this.snapshot !== null;
  }

  /** Called with the signed-in flag whenever it changes; returns the unsubscribe function. */
  addObserver(observer: (signedIn: boolean) => void): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  /** Re-reads the client's session; observers hear about a change of signed-in state. */
  refresh(): void {
    const was = this.isSignedIn;
    this.snapshot = this.read();
    if (was !== this.isSignedIn) for (const observer of [...this.observers]) observer(this.isSignedIn);
  }

  /** The client's current token and API base for one call. Signed out is `LanaError(signedOut)`; LANA checks the token. */
  async authorized<T>(call: (session: LanaSessionCredentials) => Promise<T>): Promise<T> {
    const current = this.read();
    if (current === null) throw new LanaError("signedOut", 401);
    return call({ baseURL: current.apiBase, token: current.token });
  }

  accountState(): AccountState {
    const current = this.snapshot;
    if (current === null) return { kind: "signedOut", reason: "notSignedIn", lastServer: null };
    return { kind: "signedIn", user: toUser(current), server: toServer(current) };
  }

  accessState(): AccessState {
    return this.isSignedIn ? { kind: "entitled", offline: false } : { kind: "signedOut" };
  }

  /** What the paired phone shows for this computer's account: display fields only, never the token. */
  accountInfo(): AccountInfo | null {
    const current = this.snapshot;
    if (current === null) return null;
    const name = `${current.user.firstName} ${current.user.lastName}`.trim();
    return { name, email: current.user.email, organization: current.user.organizationName || current.user.organizationID, serverHost: "" };
  }
}

function toUser(snapshot: ClientSessionSnapshot): LanaUser {
  return { id: snapshot.user.id, email: snapshot.user.email, firstName: snapshot.user.firstName, lastName: snapshot.user.lastName, mustChangePassword: false };
}

function toServer(snapshot: ClientSessionSnapshot): LanaServer {
  let host = "";
  let isSecure = false;
  try {
    const url = new URL(snapshot.apiBase);
    host = url.host;
    isSecure = url.protocol === "https:" || url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    host = "";
  }
  return { baseURL: snapshot.apiBase, host, organizationID: snapshot.user.organizationID, organizationName: snapshot.user.organizationName, domain: "", isSecure };
}
