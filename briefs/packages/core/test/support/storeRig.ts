import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromBase64 } from "../../src/bytes/index.js";
import { decodeManifest, type BundleManifest } from "../../src/handoff/index.js";
import { parseJson } from "../../src/json/index.js";
import { InMemoryDataKeyProvider, type DataKeyProvider } from "../../src/keys/index.js";
import { GatewayStore, type StoreClock } from "../../src/store/index.js";
import { golden } from "../golden/fixtures.js";

/** A clock tests move by hand (Swift `ManualClock`). */
export class ManualClock implements StoreClock {
  constructor(private ms: number = 1_800_000_000_000) {}

  now(): Date {
    return new Date(this.ms);
  }

  advance(seconds: number): void {
    this.ms += seconds * 1_000;
  }
}

/** A throwaway folder under the OS temp directory. Removed by `cleanup`. */
export function temporaryDirectory(label: string): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), `lana-${label}-`));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

export interface StoreRig {
  readonly directory: string;
  readonly clock: ManualClock;
  readonly keys: DataKeyProvider;
  readonly store: GatewayStore;
  reopen(): Promise<GatewayStore>;
  cleanup(): void;
}

export async function openRig(options: { keys?: DataKeyProvider; clock?: ManualClock } = {}): Promise<StoreRig> {
  const folder = temporaryDirectory("store");
  const clock = options.clock ?? new ManualClock();
  const keys = options.keys ?? new InMemoryDataKeyProvider();
  const opened: GatewayStore[] = [];
  const open = async (): Promise<GatewayStore> => {
    const store = await GatewayStore.open({ directory: folder.path, keys, clock });
    opened.push(store);
    return store;
  };
  const store = await open();
  return {
    directory: folder.path,
    clock,
    keys,
    store,
    reopen: open,
    cleanup: () => {
      for (const each of opened) each.close();
      folder.cleanup();
    },
  };
}

/** The three-part bundle the Swift phone code sealed for the golden Mac identity. */
export function goldenBundle(): { manifest: BundleManifest; parts: Uint8Array[]; plaintexts: Uint8Array[] } {
  const fixture = golden<{ manifest_json: string; parts: string[]; plaintexts: string[] }>("bundle");
  const decode = (value: string): Uint8Array => fromBase64(value) as Uint8Array;
  return { manifest: decodeManifest(parseJson(fixture.manifest_json)), parts: fixture.parts.map(decode), plaintexts: fixture.plaintexts.map(decode) };
}
