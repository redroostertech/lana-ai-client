import type { AnswerDraft, AnswerRequest, ModelAnswer, ModelAnswerKind } from "../ask/askEngine.js";
import { normalizeLabels } from "../ask/passageLabel.js";
import { graphemes } from "../text/graphemes.js";
import { formatLineValue, trimSpaces } from "./formatLine.js";
import type { GateEvaluation, JsonLike, ModelOutputValidation } from "./kernel.js";

/**
 * Ask's reply format (`lana.ask.answer.v1`), Swift `AnswerFormat`: the instructions, the
 * prompt, the validator the kernel calls, and the grounding gate. The model replies in
 * labelled lines that are read back deterministically.
 */
export const ANSWER_SCHEMA = "lana.ask.answer.v1";
export const GROUNDING_GATE = "lana.grounded_citations";
/** Room for an in-depth suggestion (an opening line and several steps). */
export const ANSWER_MAXIMUM_RESPONSE_TOKENS = 800;
const NOT_FOUND = "NONE";

export const ANSWER_INSTRUCTIONS =
  "You help someone review and act on a meeting they recorded. The numbered passages " +
  "are what was said. There are two kinds of question:\n" +
  "1. Questions about what happened (who said what, what was decided, dates, details). " +
  "Answer only from the passages and never guess; if the passages do not say, the answer " +
  "is NONE. Give the whole answer: every relevant point, who said it, and any dates or " +
  "numbers. Use as many sentences as the question needs.\n" +
  "2. Requests for advice, ideas, methods or next steps (what should we do, how would I " +
  "track this, what would you suggest). Be a thoughtful collaborator: give a specific, " +
  "in-depth answer that builds on what was said and uses general knowledge and good " +
  "practice. Start with one sentence that answers directly, then give 3 to 6 concrete " +
  "steps or options, each on its own line starting with \"- \", saying what to do and how. " +
  "Tailor it to this meeting; avoid generic advice.\n" +
  "Follow-ups: read the earlier conversation. If the person rephrases, narrows the " +
  "question or says the last answer missed the point, answer what they now ask, " +
  "differently and more specifically. Never repeat an earlier answer.\n" +
  "Write plainly and name who said what when it matters. Reply in exactly this format " +
  "and nothing else:\n" +
  "KIND: fact, or suggestion\n" +
  "ANSWER: the answer, which may continue over several lines, or NONE if it is a fact " +
  "question the passages do not answer.\n" +
  "SOURCES: the labels of the passages you used, such as P1, P3.\n" +
  "For example:\n" +
  "KIND: suggestion\n" +
  "ANSWER: Track each initiative against the goals Dana set in the meeting.\n" +
  "- Write down a baseline for each goal this week, such as current caseload and wait times.\n" +
  "- Review those numbers in a short monthly check-in and note what changed.\n" +
  "SOURCES: P2, P4";

export function answerPrompt(request: AnswerRequest): string {
  const lines: string[] = [];
  if (request.history.length > 0) {
    lines.push("Earlier in this conversation:");
    for (const turn of request.history) lines.push(`Q: ${turn.question}\nA: ${turn.answer}`);
    lines.push("");
  }
  lines.push("Passages:");
  for (const passage of request.passages) lines.push(`[${passage.label}] (${passage.heading})\n${passage.text}`);
  lines.push("");
  lines.push(`Question: ${request.question}`);
  return lines.join("\n");
}

/** Swift `split(whereSeparator: \.isNewline)`: empty lines are omitted. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|[\n\r\v\f\u{85}\u{2028}\u{2029}]/u).filter((line) => line.length > 0);
}

const NEWLINE_END = /[\n\r\v\f\u{85}\u{2028}\u{2029}]$/u;
const WHITESPACE_ONLY = /^[\p{Zs}\t\n\v\f\r\u{85}\u{200B}\u{2028}\u{2029}]*$/u;
const LETTER_OR_NUMBER = /^[\p{L}\p{N}]/u;
const NUMBER = /^\p{N}/u;

function value(label: string, line: string): string | undefined {
  return formatLineValue(label, line);
}

const notAnswer = (): ModelAnswer => ({ answerable: false, answer: "", citations: [], kind: "fact" });

/** Reads the reply. The answer may run over several lines until `SOURCES:`. */
export function parseAnswer(reply: string): ModelAnswer {
  let answerLines: string[] = [];
  let sources: string[] = [];
  let inAnswer = false;
  let sawAnswerLine = false;
  let kind: ModelAnswerKind = "fact";
  for (const raw of splitLines(reply)) {
    const line = trimSpaces(raw);
    const kindBody = value("KIND:", line);
    if (kindBody !== undefined) {
      // Models sometimes put the verdict on the KIND line: "KIND: NONE" means not found.
      if (kindBody.toUpperCase().startsWith(NOT_FOUND)) return notAnswer();
      kind = kindBody.toLowerCase().startsWith("suggest") ? "suggestion" : "fact";
      continue;
    }
    const answerBody = value("ANSWER:", line);
    if (answerBody !== undefined) {
      inAnswer = true;
      sawAnswerLine = true;
      answerLines = answerBody.length === 0 ? [] : [answerBody];
      continue;
    }
    const sourcesBody = value("SOURCES:", line);
    if (sourcesBody !== undefined) {
      inAnswer = false;
      sources = normalizeLabels([sourcesBody]);
    } else if (inAnswer && line.length > 0) {
      answerLines.push(line);
    }
  }
  if (!sawAnswerLine) return proseAnswer(reply);
  const answer = joinAnswerLines(answerLines);
  if (kind === "suggestion") {
    // A suggestion may rest on general knowledge, so it needs no source to be shown.
    const answerable = answer.length > 0 && answer.toUpperCase() !== NOT_FOUND;
    return { answerable, answer: answerable ? answer : "", citations: answerable ? sources : [], kind: "suggestion" };
  }
  const answerable = answer.length > 0 && answer.toUpperCase() !== NOT_FOUND && sources.length > 0;
  return { answerable, answer: answerable ? answer : "", citations: answerable ? sources : [], kind: "fact" };
}

/**
 * The answer so far in a reply still being written, or undefined before the `ANSWER:` line
 * starts. Only the answer is shown: labels, sources and a half-written `NONE` or `SOURCES:`
 * never appear. The kind is known once its line ends.
 */
export function draftAnswer(partial: string): AnswerDraft | undefined {
  const endsLine = NEWLINE_END.test(partial);
  const lines = splitLines(partial).map(trimSpaces);
  let kind: ModelAnswerKind | undefined;
  let answerLines: string[] | undefined;
  for (const [index, line] of lines.entries()) {
    const complete = index !== lines.length - 1 || endsLine;
    const kindBody = value("KIND:", line);
    if (kindBody !== undefined) {
      if (complete) kind = kindBody.toLowerCase().startsWith("suggest") ? "suggestion" : "fact";
      continue;
    }
    const answerBody = value("ANSWER:", line);
    if (answerBody !== undefined) {
      answerLines = answerBody.length === 0 ? [] : [answerBody];
    } else if (value("SOURCES:", line) !== undefined || (!complete && couldBeLabel(line, "SOURCES:"))) {
      break;
    } else if (answerLines !== undefined && line.length > 0) {
      answerLines.push(line);
    }
  }
  if (answerLines === undefined) return undefined;
  const text = joinAnswerLines(answerLines);
  // "N", "NO", "NON", "NONE": the model is saying it has no answer.
  if (text.length > 0 && NOT_FOUND.startsWith(text.toUpperCase())) return { kind, text: "" };
  return { kind, text };
}

/**
 * The answer's lines as one text. A wrapped line continues the sentence; a list item
 * ("- ", "* ", "1. ") starts its own line, so steps stay readable.
 */
export function joinAnswerLines(lines: readonly string[]): string {
  let text = "";
  for (const line of lines) {
    const item = listItem(line);
    if (item !== undefined) text += `${text.length === 0 ? "" : "\n"}- ${item}`;
    else text += `${text.length === 0 ? "" : " "}${line}`;
  }
  return trimSpaces(text);
}

function listItem(line: string): string | undefined {
  for (const marker of ["- ", "* ", "\u{2022} "]) {
    if (line.startsWith(marker)) return trimSpaces(line.slice(marker.length));
  }
  // "1. Step" or "2) Step"
  const characters = graphemes(line);
  let digits = 0;
  while (digits < characters.length && NUMBER.test(characters[digits]!)) digits += 1;
  const rest = characters.slice(digits).join("");
  if (digits > 0 && digits <= 2 && (rest.startsWith(". ") || rest.startsWith(") "))) return trimSpaces(rest.slice(2));
  return undefined;
}

/** A line cut off mid-label, such as `SOUR` or `**Sources`, may still become that label. */
function couldBeLabel(line: string, label: string): boolean {
  const bare = line.replace(/^[*_#\->` ]+|[*_#\->` ]+$/g, "").toUpperCase();
  return bare.length > 0 && label.startsWith(bare);
}

/**
 * Small models often skip the format and answer in prose with the labels in brackets.
 * The labels are ours, so the reply is still readable: sentences without labels are the
 * answer and every label mentioned is a source. Prose with no label is not an answer.
 */
export function proseAnswer(reply: string): ModelAnswer {
  const all = splitLines(reply).map(trimSpaces).filter((line) => line.length > 0);
  const sources = normalizeLabels(all.flatMap(labelTokens));
  // Format lines (KIND:, SOURCES:) are never answer text.
  const lines = all.filter((line) => ["KIND:", "ANSWER:", "SOURCES:"].every((label) => value(label, line) === undefined));
  if (sources.length === 0) return notAnswer();
  const plain = lines.filter((line) => labelTokens(line).length === 0);
  const answer = trimSpaces((plain.length === 0 ? lines.map(withoutLabels) : plain).join(" "));
  if (answer.length === 0 || answer.toUpperCase() === NOT_FOUND) return notAnswer();
  return { answerable: true, answer, citations: sources, kind: "fact" };
}

const INT64_MAX = 9_223_372_036_854_775_807n;

/** Our own passage labels (`P` followed by digits) appearing as words in `line`. */
export function labelTokens(line: string): string[] {
  const words: string[] = [];
  let current = "";
  for (const character of graphemes(line)) {
    if (LETTER_OR_NUMBER.test(character)) {
      current += character;
    } else if (current.length > 0) {
      words.push(current);
      current = "";
    }
  }
  if (current.length > 0) words.push(current);
  return words.filter((word) => {
    if (graphemes(word).length <= 1 || (word[0] !== "P" && word[0] !== "p")) return false;
    const digits = word.slice(1);
    // Swift `Int(_:)`: ASCII digits that fit in Int64.
    return /^[0-9]+$/.test(digits) && BigInt(digits) <= INT64_MAX;
  });
}

/** `text (in P1, P3)` to `text`: removes bracketed groups that hold labels. */
function withoutLabels(line: string): string {
  let result = "";
  let group = "";
  let depth = 0;
  for (const character of graphemes(line)) {
    if (character === "(" || character === "[") {
      depth += 1;
      group += character;
      continue;
    }
    if (depth > 0) {
      group += character;
      if (character === ")" || character === "]") {
        depth -= 1;
        if (depth === 0) {
          if (labelTokens(group).length === 0) result += group;
          group = "";
        }
      }
      continue;
    }
    result += character;
  }
  let cleaned = trimSpaces(result + group);
  // "show tonight [P2]." leaves "show tonight ." behind.
  for (const mark of [".", ",", ";", ":", "?", "!"]) cleaned = cleaned.split(` ${mark}`).join(mark);
  return cleaned;
}

/**
 * The kernel's output validator: only an empty reply is unreadable (the step fails and the
 * kernel retries it once). Any other reply reads as an answer or as not found.
 */
export function validateAnswer(reply: string): ModelOutputValidation {
  if (WHITESPACE_ONLY.test(reply)) return { valid: false, reason: "empty_reply" };
  const parsed = parseAnswer(reply);
  return { valid: true, parsed: { answerable: parsed.answerable, suggestion: parsed.kind === "suggestion", citations: [...parsed.citations] } };
}

/**
 * The grounding gate: a factual answer must cite at least one passage it was given. "Not in
 * the passages" is an honest answer and passes, and so is a suggestion, which is always
 * shown labelled as one.
 */
export function groundingGate(supplied: ReadonlySet<string>): (content: string, output: JsonLike | undefined) => GateEvaluation {
  return (_content, output) => {
    const step = isObject(output) ? output : undefined;
    const parsed = step !== undefined && isObject(step["parsed"]) ? step["parsed"] : undefined;
    const answerable = parsed?.["answerable"];
    if (parsed === undefined || typeof answerable !== "boolean") return { verdict: "withhold", reason: "no_parsed_answer" };
    if (!answerable) return { verdict: "allow" };
    if (parsed["suggestion"] === true) return { verdict: "allow" };
    const values = parsed["citations"];
    const cited = Array.isArray(values) ? values.filter((label): label is string => typeof label === "string") : [];
    const grounded = cited.filter((label) => supplied.has(label));
    return grounded.length === 0 ? { verdict: "withhold", reason: "no_supplied_citation", findings: [cited.length] } : { verdict: "allow" };
  };
}

function isObject(value: JsonLike | undefined): value is { readonly [key: string]: JsonLike } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
