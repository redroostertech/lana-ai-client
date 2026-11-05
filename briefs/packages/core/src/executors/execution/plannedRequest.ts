import { toBase64 } from "../../bytes/base64.js";
import { sha256Hex } from "../../crypto/digest.js";
import { canonicalEncode } from "../../json/canonical.js";
import type { JsonObject, JsonValue } from "../../json/jsonValue.js";
import { asBytes, asObject, asString, field, optional } from "../../json/read.js";
import type { HTTPRequest } from "../http/httpTransport.js";

/**
 * The exact HTTP request an action will send, minus Authorization (added at send time).
 * The body is canonical JSON so the hash is stable across encode and decode (Swift `PlannedRequest`).
 */
export interface PlannedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array | undefined;
}

export function makePlannedRequest(method: string, url: string, headers: Readonly<Record<string, string>>, body?: Uint8Array): PlannedRequest {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) if (name.toLowerCase() !== "authorization") kept[name] = value;
  return { method: method.toUpperCase(), url, headers: kept, body };
}

/** A JSON request whose body is the canonical encoding of `body`. */
export function jsonRequest(method: string, url: string, body: JsonValue): PlannedRequest {
  return makePlannedRequest(method, url, { Accept: "application/json", "Content-Type": "application/json" }, canonicalEncode(body));
}

export function encodePlannedRequest(request: PlannedRequest): JsonObject {
  return {
    method: request.method,
    url: request.url,
    headers: { ...request.headers },
    body: request.body === undefined ? undefined : toBase64(request.body),
  };
}

export function decodePlannedRequest(value: JsonValue, path = "request"): PlannedRequest {
  const object = asObject(value, path);
  const headersObject = field(object, "headers", path, asObject);
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(headersObject)) headers[name] = asString(header, `${path}.headers.${name}`);
  // Decoded verbatim (no normalizing), so a tampered request no longer matches its hash.
  return {
    method: field(object, "method", path, asString),
    url: field(object, "url", path, asString),
    headers,
    body: optional(object, "body", path, asBytes),
  };
}

/** Hex SHA-256 over the canonical encoding of the request. */
export function plannedRequestHash(request: PlannedRequest): string {
  return sha256Hex(canonicalEncode(encodePlannedRequest(request)));
}

/** The request as sent, with the bearer token added last. */
export function plannedToHTTP(request: PlannedRequest, bearerToken: string): HTTPRequest {
  return { method: request.method, url: request.url, headers: { ...request.headers, Authorization: `Bearer ${bearerToken}` }, body: request.body };
}
