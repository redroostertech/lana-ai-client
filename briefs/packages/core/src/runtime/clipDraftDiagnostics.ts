import { splitLines } from "./answerFormat.js";
import { formatLineValue, trimSpaces } from "./formatLine.js";
import type { ClipDraftKind } from "./clipDraftFormat.js";

/**
 * Why a clip draft reply was or was not used, for the opt-in drafting diagnostic:
 * `ok` (the kind's parser reads it), `empty_reply`, `no_label` (no line with the kind's
 * label, nor a line the parser accepts without one), `empty_title` (a label with nothing
 * after it), or `model_error` (the model threw).
 */
export type ClipDraftRule = "ok" | "empty_reply" | "no_label" | "empty_title" | "model_error";

/** One model call of a clip draft, as sizes and states only. Never the prompt or reply text. */
export interface ClipDraftAttempt {
  readonly kind: ClipDraftKind;
  /** 1 for the first call, 2 for the kernel's retry. */
  readonly attempt: number;
  readonly ms: number;
  readonly promptChars: number;
  readonly promptLines: number;
  readonly replyChars: number;
  readonly replyLines: number;
  /** The first known label found on a line, or none. */
  readonly label: "task" | "action" | "decision" | "none";
  /** `|` separated fields on the labelled line (or the first line with a bar), 0 when there is none. */
  readonly fields: number;
  /** True when a line holds a bar but no label. */
  readonly bareLine: boolean;
  readonly rule: ClipDraftRule;
  /** The model error's class name, for `model_error`. */
  readonly modelError: string | null;
}

export type ClipDraftObserver = (attempt: ClipDraftAttempt) => void;

/** The structure of a reply: sizes, the label found and the field count. Reads no words out. */
export function clipDraftReplyShape(reply: string, kind: ClipDraftKind, parsed: boolean): Pick<ClipDraftAttempt, "replyChars" | "replyLines" | "label" | "fields" | "bareLine" | "rule"> {
  const lines = splitLines(reply);
  let label: ClipDraftAttempt["label"] = "none";
  let fields = 0;
  let bareLine = false;
  for (const raw of lines) {
    const line = trimSpaces(raw);
    let labelled = false;
    for (const [name, text] of LABELS) {
      const body = formatLineValue(text, line);
      if (body === undefined) continue;
      labelled = true;
      if (label === "none") {
        label = name;
        fields = body.split("|").length;
      }
    }
    if (!labelled && line.includes("|")) {
      if (!bareLine && label === "none") fields = line.split("|").length;
      bareLine = true;
    }
  }
  const relevant = kind === "decision" ? label === "decision" : kind === "action" ? label === "action" : label === "task" || label === "action";
  const rule: ClipDraftRule = parsed ? "ok" : trimSpaces(reply) === "" ? "empty_reply" : relevant ? "empty_title" : "no_label";
  return { replyChars: [...reply].length, replyLines: lines.length, label, fields, bareLine, rule };
}

const LABELS = [["task", "TASK:"], ["action", "ACTION:"], ["decision", "DECISION:"]] as const;
