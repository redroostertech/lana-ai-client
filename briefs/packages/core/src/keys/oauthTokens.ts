import { LanaDate } from "../json/lanaDate.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { asDate, asObject, asString, field, optional } from "../json/read.js";

/** OAuth tokens for one connector account (Swift `OAuthTokens`). Never log these. */
export interface OAuthTokens {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly expiresAt: Date;
  readonly scope?: string | undefined;
  /** Provider region the tokens were issued in. Clio tokens only work in their region. */
  readonly region?: string | undefined;
}

/** Same keys as the Swift `CodingKeys`, so the stored JSON matches the Mac app's Keychain item. */
export function encodeOAuthTokens(tokens: OAuthTokens): JsonObject {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: LanaDate.format(tokens.expiresAt),
    scope: tokens.scope,
    region: tokens.region,
  };
}

export function decodeOAuthTokens(value: JsonValue, path = "tokens"): OAuthTokens {
  const object = asObject(value, path);
  return {
    accessToken: field(object, "access_token", path, asString),
    refreshToken: optional(object, "refresh_token", path, asString),
    expiresAt: field(object, "expires_at", path, asDate),
    scope: optional(object, "scope", path, asString),
    region: optional(object, "region", path, asString),
  };
}
