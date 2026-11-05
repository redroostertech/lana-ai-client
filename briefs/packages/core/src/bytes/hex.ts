/** Lowercase hex, the form fixtures and digests use. */
export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new RangeError("Invalid hex string");
  return new Uint8Array(Buffer.from(hex, "hex"));
}
