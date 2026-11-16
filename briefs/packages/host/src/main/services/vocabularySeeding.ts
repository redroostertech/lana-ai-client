import { seedVocabulary, VOCABULARY_SETTING_KEYS, type SettingsWriter } from "@lana/core/gateway";
import type { MainLog } from "../log.js";

/**
 * Seeds the meeting word list once from the firm's connector names (the first time LANA
 * answers with at least one), so product names like the firm's CRM are spelled right from
 * the first meeting. A name the person removes later does not come back. Never throws;
 * logs counts only.
 */
export async function seedVocabularyFromConnectors(settings: SettingsWriter, connectorNames: () => Promise<string[]>, log: MainLog): Promise<boolean> {
  if (settings.get(VOCABULARY_SETTING_KEYS.seeded) === "1") return false;
  let names: string[];
  try {
    names = await connectorNames();
  } catch {
    log.notice("settings.vocabulary_seed_failed");
    return false;
  }
  if (names.length === 0 || !seedVocabulary(settings, names)) return false;
  log.info("settings.vocabulary_seeded", { names: names.length });
  return true;
}
