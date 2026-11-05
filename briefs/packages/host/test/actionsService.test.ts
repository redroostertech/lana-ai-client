import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorHub } from "@lana/core/connectors";
import { vaultTokenStore } from "@lana/core/executors";
import type { EntityHint, Intent } from "@lana/core/intent";
import type { LedgerRepository } from "@lana/core/store";
import type { ActionCard, InboxMeeting } from "../src/shared/api.js";
import {
  ActionServiceError,
  type ActionPlan, type ActionService, type ExecutionResult, type ResolvedTarget, type UndoToken,
} from "../src/main/services/actions/actionService.js";
import { ActionsService } from "../src/main/services/actions/actionsService.js";
import { ExecutorActionService } from "../src/main/services/actions/executorActionService.js";
import { decodeStoredResolution } from "../src/main/services/actions/storedResolution.js";
import { openRealRig, receiveGoldenMeeting, type RealRig } from "./support/realRig.js";

/** The real service with nothing connected: resolution over the mirror, no executors. */
function unconnected(): ExecutorActionService {
  const hub = new ConnectorHub({
    configuration: { clioClientID: "clio-client", microsoftClientID: "ms-client" },
    secrets: rig.vault,
    tokens: vaultTokenStore(rig.vault),
    transport: { send: () => Promise.reject(new Error("no network in this test")) },
    store: rig.store,
  });
  return new ExecutorActionService(hub, rig.store.mirror, "computer", rig.log);
}

/** A stand-in executor for the success path: records calls, answers with a fixed result. */
class FakeActionService implements ActionService {
  executed: ActionPlan[] = [];
  undone: UndoToken[] = [];
  fail: string | null = null;
  ledger: LedgerRepository | null = null;
  private readonly resolver = unconnected();
  resolve(hint: EntityHint) {
    return this.resolver.resolve(hint);
  }
  search(text: string, kind: "matter" | "contact") {
    return this.resolver.search(text, kind);
  }
  async plan(intent: Intent, target: ResolvedTarget) {
    return { ok: true as const, plan: { executor: "clio.note" as const, method: "POST", url: "https://app.clio.com/api/v4/notes.json", body: `{"regarding":"${target.regarding?.id ?? ""}","id":"${intent.id}"}`, planHash: "ab".repeat(32) } };
  }
  async execute(plan: ActionPlan, ledger: LedgerRepository): Promise<ExecutionResult> {
    this.ledger = ledger;
    if (this.fail !== null) throw new ActionServiceError(this.fail, "The service had a problem. Retry in a minute.");
    this.executed.push(plan);
    return { externalID: "880001", webURL: null, deduplicated: false, undo: { executor: "clio.note", externalID: "880001", url: "https://app.clio.com/api/v4/notes/880001.json", expiresAt: new Date(Date.now() + 3_600_000) } };
  }
  async undo(token: UndoToken): Promise<void> {
    this.undone.push(token);
  }
}

let rig: RealRig;
let signedIn: boolean;
let entitled: boolean;
let pending: number[];
beforeEach(async () => {
  rig = await openRealRig();
  signedIn = true;
  entitled = true;
  pending = [];
});
afterEach(() => rig.cleanup());

function actions(service: ActionService = unconnected()): ActionsService {
  return new ActionsService({
    store: rig.store,
    service: () => service,
    isSignedIn: () => signedIn,
    isEntitled: () => entitled,
    deviceNoun: "computer",
    onChange: (count) => pending.push(count),
    log: rig.log,
  });
}

async function cards(service: ActionsService): Promise<ActionCard[]> {
  const result = await service.sections();
  if (!result.ok) throw new Error(result.error.message);
  return result.value.flatMap((section: InboxMeeting) => section.cards);
}

function seedMirror(): void {
  rig.store.mirror.replace("clio", [
    { source: "clio", externalID: "4201", kind: "matter", name: "Muller v. Acme", displayNumber: "00042", clientName: "Jose Muller" },
    { source: "clio", externalID: "4202", kind: "matter", name: "Muller v. Acme appeal", displayNumber: "00043", clientName: "Jose Muller" },
    { source: "clio", externalID: "9001", kind: "contact", name: "Acme Corp Billing", email: "billing@acme.test" },
  ]);
}

describe("ActionsService over the real store", () => {
  it("lists the received meeting's intents as cards, with unsupported types read only", async () => {
    const opened = await receiveGoldenMeeting(rig);
    const service = actions();
    const result = await service.sections();
    expect(result.ok && result.value.map((section) => section.id)).toEqual([opened.meeting.id]);
    const list = await cards(service);
    expect(list.map((card) => [card.type, card.typeTitle, card.destinationLabel])).toEqual([
      ["note", "Log a note", "Clio"],
      ["task", "Create a task", "Clio"],
      ["email", "Draft an email", "Outlook draft, not sent"],
      ["unsupported", "Needs a newer LANA", "calendar.hold"],
    ]);
    const [note, task, email, unsupported] = list;
    expect(note).toMatchObject({ spokenTarget: "Müller v. Acme", target: { kind: "noMatch" }, confirmBlockReason: "Choose the matter or contact for this note.", isEditable: true });
    expect(task?.target).toEqual({ kind: "noMatch" });
    expect(task?.draft).toEqual({ title: "Send redlines", body: "", dueDate: "2026-11-07" });
    expect(email?.recipients.map((row) => row.state.kind)).toEqual(["resolved", "unresolved"]);
    expect(email?.confirmBlockReason).toBe("One recipient needs an email address.");
    expect(unsupported).toMatchObject({ phase: { kind: "unsupported" }, canDismiss: true, isEditable: false, plan: null });
    expect(unsupported?.unsupportedFields.map((field) => field.label)).toEqual(["Big", "Flags", "Minutes", "Nested", "Ratio", "When"]);
    expect(await service.inbox.pendingCount()).toBe(3);
    const proposed = await service.inbox.list();
    expect(proposed.ok && proposed.value.map((item) => item.status)).toEqual(["needsChoice", "needsChoice", "needsChoice", "ready"]);
  });

  it("offers near duplicates from the mirror without choosing one, then saves the person's choice", async () => {
    await receiveGoldenMeeting(rig);
    seedMirror();
    const service = actions();
    const [note] = await cards(service);
    expect(note?.target.kind).toBe("ambiguous");
    const choices = note?.target.kind === "ambiguous" ? note.target.choices : [];
    expect(choices.map((choice) => choice.displayName)).toEqual(expect.arrayContaining(["00042 Jose Muller", "00043 Jose Muller"]));
    const chosen = await service.choose(note?.id ?? "", "matter:4201");
    expect(chosen).toMatchObject({ ok: true, value: { target: { kind: "resolved", chosenByPerson: true, choice: { displayName: "00042 Jose Muller" } }, confirmTitle: "Add note to 00042 Jose Muller" } });
    const stored = rig.store.intents.get(note?.id as never);
    expect(stored.intent.status).toBe("resolved");
    expect(decodeStoredResolution(stored.resolution)?.target.regarding).toEqual({ kind: "matter", id: "4201", displayName: "00042 Jose Muller" });
    expect(rig.store.intents.history(stored.intent.id).map((event) => `${event.from}>${event.to}:${event.actor}`)).toEqual(["proposed>transferred:phone", "transferred>resolved:user"]);

    // Clio is not connected: Confirm says which connection to set up.
    const ready = chosen.ok ? chosen.value : undefined;
    expect(ready?.confirmBlockReason).toBe("Connect Clio in Connections to run this action.");
    expect(await service.confirm(ready?.id ?? "")).toMatchObject({ ok: false, error: { message: ready?.confirmBlockReason } });

    // The choice survives a reload of the inbox.
    const [again] = await cards(actions());
    expect(again?.target).toMatchObject({ kind: "resolved", choice: { displayName: "00042 Jose Muller" } });
  });

  it("searches the mirror, saves edits through the store and takes a typed address", async () => {
    await receiveGoldenMeeting(rig);
    seedMirror();
    const service = actions();
    const [, task, email] = await cards(service);
    const found = await service.search(task?.id ?? "", "appeal");
    expect(found.ok && found.value.map((choice) => choice.id)).toEqual(["matter:4202"]);

    expect(await service.saveEdits(task?.id ?? "", { title: " ", body: "", dueDate: null })).toMatchObject({ ok: false, error: { message: "Add a task." } });
    const saved = await service.saveEdits(task?.id ?? "", { title: "Send the redlines", body: "Version 2", dueDate: "2026-11-09" });
    expect(saved).toMatchObject({ ok: true, value: { draft: { title: "Send the redlines", body: "Version 2", dueDate: "2026-11-09" } } });
    const params = rig.store.intents.get(task?.id as never).intent.params;
    expect(params.type === "task.create" && params.task).toMatchObject({ title: "Send the redlines", detail: "Version 2", dueDate: "2026-11-09" });

    const typed = await service.submitRecipient(email?.id ?? "", 1, "billing@acme.test");
    expect(typed).toMatchObject({ ok: true, value: { card: { recipients: [{ state: { kind: "resolved" } }, { state: { kind: "resolved", address: "billing@acme.test" } }] } } });
    const stored = rig.store.intents.get(email?.id as never);
    expect(stored.intent.status).toBe("resolved");
    expect(stored.intent.params.type === "email.draft" && stored.intent.params.email.to[1]?.email).toBe("billing@acme.test");
    const events = (await rig.store.auditEntries()).map((entry) => entry.event);
    expect(events.filter((event) => event === "intent.edited")).toHaveLength(2);
    expect(rig.log.lines.join("\n")).not.toContain("billing@acme.test");
    expect(rig.log.lines.join("\n")).not.toContain("redlines");
  });

  it("gates Confirm on sign-in and LANA Briefs being on, and dismisses through the store", async () => {
    await receiveGoldenMeeting(rig);
    const service = actions();
    signedIn = false;
    const [note] = await cards(service);
    expect(note?.confirmBlockReason).toBe("Sign in to LANA on this computer to run actions.");
    signedIn = true;
    entitled = false;
    const [off] = await cards(service);
    expect(off?.confirmBlockReason).toBe("LANA Briefs is not turned on for your firm. Ask your firm admin to enable it in LANA.");
    expect(await service.confirm(off?.id ?? "")).toMatchObject({ ok: false });
    entitled = true;
    const [ready, task] = await cards(service);
    expect(ready?.confirmBlockReason).toBe("Choose the matter or contact for this note.");
    expect(await service.dismiss(task?.id ?? "")).toMatchObject({ ok: true, value: { phase: { kind: "dismissed" } } });
    expect(rig.store.intents.get(task?.id as never).intent.status).toBe("dismissed");
    expect(pending.at(-1)).toBe(2);
    expect(await service.dismiss(task?.id ?? "")).toMatchObject({ ok: false });
    expect((await cards(service)).map((card) => card.id)).not.toContain(task?.id);
  });

  it("runs, audits and undoes through the ActionService once one is available", async () => {
    await receiveGoldenMeeting(rig);
    seedMirror();
    const fake = new FakeActionService();
    const service = actions(fake);
    const [note] = await cards(service);
    const chosen = await service.choose(note?.id ?? "", "matter:4201");
    expect(chosen.ok && chosen.value.plan).toMatchObject({ method: "POST", planHash: "ab".repeat(32) });
    const done = await service.confirm(note?.id ?? "");
    expect(done).toMatchObject({ ok: true, value: { phase: { kind: "executed", externalID: "880001", deduplicated: false } } });
    expect(fake.ledger).toBe(rig.store.ledger);
    const stored = rig.store.intents.get(note?.id as never);
    expect(stored.intent.status).toBe("executed");
    expect(decodeStoredResolution(stored.resolution)?.result?.externalID).toBe("880001");
    const audit = await rig.store.auditEntries();
    expect(audit.at(-1)).toMatchObject({ event: "action.executed", subject: note?.id });

    // An executed card stays while it can be undone.
    expect((await cards(service)).find((card) => card.id === note?.id)?.phase.kind).toBe("executed");
    expect(await service.undo(note?.id ?? "")).toMatchObject({ ok: true, value: { phase: { kind: "undone" } } });
    expect(fake.undone[0]?.externalID).toBe("880001");
    expect((await rig.store.auditEntries()).at(-1)).toMatchObject({ event: "action.undone" });
  });

  it("records a failed run with its reason and shows it again after a reload", async () => {
    await receiveGoldenMeeting(rig);
    seedMirror();
    const fake = new FakeActionService();
    fake.fail = "server";
    const service = actions(fake);
    const [note] = await cards(service);
    await service.choose(note?.id ?? "", "matter:4201");
    expect(await service.confirm(note?.id ?? "")).toMatchObject({ ok: true, value: { phase: { kind: "failed" } } });
    expect(rig.store.intents.get(note?.id as never).intent.status).toBe("failed");
    expect((await rig.store.auditEntries()).at(-1)).toMatchObject({ event: "action.failed", detail: '{"executor":"clio.note","reason":"server"}' });
    const [reloaded] = await cards(actions(fake));
    expect(reloaded?.phase).toEqual({ kind: "failed", reason: "The service had a problem. Retry in a minute." });
  });

  it("explains that undo needs the connection once it is gone", async () => {
    await receiveGoldenMeeting(rig);
    seedMirror();
    const fake = new FakeActionService();
    const runner = actions(fake);
    const [note] = await cards(runner);
    await runner.choose(note?.id ?? "", "matter:4201");
    await runner.confirm(note?.id ?? "");
    const stand = actions();
    await cards(stand);
    expect(await stand.undo(note?.id ?? "")).toMatchObject({ ok: false, error: { message: "Reconnect the service in Connections to undo." } });
  });
});
