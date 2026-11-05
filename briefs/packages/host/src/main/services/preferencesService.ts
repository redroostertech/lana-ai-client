import { LEASE_HOUR_CHOICES, loadBackgroundUpdates, loadHandoffSettings, RETENTION_DAYS, saveBackgroundUpdates, saveHandoffSettings } from "@lana/core/gateway";
import type { GatewayStore, SettingsRepository } from "@lana/core/store";
import type { GatewayStatus, ListenerStatus, PlatformInfo, Preferences, PreferencesApi, PreferencesUpdate, StatusText, VoiceDownload, VoiceOption } from "../../shared/api.js";
import type { MainLog } from "../log.js";

/** Swift `SettingKey` strings, so a store moved from the Mac app reads the same. */
export const VOICE_SETTING_KEYS = { voice: "voice.option", endWhenInactive: "talk.end_when_inactive" } as const;

const VOICES: readonly VoiceOption[] = ["off", "lana"];

/**
 * The stored voice choice. The Apple (system) voice is gone: a stored "apple" becomes "lana"
 * and is rewritten, "off" stays off, and nothing stored means the LANA voice.
 */
export function readVoice(settings: SettingsRepository): VoiceOption {
  const raw = settings.get(VOICE_SETTING_KEYS.voice);
  if (raw === "off") return "off";
  if (raw !== null && raw !== "lana") settings.set(VOICE_SETTING_KEYS.voice, "lana");
  return "lana";
}
const DAY_MS = 86_400_000;

export interface PreferencesServiceOptions {
  readonly store: GatewayStore;
  readonly platform: PlatformInfo;
  readonly gatewayStatus: () => Promise<GatewayStatus>;
  readonly pairedPhones: () => Promise<number>;
  /** The BLE wake line under Receiving. */
  readonly bluetooth?: () => StatusText;
  readonly emit: (preferences: Preferences) => void;
  readonly log: MainLog;
  /** The LANA voice download. */
  readonly voice: VoicePort;
  /** Settings cleared the saved Ask conversations. */
  readonly onAskHistoryCleared?: () => void;
}

export interface VoicePort {
  download(): VoiceDownload;
  sizeText(): string;
  start(): void;
  remove(): Promise<void>;
}

/**
 * Settings that live in the store (Swift `SettingsViewModel`): the handoff policy toggles
 * (the gateway reads them at every connection), audio retention (with the daily purge),
 * Ask history and the voice choice.
 */
export class PreferencesService implements PreferencesApi {
  private purgeTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: PreferencesServiceOptions) {}

  /** Audio retention runs now and then daily (Swift `RecurringScheduler.retentionJob`). */
  startRetention(): void {
    this.stopRetention();
    this.purge();
    this.purgeTimer = setInterval(() => this.purge(), DAY_MS);
    this.purgeTimer.unref();
  }

  stopRetention(): void {
    if (this.purgeTimer !== null) clearInterval(this.purgeTimer);
    this.purgeTimer = null;
  }

  async get(): Promise<Preferences> {
    const { store, platform } = this.options;
    const status = await this.options.gatewayStatus();
    const handoff = loadHandoffSettings(store.settings);
    const option = readVoice(store.settings);
    const phones = await this.options.pairedPhones();
    return {
      listener: listenerText(status.listener),
      bluetooth: this.options.bluetooth?.() ?? { text: phones > 0 ? "Not available on this computer" : "On", tone: "neutral" },
      listenerError: status.listener.kind === "failed" ? status.listener.message : null,
      requireMacClick: handoff.requireMacClick,
      allowQR: handoff.allowQr,
      allowMacApproval: handoff.allowMacApproval,
      backgroundUpdates: { ...loadBackgroundUpdates(store.settings), leaseHourChoices: [...LEASE_HOUR_CHOICES] },
      retentionDays: handoff.retentionDays,
      retentionRange: { min: RETENTION_DAYS.min, max: RETENTION_DAYS.max },
      askThreadCount: store.ask.list().length,
      voice: {
        option,
        endTalkWhenInactive: store.settings.get(VOICE_SETTING_KEYS.endWhenInactive) === "true",
        download: this.options.voice.download(),
        downloadSizeText: this.options.voice.sizeText(),
      },
      pendingOutbox: store.outbox.pendingCount(),
      version: platform.appVersion,
    };
  }

  async setHandoff(patch: { requireMacClick?: boolean; allowQR?: boolean; allowMacApproval?: boolean }): Promise<PreferencesUpdate> {
    const settings = this.options.store.settings;
    const current = loadHandoffSettings(settings);
    const next = {
      ...current,
      ...(typeof patch.requireMacClick === "boolean" ? { requireMacClick: patch.requireMacClick } : {}),
      ...(typeof patch.allowQR === "boolean" ? { allowQr: patch.allowQR } : {}),
      ...(typeof patch.allowMacApproval === "boolean" ? { allowMacApproval: patch.allowMacApproval } : {}),
    };
    saveHandoffSettings(settings, next);
    this.options.log.info("settings.handoff", { require_click: next.requireMacClick, allow_qr: next.allowQr, allow_approval: next.allowMacApproval });
    return this.update(null);
  }

  /**
   * "Let paired phones receive updates in the background". Turning it off revokes every
   * lease at once (audited); a new lease length applies to leases issued from now on.
   */
  async setBackgroundUpdates(patch: { enabled?: boolean; leaseHours?: number }): Promise<PreferencesUpdate> {
    const { store } = this.options;
    const current = loadBackgroundUpdates(store.settings);
    const next = await saveBackgroundUpdates(store.settings, store, {
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
      leaseHours: typeof patch.leaseHours === "number" ? patch.leaseHours : current.leaseHours,
    }, new Date());
    this.options.log.info("settings.background_updates", { enabled: next.enabled, hours: next.leaseHours });
    return this.update(current.enabled && !next.enabled ? "Background updates are off. Paired phones can no longer use their leases." : null);
  }

  async setRetentionDays(days: number): Promise<PreferencesUpdate> {
    const value = Number.isFinite(Number(days)) ? Math.min(Math.max(Math.round(Number(days)), RETENTION_DAYS.min), RETENTION_DAYS.max) : RETENTION_DAYS.default;
    const settings = this.options.store.settings;
    saveHandoffSettings(settings, { ...loadHandoffSettings(settings), retentionDays: value });
    this.options.log.info("settings.retention", { days: value });
    return this.update(null);
  }

  async clearAskHistory(): Promise<PreferencesUpdate> {
    this.options.store.ask.deleteAll();
    this.options.onAskHistoryCleared?.();
    this.options.log.info("settings.ask_history_cleared");
    return this.update("Ask history cleared.");
  }

  async setVoice(option: VoiceOption): Promise<PreferencesUpdate> {
    this.options.store.settings.set(VOICE_SETTING_KEYS.voice, VOICES.includes(option) ? option : "lana");
    return this.update(null);
  }

  async setEndTalkWhenInactive(value: boolean): Promise<PreferencesUpdate> {
    this.options.store.settings.set(VOICE_SETTING_KEYS.endWhenInactive, String(value === true));
    return this.update(null);
  }

  async downloadVoice(): Promise<PreferencesUpdate> {
    this.options.voice.start();
    return this.update(null);
  }

  async removeVoiceDownload(): Promise<PreferencesUpdate> {
    await this.options.voice.remove();
    return this.update(null);
  }

  /** Pushes fresh preferences (for example after the listener changed). */
  async publish(): Promise<void> {
    // Fire and forget from events: a store closing under it must not become an unhandled rejection.
    try {
      this.options.emit(await this.get());
    } catch {
      this.options.log.error("preferences.publish_failed");
    }
  }

  private purge(): void {
    try {
      const days = loadHandoffSettings(this.options.store.settings).retentionDays;
      const parts = this.options.store.meetings.purgeAudio(days);
      if (parts > 0) this.options.log.info("retention.purged", { parts, days });
    } catch {
      this.options.log.error("retention.purge_failed");
    }
  }


  private async update(message: string | null): Promise<PreferencesUpdate> {
    const preferences = await this.get();
    this.options.emit(preferences);
    return { preferences, message };
  }
}

/** The listener status as the Settings line shows it. */
export function listenerText(status: ListenerStatus): StatusText {
  switch (status.kind) {
    case "listening":
      return { text: "Listening for your phone", tone: "good" };
    case "waitingForPairing":
      return { text: "Waiting for a paired phone", tone: "warning" };
    case "starting":
      return { text: "Starting", tone: "warning" };
    case "signedOut":
      return { text: "Signed out", tone: "warning" };
    case "stopped":
      return { text: "Not listening", tone: "warning" };
    case "failed":
      return { text: "Stopped", tone: "warning" };
  }
}
