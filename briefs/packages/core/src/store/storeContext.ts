import type { Database } from "./database.js";
import type { FieldSealer } from "./fieldSealer.js";
import type { StoreFiles } from "./storeFiles.js";
import { normalizedDate } from "./storedDate.js";
import type { StoreClock } from "./types.js";

/** What every repository shares: one database, one sealer, the files and the clock. */
export class StoreContext {
  constructor(
    readonly db: Database,
    readonly sealer: FieldSealer,
    readonly files: StoreFiles,
    private readonly clock: StoreClock,
  ) {}

  /** Swift `GatewayStore.now`: the clock rounded to whole milliseconds. */
  now(): Date {
    return normalizedDate(this.clock.now());
  }
}
