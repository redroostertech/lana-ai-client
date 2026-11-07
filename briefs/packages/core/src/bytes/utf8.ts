const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** UTF-8 bytes of a well-formed string. Lone surrogates cannot exist in a Swift `String`, so they are rejected rather than replaced. */
export function utf8(text: string): Uint8Array {
  if (!text.isWellFormed()) throw new RangeError("String contains a lone surrogate");
  return encoder.encode(text);
}

/** Decodes UTF-8, rejecting malformed input as Swift's `JSONDecoder` does. */
export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
