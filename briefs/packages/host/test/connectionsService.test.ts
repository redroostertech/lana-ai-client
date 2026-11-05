import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorHub } from "@lana/core/connectors";
import { vaultTokenStore } from "@lana/core/executors";
import type { ClioRegion, ConnectorID } from "../src/shared/api.js";
import type { AppConfiguration } from "../src/main/services/appConfiguration.js";
import { ConnectionsService } from "../src/main/services/connections/connectionsService.js";
import type { ConnectorService, ConnectorState } from "../src/main/services/connections/connectorService.js";
import { connectorOf, OAuthRedirects, redirectInArgs } from "../src/main/services/connections/oauthRedirects.js";
import { openRealRig, type RealRig } from "./support/realRig.js";

const CONFIGURED: AppConfiguration = { clioClientID: "clio-id", microsoftClientID: "ms-id" };

/** What the executors port will provide: here it hands out a URL and records the redirect. */
class FakeConnectors implements ConnectorService {
  completed: Array<{ id: ConnectorID; url: string }> = [];
  linked = new Set<ConnectorID>();
  region: ClioRegion = "us";
  async snapshot(id: ConnectorID): Promise<ConnectorState> {
    return { status: this.linked.has(id) ? { kind: "connected", account: "Alicia Reyes" } : { kind: "disconnected" }, lastSync: null, mirroredRecords: null };
  }
  async clioRegion() {
    return this.region;
  }
  async setClioRegion(region: ClioRegion) {
    this.region = region;
  }
  async authorizationURL(id: ConnectorID) {
    return `https://login.example.test/${id}?state=abc`;
  }
  async completeAuthorization(id: ConnectorID, url: string) {
    this.completed.push({ id, url });
    this.linked.add(id);
    return "Alicia Reyes";
  }
  async disconnect(id: ConnectorID) {
    this.linked.delete(id);
  }
  async syncMirror() {
    return 15;
  }
}

let rig: RealRig;
beforeEach(async () => {
  rig = await openRealRig();
});
afterEach(() => rig.cleanup());

describe("Connections: system browser sign-in and the lananotes-auth redirect", () => {
  it("opens the provider page, waits for the redirect and completes through the ConnectorService", async () => {
    const fake = new FakeConnectors();
    const redirects = new OAuthRedirects();
    const opened: string[] = [];
    const connections = new ConnectionsService(() => fake, redirects, async (url) => {
      opened.push(url);
      // The OS hands the redirect back to the app (open-url or a second instance).
      setTimeout(() => expect(redirects.deliver("lananotes-auth://oauth/clio?code=secret-code&state=abc")).toBe(true), 5);
    }, rig.log);
    const state = await connections.connect("clio");
    expect(opened).toEqual(["https://login.example.test/clio?state=abc"]);
    expect(fake.completed).toEqual([{ id: "clio", url: "lananotes-auth://oauth/clio?code=secret-code&state=abc" }]);
    const clio = state.connectors.find((connector) => connector.id === "clio");
    expect(clio).toMatchObject({ status: { kind: "connected", account: "Alicia Reyes" }, message: "Synced 15 matters and contacts.", messageIsError: false });
    expect(rig.log.lines.join("\n")).not.toContain("secret-code");
  });

  it("routes redirects only to a waiting sign-in for the same connector, and times out", async () => {
    const redirects = new OAuthRedirects(20);
    expect(redirects.deliver("lananotes-auth://oauth/clio?code=1")).toBe(false);
    const waiting = redirects.waitFor("microsoft");
    expect(redirects.deliver("lananotes-auth://oauth/clio?code=1")).toBe(false);
    expect(redirects.deliver("https://evil.test/oauth/microsoft")).toBe(false);
    expect(redirects.deliver("lananotes-auth://oauth/microsoft?code=2")).toBe(true);
    await expect(waiting).resolves.toBe("lananotes-auth://oauth/microsoft?code=2");
    await expect(redirects.waitFor("clio")).rejects.toThrow("Sign-in did not finish. Try again.");
    expect(connectorOf("lananotes-auth://oauth/other")).toBeNull();
    expect(redirectInArgs(["LANA.exe", "--flag", "lananotes-auth://oauth/clio?code=3"])).toBe("lananotes-auth://oauth/clio?code=3");
  });

  it("keeps the Clio region while connected and disconnects through the service", async () => {
    const fake = new FakeConnectors();
    const connections = new ConnectionsService(() => fake, new OAuthRedirects(), async () => undefined, rig.log);
    expect((await connections.setRegion("eu")).region).toBe("eu");
    fake.linked.add("clio");
    expect((await connections.setRegion("au")).region).toBe("eu");
    const after = await connections.disconnect("clio");
    expect(after.connectors[0]?.status).toEqual({ kind: "disconnected" });
  });
});

describe("ConnectorHub behind Connections", () => {
  function hub(configuration: AppConfiguration = CONFIGURED): ConnectorHub {
    return new ConnectorHub({ configuration, secrets: rig.vault, tokens: vaultTokenStore(rig.vault), transport: { send: () => Promise.reject(new Error("offline")) }, store: rig.store });
  }

  it("reads status from configuration and the vault, with the region bound to the tokens", async () => {
    const connections = new ConnectionsService(() => hub({ ...CONFIGURED, clioClientID: null }), new OAuthRedirects(), async () => undefined, rig.log);
    expect((await connections.state()).connectors[0]?.status).toEqual({ kind: "notConfigured", reason: "Add your Clio client ID to lana.config.json (clioClientID)." });
    const configured = hub();
    expect((await configured.snapshot("microsoft")).status).toEqual({ kind: "disconnected" });
    await rig.vault.saveOAuthTokens({ accessToken: "a", expiresAt: new Date(Date.now() + 3_600_000), region: "us" }, "clio");
    // Offline: still connected, under the generic name until who_am_i answers.
    expect((await configured.snapshot("clio")).status).toEqual({ kind: "connected", account: "Connected account" });
    await configured.setClioRegion("eu");
    expect((await configured.snapshot("clio")).status).toEqual({ kind: "disconnected" });
  }, 20_000); // Opens a real sealed store and vault, about 4 s alone; slower when suites run in parallel.

  it("disconnects for real offline: tokens removed, mirror cleared, audited", async () => {
    await rig.vault.saveOAuthTokens({ accessToken: "a", expiresAt: new Date() }, "clio");
    rig.store.mirror.replace("clio", [{ source: "clio", externalID: "1", kind: "matter", name: "Lease" }]);
    const connections = new ConnectionsService(() => hub(), new OAuthRedirects(), async () => undefined, rig.log);
    await connections.disconnect("clio");
    expect(await rig.vault.oauthTokens("clio")).toBeNull();
    expect(rig.store.mirror.count("clio")).toBe(0);
    expect((await rig.store.auditEntries()).at(-1)).toMatchObject({ event: "connector.unlinked", subject: "clio" });
  });
});
