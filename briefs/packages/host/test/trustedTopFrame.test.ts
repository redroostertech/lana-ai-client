import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));

// The Briefs sender check (src/main/ipc.ts): the top frame of a page the client trusts.
describe("trustedTopFrame", () => {
  it("accepts the top frame of a trusted page and refuses frames, foreign pages and missing frames", async () => {
    const { trustedTopFrame } = await import("../src/main/ipc.js");
    const trusted = trustedTopFrame((url) => url.startsWith("file:///app/"));
    expect(trusted({ senderFrame: { url: "file:///app/briefs/index.html", parent: null } })).toBe(true);
    expect(trusted({ senderFrame: { url: "file:///app/briefs/index.html", parent: { url: "file:///app/app.html" } } })).toBe(false);
    expect(trusted({ senderFrame: { url: "https://evil.example/", parent: null } })).toBe(false);
    expect(trusted({ senderFrame: null })).toBe(false);
    expect(trusted({})).toBe(false);
  });

  it("registered bridge channels refuse a framed sender", async () => {
    const { ipcMain } = await import("electron");
    const { registerServices, trustedTopFrame } = await import("../src/main/ipc.js");
    const { ALL_API_METHODS } = await import("../src/shared/api.js");
    const services = Object.fromEntries(
      Object.entries(ALL_API_METHODS).map(([ns, methods]) => [ns, Object.fromEntries((methods as readonly string[]).map((m) => [m, async () => "ok"]))]),
    );
    registerServices(services as never, trustedTopFrame((url) => url.startsWith("file:///app/")));
    const [, handler] = vi.mocked(ipcMain.handle).mock.calls[0]!;
    const call = handler as (event: unknown) => unknown;
    expect(() => call({ senderFrame: { url: "file:///app/briefs/index.html", parent: {} } })).toThrow("Untrusted sender");
    await expect(call({ senderFrame: { url: "file:///app/briefs/index.html", parent: null } })).resolves.toBe("ok");
  });

  it("a bridge call over the size limit is refused before the service runs", async () => {
    const { ipcMain } = await import("electron");
    vi.mocked(ipcMain.handle).mockClear();
    const { registerServices, trustedTopFrame } = await import("../src/main/ipc.js");
    const { ALL_API_METHODS } = await import("../src/shared/api.js");
    const ran = vi.fn(async () => "ok");
    const services = Object.fromEntries(
      Object.entries(ALL_API_METHODS).map(([ns, methods]) => [ns, Object.fromEntries((methods as readonly string[]).map((m) => [m, ran]))]),
    );
    const measure = (value: unknown) => JSON.stringify(value ?? null).length;
    registerServices(services as never, trustedTopFrame((url) => url.startsWith("file:///app/")), undefined, { measure, maxBytes: 20 });
    const [, handler] = vi.mocked(ipcMain.handle).mock.calls[0]!;
    const call = handler as (event: unknown, ...args: unknown[]) => unknown;
    const top = { senderFrame: { url: "file:///app/briefs/index.html", parent: null } };
    expect(() => call(top, "x".repeat(100))).toThrow("Too large");
    expect(ran).not.toHaveBeenCalled();
    await expect(call(top, "small")).resolves.toBe("ok");
  });
});
