import { describe, expect, it } from "vitest";

// Recording in the LANA client: capture runs in a hidden capture page (CAPTURE_PAGE) so it
// outlives page changes in the visible window. That page records and sends levels; it
// exposes nothing and plays no tone. Every other page gets the bridge as before.

function ipc() {
  const sent: Array<[string, unknown]> = [];
  return {
    sent,
    invoke: async (channel: string) => (channel === "briefs:running" ? true : null),
    on: () => undefined,
    removeListener: () => undefined,
    send: (channel: string, value: unknown) => void sent.push([channel, value]),
  };
}

describe("the capture page", () => {
  it("records and sends levels, exposes nothing and plays no tone", async () => {
    const { exposeBriefsBridge, isCapturePage } = await import("../src/preload/bridge.js");
    const exposed: Record<string, unknown> = {};
    const tones: unknown[] = [];
    const captures: Array<(levels: { mic: number; meeting: number }) => void> = [];
    const channel = ipc();
    exposeBriefsBridge(
      { exposeInMainWorld: (key, api) => void (exposed[key] = api) },
      channel as never,
      (bridge) => void tones.push(bridge),
      "/Users/x/app/public_html/briefs/capture.html",
      (_bridge, publish) => void captures.push(publish),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exposed).toEqual({});
    expect(tones).toEqual([]);
    expect(captures).toHaveLength(1);
    captures[0]!({ mic: 0.4, meeting: 0.1 });
    expect(channel.sent).toEqual([["briefs:recording.levels", { mic: 0.4, meeting: 0.1 }]]);
    expect(isCapturePage("/app/public_html/briefs/index.html")).toBe(false);
  });

  it("a normal page gets the bridge and the tone, and never captures (control)", async () => {
    const { exposeBriefsBridge } = await import("../src/preload/bridge.js");
    const exposed: Record<string, unknown> = {};
    const tones: unknown[] = [];
    const captures: unknown[] = [];
    exposeBriefsBridge(
      { exposeInMainWorld: (key, api) => void (exposed[key] = api) },
      ipc() as never,
      (bridge) => void tones.push(bridge),
      "/Users/x/app/public_html/briefs/index.html",
      () => void captures.push(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(typeof (exposed["lanaBriefs"] as { importRecording?: unknown }).importRecording).toBe("function");
    expect(tones).toHaveLength(1);
    expect(captures).toEqual([]);
  });

  it("import refuses anything but the file's bytes", async () => {
    const { buildBriefsBridge } = await import("../src/preload/bridge.js");
    const bridge = buildBriefsBridge(ipc() as never);
    await expect(bridge.importRecording("not bytes" as never, { title: "", consent: "announced", participants: [], jurisdictionNote: "" })).resolves.toMatchObject({ ok: false });
  });
});
