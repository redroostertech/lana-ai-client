import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorHub } from "@lana/core/connectors";
import { ClioMarker, fetchHTTPTransport, makePlannedRequest, plannedRequestHash, vaultTokenStore } from "@lana/core/executors";
import type { LanaId } from "@lana/core/ids";
import type { ActionCard, InboxMeeting } from "../src/shared/api.js";
import { ActionsService } from "../src/main/services/actions/actionsService.js";
import { ExecutorActionService } from "../src/main/services/actions/executorActionService.js";
import { decodeStoredResolution } from "../src/main/services/actions/storedResolution.js";
import { ConnectionsService } from "../src/main/services/connections/connectionsService.js";
import { OAuthRedirects } from "../src/main/services/connections/oauthRedirects.js";
import { redirectedTransport, testConnectorOrigin, testDirectoryURL } from "../src/main/services/connections/testEndpoints.js";
import { FakeProviders } from "./support/fakeProviders.js";
import { openRealRig, receiveGoldenMeeting, type RealRig } from "./support/realRig.js";

let rig: RealRig;
let providers: FakeProviders;
let hub: ConnectorHub;
let connections: ConnectionsService;

beforeEach(async () => {
  rig = await openRealRig();
  providers = new FakeProviders();
  const origin = await providers.start();
  hub = new ConnectorHub({
    configuration: { clioClientID: "clio-client", microsoftClientID: "ms-client" },
    secrets: rig.vault,
    tokens: vaultTokenStore(rig.vault),
    transport: redirectedTransport(fetchHTTPTransport, origin),
    store: rig.store,
    log: rig.log,
  });
  const redirects = new OAuthRedirects();
  // Plays the system browser: the person signs in and the OS hands the redirect back.
  const browser = async (url: string): Promise<void> => {
    const parsed = new URL(url);
    const connector = parsed.hostname === "login.microsoftonline.com" ? "microsoft" : "clio";
    setTimeout(() => redirects.deliver(`lananotes-auth://oauth/${connector}?code=code-${connector}&state=${encodeURIComponent(parsed.searchParams.get("state") ?? "")}`), 1);
  };
  connections = new ConnectionsService(() => hub, redirects, browser, rig.log);
});

afterEach(async () => {
  await providers.stop();
  rig.cleanup();
});

function actions(): ActionsService {
  return new ActionsService({
    store: rig.store,
    service: () => new ExecutorActionService(hub, rig.store.mirror, "computer", rig.log),
    isSignedIn: () => true,
    isEntitled: () => true,
    deviceNoun: "computer",
    onChange: () => undefined,
    log: rig.log,
  });
}

async function cards(service: ActionsService): Promise<ActionCard[]> {
  const result = await service.sections();
  if (!result.ok) throw new Error(result.error.message);
  return result.value.flatMap((section: InboxMeeting) => section.cards);
}

async function connect(id: "clio" | "microsoft"): Promise<void> {
  const state = await connections.connect(id);
  const snapshot = state.connectors.find((connector) => connector.id === id);
  expect(snapshot?.status).toEqual({ kind: "connected", account: "Alicia Reyes" });
}

function history(id: string): string[] {
  return rig.store.intents.history(id as LanaId).map((event) => `${event.from}>${event.to}:${event.actor}`);
}

describe("Actions through the connector hub and a fake Clio and Graph", () => {
  it("connects Clio in the browser, syncs the mirror and resolves the note's matter on its own", async () => {
    await receiveGoldenMeeting(rig);
    const state = await connections.connect("clio");
    expect(state.connectors[0]).toMatchObject({ status: { kind: "connected", account: "Alicia Reyes" }, message: "Synced 3 matters and contacts.", mirroredRecords: 3 });
    expect(rig.store.mirror.count("clio")).toBe(3);
    expect(providers.sent("POST", "app.clio.com/oauth/token")).toHaveLength(1);

    const [note] = await cards(actions());
    // One confident, unique matter: matched, but still only runs on a click.
    expect(note?.target).toMatchObject({ kind: "resolved", chosenByPerson: false, choice: { id: "matter:4201", displayName: "00042 Jose Muller", reasons: ["Exact name"] } });
    expect(note?.confirmTitle).toBe("Add note to 00042 Jose Muller");
    expect(note?.phase).toEqual({ kind: "review" });
    expect(providers.sent("POST", "notes.json")).toHaveLength(0);
  });

  it("confirms a note to executed with the exact request and hash shown, then undoes it inside the window", async () => {
    const opened = await receiveGoldenMeeting(rig);
    await connect("clio");
    const service = actions();
    const [note] = await cards(service);
    const intentID = opened.meeting.intents[0]?.id ?? "";
    expect(note?.id).toBe(intentID);

    // The card shows the exact request: canonical body ending with the marker, and its hash.
    const plan = note?.plan;
    expect(plan).toMatchObject({ method: "POST", url: "https://app.clio.com/api/v4/notes.json" });
    const body = JSON.parse(plan?.body ?? "{}") as { data: { detail: string; regarding: unknown; subject: string; type: string } };
    expect(body.data).toMatchObject({ type: "Matter", regarding: { id: 4201, type: "Matter" }, subject: "Settlement call with José Müller" });
    expect(body.data.detail.endsWith(`\n\n${ClioMarker.make(intentID)}`)).toBe(true);
    expect(plan?.planHash).toBe(plannedRequestHash(makePlannedRequest("POST", plan?.url ?? "", { Accept: "application/json", "Content-Type": "application/json" }, new TextEncoder().encode(plan?.body ?? ""))));

    const done = await service.confirm(intentID);
    expect(done).toMatchObject({ ok: true, value: { phase: { kind: "executed", externalID: "880001", deduplicated: false } } });
    // Sent byte for byte with the bearer token; nothing else was created.
    const posts = providers.sent("POST", "app.clio.com/api/v4/notes.json");
    expect(posts.map((request) => request.body)).toEqual([plan?.body]);
    expect(posts[0]?.authorization).toBe("Bearer access-app.clio.com");
    expect(providers.notes.get(880001)?.text.endsWith(ClioMarker.make(intentID))).toBe(true);

    expect(history(intentID)).toEqual(["proposed>transferred:phone", "transferred>resolved:system", "resolved>confirmed:user", "confirmed>executed:system"]);
    const stored = rig.store.intents.get(intentID as LanaId);
    expect(decodeStoredResolution(stored.resolution)).toMatchObject({ planHash: plan?.planHash, result: { externalID: "880001", undo: { url: "https://app.clio.com/api/v4/notes/880001.json" } } });
    expect(rig.store.ledger.get(stored.intent.idempotencyKey)).toMatchObject({ status: "completed", planHash: plan?.planHash, attempts: 1 });
    const audit = await rig.store.auditEntries();
    expect(audit.at(-1)).toMatchObject({
      event: "action.executed", subject: intentID,
      detail: JSON.stringify({ deduplicated: "false", executor: "clio.note", external_id: "880001", plan_hash: plan?.planHash }),
    });

    // A reloaded inbox (a new window) still offers undo.
    const again = actions();
    expect((await cards(again)).find((card) => card.id === intentID)?.phase.kind).toBe("executed");
    expect(await again.undo(intentID)).toMatchObject({ ok: true, value: { phase: { kind: "undone" } } });
    expect(providers.sent("DELETE", "app.clio.com/api/v4/notes/880001.json")).toHaveLength(1);
    expect(providers.notes.size).toBe(0);
    expect(rig.store.intents.get(intentID as LanaId).intent.status).toBe("undone");
    expect((await rig.store.auditEntries()).at(-1)).toMatchObject({ event: "action.undone", detail: '{"executor":"clio.note","external_id":"880001"}' });

    const lines = rig.log.lines.join("\n");
    for (const secret of ["access-app.clio.com", "code-clio", "Settlement", "Alicia", "Muller", "Müller"]) expect(lines).not.toContain(secret);
  });

  it("resumes an interrupted run by finding its Lana: marker instead of creating a second note", async () => {
    const opened = await receiveGoldenMeeting(rig);
    await connect("clio");
    const service = actions();
    const [note] = await cards(service);
    const intentID = note?.id ?? "";
    const plan = note?.plan;
    // The PC stopped after the request reached Clio: confirmed in the store, a pending ledger row,
    // and the note already in Clio with its marker.
    rig.store.intents.transition(intentID as LanaId, "confirmed", "user", { plan_hash: plan?.planHash ?? "" });
    const key = opened.meeting.intents[0]?.idempotencyKey ?? "";
    rig.store.ledger.begin(key, plan?.planHash ?? "");
    providers.notes.set(770001, { id: 770001, text: JSON.parse(plan?.body ?? "{}").data.detail, body: {} });

    const restarted = actions();
    const [interrupted] = await cards(restarted);
    expect(interrupted?.phase).toEqual({ kind: "interrupted" });
    expect(interrupted?.plan?.planHash).toBe(plan?.planHash);
    expect(await restarted.confirm(intentID)).toMatchObject({ ok: true, value: { phase: { kind: "executed", externalID: "770001", deduplicated: true } } });
    expect(providers.sent("POST", "notes.json")).toHaveLength(0);
    const searches = providers.sent("GET", "app.clio.com/api/v4/notes.json").map((request) => new URL(`https://${request.target}`).searchParams);
    expect(searches.map((params) => [params.get("query"), params.get("type")])).toEqual([[ClioMarker.make(intentID), "Matter"]]);
    expect(rig.store.ledger.get(key)).toMatchObject({ status: "completed", attempts: 2 });
    expect((await rig.store.auditEntries()).at(-1)).toMatchObject({ event: "action.executed", detail: expect.stringContaining('"deduplicated":"true"') });
    expect(history(intentID).at(-1)).toBe("confirmed>executed:system");
  });

  it("does not resend after a lost response: the marker search finds the note that landed", async () => {
    await receiveGoldenMeeting(rig);
    await connect("clio");
    const service = actions();
    const [note] = await cards(service);
    providers.dropNextCreate = true;
    expect(await service.confirm(note?.id ?? "")).toMatchObject({ ok: true, value: { phase: { kind: "executed", deduplicated: true } } });
    expect(providers.sent("POST", "notes.json")).toHaveLength(1);
    expect(providers.notes.size).toBe(1);
  });

  it("saves an Outlook draft (never sent) with both recipients resolved", async () => {
    const opened = await receiveGoldenMeeting(rig);
    await connect("clio");
    const service = actions();
    let [, , email] = await cards(service);
    // The said address, and the company found in the mirror and live Clio as one record.
    expect(email?.recipients.map((row) => row.state)).toEqual([
      { kind: "resolved", address: "dana@firm.law", name: "Dana Park", reason: "Address said in the meeting" },
      { kind: "resolved", address: "billing@acme.test", name: "Acme Corp", reason: "Exact name" },
    ]);
    // Before Microsoft 365 is connected the card says what to set up.
    expect(email?.confirmBlockReason).toBe("Connect Microsoft 365 in Connections to run this action.");
    await connect("microsoft");
    [, , email] = await cards(service);
    expect(email?.confirmTitle).toBe("Save draft to Dana Park and 1 more");
    expect(email?.plan).toMatchObject({ method: "POST", url: "https://graph.microsoft.com/v1.0/me/messages" });
    const intentID = opened.meeting.intents[2]?.id ?? "";
    expect(await service.confirm(intentID)).toMatchObject({ ok: true, value: { phase: { kind: "executed", deduplicated: false } } });
    const [draft] = providers.drafts.values();
    expect(draft?.intentID).toBe(intentID);
    expect(draft?.body).toMatchObject({ subject: "Recap", toRecipients: [{ emailAddress: { address: "dana@firm.law" } }, { emailAddress: { address: "billing@acme.test" } }] });
    expect(providers.requests.some((request) => request.target.includes("/send"))).toBe(false);
    expect(providers.sent("POST", "graph.microsoft.com/v1.0/me/messages")[0]?.authorization).toBe("Bearer access-login.microsoftonline.com");
    expect((await rig.store.auditEntries()).at(-1)).toMatchObject({ event: "action.executed", detail: expect.stringContaining('"executor":"graph.draft"') });
  });

  it("disconnecting Clio clears the mirror and tokens, and the cards ask to connect again", async () => {
    await receiveGoldenMeeting(rig);
    await connect("clio");
    expect(rig.store.mirror.count("clio")).toBe(3);
    const state = await connections.disconnect("clio");
    expect(state.connectors[0]?.status).toEqual({ kind: "disconnected" });
    expect(rig.store.mirror.count("clio")).toBe(0);
    expect(await rig.vault.oauthTokens("clio")).toBeNull();
    expect((await rig.store.auditEntries()).at(-1)).toMatchObject({ event: "connector.unlinked", subject: "clio" });
    expect(await connections.syncNow()).toMatchObject({ connectors: [{ message: "Connect this service first.", messageIsError: true }, expect.anything()] });
    const [note] = await cards(actions());
    expect(note?.target.kind).toBe("noMatch");
  });
});

describe("Test connector origin", () => {
  it("is honored only in unpackaged builds and only on loopback", () => {
    expect(testConnectorOrigin({ LANA_TEST_CONNECTOR_ORIGIN: "http://127.0.0.1:4100/x" }, false)).toBe("http://127.0.0.1:4100");
    expect(testConnectorOrigin({ LANA_TEST_CONNECTOR_ORIGIN: "http://127.0.0.1:4100" }, true)).toBeNull();
    expect(testConnectorOrigin({ LANA_TEST_CONNECTOR_ORIGIN: "http://evil.test:4100" }, false)).toBeNull();
    expect(testConnectorOrigin({ LANA_TEST_CONNECTOR_ORIGIN: "https://localhost:4100" }, false)).toBeNull();
    expect(testConnectorOrigin({}, false)).toBeNull();
  });

  it("lets only an unpackaged build ask a loopback stand-in for the LANA directory", () => {
    expect(testDirectoryURL({ LANA_TEST_DIRECTORY_URL: "http://127.0.0.1:4100/lana-ai/v1/discovery" }, false)).toBe("http://127.0.0.1:4100/lana-ai/v1/discovery");
    expect(testDirectoryURL({ LANA_TEST_DIRECTORY_URL: "http://127.0.0.1:4100/lana-ai/v1/discovery" }, true)).toBeNull();
    expect(testDirectoryURL({ LANA_TEST_DIRECTORY_URL: "http://directory.evil.test/v1/discovery" }, false)).toBeNull();
    expect(testDirectoryURL({}, false)).toBeNull();
  });
});
