import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ClioCandidateSource, ClioClient, ClioNoteExecutor, ClioTaskExecutor, ExecutorError, GraphConfiguration, GraphDraftExecutor, HTTPError,
  HTTPResponse, InMemoryIdempotencyLedger, RateLimitConfiguration, StoreIdempotencyLedger, decodeActionPlan, decodeExecutionResult,
  encodeActionPlan, type ResolvedTarget,
} from "../../src/executors/index.js";
import { makeLanaId } from "../../src/ids/index.js";
import { makeIntent, type Intent } from "../../src/intent/index.js";
import { canonicalString, parseJson } from "../../src/json/index.js";
import { EMPTY_LIST, Harness, bodyText, staticTokens } from "../support/executorFakes.js";
import { openRig } from "../support/storeRig.js";

const meeting = makeLanaId("meeting");
const created = new Date(1_793_000_000_000);

function noteIntent(body = "Client confirmed the lease renewal terms."): Intent {
  return makeIntent({
    meetingID: meeting,
    params: { type: "note.log", note: { subject: "Lease renewal call", body, regarding: { kind: "matter", name: "Acme lease" } } },
    confidence: 0.9,
    evidence: [],
    createdAt: created,
  });
}

function taskIntent(dueDate: string | undefined = "2026-11-14"): Intent {
  return makeIntent({
    meetingID: meeting,
    params: { type: "task.create", task: { title: "Send revised lease", detail: "Redline section 4.", dueDate, regarding: { kind: "matter", name: "Acme lease" } } },
    confidence: 0.9,
    evidence: [],
    createdAt: created,
  });
}

function emailIntent(recipients = 1): Intent {
  return makeIntent({
    meetingID: meeting,
    params: {
      type: "email.draft",
      email: { to: Array.from({ length: recipients }, (_, i) => ({ kind: "contact" as const, name: `Person ${i}` })), subject: "Follow up on lease", body: "Attached is the summary." },
    },
    confidence: 0.9,
    evidence: [],
    createdAt: created,
  });
}

const matter: ResolvedTarget = { regarding: { kind: "matter", id: "1001", displayName: "00042 Acme lease" } };

function recipients(intent: Intent, addresses: (string | undefined)[]): ResolvedTarget {
  if (intent.params.type !== "email.draft") return {};
  return { recipients: intent.params.email.to.map((hint, i) => ({ hint, address: addresses[i], displayName: hint.name })) };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("Clio note executor", () => {
  it("sends exactly the planned request after a marker search scoped to the note type", async () => {
    const h = new Harness();
    h.transport.on("GET", "/api/v4/notes.json", { status: 200, json: EMPTY_LIST });
    h.transport.on("POST", "/api/v4/notes.json", { status: 201, json: '{"data":{"id":555}}' });
    const executor = new ClioNoteExecutor(h.clio, h.clock);
    const intent = noteIntent();
    const plan = await executor.plan(intent, matter);

    expect(plan.request.method).toBe("POST");
    expect(plan.request.url).toBe("https://app.clio.com/api/v4/notes.json");
    expect(plan.request.headers["Authorization"]).toBeUndefined();
    const data = (JSON.parse(bodyText(plan.request as never)) as { data: { type: string; detail: string; regarding: { id: number } } }).data;
    expect(data.type).toBe("Matter");
    expect(data.detail.endsWith(`\n\nLana:${intent.id}`)).toBe(true);
    expect(data.regarding.id).toBe(1001);

    const result = await executor.execute(plan, new InMemoryIdempotencyLedger());
    expect(result.externalID).toBe("555");
    expect(result.deduplicated).toBe(false);
    expect(result.undo.url).toBe("https://app.clio.com/api/v4/notes/555.json");
    const posts = h.transport.sent("POST", "/notes.json");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual(plan.request.body);
    expect(posts[0]!.url).toBe(plan.request.url);
    expect(posts[0]!.headers["Authorization"]).toBe("Bearer test-access-token");
    for (const [name, value] of Object.entries(plan.request.headers)) expect(posts[0]!.headers[name]).toBe(value);

    const search = new URL(h.transport.sent("GET", "/notes.json")[0]!.url);
    expect(search.searchParams.get("query")).toBe(plan.marker);
    expect(search.searchParams.get("type")).toBe("Matter");
    expect(h.transport.methods).toEqual(["GET", "POST"]);
  });

  it("reuses a note that already carries the marker", async () => {
    const h = new Harness();
    const intent = noteIntent();
    const marker = `Lana:${intent.id}`;
    h.transport.on("GET", "/api/v4/notes.json", {
      status: 200,
      json: JSON.stringify({ data: [{ id: 9, detail: "Lana:int_other" }, { id: 777, detail: `Earlier text\n\n${marker}` }], meta: { paging: {} } }),
    });
    const executor = new ClioNoteExecutor(h.clio, h.clock);
    const result = await executor.execute(await executor.plan(intent, matter), new InMemoryIdempotencyLedger());
    expect(result.externalID).toBe("777");
    expect(result.deduplicated).toBe(true);
    expect(h.transport.sent("POST", "/notes.json")).toHaveLength(0);
  });

  it("returns the ledger result instead of executing twice", async () => {
    const h = new Harness();
    h.transport.on("GET", "/api/v4/notes.json", { status: 200, json: EMPTY_LIST });
    h.transport.on("POST", "/api/v4/notes.json", { status: 201, json: '{"data":{"id":555}}' }, { status: 201, json: '{"data":{"id":556}}' });
    const ledger = new InMemoryIdempotencyLedger();
    const plan = await new ClioNoteExecutor(h.clio, h.clock).plan(noteIntent(), matter);
    const first = await new ClioNoteExecutor(h.clio, h.clock).execute(plan, ledger);
    const again = await new ClioNoteExecutor(h.clio, h.clock).execute(plan, ledger);
    expect(again).toEqual(first);
    expect(h.transport.sent("POST", "/notes.json")).toHaveLength(1);
    expect(ledger.entry(plan.idempotencyKey)?.state).toEqual({ kind: "completed", result: first });
  });

  it("resends a failed POST only after the marker search misses", async () => {
    const h = new Harness();
    h.transport.on("GET", "/api/v4/notes.json", { status: 200, json: EMPTY_LIST });
    h.transport.on("POST", "/api/v4/notes.json", { status: 503 }, { status: 201, json: '{"data":{"id":600}}' });
    const executor = new ClioNoteExecutor(h.clio, h.clock);
    const plan = await executor.plan(noteIntent(), matter);
    const result = await executor.execute(plan, new InMemoryIdempotencyLedger());
    expect(result.externalID).toBe("600");
    expect(h.transport.methods).toEqual(["GET", "POST", "GET", "POST"]);
    expect(h.transport.sent("POST", "/notes.json").every((post) => bodyText(post) === bodyText(plan.request as never))).toBe(true);
    expect(h.sleeper.sleeps).toEqual([0.75]);
  });

  it("does not resend a failed POST that landed", async () => {
    const h = new Harness();
    const intent = noteIntent();
    h.transport.on("GET", "/api/v4/notes.json", { status: 200, json: EMPTY_LIST }, { status: 200, json: JSON.stringify({ data: [{ id: 601, detail: `x\n\nLana:${intent.id}` }] }) });
    h.transport.on("POST", "/api/v4/notes.json", { status: 504 });
    const executor = new ClioNoteExecutor(h.clio, h.clock);
    const result = await executor.execute(await executor.plan(intent, matter), new InMemoryIdempotencyLedger());
    expect(result).toMatchObject({ externalID: "601", deduplicated: true });
    expect(h.transport.sent("POST", "/notes.json")).toHaveLength(1);
  });

  it("treats a network failure on POST as ambiguous and checks the marker", async () => {
    const h = new Harness();
    const intent = noteIntent();
    h.transport.on("GET", "/api/v4/notes.json", { status: 200, json: EMPTY_LIST }, { status: 200, json: JSON.stringify({ data: [{ id: 602, detail: `x\n\nLana:${intent.id}` }] }) });
    h.transport.on("POST", "/api/v4/notes.json", { status: 0, fail: new TypeError("fetch failed") });
    const executor = new ClioNoteExecutor(h.clio, h.clock);
    const result = await executor.execute(await executor.plan(intent, matter), new InMemoryIdempotencyLedger());
    expect(result).toMatchObject({ externalID: "602", deduplicated: true });
    expect(h.transport.sent("POST", "/notes.json")).toHaveLength(1);
  });

  it("does not retry a client error and records the failure without bodies", async () => {
    const h = new Harness();
    h.transport.on("GET", "/api/v4/notes.json", { status: 200, json: EMPTY_LIST });
    h.transport.on("POST", "/api/v4/notes.json", { status: 422, json: '{"error":"Client Acme is invalid"}' });
    const ledger = new InMemoryIdempotencyLedger();
    const executor = new ClioNoteExecutor(h.clio, h.clock);
    const plan = await executor.plan(noteIntent(), matter);
    const error = await rejection(executor.execute(plan, ledger));
    expect(error).toBeInstanceOf(HTTPError);
    expect((error as HTTPError).reason).toEqual({ kind: "status", status: 422, retryAfter: undefined });
    expect(h.transport.sent("POST", "/notes.json")).toHaveLength(1);
    expect(ledger.entry(plan.idempotencyKey)?.state).toEqual({ kind: "failed", error: "HTTPError: HTTP status 422" });
  });

  it("gives up after the retry budget and records the last status", async () => {
    const h = new Harness();
    h.transport.on("GET", "/api/v4/notes.json", { status: 200, json: EMPTY_LIST });
    h.transport.on("POST", "/api/v4/notes.json", { status: 503 });
    const ledger = new InMemoryIdempotencyLedger();
    const executor = new ClioNoteExecutor(h.clio, h.clock);
    const plan = await executor.plan(noteIntent(), matter);
    await expect(executor.execute(plan, ledger)).rejects.toBeInstanceOf(HTTPError);
    expect(h.transport.sent("POST", "/notes.json")).toHaveLength(3);
    expect(h.transport.sent("GET", "/notes.json")).toHaveLength(3);
    expect(ledger.entry(plan.idempotencyKey)?.state).toEqual({ kind: "failed", error: "HTTPError: HTTP status 503" });
  });

  it("refuses a tampered plan before any request", async () => {
    const h = new Harness();
    const executor = new ClioNoteExecutor(h.clio, h.clock);
    const plan = await executor.plan(noteIntent(), matter);
    const text = canonicalString(encodeActionPlan(plan));
    const tampered = decodeActionPlan(parseJson(text.replace(plan.planHash, "0".repeat(64))));
    const error = await rejection(executor.execute(tampered, new InMemoryIdempotencyLedger()));
    expect((error as ExecutorError).reason.kind).toBe("planHashMismatch");
    expect(h.transport.requests).toHaveLength(0);

    const roundTripped = decodeActionPlan(parseJson(text));
    expect(roundTripped).toEqual(plan);
    const editedBody = decodeActionPlan(parseJson(text.replace('"method":"POST"', '"method":"PUT"')));
    expect((await rejection(executor.execute(editedBody, new InMemoryIdempotencyLedger())) as ExecutorError).reason.kind).toBe("planHashMismatch");
  });

  it("undoes inside the 24 hour window only, and only with the right executor", async () => {
    const h = new Harness();
    h.transport.on("GET", "/api/v4/notes.json", { status: 200, json: EMPTY_LIST });
    h.transport.on("POST", "/api/v4/notes.json", { status: 201, json: '{"data":{"id":555}}' });
    h.transport.on("DELETE", "/api/v4/notes/555.json", { status: 204, json: "" });
    const executor = new ClioNoteExecutor(h.clio, h.clock);
    const result = await executor.execute(await executor.plan(noteIntent(), matter), new InMemoryIdempotencyLedger());
    expect(result.undo.expiresAt.getTime()).toBe(h.clock.now().getTime() + 86_400_000);
    h.clock.advance(86_400 - 1);
    await executor.undo(result.undo);
    expect(h.transport.sent("DELETE", "/notes/555.json")).toHaveLength(1);
    h.clock.advance(2);
    expect(((await rejection(executor.undo(result.undo))) as ExecutorError).reason.kind).toBe("undoExpired");
    expect(((await rejection(new ClioTaskExecutor(h.clio, h.clock).undo(result.undo))) as ExecutorError).reason.kind).toBe("wrongExecutor");
    expect(h.transport.sent("DELETE", "/notes/555.json")).toHaveLength(1);
  });

  it("maps plan errors", async () => {
    const h = new Harness();
    const note = new ClioNoteExecutor(h.clio, h.clock);
    const task = new ClioTaskExecutor(h.clio, h.clock);
    expect(((await rejection(task.plan(taskIntent("next Friday"), matter))) as ExecutorError).description).toBe('invalidTarget("due_date")');
    expect(((await rejection(task.plan(noteIntent(), matter))) as ExecutorError).description).toBe('unsupportedIntent("note.log")');
    const missing = (await rejection(note.plan(noteIntent(), {}))) as ExecutorError;
    expect(missing.description).toBe("missingTarget");
    expect(missing.message).toBe("Choose the matter or contact this belongs to.");
  });
});

describe("Clio task executor", () => {
  it("defaults the assignee to the connected user and creates the task", async () => {
    const h = new Harness();
    h.transport.on("GET", "/users/who_am_i.json", { status: 200, json: '{"data":{"id":42,"name":"Pat Attorney"}}' });
    h.transport.on("GET", "/api/v4/tasks.json", { status: 200, json: EMPTY_LIST });
    h.transport.on("POST", "/api/v4/tasks.json", { status: 201, json: '{"data":{"id":31}}' });
    const executor = new ClioTaskExecutor(h.clio, h.clock);
    const intent = taskIntent();
    const plan = await executor.plan(intent, matter);
    const data = (JSON.parse(bodyText(plan.request as never)) as { data: Record<string, unknown> }).data;
    expect(data["due_at"]).toBe("2026-11-14");
    expect(data["priority"]).toBe("Normal");
    expect(data["assignee"]).toEqual({ id: 42, type: "User" });
    expect(data["matter"]).toEqual({ id: 1001 });
    expect(String(data["description"]).endsWith(`Lana:${intent.id}`)).toBe(true);
    expect(plan.preview.fields).toContainEqual({ label: "Assignee", value: "Pat Attorney" });
    expect(plan.preview.fields[0]).toEqual({ label: "Matter", value: "00042 Acme lease" });

    const result = await executor.execute(plan, new InMemoryIdempotencyLedger());
    expect(result.externalID).toBe("31");
    expect(result.undo.url).toBe("https://app.clio.com/api/v4/tasks/31.json");
    expect(h.transport.sent("POST", "/tasks.json")[0]?.body).toEqual(plan.request.body);
    const search = new URL(h.transport.sent("GET", "/api/v4/tasks.json")[0]!.url);
    expect(search.searchParams.get("fields")).toBe("id,description");
  });
});

describe("Interrupted run", () => {
  it("finds the note an interrupted run created instead of posting again, through the store ledger", async () => {
    const rig = await openRig();
    try {
      const h = new Harness();
      const ledger = new StoreIdempotencyLedger(rig.store.ledger);
      const executor = new ClioNoteExecutor(h.clio, h.clock);
      const intent = noteIntent();
      const plan = await executor.plan(intent, matter);

      // First run: the ledger row is written, the POST lands at Clio, and the app dies
      // before the response is recorded.
      const first = await ledger.begin(plan.idempotencyKey, plan.planHash);
      expect(first.state.kind).toBe("inProgress");

      h.transport.on("GET", "/api/v4/notes.json", { status: 200, json: JSON.stringify({ data: [{ id: 888, detail: `Client confirmed.\n\nLana:${intent.id}` }] }) });
      const result = await executor.execute(plan, ledger);
      expect(result).toMatchObject({ externalID: "888", deduplicated: true });
      expect(h.transport.sent("POST", "/notes.json")).toHaveLength(0);

      const row = rig.store.ledger.get(plan.idempotencyKey);
      expect(row?.status).toBe("completed");
      expect(row?.attempts).toBe(2);
      expect(decodeExecutionResult(parseJson(row!.result!))).toEqual(result);
      expect(row!.result).toContain('"external_id":"888"');

      // Next launch: the completed row answers without any network call.
      const again = await new ClioNoteExecutor(h.clio, h.clock).execute(plan, new StoreIdempotencyLedger((await rig.reopen()).ledger));
      expect(again).toEqual(result);
      expect(h.transport.requests).toHaveLength(1);
    } finally {
      rig.cleanup();
    }
  });

  it("records a failure in the store ledger and retries on the next run", async () => {
    const rig = await openRig();
    try {
      const h = new Harness();
      const ledger = new StoreIdempotencyLedger(rig.store.ledger);
      const executor = new ClioNoteExecutor(h.clio, h.clock);
      const plan = await executor.plan(noteIntent(), matter);
      h.transport.on("GET", "/api/v4/notes.json", { status: 200, json: EMPTY_LIST });
      h.transport.on("POST", "/api/v4/notes.json", { status: 400 }, { status: 201, json: '{"data":{"id":5}}' });
      await expect(executor.execute(plan, ledger)).rejects.toBeInstanceOf(HTTPError);
      expect(rig.store.ledger.get(plan.idempotencyKey)).toMatchObject({ status: "failed", error: "HTTPError: HTTP status 400" });
      const result = await executor.execute(plan, ledger);
      expect(result.externalID).toBe("5");
      expect(rig.store.ledger.get(plan.idempotencyKey)).toMatchObject({ status: "completed", attempts: 2 });
    } finally {
      rig.cleanup();
    }
  });
});

describe("Clio client", () => {
  it("follows paging on the same host only", async () => {
    const h = new Harness();
    h.transport.on("GET", "contacts.json?fields", {
      status: 200,
      json: '{"data":[{"id":1,"name":"A","type":"Person"}],"meta":{"paging":{"next":"https://app.clio.com/api/v4/contacts.json?page_token=2"}}}',
    });
    h.transport.on("GET", "page_token=2", { status: 200, json: '{"data":[{"id":2,"name":"B","type":"Company"}],"meta":{"paging":{"next":"https://evil.example.com/steal"}}}' });
    const error = await rejection(h.clio.searchContacts("a"));
    expect((error as ExecutorError).reason.kind).toBe("untrustedHost");
    expect(h.transport.urls.some((url) => url.includes("evil.example.com"))).toBe(false);
  });

  it("pages the mirror up to maxPages", async () => {
    const h = new Harness();
    h.transport.on("GET", "matters.json?fields", {
      status: 200,
      json: '{"data":[{"id":1,"display_number":"00001","description":"Lease","client":{"id":9,"name":"Acme"}}],"meta":{"paging":{"next":"https://app.clio.com/api/v4/matters.json?page_token=b"}}}',
    });
    h.transport.on("GET", "page_token=b", { status: 200, json: '{"data":[{"id":2,"display_number":"00002","description":"Appeal"}],"meta":{"paging":{}}}' });
    const client = new ClioClient({ region: "eu", client: h.client, tokens: staticTokens, maxPages: 10 });
    h.transport.requests.length = 0;
    await expect(client.allMatters()).rejects.toBeInstanceOf(ExecutorError); // eu client refuses the app.clio.com next link
    const us = new ClioClient({ region: "us", client: h.client, tokens: staticTokens, maxPages: 10 });
    const matters = await us.allMatters();
    expect(matters.map((m) => m.id)).toEqual(["1", "2"]);
    expect(matters[0]?.client).toEqual({ id: "9", name: "Acme" });
    expect(h.transport.urls.at(-2)).toContain("limit=200");
    expect(h.transport.urls.at(-2)).toContain("order=id(asc)");
  });

  it("maps contacts to candidates with the normalized query", async () => {
    const h = new Harness();
    h.transport.on("GET", "contacts.json", {
      status: 200,
      json: '{"data":[{"id":7,"name":"Acme Logistics","type":"Company","primary_email_address":"info@acme.test"}],"meta":{"paging":{}}}',
    });
    const candidates = await new ClioCandidateSource(h.clio).search({ kind: "company", name: "Acme Logistics, LLC" });
    expect(candidates).toEqual([{ id: "7", kind: "company", name: "Acme Logistics", email: "info@acme.test", source: "clio" }]);
    expect(new URL(h.transport.requests[0]!.url).searchParams.get("query")).toBe("acme logistics");
  });

  it("rejects a response of the wrong shape without echoing it", async () => {
    const h = new Harness();
    h.transport.on("GET", "/users/who_am_i.json", { status: 200, json: '{"data":{"id":"forty-two","name":"Pat Attorney"}}' });
    const error = await rejection(h.clio.whoAmI());
    expect((error as Error).name).toBe("DecodingError");
    expect((error as Error).message).not.toContain("Pat");
  });
});

describe("Graph draft executor", () => {
  it("creates a draft and never sends", async () => {
    const h = new Harness();
    h.transport.on("GET", "/me/messages?", { status: 200, json: '{"value":[]}' });
    h.transport.on("POST", "/v1.0/me/messages", { status: 201, json: '{"id":"AAMk-1=","webLink":"https://outlook.office365.com/owa/?ItemID=AAMk"}' });
    h.transport.on("DELETE", "/me/messages/AAMk-1=", { status: 204, json: "" });
    const executor = new GraphDraftExecutor(h.client, staticTokens, h.clock);
    const intent = emailIntent(2);
    const plan = await executor.plan(intent, recipients(intent, ["a@firm.test", "b@client.test"]));
    const body = JSON.parse(bodyText(plan.request as never)) as Record<string, unknown>;
    expect(body["singleValueExtendedProperties"]).toEqual([{ id: GraphConfiguration.intentPropertyID, value: intent.id }]);
    expect(body["toRecipients"]).toHaveLength(2);
    expect(body["transactionId"]).toBeUndefined();
    expect(plan.marker).toBe(intent.id);

    const result = await executor.execute(plan, new InMemoryIdempotencyLedger());
    expect(result.externalID).toBe("AAMk-1=");
    expect(new URL(result.webURL!).host).toBe("outlook.office365.com");
    const post = h.transport.sent("POST", "/me/messages")[0];
    expect(post?.body).toEqual(plan.request.body);
    expect(post?.url).toBe("https://graph.microsoft.com/v1.0/me/messages");
    const search = new URL(h.transport.sent("GET", "/me/messages")[0]!.url);
    expect(search.searchParams.get("$filter")).toBe(
      `singleValueExtendedProperties/Any(ep: ep/id eq '${GraphConfiguration.intentPropertyID}' and ep/value eq '${intent.id}')`,
    );
    await executor.undo(result.undo);
    expect(h.transport.sent("DELETE", "/me/messages/")).toHaveLength(1);
    expect(h.transport.urls.every((url) => !url.toLowerCase().includes("/send"))).toBe(true);
  });

  it("reuses an existing draft", async () => {
    const h = new Harness();
    h.transport.on("GET", "/me/messages?", { status: 200, json: '{"value":[{"id":"AAMk-9","webLink":null}]}' });
    const executor = new GraphDraftExecutor(h.client, staticTokens, h.clock);
    const intent = emailIntent();
    const result = await executor.execute(await executor.plan(intent, recipients(intent, ["a@firm.test"])), new InMemoryIdempotencyLedger());
    expect(result).toMatchObject({ externalID: "AAMk-9", deduplicated: true, webURL: undefined });
    expect(h.transport.sent("POST", "/me/messages")).toHaveLength(0);
  });

  it("blocks the plan on unresolved recipients", async () => {
    const h = new Harness();
    const executor = new GraphDraftExecutor(h.client, staticTokens, h.clock);
    const intent = emailIntent(3);
    const two = (await rejection(executor.plan(intent, recipients(intent, ["a@firm.test", undefined, "not an address"])))) as ExecutorError;
    expect(two.reason).toEqual({ kind: "unresolvedRecipients", count: 2 });
    expect(two.message).toBe("2 recipients need email addresses.");
    const one = (await rejection(executor.plan(intent, { recipients: recipients(intent, ["a@firm.test", "b@firm.test"]).recipients!.slice(0, 2) }))) as ExecutorError;
    expect(one.message).toBe("One recipient needs an email address.");
    expect(h.transport.requests).toHaveLength(0);
  });

  it("has no send path in the executors source", () => {
    const root = fileURLToPath(new URL("../../src/executors/", import.meta.url));
    const files = readdirSync(root, { recursive: true }).map(String).filter((file) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = readFileSync(join(root, file), "utf8");
      expect(text.includes('/send"'), file).toBe(false);
      expect(text.includes("sendMail"), file).toBe(false);
    }
  });
});

describe("HTTP response", () => {
  it("reads headers case-insensitively and maps non-2xx to a status error", () => {
    const response = new HTTPResponse({ status: 429, headers: { "retry-after": "7" }, body: new Uint8Array() });
    expect(response.retryAfter(new Date())).toBe(7);
    expect(() => response.requireSuccess()).toThrow(HTTPError);
    expect(new RateLimitConfiguration(0, 0).requests).toBe(1);
  });
});
