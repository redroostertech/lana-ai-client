export { InMemoryDataKeyProvider, type DataKeyProvider } from "./dataKeyProvider.js";
export {
  SecretKeyVault, createInMemoryKeyVault, createSealedFileKeyVault, VAULT_ITEMS, type KeyVault,
} from "./keyVault.js";
export { InMemorySecretBackend, SealedFileSecretBackend, type SecretBackend, type SecretSealer } from "./secretBackend.js";
export { safeStorageSealer, type SafeStorageLike } from "./safeStorageSealer.js";
export { KeyVaultError, type KeyVaultErrorKind } from "./keyVaultError.js";
