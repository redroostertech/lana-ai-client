import { describe, expect, it } from "vitest";
import type { LanaEvent } from "../src/shared/api.js";
import { startTonePlayer, type ToneAudio } from "../src/preload/tonePlayer.js";

/** Just enough of Web Audio to watch what the player does. */
class FakeContext {
  state: "running" | "suspended" | "closed" = "suspended";
  readonly sources: FakeSource[] = [];
  readonly buffers: { channels: number; length: number; rate: number; data: Float32Array | null }[] = [];
  readonly destination = { node: "destination" };
  constructor(readonly sampleRate: number, private readonly failBuffers = false) {}
  async resume(): Promise<void> {
    this.state = "running";
  }
  async close(): Promise<void> {
    this.state = "closed";
  }
  createBuffer(channels: number, length: number, rate: number) {
    if (this.failBuffers) throw new Error("NotSupportedError");
    const record = { channels, length, rate, data: null as Float32Array | null };
    this.buffers.push(record);
    return { copyToChannel: (data: Float32Array, channel: number) => (record.data = channel === 0 ? data : null) };
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

class FakeSource {
  buffer: unknown = null;
  connectedTo: unknown = null;
  started = false;
  onended: (() => void) | null = null;
  connect(target: unknown): void {
    this.connectedTo = target;
  }
  disconnect(): void {
    this.connectedTo = null;
  }
  start(): void {
    this.started = true;
  }
}

function rig(failBuffers = false) {
  const contexts: FakeContext[] = [];
  const audio: ToneAudio = {
    createContext: (rate) => {
      const context = new FakeContext(rate, failBuffers);
      contexts.push(context);
      return context as unknown as AudioContext;
    },
  };
  let listener: ((event: LanaEvent) => void) | null = null;
  const played: string[] = [];
  const failed: string[] = [];
  const stop = startTonePlayer(
    {
      onEvent: (fn) => {
        listener = fn;
        return () => (listener = null);
      },
      tone: { played: async (id) => void played.push(id), failed: async (id) => void failed.push(id) },
    },
    audio,
  );
  const send = (id: string, samples: Float32Array, sampleRate = 48_000) =>
    listener?.({ type: "tone", request: { id, samples, sampleRate, durationMs: Math.ceil((samples.length / sampleRate) * 1000) } });
  return { contexts, played, failed, send, stop, listening: () => listener !== null };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Tone player (renderer side of ToneBridge)", () => {
  it("plays each burst once as a mono buffer at its own rate and reports when it ends", async () => {
    const { contexts, played, failed, send } = rig();
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    send("a", samples);
    await flush();
    const context = contexts[0];
    expect(context?.sampleRate).toBe(48_000);
    expect(context?.state).toBe("running");
    expect(context?.buffers).toEqual([{ channels: 1, length: 4, rate: 48_000, data: samples }]);
    const source = context?.sources[0];
    expect(source?.started).toBe(true);
    expect(source?.connectedTo).toBe(context?.destination);
    expect(played).toEqual([]);
    source?.onended?.();
    expect(played).toEqual(["a"]);
    expect(failed).toEqual([]);

    // Same rate: the context is reused.
    send("b", samples);
    await flush();
    expect(contexts).toHaveLength(1);
    context?.sources[1]?.onended?.();
    expect(played).toEqual(["a", "b"]);
  });

  it("reports failed when Web Audio refuses the burst, and stops listening when stopped", async () => {
    const { failed, played, send, stop, listening, contexts } = rig(true);
    send("x", new Float32Array(10));
    await flush();
    expect(failed).toEqual(["x"]);
    expect(played).toEqual([]);
    stop();
    expect(listening()).toBe(false);
    expect(contexts[0]?.state).toBe("closed");
  });
});

describe("the tone player in the client's preload", () => {
  it("starts only when Briefs answers on this computer; without Briefs no audio output opens", async () => {
    const { exposeBriefsBridge } = await import("../src/preload/bridge.js");
    const exposed: Record<string, unknown> = {};
    const started: unknown[] = [];
    const ipc = (running: boolean) => ({
      invoke: async (channel: string) => (channel === "briefs:running" ? running : null),
      on: () => undefined,
      removeListener: () => undefined,
      send: () => undefined,
    });
    exposeBriefsBridge({ exposeInMainWorld: (key, api) => void (exposed[key] = api) }, ipc(false) as never, (bridge) => void started.push(bridge));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([]);
    expect(exposed["lanaBriefs"]).toBeDefined();
    exposeBriefsBridge({ exposeInMainWorld: () => undefined }, ipc(true) as never, (bridge) => void started.push(bridge));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(1);
  });
});
