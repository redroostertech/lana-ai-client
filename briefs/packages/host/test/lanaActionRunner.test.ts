import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LANA_ERROR_MESSAGES, LanaActionExecutor, LanaClient, fetchLanaTransport, type LanaMatter } from "@lana/core/lana";
import { AUDIT_EVENTS, type StoredAction } from "@lana/core/store";
import type { IntentParams } from "@lana/core/intent";
import { resolutionWithMatter } from "../src/main/services/actions/actionPagesService.js";
import { EMAIL_STAYS_DRAFT, LanaActionRunner, UNDO_CLOSED, lanaDeletePath, runFailureMessage } from "../src/main/services/actions/lanaActionRunner.js";
import { decodeStoredResolution } from "../src/main/services/actions/storedResolution.js";
import { MattersService } from "../src/main/services/mattersService.js";
import { FakeLanaServer, sessionAccess, signedInAccount } from "../../core/test/support/fakeLanaServer.js";
import { openRealRig, receiveGoldenMeeting, type RealRig } from "./support/realRig.js";

const MATTER = { id: "4f6c1d2e-0000-4000-8000-000000000042", label: "00042 Acme Logistics", detail: null };

let rig: RealRig;
let server: FakeLanaServer;
let signedIn: boolean;
let entitled: boolean;
let runner: LanaActionRunner;
let client: LanaClient;
let dispose: () => void;

beforeEach(async () => {
  rig = await openRealRig();
  server = new FakeLanaServer();
  await server.start();
  const account = await signedInAccount(server.baseURL);
  dispose = () => account.manager.dispose();
  client = new LanaClient({ session: sessionAccess(account.manager), transport: fetchLanaTransport, sleep: async () => undefined });
  signedIn = true;
  entitled = true;
  runner = new LanaActionRunner({
    store: rig.store,
    executor: () => new LanaActionExecutor(client, () => rig.clock.now()),
    isSignedIn: () => signedIn,
    isEntitled: () => entitled,
    deviceNoun: "computer",
    log: rig.log,
    now: () => rig.clock.now(),
  });
});

afterEach(async () => {
  dispose();
  await server.stop();
  rig.cleanup();
});

function manual(params: IntentParams, matter: typeof MATTER | null = MATTER): StoredAction {
  return rig.store.actions.createManual({ params, meetingID: null, resolution: matter === null ? null : resolutionWithMatter(null, matter) });
}

const task = (): IntentParams => ({ type: "task.create", task: { title: "File the motion", detail: "Draft tonight", dueDate: "2026-11-14" } });
const note = (): IntentParams => ({ type: "note.log", note: { subject: "Lease call", body: "Client agreed the terms" } });

function audit(event: string, subject: string): Array<Record<string, unknown>> {
  return rig.store.actions.history(subject as StoredAction["id"]).filter((entry) => entry.event === event).map((entry) => JSON.parse(entry.detail) as Record<string, unknown>);
}

describe("LanaActionRunner", () => {
  it("runs a manual task on LANA: executed, the LANA id and link kept, action.ran with the LANA id only", async () => {
    const action = manual(task());
    expect(runner.gate(action)).toMatchObject({ canRun: true, runTitle: "Create task on 00042 Acme Logistics", runBlockReason: null, canUndo: false, lanaURL: null });
    expect(await runner.run(action)).toEqual({ ok: true, value: null });
    const after = rig.store.actions.get(action.id);
    expect(after.status).toBe("executed");
    const lanaID = server.tasks[0]!.id;
    expect(server.tasks[0]).toMatchObject({ matter: MATTER.id, title: "File the motion", text: `Draft tonight\n\nLana:${action.id}` });
    const result = decodeStoredResolution(after.resolution)!;
    expect(result.target.regarding).toEqual({ kind: "matter", id: MATTER.id, displayName: MATTER.label });
    expect(result.result).toMatchObject({ externalID: lanaID, webURL: `workspace-details.html?id=${MATTER.id}&tab=tasks&task=${lanaID}`, deduplicated: false });
    expect(result.result!.undo).toMatchObject({ executor: "lana.task", url: lanaDeletePath("task", MATTER.id, lanaID) });
    expect(audit(AUDIT_EVENTS.actionRan, action.id)).toEqual([{ lana_id: lanaID }]);
    const gate = runner.gate(after);
    expect(gate).toMatchObject({ canRun: false, canUndo: true, lanaURL: result.result!.webURL, phase: { kind: "executed", externalID: lanaID } });
  });

  it("runs a note as a LANA matter note", async () => {
    const action = manual(note());
    expect((await runner.run(action)).ok).toBe(true);
    expect(server.notes[0]).toMatchObject({ matter: MATTER.id, title: "Lease call", text: `Client agreed the terms\n\nLana:${action.id}` });
    expect(runner.gate(rig.store.actions.get(action.id)).lanaURL).toBe(`workspace-details.html?id=${MATTER.id}&tab=notes`);
  });

  it("runs a meeting action once it has a matter", async () => {
    await receiveGoldenMeeting(rig);
    const action = rig.store.actions.list({ status: [], kind: [] }).find((item) => item.origin === "meeting" && (item.type === "task.create" || item.type === "note.log"));
    expect(action).toBeDefined();
    expect(runner.gate(action!).canRun).toBe(false);
    rig.store.actions.setResolution(action!.id, resolutionWithMatter(action!.resolution, MATTER));
    const ready = rig.store.actions.get(action!.id);
    expect((await runner.run(ready)).ok).toBe(true);
    expect(rig.store.actions.get(action!.id).status).toBe("executed");
    expect(server.tasks.length + server.notes.length).toBe(1);
  });

  it("a retry after a lost answer finds the record instead of making a second one", async () => {
    const action = manual(task());
    server.script((r) => r.method === "POST", { status: 502 }, true);
    expect((await runner.run(action)).ok).toBe(true);
    expect(server.tasks).toHaveLength(1);
    expect(decodeStoredResolution(rig.store.actions.get(action.id).resolution)!.result!.deduplicated).toBe(true);
  });

  it("a failed run moves to failed with the code, says why, and Retry runs it once", async () => {
    const action = manual(task());
    server.script((r) => r.method === "POST", { drop: true });
    const failed = await runner.run(action);
    expect(failed).toEqual({ ok: false, error: { code: "offline", message: LANA_ERROR_MESSAGES.offline } });
    const after = rig.store.actions.get(action.id);
    expect(after.status).toBe("failed");
    expect(runner.gate(after)).toMatchObject({ canRun: true, runTitle: "Retry", phase: { kind: "failed", reason: LANA_ERROR_MESSAGES.offline }, actionError: LANA_ERROR_MESSAGES.offline });
    expect((await runner.run(after)).ok).toBe(true);
    expect(server.tasks).toHaveLength(1);
  });

  it.each([
    ["403", (s: FakeLanaServer) => s.forbidden.add(MATTER.id), "noAccess"],
    ["404", () => undefined, "notFound"],
    ["401 after refresh", (s: FakeLanaServer) => s.valid.clear(), "signedOut"],
    ["500", (s: FakeLanaServer) => s.script((r) => r.method === "POST", { status: 500 }), "server"],
  ] as const)("maps %s to a plain message on the page", async (_label, arrange, code) => {
    arrange(server);
    const action = code === "notFound" ? manual(task(), { ...MATTER, id: "4f6c1d2e-0000-4000-8000-000000000099" }) : manual(task());
    const result = await runner.run(action);
    expect(result).toEqual({ ok: false, error: { code, message: LANA_ERROR_MESSAGES[code] } });
    expect(runFailureMessage(code)).toBe(LANA_ERROR_MESSAGES[code]);
  });

  it("blocks running without a matter, signed out, not entitled, and for an email", async () => {
    expect(runner.gate(manual(task(), null)).runBlockReason).toBe("Choose the matter for this task.");
    const email = manual({ type: "email.draft", email: { to: [{ kind: "contact", name: "Dana", email: "dana@example.com" }], subject: "Draft", body: "Hi" } });
    expect(runner.gate(email)).toMatchObject({ canRun: false, runBlockReason: EMAIL_STAYS_DRAFT });
    expect(await runner.run(email)).toEqual({ ok: false, error: { code: "blocked", message: EMAIL_STAYS_DRAFT } });
    signedIn = false;
    expect(runner.gate(manual(task())).runBlockReason).toBe("Sign in to LANA on this computer to run actions.");
    signedIn = true;
    entitled = false;
    expect(runner.gate(manual(task())).canRun).toBe(false);
    expect(server.seen).toHaveLength(0);
  });

  it("undo soft deletes the LANA record and audits action.undone with the LANA id", async () => {
    const action = manual(task());
    await runner.run(action);
    const ran = rig.store.actions.get(action.id);
    expect(await runner.undo(ran)).toEqual({ ok: true, value: null });
    expect(server.tasks[0]!.deleted).toBe(true);
    expect(rig.store.actions.get(action.id).status).toBe("undone");
    expect(audit(AUDIT_EVENTS.actionUndone, action.id)).toEqual([{ lana_id: server.tasks[0]!.id }]);
    expect(runner.gate(rig.store.actions.get(action.id)).canUndo).toBe(false);
  });

  it("undo is refused after 24 hours, without calling LANA", async () => {
    const action = manual(note());
    await runner.run(action);
    rig.clock.advance(24 * 3600 + 1);
    const before = server.seen.length;
    expect(await runner.undo(rig.store.actions.get(action.id))).toEqual({ ok: false, error: { code: "undoClosed", message: UNDO_CLOSED } });
    expect(server.seen.length).toBe(before);
  });

  it("undo that LANA refuses keeps the action ran and says why", async () => {
    const action = manual(task());
    await runner.run(action);
    server.script((r) => r.method === "DELETE", { status: 403 });
    expect(await runner.undo(rig.store.actions.get(action.id))).toEqual({ ok: false, error: { code: "noAccess", message: LANA_ERROR_MESSAGES.noAccess } });
    expect(rig.store.actions.get(action.id).status).toBe("executed");
    expect(runner.gate(rig.store.actions.get(action.id)).actionError).toBe(LANA_ERROR_MESSAGES.noAccess);
  });

  it("logs ids, codes and states only", async () => {
    const action = manual(task());
    await runner.run(action);
    const text = JSON.stringify(rig.log);
    expect(text).not.toContain("File the motion");
    expect(text).not.toContain("token-1");
    expect(text).not.toContain("Acme");
  });
});

describe("MattersService", () => {
  function service(on = true): MattersService {
    return new MattersService({ client: () => client, isSignedIn: () => on, log: rig.log });
  }

  it("searches LANA and returns number and client labels", async () => {
    const result = await service().search("acme");
    expect(result).toEqual({
      ok: true,
      value: [
        { id: "4f6c1d2e-0000-4000-8000-000000000042", label: "00042 Acme Logistics", detail: "Lease renewal. Client: Acme Logistics" },
        { id: "4f6c1d2e-0000-4000-8000-000000000043", label: "00043 Acme Logistics", detail: "Acme employment. Client: Acme Logistics" },
      ],
    });
    expect(JSON.stringify(rig.log)).not.toContain("acme");
  });

  it("finds nothing under 2 characters without calling LANA", async () => {
    expect(await service().search(" a ")).toEqual({ ok: true, value: [] });
    expect(server.seen).toHaveLength(0);
  });

  it("asks the person to sign in when signed out", async () => {
    expect(await service(false).search("acme")).toEqual({ ok: false, error: { code: "signedOut", message: LANA_ERROR_MESSAGES.signedOut } });
  });

  it("maps LANA failures to plain messages", async () => {
    for (let i = 0; i < 3; i += 1) server.script((r) => r.path.endsWith("/search"), { status: 503 });
    expect(await service().search("acme")).toEqual({ ok: false, error: { code: "server", message: LANA_ERROR_MESSAGES.server } });
    server.script((r) => r.path.endsWith("/search"), { status: 403 });
    expect(await service().search("acme")).toEqual({ ok: false, error: { code: "noAccess", message: LANA_ERROR_MESSAGES.noAccess } });
  });

  it("labels a matter with no number by client and name", async () => {
    const { matterHitOf } = await import("@lana/core/lana");
    const bare: LanaMatter = { id: "m1", code: null, name: "Lease", clientName: "Acme" };
    expect(matterHitOf(bare)).toEqual({ id: "m1", label: "Acme: Lease", detail: "Lease. Client: Acme" });
    expect(matterHitOf({ id: "m2", code: " ", name: null, clientName: null })).toEqual({ id: "m2", label: "m2", detail: null });
  });
});
