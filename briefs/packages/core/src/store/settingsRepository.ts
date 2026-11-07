import { text } from "./database.js";
import type { StoreContext } from "./storeContext.js";

/** Plain key-value settings. Never secrets: those live in the KeyVault. */
export class SettingsRepository {
  constructor(private readonly ctx: StoreContext) {}

  get(key: string): string | null {
    const row = this.ctx.db.get("SELECT value FROM setting WHERE key = ?", key);
    return row === undefined ? null : text(row, "value");
  }

  set(key: string, value: string): void {
    this.ctx.db.write(() => {
      this.ctx.db.run("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
    });
  }
}
