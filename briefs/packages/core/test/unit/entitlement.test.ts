import { describe, expect, it } from "vitest";
import {
  decodeEntitlementRecord, encodeEntitlementRecord, ENTITLEMENT_OFFLINE_GRACE_MS, EntitlementMonitor, HttpLanaAccountService, isEntitled, LanaAccountError,
  LANA_NOTES_APP_ID, MemoryEntitlementCache, offlineEntitlement, VaultEntitlementCache,
  type EntitlementState, type HttpRequest, type HttpResponse, type HttpTransport, type LanaAccountSession,
} from "../../src/account/index.js";
import { enabledAppIDs } from "../../src/account/lanaAuthClient.js";
import { createInMemoryKeyVault, SECRET_ACCOUNTS } from "../../src/keys/index.js";

const NOW = new Date("2026-11-02T12:00:00.000Z");
const DAY_MS = 86_400_000;

/** The directory's real reply for an organization (org_id mwestbrooks), with LANA Briefs added. */
function discoveryReply(apps: unknown[]): Record<string, unknown> {
  return {
    status: "healthy",
    server: { org_id: "mwestbrooks", org_name: "Michael Westbrooks", version: "1.0.1", api_version: "v1" },
    domain: "mwestbrooks.lanaai.io",
    discovery: { bonjour_name: "LANA AI", bonjour_status: "active", static_ip: "localhost", port: 8080, is_secure_ssl: false, endpoint: null, deployment_url: null, vpn: { enabled: false } },
    tier: "standard",
    rate_limit: 100,
    enabled_apps: apps,
    connectors: { oauth: [] },
    is_secure_ssl: false,
    timestamp: "2026-11-02T05:00:00.000Z",
  };
}

const LANA_WORKS = { id: "lana-works", label: "LanaWorks", description: "Manage matters", route: "dashboard.html", colors: ["#82d8ff", "#4267df", "#126f62", "#111827"] };
const LANA_NOTES = { id: "lana-notes", label: "LANA Briefs", description: "Meeting notes", colors: ["#126f62"] };

class ScriptedDirectory implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(public answer: () => HttpResponse | "offline") {}
  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const reply = this.answer();
    if (reply === "offline") throw new TypeError("fetch failed");
    return reply;
  }
}

const ok = (body: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(body) });

function session(organizationID: string | null = "mwestbrooks", domain: string | null = "mwestbrooks.lanaai.io"): LanaAccountSession {
  return {
    token: "tok",
    sessionID: null,
    expiresAt: new Date(NOW.getTime() + DAY_MS),
    server: { baseURL: "http://localhost:8080", organizationID, organizationName: "Michael Westbrooks", domain },
    user: { id: "1", email: "m@firm.test", firstName: null, lastName: null, organizationID: null, timezone: null, mustChangePassword: false },
  };
}

function rig(answer: () => HttpResponse | "offline") {
  let now = NOW;
  const directory = new ScriptedDirectory(answer);
  const accounts = new HttpLanaAccountService({ transport: directory, directoryURL: "https://directory.test/v1/discovery", now: () => now });
  const cache = new MemoryEntitlementCache();
  const changes: Array<[string, boolean]> = [];
  const states: EntitlementState[] = [];
  const monitor = new EntitlementMonitor({
    discover: (organizationID, domain) => accounts.discover(organizationID, domain),
    cache,
    now: () => now,
    onChange: (state) => states.push(state),
    onEntitlementChanged: (organizationID, entitled) => void changes.push([organizationID, entitled]),
  });
  return { directory, cache, changes, states, monitor, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe("Entitlement rule", () => {
  it("is on when an enabled_apps element has id lana-notes", () => {
    expect(LANA_NOTES_APP_ID).toBe("lana-notes");
    expect(isEntitled(enabledAppIDs([LANA_WORKS, LANA_NOTES]))).toBe(true);
    expect(isEntitled(enabledAppIDs([LANA_WORKS]))).toBe(false);
    expect(isEntitled(enabledAppIDs([]))).toBe(false);
  });

  it("ignores elements that are not objects or have no string id, and other spellings", () => {
    expect(enabledAppIDs(["lana-notes", null, 7, [LANA_NOTES], { id: 5 }, { label: "LANA Briefs" }, { id: "lana_notes" }])).toEqual(["lana_notes"]);
    expect(isEntitled(enabledAppIDs(["lana-notes", { id: "lana_notes" }, { id: "LANA-NOTES" }]))).toBe(false);
    expect(enabledAppIDs(undefined)).toEqual([]);
    expect(enabledAppIDs({ id: "lana-notes" })).toEqual([]);
  });

  it("reads the real discovery reply, keeping the directory's domain for rechecks", async () => {
    const directory = new ScriptedDirectory(() => ok(discoveryReply([LANA_WORKS, { id: "lana-automations", label: "Automations" }, LANA_NOTES])));
    const accounts = new HttpLanaAccountService({ transport: directory, directoryURL: "https://directory.test/v1/discovery" });
    const server = await accounts.discover("mwestbrooks", "");
    expect(directory.requests[0]?.body).toBe('{"domain":"mwestbrooks.lanaai.io","org_id":"mwestbrooks"}');
    expect(server).toEqual({
      baseURL: "http://localhost:8080", organizationID: "mwestbrooks", organizationName: "Michael Westbrooks", domain: "mwestbrooks.lanaai.io",
      enabledAppIDs: ["lana-works", "lana-automations", "lana-notes"],
    });
  });
});

describe("Offline grace", () => {
  const record = (entitled: boolean, ageMs: number, organizationID = "mwestbrooks") => ({ organizationID, entitled, checkedAt: new Date(NOW.getTime() - ageMs) });

  it("keeps a confirmed on answer for 7 days, then needs LANA again", () => {
    expect(ENTITLEMENT_OFFLINE_GRACE_MS).toBe(7 * DAY_MS);
    expect(offlineEntitlement(record(true, 7 * DAY_MS), "mwestbrooks", NOW)).toMatchObject({ kind: "entitled", offline: true });
    expect(offlineEntitlement(record(true, 7 * DAY_MS + 1), "mwestbrooks", NOW)).toEqual({ kind: "unreachable", organizationID: "mwestbrooks" });
  });

  it("never turns an off answer, another organization's answer or no answer into access", () => {
    expect(offlineEntitlement(record(false, 1_000), "mwestbrooks", NOW)).toEqual({ kind: "notEntitled", organizationID: "mwestbrooks" });
    expect(offlineEntitlement(record(true, 1_000, "harlow"), "mwestbrooks", NOW)).toEqual({ kind: "unreachable", organizationID: "mwestbrooks" });
    expect(offlineEntitlement(null, "mwestbrooks", NOW)).toEqual({ kind: "unreachable", organizationID: "mwestbrooks" });
  });

  it("does not stretch the grace for an answer stamped in the future", () => {
    expect(offlineEntitlement(record(true, -DAY_MS), "mwestbrooks", NOW).kind).toBe("unreachable");
  });

  it("keeps the record sealed in the vault and reads it back", async () => {
    const vault = createInMemoryKeyVault();
    const cache = new VaultEntitlementCache(vault);
    await cache.save(record(true, 0));
    expect(await vault.secret(SECRET_ACCOUNTS.entitlement)).not.toBeNull();
    expect(await cache.load()).toEqual(record(true, 0));
    expect(decodeEntitlementRecord(encodeEntitlementRecord(record(false, 5)))).toEqual(record(false, 5));
    expect(decodeEntitlementRecord(new TextEncoder().encode('{"entitled":"yes"}'))).toBeNull();
    await cache.clear();
    expect(await cache.load()).toBeNull();
  });
});

describe("EntitlementMonitor", () => {
  it("grants access when discovery lists LANA Briefs, and audits the change once", async () => {
    const { monitor, changes, cache, states } = rig(() => ok(discoveryReply([LANA_WORKS, LANA_NOTES])));
    expect(await monitor.check(session())).toMatchObject({ kind: "entitled", offline: false });
    expect(monitor.hasAccess).toBe(true);
    expect(states.map((state) => state.kind)).toEqual(["checking", "entitled"]);
    expect(cache.record).toMatchObject({ organizationID: "mwestbrooks", entitled: true });
    await monitor.check(session());
    expect(changes).toEqual([["mwestbrooks", true]]);
  });

  it("refuses when LANA Briefs is not listed, and audits turning off", async () => {
    let apps: unknown[] = [LANA_WORKS, LANA_NOTES];
    const { monitor, changes } = rig(() => ok(discoveryReply(apps)));
    await monitor.check(session());
    apps = [LANA_WORKS];
    expect(await monitor.check(session())).toEqual({ kind: "notEntitled", organizationID: "mwestbrooks" });
    expect(monitor.hasAccess).toBe(false);
    expect(changes).toEqual([["mwestbrooks", true], ["mwestbrooks", false]]);
  });

  it("treats an organization the directory does not know as not entitled", async () => {
    const { monitor } = rig(() => ({ status: 404, body: '{"status":"not_found","error":"Organization not found or inactive"}' }));
    expect(await monitor.check(session())).toEqual({ kind: "notEntitled", organizationID: "mwestbrooks" });
  });

  it("works offline on the cached answer inside the grace, then says LANA cannot be reached", async () => {
    let online = true;
    const { monitor, advance } = rig(() => (online ? ok(discoveryReply([LANA_NOTES])) : "offline"));
    await monitor.check(session());
    online = false;
    advance(3 * DAY_MS);
    expect(await monitor.check(session())).toMatchObject({ kind: "entitled", offline: true });
    advance(5 * DAY_MS);
    expect(await monitor.check(session())).toEqual({ kind: "unreachable", organizationID: "mwestbrooks" });
  });

  it("with no cache and no directory, says LANA cannot be reached", async () => {
    const { monitor } = rig(() => "offline");
    expect(await monitor.check(session())).toEqual({ kind: "unreachable", organizationID: "mwestbrooks" });
  });

  it("starts from a cached on answer at launch while it asks again", async () => {
    const { monitor, cache, states } = rig(() => "offline");
    cache.record = { organizationID: "mwestbrooks", entitled: true, checkedAt: new Date(NOW.getTime() - DAY_MS) };
    await monitor.check(session());
    expect(states.map((state) => state.kind)).toEqual(["entitled"]);
  });

  it("cannot ask without an Organization ID (a server typed under Advanced)", async () => {
    const { monitor, directory } = rig(() => ok(discoveryReply([LANA_NOTES])));
    expect(await monitor.check(session(null, null))).toEqual({ kind: "noOrganization" });
    expect(directory.requests).toHaveLength(0);
  });

  it("asks by Organization ID with the hosted domain when the session kept no domain", async () => {
    const { monitor, directory } = rig(() => ok(discoveryReply([LANA_NOTES])));
    await monitor.check(session("mwestbrooks", null));
    expect(directory.requests[0]?.body).toBe('{"domain":"mwestbrooks.lanaai.io","org_id":"mwestbrooks"}');
  });

  it("forgets everything on sign-out and drops an answer that arrives after it", async () => {
    let release: (() => void) | null = null;
    const cache = new MemoryEntitlementCache();
    const monitor = new EntitlementMonitor({
      discover: () => new Promise((resolve) => (release = () => resolve({ enabledAppIDs: [LANA_NOTES_APP_ID] }))),
      cache,
      now: () => NOW,
    });
    const pending = monitor.check(session());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await monitor.signedOut();
    (release as (() => void) | null)?.();
    await pending;
    expect(monitor.state).toEqual({ kind: "signedOut" });
    expect(cache.record).toBeNull();
  });

  it("asks again on coming forward only when the last check is a few minutes old", async () => {
    const { monitor, directory, advance } = rig(() => ok(discoveryReply([LANA_NOTES])));
    await monitor.check(session());
    await monitor.checkIfStale(session());
    expect(directory.requests).toHaveLength(1);
    advance(6 * 60_000);
    await monitor.checkIfStale(session());
    expect(directory.requests).toHaveLength(2);
  });

  it("maps a directory failure the same as no network", async () => {
    const { monitor } = rig(() => ({ status: 503, body: "{}" }));
    expect((await monitor.check(session())).kind).toBe("unreachable");
    expect(new LanaAccountError("directoryUnavailable").kind).toBe("directoryUnavailable");
  });
});
