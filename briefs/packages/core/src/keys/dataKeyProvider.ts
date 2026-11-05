import { randomBytes } from "../crypto/random.js";

/**
 * Supplies the at-rest master key that seals the gateway store (Swift `DataKeyProvider`).
 * A copied store is unreadable without this machine's key vault.
 */
export interface DataKeyProvider {
  dataKey(): Promise<Uint8Array>;
}

/** Process memory only. Tests and previews. */
export class InMemoryDataKeyProvider implements DataKeyProvider {
  private readonly key: Uint8Array;

  constructor(key: Uint8Array = randomBytes(32)) {
    if (key.length !== 32) throw new RangeError("Data key must be 32 bytes");
    this.key = key.slice();
  }

  async dataKey(): Promise<Uint8Array> {
    return this.key.slice();
  }
}
