import { AuthorizedHTTPClient } from "../execution/authorizedHTTPClient.js";
import { arr, obj, optObj, optStr, parseResponse, type Json } from "../execution/responseJson.js";
import type { RateLimitedClient } from "../http/rateLimitedClient.js";
import type { AccessTokenProvider } from "../oauth/tokenStore.js";
import { compareKeys } from "../../json/compareKeys.js";
import { parseURL, withQuery } from "../url.js";
import { ClioMarker } from "./clioMarker.js";
import {
  decodeClioContact, decodeClioMarkedRecord, decodeClioMatter, decodeClioUser, type ClioContact, type ClioMatter, type ClioUser,
} from "./clioModels.js";
import { clioBaseURL, clioHost, type ClioRegion } from "./clioRegion.js";

export interface ClioClientOptions {
  readonly region: ClioRegion;
  readonly client: RateLimitedClient;
  readonly tokens: AccessTokenProvider;
  readonly maxPages?: number;
}

/**
 * Read side of Clio Manage API v4 plus deletes (Swift `ClioClient`). Creates are built as
 * `PlannedRequest`s by the executors and sent verbatim.
 */
export class ClioClient {
  static readonly matterFields = "id,display_number,description,status,client{id,name}";
  static readonly contactFields = "id,name,primary_email_address,type";
  /** Clio's maximum page size for list endpoints. */
  static readonly mirrorPageSize = 200;

  readonly region: ClioRegion;
  readonly http: AuthorizedHTTPClient;
  private readonly maxPages: number;

  constructor(options: ClioClientOptions) {
    this.region = options.region;
    this.http = new AuthorizedHTTPClient(options.client, options.tokens, clioHost(options.region));
    this.maxPages = Math.max(1, options.maxPages ?? 5);
  }

  async whoAmI(): Promise<ClioUser> {
    const response = await this.http.get(this.url("users/who_am_i.json", { fields: "id,name" }));
    response.requireSuccess(this.http.client.clock.now());
    return decodeClioUser(obj(parseResponse(response.body), "$")["data"], "$.data");
  }

  searchMatters(query: string): Promise<ClioMatter[]> {
    return this.list(this.url("matters.json", { query, fields: ClioClient.matterFields }), decodeClioMatter);
  }

  searchContacts(query: string): Promise<ClioContact[]> {
    return this.list(this.url("contacts.json", { query, fields: ClioClient.contactFields }), decodeClioContact);
  }

  /**
   * Every matter, paging until Clio stops returning a next link or `maxPages` is reached.
   * Used by the gateway's local mirror sync; requests go through the rate limiter.
   */
  allMatters(pageSize: number = ClioClient.mirrorPageSize): Promise<ClioMatter[]> {
    return this.list(this.url("matters.json", { fields: ClioClient.matterFields, limit: String(pageSize), order: "id(asc)" }), decodeClioMatter);
  }

  /** Every contact, paged like `allMatters`. */
  allContacts(pageSize: number = ClioClient.mirrorPageSize): Promise<ClioContact[]> {
    return this.list(this.url("contacts.json", { fields: ClioClient.contactFields, limit: String(pageSize), order: "id(asc)" }), decodeClioContact);
  }

  delete(url: string): Promise<void> {
    return this.http.delete(url);
  }

  /** `https://<host>/api/v4/<path>` with the query items sorted by name. */
  url(path: string, query: Readonly<Record<string, string>> = {}): string {
    const items = Object.keys(query).sort(compareKeys).map((name) => [name, query[name] ?? ""] as const);
    return withQuery(`${clioBaseURL(this.region)}/api/v4/${path}`, items);
  }

  recordURL(collection: string, id: string): string {
    return this.url(`${collection}/${id}.json`);
  }

  /**
   * Finds a note or task whose text ends with the marker line. Clio's `query` is a fuzzy
   * text search, so each hit is checked locally for the exact marker line.
   */
  async findMarked(collection: string, marker: string, extraQuery: Readonly<Record<string, string>>): Promise<string | undefined> {
    const query = { ...extraQuery, query: marker, fields: collection === "notes" ? "id,detail" : "id,description" };
    const records = await this.list(this.url(`${collection}.json`, query), decodeClioMarkedRecord);
    return records.find((record) => ClioMarker.endsWithMarker(record.detail ?? record.description ?? "", marker))?.id;
  }

  async list<Item>(first: string, decode: (value: Json, path: string) => Item): Promise<Item[]> {
    const items: Item[] = [];
    let next: string | undefined = first;
    let pages = 0;
    while (next !== undefined && pages < this.maxPages) {
      const response = await this.http.get(next);
      response.requireSuccess(this.http.client.clock.now());
      const envelope = obj(parseResponse(response.body), "$");
      arr(envelope["data"], "$.data").forEach((item, index) => items.push(decode(item, `$.data[${index}]`)));
      const paging = optObj(optObj(envelope, "meta", "$") ?? {}, "paging", "$.meta");
      next = parseURL(paging === undefined ? undefined : optStr(paging, "next", "$.meta.paging"));
      pages += 1;
    }
    return items;
  }
}
