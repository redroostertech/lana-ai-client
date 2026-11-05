import type { LanaId } from "../../ids/lanaId.js";
import { ExecutorError } from "../execution/executorError.js";

/** Foundation `.whitespacesAndNewlines` (with U+200B, as Foundation counts it). */
const EDGE_WHITESPACE_NEWLINES = /^[\p{Zs}\t\n\v\f\r\u{85}\u{200B}\u{2028}\u{2029}]+|[\p{Zs}\t\n\v\f\r\u{85}\u{200B}\u{2028}\u{2029}]+$/gu;
/** Foundation `.whitespaces`. */
const EDGE_WHITESPACE = /^[\p{Zs}\t\u{200B}]+|[\p{Zs}\t\u{200B}]+$/gu;
/** Swift `Character.isNewline` (a CR LF pair is one newline). */
const NEWLINES = /[\n\v\f\r\u{85}\u{2028}\u{2029}]+/u;
const INT64 = /^[+-]?\d+$/;

/**
 * The marker line that ends every Clio note and task the gateway creates. It must stay
 * exactly `Lana:<intent id>`: a retry, from either the desktop or the native Mac app,
 * finds an earlier create by it.
 */
export const ClioMarker = {
  make(intentID: LanaId | string): string {
    return `Lana:${intentID}`;
  },

  append(marker: string, text: string): string {
    const trimmed = text.replace(EDGE_WHITESPACE_NEWLINES, "");
    return trimmed.length === 0 ? marker : `${trimmed}\n\n${marker}`;
  },

  /** True when the last non-empty line, trimmed of spaces, is exactly the marker. */
  endsWithMarker(text: string, marker: string): boolean {
    const lines = text.split(NEWLINES).filter((line) => line.length > 0);
    const last = lines.at(-1);
    return last !== undefined && last.replace(EDGE_WHITESPACE, "") === marker;
  },

  /** Swift `Int64(raw)` that must be positive. Ids above 2^53 are refused here (Swift accepts up to 2^63). */
  numericID(raw: string): number {
    if (!INT64.test(raw)) throw ExecutorError.invalidTarget("id");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) throw ExecutorError.invalidTarget("id");
    return value;
  },
};
