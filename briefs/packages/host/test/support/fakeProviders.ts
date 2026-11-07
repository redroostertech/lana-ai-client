import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** One request the fake providers received. The Authorization header is kept to check the bearer token. */
export interface ProviderRequest {
  readonly method: string;
  /** Host and path as the app meant it: `app.clio.com/api/v4/notes.json?...`. */
  readonly target: string;
  readonly body: string;
  readonly authorization: string | undefined;
}

export interface FakeMatter {
  readonly id: number;
  readonly display_number: string;
  readonly description: string;
  readonly client: { readonly id: number; readonly name: string };
}

export interface FakeContact {
  readonly id: number;
  readonly name: string;
  readonly primary_email_address?: string;
  readonly type: "Person" | "Company";
}

interface ClioRecord {
  readonly id: number;
  readonly text: string;
  readonly body: unknown;
}

interface GraphDraft {
  readonly id: string;
  readonly intentID: string;
  readonly body: unknown;
}

const INTENT_PROPERTY = "String {8b3f6c2e-5d4a-4e91-a7c3-1f0e9d2b6a58} Name LanaIntentId";

/**
 * Clio Manage and Microsoft Graph (plus their token endpoints) on localhost, for the app
 * and Electron tests. Requests arrive as `/<provider host>/<path>` (the app's test
 * transport rewrites `https://<host>/<path>`). Notes and tasks keep their text so the
 * `Lana:<intent id>` marker search works; drafts keep the LanaIntentId property. Nothing
 * here ever sends mail: there is no send route.
 */
export class FakeProviders {
  readonly requests: ProviderRequest[] = [];
  readonly notes = new Map<number, ClioRecord>();
  readonly tasks = new Map<number, ClioRecord>();
  readonly drafts = new Map<string, GraphDraft>();
  matters: FakeMatter[] = [{ id: 4201, display_number: "00042", description: "Muller v. Acme", client: { id: 501, name: "Jose Muller" } }];
  contacts: FakeContact[] = [
    { id: 9001, name: "Acme Corp", primary_email_address: "billing@acme.test", type: "Company" },
    { id: 9002, name: "Dana Park", primary_email_address: "dana@firm.law", type: "Person" },
  ];
  /** Store the next Clio create, then drop the connection without answering (a lost response). */
  dropNextCreate = false;
  private nextID = 880_001;
  private server: Server | null = null;
  origin = "";

  async start(): Promise<string> {
    this.server = createServer((request, response) => this.handle(request, response));
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.origin = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
    return this.origin;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server === null ? resolve() : this.server.close(() => resolve())));
  }

  sent(method: string, fragment: string): ProviderRequest[] {
    return this.requests.filter((request) => request.method === method && request.target.includes(fragment));
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const target = (request.url ?? "").replace(/^\//, "");
      const method = request.method ?? "GET";
      this.requests.push({ method, target, body, authorization: request.headers.authorization });
      const url = new URL(`https://${target}`);
      const reply = (status: number, value?: unknown): void => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(value === undefined ? "" : JSON.stringify(value));
      };
      if (method === "POST" && url.pathname.endsWith("/token")) return reply(200, { access_token: `access-${url.hostname}`, refresh_token: "refresh-1", expires_in: 3600 });
      if (url.hostname.endsWith("app.clio.com")) return this.clio(method, url, body, reply, response);
      if (url.hostname === "graph.microsoft.com") return this.graph(method, url, body, reply);
      reply(404, {});
    });
  }

  private clio(method: string, url: URL, body: string, reply: (status: number, value?: unknown) => void, response: ServerResponse): void {
    const path = url.pathname.replace(/^\/api\/v4\//, "");
    const query = url.searchParams.get("query");
    const page = <T>(items: T[]) => reply(200, { data: items, meta: { paging: {} } });
    if (method === "GET" && path === "users/who_am_i.json") return reply(200, { data: { id: 77, name: "Alicia Reyes" } });
    if (method === "GET" && path === "matters.json") return page(query === null ? this.matters : this.matters.filter((matter) => matches(`${matter.description} ${matter.client.name} ${matter.display_number}`, query)));
    if (method === "GET" && path === "contacts.json") return page(query === null ? this.contacts : this.contacts.filter((contact) => matches(`${contact.name} ${contact.primary_email_address ?? ""}`, query)));
    for (const [collection, records, field] of [["notes", this.notes, "detail"], ["tasks", this.tasks, "description"]] as const) {
      if (method === "GET" && path === `${collection}.json`) {
        return page([...records.values()].filter((record) => query !== null && record.text.includes(query)).map((record) => ({ id: record.id, [field]: record.text })));
      }
      if (method === "POST" && path === `${collection}.json`) {
        const parsed = JSON.parse(body) as { data: Record<string, unknown> };
        const record = { id: this.nextID++, text: String(parsed.data[field] ?? ""), body: parsed };
        records.set(record.id, record);
        if (this.dropNextCreate) {
          this.dropNextCreate = false;
          response.socket?.destroy();
          return;
        }
        return reply(201, { data: { id: record.id } });
      }
      const single = new RegExp(`^${collection}/(\\d+)\\.json$`).exec(path);
      if (method === "DELETE" && single !== null) return reply(records.delete(Number(single[1])) ? 204 : 404);
    }
    reply(404, {});
  }

  private graph(method: string, url: URL, body: string, reply: (status: number, value?: unknown) => void): void {
    const path = url.pathname.replace(/^\/v1\.0\//, "");
    if (method === "GET" && path === "me") return reply(200, { displayName: "Alicia Reyes", mail: "alicia@firm.law" });
    if (method === "GET" && path === "me/messages") {
      const filter = url.searchParams.get("$filter") ?? "";
      const wanted = /ep\/value eq '([^']*)'/.exec(filter)?.[1];
      return reply(200, { value: [...this.drafts.values()].filter((draft) => draft.intentID === wanted).map((draft) => ({ id: draft.id, webLink: `https://outlook.office.com/mail/drafts/${draft.id}` })) });
    }
    if (method === "POST" && path === "me/messages") {
      const parsed = JSON.parse(body) as { singleValueExtendedProperties?: { id: string; value: string }[] };
      const intentID = parsed.singleValueExtendedProperties?.find((property) => property.id === INTENT_PROPERTY)?.value ?? "";
      const draft = { id: `AAMk-${this.nextID++}`, intentID, body: parsed };
      this.drafts.set(draft.id, draft);
      return reply(201, { id: draft.id, webLink: `https://outlook.office.com/mail/drafts/${draft.id}` });
    }
    const single = /^me\/messages\/([^/]+)$/.exec(path);
    if (method === "DELETE" && single !== null) return reply(this.drafts.delete(decodeURIComponent(single[1] ?? "")) ? 204 : 404);
    reply(404, {});
  }
}

/** Clio's fuzzy `query`: any word of the query appears in the text, ignoring case and accents. */
function matches(text: string, query: string): boolean {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const haystack = fold(text);
  return fold(query).split(/[^\p{L}\p{N}@.]+/u).some((word) => word.length > 0 && haystack.includes(word));
}
