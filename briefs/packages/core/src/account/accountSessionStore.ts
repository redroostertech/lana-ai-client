import { SECRET_ACCOUNTS, type KeyVault } from "../keys/keyVault.js";
import { decodeSession, encodeSession, type LanaAccountSession } from "./lanaAccountSession.js";

/** Where the signed-in session lives between launches (Swift `AccountSessionStoring`). */
export interface AccountSessionStoring {
  load(): Promise<LanaAccountSession | null>;
  save(session: LanaAccountSession): Promise<void>;
  clear(): Promise<void>;
}

/** The session as one KeyVault secret, `lana.session` (Swift `SecretAccountSessionStore`). */
export class VaultAccountSessionStore implements AccountSessionStoring {
  constructor(private readonly vault: Pick<KeyVault, "secret" | "setSecret">) {}

  async load(): Promise<LanaAccountSession | null> {
    const data = await this.vault.secret(SECRET_ACCOUNTS.lanaSession);
    if (data === null) return null;
    const session = decodeSession(data);
    if (session === null) {
      // An unreadable item (an older shape) is dropped; the person signs in again.
      await this.clear();
      return null;
    }
    return session;
  }

  save(session: LanaAccountSession): Promise<void> {
    return this.vault.setSecret(SECRET_ACCOUNTS.lanaSession, encodeSession(session));
  }

  clear(): Promise<void> {
    return this.vault.setSecret(SECRET_ACCOUNTS.lanaSession, null);
  }
}

/** Process memory only: demo data and tests. */
export class MemoryAccountSessionStore implements AccountSessionStoring {
  session: LanaAccountSession | null = null;
  async load(): Promise<LanaAccountSession | null> {
    return this.session;
  }
  async save(session: LanaAccountSession): Promise<void> {
    this.session = session;
  }
  async clear(): Promise<void> {
    this.session = null;
  }
}
