import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AskEngine, askTurnsFromSaved, BackendError, decodeSavedAskTurns, encodeSavedAskTurns, hasAudioMoment, normalizeLabels,
  PassageBuilder, PassageIndex, savedFromTurns, statusCode, terms, unavailable, AVAILABLE,
  type AnswerBackend, type AnswerRequest, type ModelAnswer, type Passage,
} from "../../src/ask/index.js";
import { decodeMeeting } from "../../src/intent/index.js";
import { LanaDate, parseJson } from "../../src/json/index.js";
import {
  ANSWER_INSTRUCTIONS, ANSWER_MAXIMUM_RESPONSE_TOKENS, answerPrompt, draftAnswer, joinAnswerLines, parseAnswer, validateAnswer, workflowDefinition,
} from "../../src/runtime/index.js";
import { golden } from "./fixtures.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fixture = golden<any>("ask");
const meetings = (fixture.meetings as string[]).map((text) => decodeMeeting(parseJson(text)));
const builders = (fixture.builders as { target_tokens: number; overlap_turns: number }[]).map((b) => new PassageBuilder(b.target_tokens, b.overlap_turns));

function passageJson(passage: Passage): Record<string, unknown> {
  return {
    id: passage.id, meeting_id: passage.meetingID, meeting_title: passage.meetingTitle, meeting_date: LanaDate.format(passage.meetingDate),
    kind: passage.kind, start: passage.start, end: passage.end, speakers: passage.speakers, text: passage.text,
    key_point_kind: passage.keyPointKind ?? null, has_audio_moment: hasAudioMoment(passage),
  };
}

describe("Ask golden vectors from Swift", () => {
  it("builds the same passages with every builder", () => {
    builders.forEach((builder, b) => {
      meetings.forEach((meeting, m) => {
        expect(builder.passages(meeting).map(passageJson)).toEqual(fixture.passages[b][m]);
      });
    });
  });

  it("tokenizes like Swift", () => {
    for (const { text, terms: expected } of fixture.tokenizer) expect(terms(text), text).toEqual(expected);
  });

  it("normalizes passage labels like Swift", () => {
    for (const { raw, normalized } of fixture.labels) expect(normalizeLabels(raw)).toEqual(normalized);
  });

  it("ranks search hits like Swift", () => {
    const index = new PassageIndex(meetings.flatMap((meeting) => new PassageBuilder().passages(meeting)));
    for (const { query, limit, hits } of fixture.search as { query: string; limit: number; hits: { id: string; score: number }[] }[]) {
      const found = index.search(query, limit);
      expect(found.length, query).toBe(hits.length);
      found.forEach((hit, i) => {
        expect(hit.score, query).toBeCloseTo(hits[i]!.score, 9);
        // Swift sums a set of terms in hash order, so equal scores may differ in the last bit.
        if (Math.abs(hit.score - hits[i]!.score) < 1e-9) expect(hit.passage.id, query).toBe(hits[i]!.id);
      });
    }
  });

  describe("engine scenarios: context selection, budget, pinned, history and statuses", () => {
    for (const scenario of fixture.scenarios as any[]) {
      it(scenario.name, async () => {
        const chosen = (scenario.meetings as number[]).map((i) => meetings[i]!);
        const builder = builders[scenario.builder ?? 0]!;
        const requests: AnswerRequest[] = [];
        const backend: AnswerBackend = {
          modelID: "golden",
          availability: async () => (scenario.available === false ? unavailable("modelNotReady") : AVAILABLE),
          answer: async (request): Promise<ModelAnswer> => {
            requests.push(request);
            const reply = scenario.reply;
            if (reply.refused === true) throw BackendError.refused();
            const labels = request.passages.map((p) => p.label);
            const citations = (reply.citations ?? []).flatMap((cite: string) =>
              cite === "first" ? labels.slice(0, 1) : cite === "last" ? labels.slice(-1) : cite === "all" ? labels : [cite]);
            return { answerable: reply.answerable ?? false, answer: reply.answer ?? "", citations, kind: reply.kind === "suggestion" ? "suggestion" : "fact" };
          },
        };
        const budget = { ...(scenario.budget?.passage_tokens === undefined ? {} : { passageTokens: scenario.budget.passage_tokens }),
          ...(scenario.budget?.max_passages === undefined ? {} : { maxPassages: scenario.budget.max_passages }) };
        const extra: Passage[] = scenario.extra === true ? [{
          id: `${chosen[0]!.id}#history-int_01JCQ7A1B2C3D4E5F6G7H8J9R2`, meetingID: chosen[0]!.id, meetingTitle: chosen[0]!.title, meetingDate: chosen[0]!.startedAt,
          kind: "action", start: 21.25, end: 55.5, speakers: [],
          text: "Task 'Prepare Solberg deposition outline' regarding Pemberton v. Lockridge: proposed Nov 1, confirmed Nov 2, created in Clio. Status now: created in Clio.",
        }] : [];
        const engine = AskEngine.forMeetings(chosen, backend, { builder, budget, extraPassages: extra });
        const built = chosen.flatMap((meeting) => builder.passages(meeting));
        const pinned = ((scenario.pinned ?? []) as string[]).map((id) => built.find((p) => p.id === id)!);
        const history = ((scenario.history ?? []) as [string, string][]).map(([question, text]) => ({ question, answer: { status: "answered" as const, text, citations: [] } }));
        const answer = await engine.ask(scenario.question, { history, pinned });

        expect({ status: statusCode(answer), text: answer.text, citations: answer.citations.map((p) => p.id) }).toEqual(scenario.answer);
        if (scenario.request === null) {
          expect(requests).toHaveLength(0);
        } else {
          const request = requests[0]!;
          expect({
            question: request.question,
            passages: request.passages.map((p) => ({ label: p.label, heading: p.heading, text: p.text })),
            history: request.history.map((h) => [h.question, h.answer]),
            prompt: answerPrompt(request),
          }).toEqual(scenario.request);
        }

        const saved = decodeSavedAskTurns(new TextEncoder().encode(scenario.saved));
        const reopened = askTurnsFromSaved(saved);
        expect(reopened[0]!.answer.status).toBe(answer.status);
        expect(reopened[0]!.answer.citations.map((p) => p.id)).toEqual(answer.citations.map((p) => p.id));
        expect(decodeSavedAskTurns(encodeSavedAskTurns(savedFromTurns([{ question: scenario.question, answer }])))).toEqual(saved);
      });
    }
  });

  describe("AnswerFormat", () => {
    it("copies the instructions and limits exactly", () => {
      expect(ANSWER_INSTRUCTIONS).toBe(fixture.format.instructions);
      expect(ANSWER_MAXIMUM_RESPONSE_TOKENS).toBe(fixture.format.maximum_response_tokens);
    });

    it("parses and validates every reply like Swift", () => {
      for (const expected of fixture.format.parse) {
        const parsed = parseAnswer(expected.reply);
        expect({ answerable: parsed.answerable, answer: parsed.answer, citations: parsed.citations, kind: parsed.kind }, expected.reply)
          .toEqual({ answerable: expected.answerable, answer: expected.answer, citations: expected.citations, kind: expected.kind });
        const validation = validateAnswer(expected.reply);
        expect(validation.valid ? { valid: validation.parsed } : { invalid: validation.reason }, expected.reply).toEqual(expected.validate);
      }
    });

    it("drafts every partial reply like Swift", () => {
      for (const { partial, draft } of fixture.format.draft) {
        const mine = draftAnswer(partial);
        expect(mine === undefined ? null : { kind: mine.kind ?? null, text: mine.text }, partial).toEqual(draft);
      }
    });

    it("joins answer lines like Swift", () => {
      for (const { lines, text } of fixture.format.joined) expect(joinAnswerLines(lines)).toBe(text);
    });
  });

  it("keeps the ask.answer.v1 definition identical to the Swift bundle", () => {
    const path = fileURLToPath(new URL("../../../../fixtures/workflows/ask.answer.v1.json", import.meta.url));
    expect(workflowDefinition("ask.answer.v1")).toEqual(JSON.parse(readFileSync(path, "utf8")));
  });
});
