import type { LanaId } from "../ids/lanaId.js";

/** Foundation `.whitespacesAndNewlines` (with U+200B, as Foundation counts it). */
const EDGE_WHITESPACE_NEWLINES = /^[\p{Zs}\t\n\v\f\r\u{85}\u{200B}\u{2028}\u{2029}]+|[\p{Zs}\t\n\v\f\r\u{85}\u{200B}\u{2028}\u{2029}]+$/gu;
/** Foundation `.whitespaces`. */
const EDGE_WHITESPACE = /^[\p{Zs}\t\u{200B}]+|[\p{Zs}\t\u{200B}]+$/gu;
/** Swift `Character.isNewline` (a CR LF pair is one newline). */
const NEWLINES = /[\n\v\f\r\u{85}\u{2028}\u{2029}]+/u;

/** How long an action that ran on LANA can be undone: 24 hours. */
export const UNDO_WINDOW = 24 * 60 * 60;

/**
 * The marker line that ends every note and task an action creates on LANA. It must stay
 * exactly `Lana:<action id>`: a retry finds an earlier create by it, so nothing is made twice.
 */
export const ActionMarker = {
  make(actionID: LanaId | string): string {
    return `Lana:${actionID}`;
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
};
