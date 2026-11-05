import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LANA_ERROR_MESSAGES, LanaActionExecutor, LanaClient, LanaError, LanaUndoClosedError, fetchLanaTransport, lanaLedgerKey, lanaMarker,
  type LanaActionInput, type LanaErrorKind, type LanaTransport,
} from "../../src/lana/index.js";
import { FakeLanaServer, sessionAccess, signedInAccount, type SeenRequest } from "../support/fakeLanaServer.js";
import { openRig, type StoreRig } from "../support/storeRig.js";

const MATTER = "4f6c1d2e-0000-4000-8000-000000000042";
const OTHER_MATTER = "4f6c1d2e-0000-4000-8000-000000000043";

let server: FakeLanaServer;
let disposers: Array<() => void> = [];

beforeEach(async () => {
  server = new FakeLanaServer();
  await server.start();
  disposers = [];
});

afterEach(async () => {
  for (const dispose of disposers) dispose();
  await server.stop();
});

async function client(options: { token?: string; refreshTo?: string | null; transport?: LanaTransport; readTimeoutMs?: number; writeTimeoutMs?: number } = {}) {
  const account = await signedInAccount(server.baseURL, options);
  disposers.push(() => account.manager.dispose());
  const lana = new LanaClient({
    session: sessionAccess(account.manager),
    transport: options.transport ?? fetchLanaTransport,
    sleep: async () => undefined,
    ...(options.readTimeoutMs === undefined ? {} : { readTimeoutMs: options.readTimeoutMs }),
    ...(options.writeTimeoutMs === undefined ? {} : { writeTimeoutMs: options.writeTimeoutMs }),
  });
  return { lana, account };
}

async function failure(promise: Promise<unknown>): Promise<LanaError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LanaError) return error;
    throw error;
  }
  throw new Error("expected a LanaError");
}

const searches = (request: SeenRequest): boolean => request.path === "/api/v1/matters/search";
const taskCreates = (request: SeenRequest): boolean => request.method === "POST" && request.path.endsWith("/tasks");

describe("LanaClient", () => {
  it("searches matters with the session token and maps the rows", async () => {
    const { lana } = await client();
    const hits = await lana.searchMatters("  acme ", 5);
    expect(hits.map((hit) => hit.code)).toEqual(["00042", "00043"]);
    expect(hits[0]).toEqual({ id: MATTER, code: "00042", name: "Lease renewal", clientName: "Acme Logistics" });
    const request = server.seen.at(-1)!;
    expect(request.token).toBe("token-1");
    expect(request.query.get("q")).toBe("acme");
    expect(request.query.get("limit")).toBe("5");
  });

  it("does not call LANA for fewer than 2 characters", async () => {
    const { lana } = await client();
    expect(await lana.searchMatters(" a ")).toEqual([]);
    expect(server.seen).toHaveLength(0);
  });

  it("refreshes once on a 401 and retries with the new token", async () => {
    const { lana, account } = await client({ token: "stale", refreshTo: "token-1" });
    expect(await lana.searchMatters("lease")).toHaveLength(1);
    expect(account.refreshes()).toBe(1);
    expect(server.seen.map((r) => r.token)).toEqual(["stale", "token-1"]);
  });

  it("maps a 401 that survives the refresh to signedOut and signs out", async () => {
    const { lana, account } = await client({ token: "stale", refreshTo: "also-stale" });
    const error = await failure(lana.searchMatters("lease"));
    expect(error.kind).toBe("signedOut");
    expect(error.message).toBe(LANA_ERROR_MESSAGES.signedOut);
    expect(account.manager.isSignedIn).toBe(false);
  });

  it("maps a refused refresh to signedOut", async () => {
    const { lana } = await client({ token: "stale", refreshTo: null });
    expect((await failure(lana.searchMatters("lease"))).kind).toBe("signedOut");
  });

  it.each<[number, LanaErrorKind]>([[403, "noAccess"], [404, "notFound"], [400, "rejected"], [422, "rejected"], [429, "busy"], [500, "server"], [503, "server"]])(
    "maps HTTP %i to %s",
    async (status, kind) => {
      const { lana } = await client();
      for (let i = 0; i < 3; i += 1) server.script(searches, { status });
      const error = await failure(lana.searchMatters("lease"));
      expect(error.kind).toBe(kind);
      expect(error.status).toBe(status);
    },
  );

  it("retries a read on 5xx, 429 and a dropped connection, at most 3 times", async () => {
    const { lana } = await client();
    server.script(searches, { status: 503 });
    server.script(searches, { drop: true });
    expect(await lana.searchMatters("lease")).toHaveLength(1);
    expect(server.seen.filter(searches)).toHaveLength(3);
    for (let i = 0; i < 5; i += 1) server.script(searches, { status: 429 });
    expect((await failure(lana.searchMatters("lease"))).kind).toBe("busy");
    expect(server.seen.filter(searches)).toHaveLength(6);
  });

  it("never retries a 403 or 404 read", async () => {
    const { lana } = await client();
    server.script(searches, { status: 403 });
    await failure(lana.searchMatters("lease"));
    expect(server.seen.filter(searches)).toHaveLength(1);
  });

  it("maps no answer and a timeout to offline", async () => {
    const down: LanaTransport = { send: async () => { throw new TypeError("fetch failed"); } };
    const { lana } = await client({ transport: down });
    expect((await failure(lana.searchMatters("lease"))).kind).toBe("offline");
    const slow = await client({ readTimeoutMs: 50 });
    for (let i = 0; i < 3; i += 1) server.script(searches, { hang: true });
    expect((await failure(slow.lana.searchMatters("lease"))).kind).toBe("offline");
  });

  it("maps a 2xx that is not LANA's shape to invalidResponse", async () => {
    const { lana } = await client();
    server.script(searches, { status: 200, body: "<html>" });
    expect((await failure(lana.searchMatters("lease"))).kind).toBe("invalidResponse");
    server.script(taskCreates, { status: 201, body: JSON.stringify({ status: "success", data: {} }) });
    expect((await failure(lana.createTask(MATTER, { title: "T", description: "" }))).kind).toBe("invalidResponse");
  });

  it("creates a task on the matter with a noon UTC due date, and sends a create once", async () => {
    const { lana } = await client();
    const id = await lana.createTask(MATTER, { title: "File the motion", description: "Draft tonight", dueDate: "2026-11-14" });
    expect(server.tasks[0]).toMatchObject({ id, matter: MATTER, title: "File the motion", text: "Draft tonight" });
    expect(server.seen.at(-1)!.body).toEqual({ title: "File the motion", description: "Draft tonight", due_date: "2026-11-14T12:00:00.000Z" });
    server.script(taskCreates, { status: 503 });
    expect((await failure(lana.createTask(MATTER, { title: "Again", description: "" }))).kind).toBe("server");
    expect(server.seen.filter(taskCreates)).toHaveLength(2);
  });

  it("creates, lists and soft deletes notes; a second delete is not an error", async () => {
    const { lana } = await client();
    const id = await lana.createNote(MATTER, { title: "Call", content: "Client agreed" });
    expect((await lana.recentNotes(MATTER)).map((note) => note.id)).toEqual([id]);
    await lana.deleteNote(MATTER, id);
    await lana.deleteNote(MATTER, id);
    expect(server.notes[0]!.deleted).toBe(true);
    expect(await lana.recentNotes(MATTER)).toEqual([]);
  });

  it("deletes a task with its matter as the access check", async () => {
    const { lana } = await client();
    const id = await lana.createTask(MATTER, { title: "T", description: "" });
    await lana.deleteTask(MATTER, id);
    const request = server.seen.at(-1)!;
    expect(request.path).toBe(`/api/v1/tasks/${id}`);
    expect(request.query.get("matter_id")).toBe(MATTER);
    expect(server.tasks[0]!.deleted).toBe(true);
  });

  it("puts no token in a URL", async () => {
    const { lana } = await client();
    await lana.searchMatters("lease");
    await lana.createNote(MATTER, { title: "x", content: "y" });
    expect(server.seen.every((request) => !request.path.includes("token") && ![...request.query.values()].some((v) => v.includes("token")))).toBe(true);
  });
});

describe("LanaActionExecutor", () => {
  let rig: StoreRig;

  beforeEach(async () => {
    rig = await openRig();
  });

  afterEach(() => rig.cleanup());

  function task(overrides: Partial<LanaActionInput> = {}): LanaActionInput {
    return {
      actionID: "int_01JCQ7A1B2C3D4E5F6G7H8J9KM",
      type: "task.create",
      idempotencyKey: "int_01JCQ7A1B2C3D4E5F6G7H8J9KM:task.create",
      matterID: MATTER,
      title: "File the motion to compel",
      body: "Dana drafts it tonight.",
      dueDate: "2026-11-14",
      ...overrides,
    };
  }

  async function executor() {
    const { lana } = await client();
    return new LanaActionExecutor(lana, () => rig.clock.now());
  }

  it("runs a task: one create with the marker last, the id and link recorded in the ledger", async () => {
    const lana = await executor();
    const outcome = await lana.run(task(), rig.store.ledger);
    expect(outcome.deduplicated).toBe(false);
    expect(outcome.record).toEqual({ kind: "task", id: server.tasks[0]!.id, matterID: MATTER, link: `workspace-details.html?id=${MATTER}&tab=tasks&task=${server.tasks[0]!.id}` });
    expect(server.tasks[0]!.text).toBe(`Dana drafts it tonight.\n\n${lanaMarker(task().actionID)}`);
    expect(outcome.undoUntil.getTime() - rig.clock.now().getTime()).toBe(24 * 3_600_000);
    const row = rig.store.ledger.get(lanaLedgerKey(task().idempotencyKey))!;
    expect(row.status).toBe("completed");
    expect(row.result).toContain(server.tasks[0]!.id);
  });

  it("runs a note on the matter", async () => {
    const lana = await executor();
    const outcome = await lana.run(task({ type: "note.log", idempotencyKey: "k-note", title: "Lease call", body: "Terms agreed", dueDate: undefined }), rig.store.ledger);
    expect(outcome.record.kind).toBe("note");
    expect(server.notes[0]).toMatchObject({ title: "Lease call", text: `Terms agreed\n\n${lanaMarker(task().actionID)}` });
    expect(outcome.record.link).toBe(`workspace-details.html?id=${MATTER}&tab=notes`);
  });

  it("a retry after it completed returns the same record without calling LANA", async () => {
    const lana = await executor();
    const first = await lana.run(task(), rig.store.ledger);
    const before = server.seen.length;
    const again = await lana.run(task(), rig.store.ledger);
    expect(again.record).toEqual(first.record);
    expect(again.deduplicated).toBe(true);
    expect(server.seen.length).toBe(before);
    expect(server.tasks).toHaveLength(1);
  });

  it("a create that landed but answered 503 is found by its marker, not sent again", async () => {
    const lana = await executor();
    server.script(taskCreates, { status: 503 }, true);
    const outcome = await lana.run(task(), rig.store.ledger);
    expect(outcome.deduplicated).toBe(true);
    expect(server.tasks).toHaveLength(1);
    expect(outcome.record.id).toBe(server.tasks[0]!.id);
    expect(server.seen.filter(taskCreates)).toHaveLength(1);
  });

  it("a dropped create that did not land fails, and the retry searches first and then creates once", async () => {
    const lana = await executor();
    server.script(taskCreates, { drop: true });
    const error = await failure(lana.run(task(), rig.store.ledger));
    expect(error.kind).toBe("offline");
    expect(server.tasks).toHaveLength(0);
    expect(rig.store.ledger.get(lanaLedgerKey(task().idempotencyKey))!.status).toBe("failed");
    const outcome = await lana.run(task(), rig.store.ledger);
    expect(outcome.deduplicated).toBe(false);
    expect(server.tasks).toHaveLength(1);
    const kinds = server.seen.map((r) => `${r.method} ${r.path.endsWith("/tasks") ? "tasks" : r.path}`);
    expect(kinds).toEqual(["POST tasks", "GET tasks", "GET tasks", "POST tasks"]);
  });

  it("a crash after a create landed is found on the next run (pending ledger row)", async () => {
    const lana = await executor();
    rig.store.ledger.begin(lanaLedgerKey(task().idempotencyKey), "hash");
    server.tasks.push({ id: "9b1e7c3a-0000-4000-8000-0000000000aa", matter: MATTER, title: "x", text: `body\n\n${lanaMarker(task().actionID)}`, deleted: false });
    const outcome = await lana.run(task(), rig.store.ledger);
    expect(outcome).toMatchObject({ deduplicated: true, record: { id: "9b1e7c3a-0000-4000-8000-0000000000aa" } });
    expect(server.seen.filter(taskCreates)).toHaveLength(0);
  });

  it("a marker in the middle of another task does not count", async () => {
    const lana = await executor();
    rig.store.ledger.begin(lanaLedgerKey(task().idempotencyKey), "hash");
    server.tasks.push({ id: "9b1e7c3a-0000-4000-8000-0000000000bb", matter: MATTER, title: "x", text: `${lanaMarker(task().actionID)}\nmore`, deleted: false });
    const outcome = await lana.run(task(), rig.store.ledger);
    expect(outcome.deduplicated).toBe(false);
    expect(server.tasks).toHaveLength(2);
  });

  it.each<[string, (s: FakeLanaServer) => void, LanaErrorKind]>([
    ["no matter access", (s) => s.forbidden.add(MATTER), "noAccess"],
    ["a matter LANA does not have", () => undefined, "notFound"],
    ["fields LANA refuses", (s) => s.script(taskCreates, { status: 400 }), "rejected"],
  ])("fails with %s and records the failure", async (_label, arrange, kind) => {
    const lana = await executor();
    arrange(server);
    const input = kind === "notFound" ? task({ matterID: "4f6c1d2e-0000-4000-8000-000000000099" }) : task();
    expect((await failure(lana.run(input, rig.store.ledger))).kind).toBe(kind);
    expect(server.tasks).toHaveLength(0);
    expect(rig.store.ledger.get(lanaLedgerKey(input.idempotencyKey))!.error).toBe(`LanaError: ${kind}`);
  });

  it("refuses a run with no matter or no title before calling LANA", async () => {
    const lana = await executor();
    expect((await failure(lana.run(task({ matterID: " " }), rig.store.ledger))).kind).toBe("notFound");
    expect((await failure(lana.run(task({ title: " " }), rig.store.ledger))).kind).toBe("rejected");
    expect(server.seen).toHaveLength(0);
  });

  it("undo soft deletes the record inside the window; an already deleted record is fine", async () => {
    const lana = await executor();
    const outcome = await lana.run(task(), rig.store.ledger);
    await lana.undo(outcome.record, outcome.undoUntil);
    expect(server.tasks[0]!.deleted).toBe(true);
    await lana.undo(outcome.record, outcome.undoUntil);
    const note = await lana.run(task({ type: "note.log", idempotencyKey: "k2", dueDate: undefined }), rig.store.ledger);
    await lana.undo(note.record, note.undoUntil);
    expect(server.notes[0]!.deleted).toBe(true);
  });

  it("undo after the window is refused without calling LANA", async () => {
    const lana = await executor();
    const outcome = await lana.run(task(), rig.store.ledger);
    rig.clock.advance(24 * 3600 + 1);
    const before = server.seen.length;
    await expect(lana.undo(outcome.record, outcome.undoUntil)).rejects.toBeInstanceOf(LanaUndoClosedError);
    expect(server.seen.length).toBe(before);
  });

  it("undo maps no access to noAccess", async () => {
    const lana = await executor();
    const outcome = await lana.run(task(), rig.store.ledger);
    server.script((r) => r.method === "DELETE", { status: 403 });
    expect((await failure(lana.undo(outcome.record, outcome.undoUntil))).kind).toBe("noAccess");
    expect(server.tasks[0]!.deleted).toBe(false);
  });

  it("keeps a long task description under LANA's limit with the marker last", async () => {
    const lana = await executor();
    await lana.run(task({ body: "x".repeat(20_000) }), rig.store.ledger);
    const text = server.tasks[0]!.text;
    expect([...text].length).toBeLessThanOrEqual(10_000);
    expect(text.endsWith(lanaMarker(task().actionID))).toBe(true);
  });

  it("the other matter's tasks are never searched", async () => {
    const lana = await executor();
    server.tasks.push({ id: "9b1e7c3a-0000-4000-8000-0000000000cc", matter: OTHER_MATTER, title: "x", text: `b\n\n${lanaMarker(task().actionID)}`, deleted: false });
    rig.store.ledger.begin(lanaLedgerKey(task().idempotencyKey), "hash");
    const outcome = await lana.run(task(), rig.store.ledger);
    expect(outcome.deduplicated).toBe(false);
  });
});
