import { describe, expect, it } from "vitest";
import { fromHex } from "../../src/bytes/index.js";
import {
  ClioMarker, ClioNoteExecutor, ClioTaskExecutor, EntityResolver, GraphConfiguration, GraphDraftExecutor, NameNormalizer, PKCE,
  StringSimilarity, clioOAuthConfiguration, decodeCandidate, decodeResolvedTarget, encodeActionPlan, encodePlannedRequest, formEncode,
  parseRetryAfter, ExecutorError, CLIO_REGIONS, type ActionExecutor, type Resolution,
} from "../../src/executors/index.js";
import { decodeEntityHint, decodeIntent, encodeIntent } from "../../src/intent/index.js";
import { canonicalString, LanaDate, parseJson } from "../../src/json/index.js";
import { Harness, staticTokens } from "../support/executorFakes.js";
import { golden } from "./fixtures.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vectors = golden<any>("executors");
const INTENT_ID = "int_01JCQ8A1B2C3D4E5F6G7H8J9K0";

function executors(harness: Harness): Record<string, ActionExecutor> {
  harness.transport.on("GET", "/users/who_am_i.json", { status: 200, json: '{"data":{"id":42,"name":"Pat Attorney"}}' });
  return {
    "clio.note": new ClioNoteExecutor(harness.clio, harness.clock),
    "clio.task": new ClioTaskExecutor(harness.clio, harness.clock),
    "graph.draft": new GraphDraftExecutor(harness.client, staticTokens, harness.clock),
  };
}

function describeResolution(resolution: Resolution): unknown {
  switch (resolution.outcome) {
    case "match":
      return { outcome: "match", id: resolution.candidate.id, score: resolution.score, reasons: resolution.reasons };
    case "ambiguous":
      return { outcome: "ambiguous", options: resolution.options.map((o) => ({ id: o.candidate.id, score: o.score, reasons: o.reasons })) };
    case "no_match":
      return { outcome: "no_match", suggest_create: resolution.suggestCreate };
  }
}

describe("executors golden vectors (Swift export)", () => {
  it("derives the same PKCE challenges", () => {
    for (const entry of vectors.pkce) {
      if (entry.bytes_hex !== undefined) {
        const pkce = PKCE.fromRandomBytes(fromHex(entry.bytes_hex));
        expect(pkce.verifier).toBe(entry.verifier);
        expect(pkce.challenge).toBe(entry.challenge);
      }
      expect(new PKCE(entry.verifier).challenge).toBe(entry.challenge);
    }
    expect(PKCE.generate().verifier).toHaveLength(43);
  });

  it("form encodes token requests the same way", () => {
    for (const entry of vectors.form) expect(formEncode(entry.pairs)).toBe(entry.encoded);
  });

  it("builds the same Clio and Graph URLs", () => {
    const clio = new Harness().clio;
    for (const entry of vectors.urls.clio) expect(clio.url(entry.path, entry.query)).toBe(entry.url);
    for (const entry of vectors.urls.clio_records) {
      expect(clio.recordURL("notes", entry.id)).toBe(entry.note);
      expect(clio.recordURL("tasks", entry.id)).toBe(entry.task);
    }
    expect(vectors.urls.regions.map((r: { region: string }) => r.region)).toEqual([...CLIO_REGIONS]);
    for (const entry of vectors.urls.regions) {
      const config = clioOAuthConfiguration(entry.region, "client-1", undefined, "lananotes-auth://oauth/clio");
      expect(config.authorizeURL).toBe(entry.authorize);
      expect(config.tokenURL).toBe(entry.token);
    }
    const graph = GraphConfiguration.oauthConfiguration("app-1", "lananotes-auth://oauth/microsoft");
    expect(graph.authorizeURL).toBe(vectors.urls.graph_authorize);
    expect(graph.tokenURL).toBe(vectors.urls.graph_token);
    for (const entry of vectors.urls.graph_search) expect(GraphDraftExecutor.searchURL(entry.intent_id)).toBe(entry.url);
    for (const entry of vectors.urls.graph_messages) expect(GraphDraftExecutor.messageURL(entry.id) ?? null).toBe(entry.url);
  });

  it("appends and recognizes the Lana:<intent id> marker line", () => {
    const marker = ClioMarker.make(INTENT_ID);
    expect(marker).toBe(`Lana:${INTENT_ID}`);
    for (const entry of vectors.markers) expect(ClioMarker.append(marker, entry.text)).toBe(entry.appended);
    for (const entry of vectors.marker_search) expect(ClioMarker.endsWithMarker(entry.text, marker)).toBe(entry.found);
  });

  it("parses Retry-After the same way", () => {
    for (const entry of vectors.retry_after) {
      const now = LanaDate.parse(entry.now);
      expect(now).not.toBeNull();
      expect(parseRetryAfter(entry.header, now as Date) ?? null).toBe(entry.seconds);
    }
  });

  it("plans byte-identical requests, plans and plan hashes", async () => {
    expect(vectors.plans.length).toBeGreaterThanOrEqual(7);
    for (const entry of vectors.plans) {
      const harness = new Harness();
      const intent = decodeIntent(parseJson(entry.intent));
      expect(canonicalString(encodeIntent(intent))).toBe(entry.intent);
      const executor = executors(harness)[entry.executor];
      const plan = await executor!.plan(intent, decodeResolvedTarget(parseJson(entry.target)));
      expect(canonicalString(encodePlannedRequest(plan.request)), entry.name).toBe(entry.request);
      expect(plan.planHash, entry.name).toBe(entry.plan_hash);
      expect(canonicalString(encodeActionPlan(plan)), entry.name).toBe(entry.plan);
    }
  });

  it("refuses the same targets with the same errors", async () => {
    for (const entry of vectors.plan_errors) {
      const harness = new Harness();
      const intent = decodeIntent(parseJson(entry.intent));
      const target = decodeResolvedTarget(parseJson(entry.target));
      const executor = executors(harness)[entry.executor]!;
      let error: string | null = null;
      let request: string | null = null;
      try {
        request = canonicalString(encodePlannedRequest((await executor.plan(intent, target)).request));
      } catch (caught) {
        error = caught instanceof ExecutorError ? caught.description : String(caught);
      }
      if (entry.name === "note_id_9223372036854775807") {
        // Known difference: Swift takes any positive Int64; the desktop refuses ids above 2^53.
        expect(entry.error).toBeNull();
        expect(error).toBe('invalidTarget("id")');
        continue;
      }
      expect({ name: entry.name, error, request }).toEqual({ name: entry.name, error: entry.error, request: entry.request });
    }
  });

  it("accepts and rejects the same recipient addresses", async () => {
    const harness = new Harness();
    const draft = new GraphDraftExecutor(harness.client, staticTokens, harness.clock);
    const hint = { kind: "contact" as const, name: "P" };
    const intent = decodeIntent(parseJson(vectors.plans.find((p: { executor: string }) => p.executor === "graph.draft").intent));
    const single = { ...intent, params: { type: "email.draft" as const, email: { to: [hint], subject: "S", body: "B" } } };
    for (const entry of vectors.addresses) {
      const target = { recipients: [{ hint, address: entry.address ?? undefined, displayName: "P" }] };
      const ok = await draft.plan(single, target).then(() => true, () => false);
      expect({ address: entry.address, ok }).toEqual({ address: entry.address, ok: entry.ok });
    }
  });

  it("validates due dates the same way", async () => {
    const harness = new Harness();
    const task = new ClioTaskExecutor(harness.clio, harness.clock);
    const base = decodeIntent(parseJson(vectors.plans.find((p: { name: string }) => p.name === "task_full").intent));
    for (const entry of vectors.due_dates) {
      const intent = { ...base, params: { type: "task.create" as const, task: { title: "T", detail: "D", dueDate: entry.due_date } } };
      const ok = await task.plan(intent, { assignee: { kind: "user", id: "9", displayName: "U" } }).then(() => true, () => false);
      expect({ due: entry.due_date, ok }).toEqual({ due: entry.due_date, ok: entry.ok });
    }
  });

  it("folds and tokenizes names the same way", () => {
    expect(vectors.names.length).toBeGreaterThan(100);
    for (const entry of vectors.names) {
      expect({
        name: entry.name,
        fold: NameNormalizer.fold(entry.name),
        tokens: NameNormalizer.tokens(entry.name),
        core: NameNormalizer.coreTokens(entry.name),
        normalized: NameNormalizer.normalized(entry.name),
        search_query: NameNormalizer.searchQuery(entry.name),
      }).toEqual({ name: entry.name, fold: entry.fold, tokens: entry.tokens, core: entry.core, normalized: entry.normalized, search_query: entry.search_query });
    }
  });

  it("computes identical Jaro-Winkler scores and token pairings", () => {
    for (const entry of vectors.jaro_winkler) expect(StringSimilarity.jaroWinkler(entry.a, entry.b)).toBe(entry.score);
    for (const entry of vectors.token_pairs) {
      const pairing = StringSimilarity.pair(entry.a, entry.b);
      expect(pairing.sum).toBe(entry.sum);
      expect(pairing.usedInitial).toBe(entry.used_initial);
      for (const token of entry.tokens) {
        const result = StringSimilarity.token(token.a, token.b);
        expect({ ...token, score: result.score, initial: result.initial }).toEqual(token);
      }
    }
  });

  it("ranks every near-duplicate case to the same resolution and scores", () => {
    expect(vectors.rankings.length).toBeGreaterThanOrEqual(55);
    const resolver = new EntityResolver([]);
    for (const entry of vectors.rankings) {
      const hint = decodeEntityHint(parseJson(entry.hint), "hint");
      const candidates = (parseJson(entry.candidates) as unknown[]).map((c, i) => decodeCandidate(c as never, `c${i}`));
      expect({ id: entry.id, resolution: describeResolution(resolver.rank(hint, candidates)) }).toEqual({ id: entry.id, resolution: entry.resolution });
    }
  });
});
