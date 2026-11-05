import type { IntentStatus } from "../intent/intentStatus.js";

/**
 * The Inbox list: one pure pipeline from a request to a page of rows. The store reads
 * only what the indexed columns can filter (status, type, meeting, deleted); titles,
 * details, meeting titles and matters are sealed at rest, so search, the matter filter and
 * every sort run here on the opened rows. Same shapes as the app's `ActionRow` contract,
 * plus `detail`, which search reads and the list never shows.
 */

/** `unsupported`: a type this version cannot run, waiting where a runnable one would read review. */
export const ACTION_ROW_STATUSES = ["waiting", "drafting", "review", "unsupported", "interrupted", "failed", "ran", "undone", "dismissed"] as const;
export type ActionRowStatus = (typeof ACTION_ROW_STATUSES)[number];

export const ACTION_KINDS = ["note", "task", "email", "unsupported"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_SORT_KEYS = ["created", "updated", "title", "meeting", "matter", "status", "kind"] as const;
export type ActionSortKey = (typeof ACTION_SORT_KEYS)[number];

export type ActionOrigin = "meeting" | "draft" | "manual";

export interface MatterRef {
  readonly id: string;
  readonly label: string;
  readonly detail: string | null;
}

export interface ActionListItem {
  readonly id: string;
  readonly kind: ActionKind | null;
  readonly title: string;
  /** The body (note text, task detail, email body). Searched, never listed. Empty when none. */
  readonly detail: string;
  readonly meetingID: string | null;
  readonly meetingTitle: string | null;
  readonly matter: MatterRef | null;
  readonly status: ActionRowStatus;
  readonly origin: ActionOrigin;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  /** The person has not read it yet (store `seen_at` is null). Always false for a background draft. */
  readonly unread: boolean;
}

export interface ActionListFilters {
  readonly status: readonly ActionRowStatus[];
  readonly kind: readonly ActionKind[];
  readonly meetingID?: string | undefined;
  readonly matterID?: string | undefined;
  readonly deleted?: boolean | undefined;
  /** True lists only unread actions, with any status filter (both must match). */
  readonly unread?: boolean | undefined;
}

export interface ActionListQuery {
  readonly query: string;
  readonly filters: ActionListFilters;
  readonly sort: { readonly by: ActionSortKey; readonly dir: "asc" | "desc" };
  readonly page: number;
  readonly pageSize: number;
}

export interface ActionListPage {
  readonly rows: ActionListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** The meetings and matters the actions mention, for search suggestions. */
export interface ActionListFacets {
  readonly meetings: Array<{ readonly id: string; readonly title: string }>;
  readonly matters: Array<{ readonly id: string; readonly label: string }>;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_QUERY_LENGTH = 200;

// MARK: - Request

/** A request from the bridge, checked: unknown values fall back, numbers clamp. Never throws. */
export function normalizeListQuery(raw: unknown): ActionListQuery {
  const input = isRecord(raw) ? raw : {};
  const filters = isRecord(input["filters"]) ? input["filters"] : {};
  const sort = isRecord(input["sort"]) ? input["sort"] : {};
  const query = typeof input["query"] === "string" ? input["query"].trim().slice(0, MAX_QUERY_LENGTH) : "";
  const by = ACTION_SORT_KEYS.find((key) => key === sort["by"]) ?? "created";
  const dir = sort["dir"] === "asc" ? "asc" : sort["dir"] === "desc" ? "desc" : by === "created" || by === "updated" ? "desc" : "asc";
  return {
    query,
    filters: {
      status: oneOf(filters["status"], ACTION_ROW_STATUSES),
      kind: oneOf(filters["kind"], ACTION_KINDS),
      meetingID: nonEmpty(filters["meetingID"]),
      matterID: nonEmpty(filters["matterID"]),
      deleted: filters["deleted"] === true,
      unread: filters["unread"] === true,
    },
    sort: { by, dir },
    page: wholeNumber(input["page"], 1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: wholeNumber(input["pageSize"], DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
  };
}

// MARK: - Status

/**
 * The row status of a stored action. `proposed` never reaches the desktop; it reads as review.
 * A type this version cannot run never reads review: it cannot run and is not counted as
 * waiting, so it reads unsupported until it is dismissed or deleted.
 */
export function rowStatusOf(status: IntentStatus, kind: ActionKind): ActionRowStatus {
  switch (status) {
    case "proposed":
    case "transferred":
    case "resolved":
      return kind === "unsupported" ? "unsupported" : "review";
    case "confirmed":
      return "interrupted";
    case "executed":
      return "ran";
    case "failed":
    case "undone":
    case "dismissed":
      return status;
  }
}

/** The row status of a background draft: queued is waiting, then drafting. */
export function draftRowStatusOf(status: "queued" | "drafting"): ActionRowStatus {
  return status === "queued" ? "waiting" : "drafting";
}

/**
 * The stored statuses behind row statuses, sorted. Null means no status filter. Review and
 * unsupported share stored statuses; `matchesFilters` tells them apart by row status.
 */
export function intentStatusesFor(statuses: readonly ActionRowStatus[]): IntentStatus[] | null {
  if (statuses.length === 0) return null;
  const all: Record<ActionRowStatus, IntentStatus[]> = {
    waiting: [],
    drafting: [],
    review: ["proposed", "transferred", "resolved"],
    unsupported: ["proposed", "transferred", "resolved"],
    interrupted: ["confirmed"],
    failed: ["failed"],
    ran: ["executed"],
    undone: ["undone"],
    dismissed: ["dismissed"],
  };
  return [...new Set(statuses.flatMap((status) => all[status]))].sort();
}

/** The wire type of a kind (the `type` column), sorted. Null means no type filter. */
export function intentTypesFor(kinds: readonly ActionKind[]): { readonly types: string[]; readonly unsupported: boolean } | null {
  if (kinds.length === 0) return null;
  const known: Partial<Record<ActionKind, string>> = { note: "note.log", task: "task.create", email: "email.draft" };
  return { types: [...new Set(kinds.flatMap((kind) => (known[kind] === undefined ? [] : [known[kind]])))].sort(), unsupported: kinds.includes("unsupported") };
}

export function kindOfType(type: string): ActionKind {
  return type === "note.log" ? "note" : type === "task.create" ? "task" : type === "email.draft" ? "email" : "unsupported";
}

// MARK: - SQL

export interface SqlFilter {
  /** `WHERE ...`, or empty. Same column names on `intent` and `manual_action`. */
  readonly where: string;
  readonly params: Array<string>;
  /** True when no stored row can match (only draft statuses asked for). */
  readonly empty: boolean;
}

/**
 * The indexed part of the filters as SQL with placeholders (never interpolated values).
 * Matter and search are not here: they are sealed, so they apply after opening the rows.
 */
export function actionListSql(filters: ActionListFilters): SqlFilter {
  const clauses: string[] = [filters.deleted === true ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"];
  const params: string[] = [];
  const statuses = intentStatusesFor(filters.status);
  if (statuses !== null) {
    if (statuses.length === 0) return { where: "", params: [], empty: true };
    clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }
  const types = intentTypesFor(filters.kind);
  if (types !== null) {
    const known = types.types.map(() => "?").join(", ");
    const parts: string[] = [];
    if (types.types.length > 0) parts.push(`type IN (${known})`);
    if (types.unsupported) parts.push(`type NOT IN ('note.log', 'task.create', 'email.draft')`);
    clauses.push(parts.length === 1 ? parts[0]! : `(${parts.join(" OR ")})`);
    params.push(...types.types);
  }
  if (filters.meetingID !== undefined) {
    clauses.push("meeting_id = ?");
    params.push(filters.meetingID);
  }
  if (filters.unread === true) clauses.push("seen_at IS NULL");
  return { where: `WHERE ${clauses.join(" AND ")}`, params, empty: false };
}

// MARK: - Filter, search, sort, page

/** Every filter, for rows that did not come through SQL (drafts) and for the sealed matter. */
export function matchesFilters(item: ActionListItem, filters: ActionListFilters): boolean {
  if ((filters.deleted === true) !== (item.deletedAt !== null)) return false;
  if (filters.status.length > 0 && !filters.status.includes(item.status)) return false;
  if (filters.kind.length > 0 && (item.kind === null || !filters.kind.includes(item.kind))) return false;
  if (filters.meetingID !== undefined && item.meetingID !== filters.meetingID) return false;
  if (filters.matterID !== undefined && item.matter?.id !== filters.matterID) return false;
  if (filters.unread === true && !item.unread) return false;
  return true;
}

/** Folds case and accents, so "acme" finds "ACMÉ". */
export function foldForSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
}

/** The query's words, folded. */
export function searchWords(query: string): string[] {
  return foldForSearch(query).split(/\s+/).filter((word) => word !== "");
}

/** Every word of the query appears in the title, the detail, the meeting or the matter. */
export function matchesSearch(item: ActionListItem, query: string): boolean {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const haystack = foldForSearch([item.title, item.detail, item.meetingTitle ?? "", item.matter?.label ?? "", item.matter?.detail ?? ""].join(" "));
  return words.every((word) => haystack.includes(word));
}

/** Each meeting and matter the items mention once, A to Z. Meetings with no title are left out. */
export function searchFacets(items: readonly ActionListItem[]): ActionListFacets {
  const meetings = new Map<string, string>();
  const matters = new Map<string, string>();
  for (const item of items) {
    if (item.meetingID !== null && item.meetingTitle !== null && item.meetingTitle.trim() !== "") meetings.set(item.meetingID, item.meetingTitle);
    if (item.matter !== null) matters.set(item.matter.id, item.matter.label);
  }
  const byText = <T extends { id: string }>(text: (value: T) => string) => (a: T, b: T) => collator.compare(text(a), text(b)) || (a.id < b.id ? -1 : 1);
  return {
    meetings: [...meetings].map(([id, title]) => ({ id, title })).sort(byText((meeting) => meeting.title)),
    matters: [...matters].map(([id, label]) => ({ id, label })).sort(byText((matter) => matter.label)),
  };
}

const STATUS_ORDER: Record<ActionRowStatus, number> = Object.fromEntries(ACTION_ROW_STATUSES.map((status, index) => [status, index])) as Record<ActionRowStatus, number>;
const KIND_ORDER: Record<ActionKind, number> = { task: 0, note: 1, email: 2, unsupported: 3 };
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function sortValue(item: ActionListItem, by: ActionSortKey): string | number | null {
  switch (by) {
    case "created":
      return item.createdAt;
    case "updated":
      return item.updatedAt;
    case "title":
      return item.title.trim() === "" ? null : item.title;
    case "meeting":
      return item.meetingTitle;
    case "matter":
      return item.matter?.label ?? null;
    case "status":
      return STATUS_ORDER[item.status];
    case "kind":
      return item.kind === null ? null : KIND_ORDER[item.kind];
  }
}

/**
 * Orders rows by one column. Empty values (no meeting, no matter) go last either way;
 * ties fall back to newest first, then id, so a page never reshuffles.
 */
export function compareRows(by: ActionSortKey, dir: "asc" | "desc"): (a: ActionListItem, b: ActionListItem) => number {
  const sign = dir === "asc" ? 1 : -1;
  return (a, b) => {
    const left = sortValue(a, by);
    const right = sortValue(b, by);
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    if (left !== null && right !== null && left !== right) {
      const order = typeof left === "number" && typeof right === "number" ? left - right
        : by === "created" || by === "updated" ? (String(left) < String(right) ? -1 : 1)
          : collator.compare(String(left), String(right));
      if (order !== 0) return sign * order;
    }
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/** One page. A page past the end gives the last page; an empty list is page 1 of nothing. */
export function pageOf(rows: readonly ActionListItem[], page: number, pageSize: number): ActionListPage {
  const last = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), last);
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), total: rows.length, page: current, pageSize };
}

/** Filter, search, sort and page in one step. `items` may hold more than the SQL already filtered. */
export function listActions(items: readonly ActionListItem[], query: ActionListQuery): ActionListPage {
  const matching = items.filter((item) => matchesFilters(item, query.filters) && matchesSearch(item, query.query));
  matching.sort(compareRows(query.sort.by, query.sort.dir));
  return pageOf(matching, query.page, query.pageSize);
}

// MARK: - Private

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is T => typeof item === "string" && (allowed as readonly string[]).includes(item)))];
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function wholeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
