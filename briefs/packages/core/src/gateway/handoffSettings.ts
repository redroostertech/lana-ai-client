import { handoffPolicyFromSettings, type MacHandoffPolicy } from "../handoff/macHandoffPolicy.js";

/** Store setting keys, as Swift `SettingKey` (same strings, so a Swift store reads the same). */
export const HANDOFF_SETTING_KEYS = {
  retentionDays: "audio.retention_days",
  requireMacClick: "handoff.require_mac_click",
  allowQr: "handoff.allow_qr",
  allowMacApproval: "handoff.allow_mac_approval",
} as const;

export const RETENTION_DAYS = { default: 90, min: 1, max: 3650 } as const;

/** Firm settings for receiving meetings and keeping audio (Swift `HandoffSettings`). */
export interface HandoffSettings {
  readonly retentionDays: number;
  /** "Require a click on this Mac after the tone". */
  readonly requireMacClick: boolean;
  readonly allowQr: boolean;
  readonly allowMacApproval: boolean;
}

export const DEFAULT_HANDOFF_SETTINGS: HandoffSettings = Object.freeze({
  retentionDays: RETENTION_DAYS.default,
  requireMacClick: false,
  allowQr: true,
  allowMacApproval: true,
});

/** The store's plain key-value settings (`GatewayStore.settings`). */
export interface SettingsReader {
  get(key: string): string | null;
}

export interface SettingsWriter extends SettingsReader {
  set(key: string, value: string): void;
}

/** Reads the settings, keeping defaults for missing or out-of-range values, as `HandoffSettings.load`. */
export function loadHandoffSettings(store: SettingsReader): HandoffSettings {
  const flag = (key: string, fallback: boolean): boolean => {
    const value = store.get(key);
    return value === null ? fallback : value === "true";
  };
  const days = parseSwiftInt(store.get(HANDOFF_SETTING_KEYS.retentionDays));
  return {
    retentionDays: days !== null && days >= RETENTION_DAYS.min && days <= RETENTION_DAYS.max ? days : DEFAULT_HANDOFF_SETTINGS.retentionDays,
    requireMacClick: flag(HANDOFF_SETTING_KEYS.requireMacClick, DEFAULT_HANDOFF_SETTINGS.requireMacClick),
    allowQr: flag(HANDOFF_SETTING_KEYS.allowQr, DEFAULT_HANDOFF_SETTINGS.allowQr),
    allowMacApproval: flag(HANDOFF_SETTING_KEYS.allowMacApproval, DEFAULT_HANDOFF_SETTINGS.allowMacApproval),
  };
}

/** Writes every key, as `HandoffSettings.save` (booleans as `true` or `false`). */
export function saveHandoffSettings(store: SettingsWriter, settings: HandoffSettings): void {
  store.set(HANDOFF_SETTING_KEYS.retentionDays, String(settings.retentionDays));
  store.set(HANDOFF_SETTING_KEYS.requireMacClick, String(settings.requireMacClick));
  store.set(HANDOFF_SETTING_KEYS.allowQr, String(settings.allowQr));
  store.set(HANDOFF_SETTING_KEYS.allowMacApproval, String(settings.allowMacApproval));
}

/** The handoff policy these settings give: acoustic always, fallbacks by toggle. */
export function handoffSettingsPolicy(settings: HandoffSettings): MacHandoffPolicy {
  return handoffPolicyFromSettings(settings);
}

/** Swift `Int(String)`: optional sign and ASCII digits only. */
function parseSwiftInt(value: string | null): number | null {
  if (value === null || !/^[+-]?[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
