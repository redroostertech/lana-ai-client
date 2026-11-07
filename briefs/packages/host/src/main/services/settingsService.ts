import { readFileSync, rmSync } from "node:fs";
import type { SettingsRepository } from "@lana/core/store";
import type { AppSettings, LanaEvent, SettingsApi, ThemePreference } from "../../shared/api.js";
import type { MainLog } from "../log.js";

/** Store setting keys owned by the desktop shell (plain values, never secrets). */
export const APP_SETTING_KEYS = {
  theme: "appearance.theme",
  /** JSON array of the user ids that finished the first-run walkthrough. */
  walkthroughCompleted: "walkthrough.completed",
} as const;

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];

/**
 * Appearance and "walkthrough seen", kept in the store's settings. A `walkthrough.json`
 * left by an earlier build is imported once and then removed.
 */
export class SettingsService implements SettingsApi {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly applyTheme: (theme: ThemePreference) => void,
    private readonly emit: (event: LanaEvent) => void,
    private readonly log: MainLog,
  ) {}

  /** Applies the saved theme and imports the old walkthrough file. Call once at startup. */
  start(legacyWalkthroughFile: string | null): void {
    this.applyTheme(this.theme());
    if (legacyWalkthroughFile === null) return;
    let ids: string[];
    try {
      const parsed: unknown = JSON.parse(readFileSync(legacyWalkthroughFile, "utf8"));
      ids = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return;
    }
    const merged = new Set([...this.completed(), ...ids]);
    this.saveCompleted(merged);
    rmSync(legacyWalkthroughFile, { force: true });
    this.log.info("settings.walkthrough_imported", { users: ids.length });
  }

  async get(): Promise<AppSettings> {
    return { theme: this.theme() };
  }

  async setTheme(theme: ThemePreference): Promise<AppSettings> {
    const value = THEMES.includes(theme) ? theme : "system";
    this.settings.set(APP_SETTING_KEYS.theme, value);
    this.applyTheme(value);
    const settings = { theme: value };
    this.emit({ type: "settings", settings });
    return settings;
  }

  async walkthroughCompleted(userID: string): Promise<boolean> {
    return this.completed().has(String(userID));
  }

  async setWalkthroughCompleted(userID: string): Promise<void> {
    const ids = this.completed();
    ids.add(String(userID));
    this.saveCompleted(ids);
  }

  private theme(): ThemePreference {
    const stored = this.settings.get(APP_SETTING_KEYS.theme);
    return THEMES.find((theme) => theme === stored) ?? "system";
  }

  private completed(): Set<string> {
    try {
      const parsed: unknown = JSON.parse(this.settings.get(APP_SETTING_KEYS.walkthroughCompleted) ?? "[]");
      return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  }

  private saveCompleted(ids: Set<string>): void {
    this.settings.set(APP_SETTING_KEYS.walkthroughCompleted, JSON.stringify([...ids].sort()));
  }
}
