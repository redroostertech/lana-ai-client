import { describe, expect, it } from "vitest";
import { HTTPError, RateLimitConfiguration, RetryPolicy } from "../../src/executors/index.js";
import { Harness } from "../support/executorFakes.js";

const get = (path: string) => ({ method: "GET", url: `https://app.clio.com${path}`, headers: {} });
const post = (path: string) => ({ method: "POST", url: `https://app.clio.com${path}`, headers: {} });

describe("Rate limited client", () => {
  it("honors Retry-After on 429", async () => {
    const h = new Harness();
    h.transport.on("GET", "/x", { status: 429, headers: { "Retry-After": "7" } }, { status: 200 });
    expect((await h.client.send(get("/x"))).status).toBe(200);
    expect(h.sleeper.sleeps).toEqual([7]);
    expect(h.transport.requests).toHaveLength(2);
  });

  it("returns a Retry-After longer than the policy allows to the caller", async () => {
    const h = new Harness();
    h.transport.on("GET", "/x", { status: 429, headers: { "Retry-After": "600" } }, { status: 200 });
    expect((await h.client.send(get("/x"))).status).toBe(429);
    expect(h.sleeper.sleeps).toEqual([]);
  });

  it("retries idempotent 5xx with jittered exponential backoff", async () => {
    const h = new Harness();
    h.transport.on("GET", "/x", { status: 503 }, { status: 502 }, { status: 200 });
    expect((await h.client.send(get("/x"))).status).toBe(200);
    expect(h.sleeper.sleeps).toEqual([0.75, 1.5]);
  });

  it("gives up after max attempts", async () => {
    const h = new Harness();
    h.transport.on("GET", "/x", { status: 500 });
    expect((await h.client.send(get("/x"))).status).toBe(500);
    expect(h.transport.requests).toHaveLength(3);
  });

  it("retries transport failures on GET and maps them to HTTPError", async () => {
    const h = new Harness();
    h.transport.on("GET", "/x", { status: 0, fail: new TypeError("fetch failed: secret") });
    const error = await h.client.send(get("/x")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HTTPError);
    expect((error as HTTPError).reason).toEqual({ kind: "transport", reason: "TypeError" });
    expect((error as HTTPError).isRetryable).toBe(true);
    expect(h.transport.requests).toHaveLength(3);
  });

  it("never retries a POST", async () => {
    const h = new Harness();
    h.transport.on("POST", "/x", { status: 503 }, { status: 201 });
    expect((await h.client.send(post("/x"))).status).toBe(503);
    expect(h.transport.requests).toHaveLength(1);
    expect(h.sleeper.sleeps).toEqual([]);
    h.transport.on("POST", "/y", { status: 429, headers: { "Retry-After": "3" } });
    expect((await h.client.send(post("/y"))).status).toBe(429);
    expect(h.transport.sent("POST", "/y")).toHaveLength(1);
    h.transport.on("POST", "/z", { status: 0, fail: new TypeError("x") });
    await expect(h.client.send(post("/z"))).rejects.toBeInstanceOf(HTTPError);
    expect(h.transport.sent("POST", "/z")).toHaveLength(1);
  });

  it("waits for a token when the bucket is empty", async () => {
    const h = new Harness(new RateLimitConfiguration(2, 60));
    h.transport.on("GET", "/x", { status: 200 });
    for (let i = 0; i < 3; i += 1) await h.client.send(get("/x"));
    expect(h.transport.requests).toHaveLength(3);
    expect(h.sleeper.sleeps).toHaveLength(1);
    expect(h.sleeper.sleeps[0]).toBeCloseTo(30, 6);
  });

  it("spaces a Clio-sized burst at the documented rate", async () => {
    const h = new Harness(RateLimitConfiguration.clio);
    h.transport.on("GET", "/x", { status: 200 });
    for (let i = 0; i < 52; i += 1) await h.client.send(get("/x"));
    expect(h.sleeper.sleeps).toHaveLength(2);
    for (const wait of h.sleeper.sleeps) expect(wait).toBeCloseTo(1.2, 6);
  });

  it("computes backoff like Swift", () => {
    const policy = new RetryPolicy({ jitter: () => 0 });
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => policy.delay(n, undefined))).toEqual([0.5, 1, 2, 4, 8, 15, 15]);
    expect(policy.delay(3, 9)).toBe(9);
    expect(new RetryPolicy({ maxAttempts: 0 }).maxAttempts).toBe(1);
    expect(RetryPolicy.isIdempotent("delete")).toBe(true);
    expect(RetryPolicy.isIdempotent("PATCH")).toBe(false);
  });
});
