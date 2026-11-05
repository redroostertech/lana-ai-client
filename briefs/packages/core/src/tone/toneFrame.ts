/**
 * Byte to symbol framing (Swift `ToneFrame`): a CRC-16/CCITT trailer and Gray-coded
 * nibbles, so a tone landing in a neighbouring bin flips one bit and the CRC catches it.
 */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function gray(value: number): number {
  return value ^ (value >> 1);
}

export function ungray(value: number): number {
  let result = value;
  for (let shift = value >> 1; shift !== 0; shift >>= 1) result ^= shift;
  return result;
}

/** Payload plus CRC, high nibble first, each nibble Gray coded. */
export function toneSymbols(payload: Uint8Array): number[] {
  const crc = crc16(payload);
  const bytes = [...payload, crc >> 8, crc & 0xff];
  return bytes.flatMap((byte) => [gray(byte >> 4), gray(byte & 0x0f)]);
}

/** Inverse of `toneSymbols`; undefined when the shape or the CRC is wrong. */
export function tonePayload(symbols: readonly number[]): Uint8Array | undefined {
  if (symbols.length < 4 || symbols.length % 2 !== 0) return undefined;
  const bytes = new Uint8Array(symbols.length / 2);
  for (let index = 0; index < symbols.length; index += 2) {
    bytes[index / 2] = ((ungray(symbols[index] as number) << 4) | ungray(symbols[index + 1] as number)) & 0xff;
  }
  const body = bytes.slice(0, bytes.length - 2);
  const received = ((bytes[bytes.length - 2] as number) << 8) | (bytes[bytes.length - 1] as number);
  return crc16(body) === received ? body : undefined;
}
