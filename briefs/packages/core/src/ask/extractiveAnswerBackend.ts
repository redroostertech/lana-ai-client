import type { AnswerBackend, AnswerRequest, ModelAnswer } from "./askEngine.js";
import { AVAILABLE, type BackendAvailability } from "./backend.js";
import { terms } from "./tokenizer.js";
import { sentences } from "../text/sentences.js";

/**
 * Deterministic, model-free backend: answers with the most relevant sentence of the best
 * passage, quoted. For demo data and previews only; never used to present model answers.
 */
export class ExtractiveAnswerBackend implements AnswerBackend {
  readonly modelID = "extractive-demo";

  async availability(): Promise<BackendAvailability> {
    return AVAILABLE;
  }

  async answer(request: AnswerRequest): Promise<ModelAnswer> {
    const queryTerms = new Set(terms(request.question));
    let best: { label: string; sentence: string; score: number } | undefined;
    for (const passage of request.passages) {
      for (const line of passage.text.split("\n")) {
        const colon = line.indexOf(":");
        const speech = colon === -1 ? line : line.slice(colon + 1);
        for (const sentence of sentences(speech)) {
          const score = [...new Set(terms(sentence))].filter((term) => queryTerms.has(term)).length;
          if (score > (best?.score ?? 0)) best = { label: passage.label, sentence, score };
        }
      }
    }
    if (best === undefined) return { answerable: false, answer: "", citations: [], kind: "fact" };
    return { answerable: true, answer: `The meeting says: "${best.sentence}"`, citations: [best.label], kind: "fact" };
  }
}
