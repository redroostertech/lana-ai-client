export type KeyVaultErrorKind = "unavailable" | "corrupt" | "io" | "badName";

/** Key vault failures. `subject` is an item name, never key material. */
export class KeyVaultError extends Error {
  override readonly name = "KeyVaultError";

  constructor(readonly kind: KeyVaultErrorKind, readonly subject: string) {
    super(`${kind}: ${subject}`);
  }
}
