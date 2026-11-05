import { readFileSync } from "node:fs";

/**
 * Non-secret build configuration (Swift `AppConfiguration`): the OAuth client ids for Clio
 * and Microsoft 365. Read from `lana.config.json` next to the app, then overridden by the
 * environment (`LANA_CLIO_CLIENT_ID`, `LANA_MICROSOFT_CLIENT_ID`). Secrets never live
 * here: they are in the KeyVault.
 */
export interface AppConfiguration {
  readonly clioClientID: string | null;
  readonly microsoftClientID: string | null;
}

export const CONFIG_FILE_NAME = "lana.config.json";

/** The OAuth redirect scheme the app registers with the OS, as the Mac app. */
export const OAUTH_CALLBACK_SCHEME = "lananotes-auth";
export const OAUTH_REDIRECT_URIS = {
  clio: `${OAUTH_CALLBACK_SCHEME}://oauth/clio`,
  microsoft: `${OAUTH_CALLBACK_SCHEME}://oauth/microsoft`,
} as const;

export interface ConfigurationSources {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Path of `lana.config.json`; a missing or unreadable file counts as empty. */
  readonly file: string | null;
}

export function loadAppConfiguration(sources: ConfigurationSources): AppConfiguration {
  const file = readConfigFile(sources.file);
  const pick = (envName: string, key: string): string | undefined => sources.env[envName] ?? (typeof file[key] === "string" ? (file[key] as string) : undefined);
  return {
    clioClientID: clientID(pick("LANA_CLIO_CLIENT_ID", "clioClientID")),
    microsoftClientID: clientID(pick("LANA_MICROSOFT_CLIENT_ID", "microsoftClientID")),
  };
}

/** Placeholders from an example file count as not configured. */
export function clientID(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  return value === "" || value.startsWith("YOUR_") ? null : value;
}

function readConfigFile(path: string | null): Record<string, unknown> {
  if (path === null) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
