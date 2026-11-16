import { describe, expect, it } from "vitest";
import { canonicalString } from "../../src/json/canonical.js";
import { decodeAccountInfo, encodeAccountInfo, issueAccountInfoUpdate, openAccountInfoUpdate } from "../../src/handoff/index.js";
import { loadVocabulary, normalizeVocabulary, saveVocabulary, seedVocabulary, VOCABULARY_SETTING_KEYS } from "../../src/gateway/vocabularySettings.js";
import { goldenIdentities } from "../support/goldenIdentities.js";

class MemorySettings {
  readonly values = new Map<string, string>();
  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("the firm's word list setting", () => {
  it("normalizes: trims, drops blanks and repeats (case-insensitive), caps sizes, keeps order", () => {
    expect(normalizeVocabulary([
      { term: "  Leadli " , alsoHeardAs: [" lead lease ", "", "Lead lease", "leely"] },
      { term: "leadli" },
      { term: "" },
      { term: "Actionstep", alsoHeardAs: [] },
      { term: "x".repeat(200) },
    ])).toEqual([
      { term: "Leadli", alsoHeardAs: ["lead lease", "leely"] },
      { term: "Actionstep" },
      { term: "x".repeat(60) },
    ]);
  });

  it("saves and loads, reading nothing stored or unreadable as empty", () => {
    const settings = new MemorySettings();
    expect(loadVocabulary(settings)).toEqual([]);
    saveVocabulary(settings, [{ term: "Leadli", alsoHeardAs: ["leely"] }]);
    expect(settings.get(VOCABULARY_SETTING_KEYS.list)).toBe('[{"also_heard_as":["leely"],"term":"Leadli"}]');
    expect(loadVocabulary(settings)).toEqual([{ term: "Leadli", alsoHeardAs: ["leely"] }]);
    settings.set(VOCABULARY_SETTING_KEYS.list, "not json");
    expect(loadVocabulary(settings)).toEqual([]);
  });

  it("seeds once from connector names, adding only names not already listed", () => {
    const settings = new MemorySettings();
    saveVocabulary(settings, [{ term: "Actionstep" }]);
    expect(seedVocabulary(settings, ["Leadli", "actionstep", "  "])).toBe(true);
    expect(loadVocabulary(settings)).toEqual([{ term: "Actionstep" }, { term: "Leadli" }]);
    expect(seedVocabulary(settings, ["Clio"])).toBe(false);
    expect(loadVocabulary(settings)).toEqual([{ term: "Actionstep" }, { term: "Leadli" }]);
  });
});

describe("the word list rides in the account info the computer sends the phone", () => {
  it("is an optional vocabulary array in the sealed body, absent when empty", async () => {
    const plain = { name: "Dana Reyes", email: "dana@example.com", organization: "Reyes Law", serverHost: "" };
    expect(canonicalString(encodeAccountInfo(plain))).toBe('{"email":"dana@example.com","name":"Dana Reyes","organization":"Reyes Law","server_host":""}');
    const account = { ...plain, vocabulary: [{ term: "Leadli", alsoHeardAs: ["leely"] }, { term: "Actionstep" }] };
    expect(canonicalString(encodeAccountInfo(account))).toBe('{"email":"dana@example.com","name":"Dana Reyes","organization":"Reyes Law","server_host":"","vocabulary":[{"also_heard_as":["leely"],"term":"Leadli"},{"term":"Actionstep"}]}');
    expect(decodeAccountInfo(encodeAccountInfo(account))).toEqual(account);
    expect(decodeAccountInfo(encodeAccountInfo(plain)).vocabulary).toBeUndefined();
    const { mac, phone } = goldenIdentities();
    const update = await issueAccountInfoUpdate({ account, phone: phone.publicKeys, mac, at: new Date("2026-11-15T10:00:00Z") });
    expect(await openAccountInfoUpdate(update, phone, mac.publicKeys)).toEqual(account);
  });
});
