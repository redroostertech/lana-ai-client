import { describe, expect, it } from "vitest";
import type { LanaAccountSession } from "@lana/core/account";
import { toAccountInfo } from "../src/main/gateway/accountBridge.js";

function session(firstName: string | null, lastName: string | null, organizationName: string | null): LanaAccountSession {
  return {
    token: "secret-token",
    sessionID: "s1",
    expiresAt: new Date("2026-12-01T00:00:00Z"),
    server: { baseURL: "https://lana.whitfield.example:8443", organizationID: "org_1", organizationName },
    user: { id: "7", email: "dana@whitfield.example", firstName, lastName, organizationID: "org_1", timezone: null, mustChangePassword: false },
  };
}

describe("account info for the paired phone", () => {
  it("carries display fields only: the organization's name and id, never the token or the server host", () => {
    const info = toAccountInfo(session("Dana", "Whitfield", "Whitfield Law"));
    expect(info).toEqual({ name: "Dana Whitfield", email: "dana@whitfield.example", organization: "Whitfield Law (org_1)", serverHost: "" });
    expect(JSON.stringify(info)).not.toContain("secret-token");
    expect(JSON.stringify(info)).not.toContain("whitfield.example:8443");
  });

  it("trims a missing name part and shows the Organization ID alone when LANA gave no name", () => {
    expect(toAccountInfo(session("Dana", null, null))).toMatchObject({ name: "Dana", organization: "org_1" });
    expect(toAccountInfo(session(null, null, null)).name).toBe("");
  });
});
