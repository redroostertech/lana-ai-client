import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { LanaSessionAccess } from "../../src/lana/index.js";

/** One request as the fake server saw it. */
export interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly token: string | null;
  readonly body: Record<string, unknown> | null;
}

interface StoredRecord {
  id: string;
  matter: string;
  title: string;
  text: string;
  deleted: boolean;
}

/** What the next matching request answers instead of the normal reply. */
export type Scripted = { status: number; body?: string } | { drop: true } | { hang: true };

/**
 * A small LANA server for tests: matter search, matter tasks and matter notes with the
 * same paths, reply shapes and soft deletes as LANA-AI. Tokens in `valid` are accepted;
 * anything else is a 401. Scripted replies (`script`) run before the normal handling, so
 * a test can make a create land and still answer 503, or drop the connection.
 */
export class FakeLanaServer {
  readonly seen: SeenRequest[] = [];
  readonly tasks: StoredRecord[] = [];
  readonly notes: StoredRecord[] = [];
  readonly valid = new Set<string>(["token-1"]);
  readonly matters = [
    { id: "4f6c1d2e-0000-4000-8000-000000000042", matter_id: "00042", name: "Lease renewal", client_name: "Acme Logistics", status: "open" },
    { id: "4f6c1d2e-0000-4000-8000-000000000043", matter_id: "00043", name: "Acme employment", client_name: "Acme Logistics", status: "open" },
  ];
  /** Matter ids this person may not write to (403 on create). */
  readonly forbidden = new Set<string>();
  private readonly scripts: Array<{ match: (request: SeenRequest) => boolean; reply: Scripted; afterHandling: boolean }> = [];
  private server: Server | null = null;
  private counter = 0;

  get baseURL(): string {
    const address = this.server?.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  /**
   * The next request `match` accepts answers `reply`. With `afterHandling` the request is
   * handled first (a create lands) and only the reply is replaced.
   */
  script(match: (request: SeenRequest) => boolean, reply: Scripted, afterHandling = false): void {
    this.scripts.push({ match, reply, afterHandling });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://fake");
    const raw = await new Promise<string>((resolve) => {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => resolve(text));
    });
    const auth = request.headers["authorization"];
    const seen: SeenRequest = {
      method: request.method ?? "",
      path: url.pathname,
      query: url.searchParams,
      token: typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : null,
      body: raw === "" ? null : (JSON.parse(raw) as Record<string, unknown>),
    };
    this.seen.push(seen);
    const index = this.scripts.findIndex((item) => item.match(seen));
    const scripted = index >= 0 ? this.scripts.splice(index, 1)[0] : undefined;
    if (scripted !== undefined && !scripted.afterHandling) return this.reply(response, scripted.reply);
    if (seen.token === null || !this.valid.has(seen.token)) return this.send(response, 401, { error: { message: "Authentication required", code: "AUTHENTICATION_ERROR" } });
    const handled = this.route(seen);
    if (scripted !== undefined) return this.reply(response, scripted.reply);
    this.send(response, handled.status, handled.body);
  }

  private reply(response: ServerResponse, reply: Scripted): void {
    if ("drop" in reply) {
      response.socket?.destroy();
      return;
    }
    if ("hang" in reply) return;
    response.writeHead(reply.status, { "Content-Type": "application/json" });
    response.end(reply.body ?? JSON.stringify({ error: { message: "scripted" } }));
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  }

  private route(request: SeenRequest): { status: number; body: unknown } {
    const parts = request.path.split("/").filter(Boolean).map(decodeURIComponent);
    // /api/v1/matters/search
    if (request.method === "GET" && parts[2] === "matters" && parts[3] === "search") {
      const q = request.query.get("q") ?? "";
      if (q.length < 2) return { status: 400, body: { error: "Search query must be at least 2 characters" } };
      const needle = q.toLowerCase();
      const matters = this.matters.filter((m) => [m.name, m.client_name, m.matter_id].some((field) => field.toLowerCase().includes(needle)));
      return { status: 200, body: { query: q, matters, count: matters.length } };
    }
    // /api/v1/matters/:matter/tasks | notes
    if (parts[2] === "matters" && parts.length >= 5) {
      const matter = parts[3]!;
      if (!this.matters.some((m) => m.id === matter)) return { status: 404, body: { error: { message: "Matter not found" } } };
      const store = parts[4] === "tasks" ? this.tasks : parts[4] === "notes" ? this.notes : null;
      if (store === null) return { status: 404, body: {} };
      if (request.method === "POST" && parts.length === 5) {
        if (this.forbidden.has(matter)) return { status: 403, body: { error: { message: "Access denied" } } };
        const body = request.body ?? {};
        const title = String(body["title"] ?? "");
        if (title === "") return { status: 400, body: { error: { message: "Title cannot be empty" } } };
        const record = { id: this.nextID(), matter, title, text: String(body[store === this.tasks ? "description" : "content"] ?? ""), deleted: false };
        store.push(record);
        return { status: 201, body: { status: "success", data: { id: record.id, title } } };
      }
      if (request.method === "GET" && parts.length === 5) {
        const search = request.query.get("search");
        const rows = store.filter((r) => r.matter === matter && !r.deleted && (search === null || r.text.includes(search) || r.title.includes(search))).reverse();
        const key = store === this.tasks ? "tasks" : "notes";
        const textKey = store === this.tasks ? "description" : "content";
        return { status: 200, body: { status: "success", data: { [key]: rows.map((r) => ({ id: r.id, title: r.title, [textKey]: r.text })), total: rows.length } } };
      }
      if (request.method === "DELETE" && parts.length === 6 && store === this.notes) return this.softDelete(store, parts[5]!, matter);
    }
    // /api/v1/tasks/:id?matter_id=
    if (request.method === "DELETE" && parts[2] === "tasks" && parts.length === 4) return this.softDelete(this.tasks, parts[3]!, request.query.get("matter_id"));
    return { status: 404, body: { error: { message: "Not found" } } };
  }

  private softDelete(store: StoredRecord[], id: string, matter: string | null): { status: number; body: unknown } {
    const record = store.find((r) => r.id === id && r.matter === matter && !r.deleted);
    if (record === undefined) return { status: 404, body: { error: { message: "Not found" } } };
    record.deleted = true;
    return { status: 200, body: { status: "success", message: "Deleted successfully" } };
  }

  private nextID(): string {
    this.counter += 1;
    return `9b1e7c3a-0000-4000-8000-${String(this.counter).padStart(12, "0")}`;
  }
}

/**
 * The LANA client's session on `baseURL` with a fixed token, the way the host reads it: one
 * session, owned by the client. `signedOut()` ends it.
 */
export function clientSession(baseURL: string, token = "token-1"): { session: LanaSessionAccess; signOut: () => void } {
  let current: string | null = token;
  return {
    session: {
      authorized: async (call) => {
        const { LanaError } = await import("../../src/lana/index.js");
        if (current === null) throw new LanaError("signedOut", 401);
        return call({ baseURL, token: current });
      },
    },
    signOut: () => {
      current = null;
    },
  };
}
