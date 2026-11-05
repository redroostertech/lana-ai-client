import { randomFillSync } from "node:crypto";

export function randomBytes(count: number): Uint8Array {
  return randomFillSync(new Uint8Array(count));
}
