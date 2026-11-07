import { describe, expect, it } from "vitest";
import { BackendError } from "../../src/ask/index.js";
import { cleanedReply, LanaRuntimeTextModel, type RuntimeFetch } from "../../src/model/index.js";

const REQUEST_ID = "cccccccc-0000-4000-8000-000000000001";

interface Sent { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function reply(status: number, json: unknown, sse?: string): Awaited<ReturnType<RuntimeFetch>> {
  const body = sse === undefined ? null : new ReadableStream<Uint8Array>({
    start(controller) {
      // Split across chunks so the reader has to join frames.
      const bytes = new TextEncoder().encode(sse);
      controller.enqueue(bytes.slice(0, 7));
      controller.enqueue(bytes.slice(7));
      controller.close();
    },
  });
  return { ok: status >= 200 && status < 300, status, body, json: async () => json, text: async () => JSON.stringify(json) };
}

function model(answer: () => Awaited<ReturnType<RuntimeFetch>>, sent: Sent[] = [], options: { base?: string | null; token?: string | null; matter?: string | null } = {}) {
  const fetch: RuntimeFetch = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    return answer();
  };
  return new LanaRuntimeTextModel({
    engineBase: () => (options.base === undefined ? "http://127.0.0.1:8079/" : options.base),
    token: () => (options.token === undefined ? "tok" : options.token),
    purpose: "briefs.notes",
    matterRef: () => options.matter ?? null,
    priority: "background",
    fetch,
    newRequestID: () => REQUEST_ID,
  });
}

const ask = { instructions: "Write notes.", prompt: "TRANSCRIPT", temperature: 0.2, maximumResponseTokens: 20000 };

describe("LANA runtime as the text model", () => {
  it("sends instructions and prompt to the engine's runtime route and never names a model or host", async () => {
    const sent: Sent[] = [];
    const text = await model(() => reply(200, { data: { request_id: REQUEST_ID, content: "<think>x</think>Notes" } }), sent, { matter: "MATT-1" }).respond(ask);
    expect(text).toBe("Notes");
    expect(sent).toEqual([{
      url: "http://127.0.0.1:8079/api/v1/runtime/requests",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
      body: {
        request_id: REQUEST_ID, purpose: "briefs.notes", matter_ref: "MATT-1", priority: "background",
        messages: [{ role: "system", content: "Write notes." }, { role: "user", content: "TRANSCRIPT" }],
        max_tokens: 8192, temperature: 0.2, stream: false,
      },
    }]);
  });

  it("streams: onText gets the whole reply so far, cleaned, and the final text is returned", async () => {
    const seen: string[] = [];
    const sse = 'event: delta\ndata: {"text":"Key "}\n\nevent: delta\ndata: {"text":"points"}\n\nevent: done\ndata: {"request_id":"x","content":"Key points"}\n\n';
    const sent: Sent[] = [];
    const text = await model(() => reply(200, {}, sse), sent).respond({ ...ask, onText: (t) => seen.push(t) });
    expect(text).toBe("Key points");
    // cleanedReply trims, so the first partial reads "Key".
    expect(seen).toEqual(["Key", "Key points", "Key points"]);
    expect(sent[0]?.body["stream"]).toBe(true);
  });

  it.each([
    [503, { code: "LOCAL_MODEL_UNAVAILABLE", ai_policy: "local_only" }, BackendError.failed("matter_kept_local")],
    [503, { code: "LOCAL_MODEL_UNAVAILABLE", ai_policy: "never_leave_firm" }, BackendError.failed("matter_kept_local")],
    [503, { code: "LOCAL_MODEL_UNAVAILABLE", ai_policy: "any" }, BackendError.unavailable("modelNotReady")],
    [404, { code: "MATTER_NOT_FOUND" }, BackendError.failed("matter_not_found")],
    [401, {}, BackendError.failed("signed_out")],
    [500, { code: "X" }, BackendError.failed("runtime")],
  ])("an answer of %i %j is %s", async (status, problem, expected) => {
    await expect(model(() => reply(status, problem)).respond(ask)).rejects.toMatchObject({ kind: expected.kind, code: expected.code, reason: expected.reason });
  });

  it("an error event in the stream is the same refusal", async () => {
    const sse = 'event: error\ndata: {"status":503,"code":"LOCAL_MODEL_UNAVAILABLE","ai_policy":"local_only"}\n\n';
    await expect(model(() => reply(200, {}, sse)).respond({ ...ask, onText: () => {} })).rejects.toMatchObject({ kind: "failed", code: "matter_kept_local" });
  });

  it("no engine or no sign-in: unavailable without a request; the engine down is modelNotReady", async () => {
    const sent: Sent[] = [];
    expect(await model(() => reply(200, {}), sent, { base: null }).availability()).toEqual({ available: false, reason: "modelNotReady" });
    await expect(model(() => reply(200, {}), sent, { token: null }).respond(ask)).rejects.toMatchObject({ code: "signed_out" });
    expect(sent).toEqual([]);
    const down = new LanaRuntimeTextModel({ engineBase: () => "http://127.0.0.1:1", token: () => "t", purpose: "briefs.ask", fetch: async () => { throw new TypeError("fetch failed"); } });
    await expect(down.respond(ask)).rejects.toMatchObject({ kind: "unavailable", reason: "modelNotReady" });
    expect(await model(() => reply(200, {})).availability()).toEqual({ available: true });
  });

  it("drops think blocks, closed or not", () => {
    expect(cleanedReply("<think>plan</think>\nANSWER: x")).toBe("ANSWER: x");
    expect(cleanedReply("ANSWER: x <think>still thinking")).toBe("ANSWER: x");
    expect(cleanedReply("<think></think><think>a</think> y ")).toBe("y");
  });
});
