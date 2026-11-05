import type { KeyVault } from "../../keys/keyVault.js";
import type { OAuthTokens } from "../../keys/oauthTokens.js";

/** Where OAuth tokens live, keyed by account ("clio", "microsoft"). Swift `TokenStore`. */
export interface TokenStore {
  load(account: string): Promise<OAuthTokens | null>;
  save(tokens: OAuthTokens, account: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/** Supplies a currently valid bearer token. `OAuthClient` is the production provider. */
export interface AccessTokenProvider {
  accessToken(): Promise<string>;
}

/**
 * Tokens in the KeyVault (`oauth.<account>`), the desktop counterpart of the Mac app's
 * Keychain items: the same accounts and the same JSON (`OAuthTokens` CodingKeys).
 */
export function vaultTokenStore(vault: KeyVault): TokenStore {
  return {
    load: (account) => vault.oauthTokens(account),
    save: (tokens, account) => vault.saveOAuthTokens(tokens, account),
    delete: (account) => vault.deleteOAuthTokens(account),
  };
}

/** Test and preview store. Never used for real credentials. */
export class InMemoryTokenStore implements TokenStore {
  private readonly storage = new Map<string, OAuthTokens>();

  constructor(initial: Readonly<Record<string, OAuthTokens>> = {}) {
    for (const [account, tokens] of Object.entries(initial)) this.storage.set(account, tokens);
  }

  async load(account: string): Promise<OAuthTokens | null> {
    return this.storage.get(account) ?? null;
  }

  async save(tokens: OAuthTokens, account: string): Promise<void> {
    this.storage.set(account, tokens);
  }

  async delete(account: string): Promise<void> {
    this.storage.delete(account);
  }
}
