import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** desktop/fixtures/golden, written by the Swift GoldenVectorExportTests. */
export const GOLDEN_DIR = fileURLToPath(new URL("../../../../fixtures/golden/", import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function golden<T = any>(name: string): T {
  return JSON.parse(readFileSync(`${GOLDEN_DIR}${name}.json`, "utf8")) as T;
}

export function hexToString(hex: string): string {
  return Buffer.from(hex, "hex").toString("utf8");
}
