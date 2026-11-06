import { LanaError, lanaErrorForStatus } from "./lanaError.js";
import type { LanaReply, LanaRequest, LanaTransport } from "./lanaTransport.js";

/** The signed-in server and token for one call. Never log either. */
export interface LanaSessionCredentials {
  readonly baseURL: string;
  readonly token: string;
}

/**
 * The LANA client's session as this client needs it: runs `call` with the current
 * credentials. There is one session, the client's; a 401 means it ended or expired, and
 * the client (not Briefs) signs in again.
 */
export interface LanaSessionAccess {
  authorized<T>(call: (session: LanaSessionCredentials) => Promise<T>): Promise<T>;
}

/** A matter as LANA's matter search returns it (`client_matters`). */
export interface LanaMatter {
  /** `client_matters.id`, the reference every matter route accepts without ambiguity. */
  readonly id: string;
  /** The firm's matter number (`client_matters.matter_id`). */
  readonly code: string | null;
  readonly name: string | null;
  readonly clientName: string | null;
}

export interface LanaTaskFields {
  readonly title: string;
  readonly description: string;
  /** `YYYY-MM-DD`, or undefined. */
  readonly dueDate?: string | undefined;
}

export interface LanaNoteFields {
  readonly title: string;
  readonly content: string;
}

/** A task or note as LANA lists it: its id and the text the marker search reads. */
export interface LanaRecordText {
  readonly id: string;
  readonly text: string;
}

/** Waits `ms` (injected so tests do not wait). */
export type LanaSleeper = (ms: number) => Promise<void>;

export interface LanaClientOptions {
  readonly session: LanaSessionAccess;
  readonly transport: LanaTransport;
  readonly sleep?: LanaSleeper;
  /** Reads (GET). Default 15 seconds. */
  readonly readTimeoutMs?: number;
  /** Writes (POST, DELETE). Default 30 seconds. */
  readonly writeTimeoutMs?: number;
  /** Attempts for a read or a delete when nothing answered, LANA was busy or failed. Default 3. A create is sent once. */
  readonly maxAttempts?: number;
}

export const MATTER_SEARCH_MIN_LENGTH = 2;
export const MATTER_SEARCH_LIMIT = 20;
/** `tasks.validators.js`: title 500, description 10,000. */
export const LANA_TASK_TITLE_MAX = 500;
export const LANA_TASK_DESCRIPTION_MAX = 10_000;
/** `matter-notes.validators.js`: title 500, content 100,000. */
export const LANA_NOTE_TITLE_MAX = 500;
export const LANA_NOTE_CONTENT_MAX = 100_000;
/** How many recent notes the marker search reads (LANA lists notes newest first). */
const NOTE_SCAN_LIMIT = 50;
const TASK_SCAN_LIMIT = 10;
const BACKOFF_MS = [500, 1_500];

const realSleep: LanaSleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The firm's LANA server, called with the person's own session so LANA's access rules
 * decide what they can see and change. One method per endpoint (all under `/api/v1`):
 *
 * - `GET /matters/search?q=&limit=` (matters.routes.js)
 * - `POST /matters/:matter_id/tasks`, `GET /matters/:matter_id/tasks?search=`, `DELETE /tasks/:task_id?matter_id=` (tasks.routes.js)
 * - `POST /matters/:matter_id/notes`, `GET /matters/:matter_id/notes`, `DELETE /matters/:matter_id/notes/:note_id` (matter-notes.routes.js)
 *
 * Reads and deletes are retried a bounded number of times; a create is sent once and the
 * executor decides, after a marker search, whether it may be sent again. Errors are
 * `LanaError`, with the status only. Nothing here logs.
 */
export class LanaClient {
  private readonly sleep: LanaSleeper;
  private readonly readTimeoutMs: number;
  private readonly writeTimeoutMs: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: LanaClientOptions) {
    this.sleep = options.sleep ?? realSleep;
    this.readTimeoutMs = options.readTimeoutMs ?? 15_000;
    this.writeTimeoutMs = options.writeTimeoutMs ?? 30_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  }

  // MARK: - Matters

  /** Matters this person may read whose number, name, client or description contains `query`. */
  async searchMatters(query: string, limit = MATTER_SEARCH_LIMIT): Promise<LanaMatter[]> {
    const q = query.trim();
    if ([...q].length < MATTER_SEARCH_MIN_LENGTH) return [];
    const object = await this.read(`/api/v1/matters/search?q=${encodeURIComponent(q)}&limit=${Math.max(1, Math.min(limit, 50))}`);
    const matters = object["matters"];
    if (!Array.isArray(matters)) throw new LanaError("invalidResponse");
    return matters.flatMap((item) => {
      const row = asRecord(item);
      const id = row === null ? null : looseString(row["id"]);
      if (row === null || id === null) return [];
      return [{ id, code: text(row["matter_id"]), name: text(row["name"]), clientName: text(row["client_name"]) }];
    });
  }

  // MARK: - Tasks

  /** Creates a task on the matter. Sent once; a failure may still have landed (see `LanaError.isAmbiguous`). */
  async createTask(matterID: string, fields: LanaTaskFields): Promise<string> {
    const body: Record<string, string> = {
      title: clip(fields.title, LANA_TASK_TITLE_MAX),
      description: fields.description,
    };
    if (fields.dueDate !== undefined) body["due_date"] = dueInstant(fields.dueDate);
    const object = await this.write("POST", `/api/v1/matters/${segment(matterID)}/tasks`, body);
    return createdID(object);
  }

  /** Tasks on the matter whose title or description contains `text` (an ILIKE search). */
  async searchTasks(matterID: string, text: string): Promise<LanaRecordText[]> {
    const object = await this.read(`/api/v1/matters/${segment(matterID)}/tasks?search=${encodeURIComponent(text)}&limit=${TASK_SCAN_LIMIT}`);
    // The matter tasks route answers `{ success, tasks }`; older servers nested them under data.
    return records(asRecord(object["data"])?.["tasks"] ?? object["tasks"], "description");
  }

  /** Soft deletes the task (LANA sets `deleted_at`). A task already gone counts as deleted. */
  async deleteTask(matterID: string, taskID: string): Promise<void> {
    await this.remove(`/api/v1/tasks/${segment(taskID)}?matter_id=${encodeURIComponent(matterID)}`);
  }

  // MARK: - Notes

  /** Creates a note on the matter. Sent once, like a task. */
  async createNote(matterID: string, fields: LanaNoteFields): Promise<string> {
    const object = await this.write("POST", `/api/v1/matters/${segment(matterID)}/notes`, {
      title: clip(fields.title, LANA_NOTE_TITLE_MAX),
      content: fields.content,
    });
    return createdID(object);
  }

  /** The matter's most recent notes, newest first. */
  async recentNotes(matterID: string): Promise<LanaRecordText[]> {
    const object = await this.read(`/api/v1/matters/${segment(matterID)}/notes?limit=${NOTE_SCAN_LIMIT}`);
    return records(asRecord(object["data"])?.["notes"], "content");
  }

  /** Soft deletes the note. A note already gone counts as deleted. */
  async deleteNote(matterID: string, noteID: string): Promise<void> {
    await this.remove(`/api/v1/matters/${segment(matterID)}/notes/${segment(noteID)}`);
  }

  // MARK: - Private

  private read(path: string): Promise<Record<string, unknown>> {
    return this.withRetries(async () => json(await this.send("GET", path, undefined, this.readTimeoutMs)));
  }

  private async write(method: "POST", path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    return json(await this.send(method, path, JSON.stringify(sortKeys(body)), this.writeTimeoutMs));
  }

  private remove(path: string): Promise<void> {
    return this.withRetries(async () => {
      try {
        await this.send("DELETE", path, undefined, this.writeTimeoutMs);
      } catch (error) {
        if (error instanceof LanaError && error.kind === "notFound") return;
        throw error;
      }
    });
  }

  /** Idempotent calls only. */
  private async withRetries<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof LanaError) || !error.isTransient || attempt >= this.maxAttempts) throw error;
        await this.sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]!);
      }
    }
  }

  /** One exchange with the session's token; 2xx returns the reply, anything else throws `LanaError`. */
  private async send(method: LanaRequest["method"], path: string, body: string | undefined, timeoutMs: number): Promise<LanaReply> {
    return this.options.session.authorized(async ({ baseURL, token }) => {
      const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      let reply: LanaReply;
      try {
        reply = await this.options.transport.send({ method, url: `${trimSlash(baseURL)}${path}`, headers, body, timeoutMs });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError" && !isTimeout(error)) throw error;
        throw new LanaError("offline");
      }
      // A 401 is refused before anything is written: the session ended or expired.
      if (reply.status === 401) throw new LanaError("signedOut", 401);
      if (reply.status < 200 || reply.status > 299) throw lanaErrorForStatus(reply.status);
      return reply;
    });
  }
}

/** LANA takes an ISO instant; noon UTC keeps the calendar date in every US and European time zone. */
export function dueInstant(date: string): string {
  return `${date}T12:00:00.000Z`;
}

function isTimeout(error: Error): boolean {
  return error.name === "TimeoutError";
}

function json(reply: LanaReply): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.body);
  } catch {
    throw new LanaError("invalidResponse");
  }
  const object = asRecord(parsed);
  if (object === null) throw new LanaError("invalidResponse");
  return object;
}

/**
 * The new record's id from a create: notes answer `{ data: { id } }`, the matter
 * tasks route answers `{ success, task: { id } }`.
 */
function createdID(object: Record<string, unknown>): string {
  const id = looseString(asRecord(object["data"])?.["id"]) ?? looseString(asRecord(object["task"])?.["id"]);
  if (id === null || id === "") throw new LanaError("invalidResponse");
  return id;
}

function records(value: unknown, textKey: string): LanaRecordText[] {
  if (!Array.isArray(value)) throw new LanaError("invalidResponse");
  return value.flatMap((item) => {
    const row = asRecord(item);
    const id = row === null ? null : looseString(row["id"]);
    return row === null || id === null ? [] : [{ id, text: text(row[textKey]) ?? "" }];
  });
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function clip(value: string, max: number): string {
  const characters = [...value];
  return characters.length <= max ? value : characters.slice(0, max).join("");
}

function sortKeys(body: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(body).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Ids arrive as UUID strings, or numbers on older deployments. */
function looseString(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}
