import { describe, expect, it, vi } from "vitest";
import { ClientSession, type ClientSessionSnapshot } from "../src/main/gateway/clientSession.js";

// One session, the client's: Briefs reads it (who, the token for LANA calls), shows the
// phone display fields only, and hears when the client signs in or out.

function snapshot(firstName: string, lastName: string, organizationName: string): ClientSessionSnapshot {
  return {
    token: "secret-token",
    apiBase: "https://lana.whitfield.example:8443",
    user: { id: "7", organizationID: "org_1", organizationName, email: "dana@whitfield.example", firstName, lastName },
  };
}

describe("the client's session in Briefs", () => {
  it("gives the paired phone display fields only: never the token or the server host", () => {
    const info = new ClientSession(() => snapshot("Dana", "Whitfield", "Whitfield Law")).accountInfo();
    expect(info).toEqual({ name: "Dana Whitfield", email: "dana@whitfield.example", organization: "Whitfield Law", serverHost: "" });
    expect(JSON.stringify(info)).not.toContain("secret-token");
    expect(JSON.stringify(info)).not.toContain("whitfield.example:8443");
  });

  it("trims a missing name part and shows the Organization ID alone when there is no name", () => {
    expect(new ClientSession(() => snapshot("Dana", "", "")).accountInfo()).toMatchObject({ name: "Dana", organization: "org_1" });
  });

  it("tells observers when the client signs in or out, and only then; a refreshed token is not a change", () => {
    let current: ClientSessionSnapshot | null = null;
    const session = new ClientSession(() => current);
    const heard = vi.fn();
    session.addObserver(heard);
    expect(session.accountState()).toEqual({ kind: "signedOut", reason: "notSignedIn", lastServer: null });
    expect(session.accountInfo()).toBeNull();
    current = snapshot("Dana", "Whitfield", "Whitfield Law");
    session.refresh();
    current = { ...current, token: "refreshed" };
    session.refresh();
    current = null;
    session.refresh();
    expect(heard.mock.calls).toEqual([[true], [false]]);
  });

  it("calls LANA with the client's current token and API base; signed out, it calls nothing", async () => {
    let current: ClientSessionSnapshot | null = snapshot("Dana", "Whitfield", "Whitfield Law");
    const session = new ClientSession(() => current);
    const call = vi.fn(async () => "ok");
    await expect(session.authorized(call)).resolves.toBe("ok");
    expect(call).toHaveBeenCalledWith({ baseURL: "https://lana.whitfield.example:8443", token: "secret-token" });
    current = null;
    await expect(session.authorized(call)).rejects.toMatchObject({ kind: "signedOut" });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
