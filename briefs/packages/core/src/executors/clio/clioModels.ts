import { intId, obj, optObj, optStr, type Json } from "../execution/responseJson.js";

export interface ClioUser {
  readonly id: string;
  readonly name?: string | undefined;
}

export interface ClioMatter {
  readonly id: string;
  readonly displayNumber?: string | undefined;
  readonly description?: string | undefined;
  readonly status?: string | undefined;
  readonly client?: { readonly id: string; readonly name?: string | undefined } | undefined;
}

export interface ClioContact {
  readonly id: string;
  readonly name?: string | undefined;
  readonly primaryEmailAddress?: string | undefined;
  /** "Person" or "Company". */
  readonly type?: string | undefined;
}

/** Note or task as returned by a marker search. */
export interface ClioMarkedRecord {
  readonly id: string;
  readonly detail?: string | undefined;
  readonly description?: string | undefined;
}

// Clio ids are Int64 in Swift; here they are decimal strings (ids above 2^53 are refused).

export function decodeClioUser(value: Json, path: string): ClioUser {
  const o = obj(value, path);
  return { id: intId(o, "id", path), name: optStr(o, "name", path) };
}

export function decodeClioMatter(value: Json, path: string): ClioMatter {
  const o = obj(value, path);
  const client = optObj(o, "client", path);
  return {
    id: intId(o, "id", path),
    displayNumber: optStr(o, "display_number", path),
    description: optStr(o, "description", path),
    status: optStr(o, "status", path),
    client: client === undefined ? undefined : { id: intId(client, "id", `${path}.client`), name: optStr(client, "name", `${path}.client`) },
  };
}

export function decodeClioContact(value: Json, path: string): ClioContact {
  const o = obj(value, path);
  return { id: intId(o, "id", path), name: optStr(o, "name", path), primaryEmailAddress: optStr(o, "primary_email_address", path), type: optStr(o, "type", path) };
}

export function decodeClioMarkedRecord(value: Json, path: string): ClioMarkedRecord {
  const o = obj(value, path);
  return { id: intId(o, "id", path), detail: optStr(o, "detail", path), description: optStr(o, "description", path) };
}

/** `{"data":{"id":...}}` from a create. */
export function decodeClioCreatedId(value: Json): string {
  const data = obj(obj(value, "$")["data"], "$.data");
  return intId(data, "id", "$.data");
}
