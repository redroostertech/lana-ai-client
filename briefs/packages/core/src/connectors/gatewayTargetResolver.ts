import type { EntityHint, EntityKind } from "../intent/entityHint.js";
import type { Candidate, CandidateSource } from "../executors/resolver/candidate.js";
import { EntityResolver } from "../executors/resolver/entityResolver.js";
import type { Resolution } from "../executors/resolver/resolution.js";
import type { MirrorCandidateSource } from "./mirrorCandidateSource.js";

/** Foundation `.whitespacesAndNewlines` at the edges. */
const EDGES = /^[\p{Zs}\t\n\v\f\r\u{85}\u{200B}\u{2028}\u{2029}]+|[\p{Zs}\t\n\v\f\r\u{85}\u{200B}\u{2028}\u{2029}]+$/gu;

/**
 * Production resolver (Swift `GatewayTargetResolver`): the local mirror first, then live
 * Clio when connected, scored by `EntityResolver` with its default thresholds. A match
 * needs a confident, unique winner; everything else is offered to the person. Never
 * auto-merges.
 *
 * One deliberate difference from the Mac: the mirror cannot tell a person from a company,
 * so the same Clio contact came back twice (as a person from the mirror, as a company from
 * live search), always tying with itself and never resolving. Here a live record replaces
 * its mirrored copy before ranking; records with different ids are never combined.
 */
export class GatewayTargetResolver {
  constructor(private readonly mirror: MirrorCandidateSource, private readonly liveSources: () => Promise<CandidateSource[]>) {}

  async resolve(hint: EntityHint): Promise<Resolution> {
    const merged = new Map<string, Candidate>();
    for (const candidate of await this.mirror.search(hint)) merged.set(recordKey(candidate), candidate);
    for (const source of await this.liveSources()) {
      for (const candidate of await source.search(hint)) merged.set(recordKey(candidate), candidate);
    }
    return new EntityResolver([]).rank(hint, [...merged.values()]);
  }

  /** Free text search the person uses to choose a record explicitly. Live search is best effort. */
  async search(text: string, kind: EntityKind): Promise<Candidate[]> {
    const trimmed = text.replace(EDGES, "");
    if (trimmed.length === 0) return [];
    const results = await this.mirror.searchText(trimmed, kind);
    const hint: EntityHint = { kind, name: trimmed, email: trimmed.includes("@") ? trimmed : undefined };
    for (const source of await this.liveSources()) {
      let live: Candidate[];
      try {
        live = await source.search(hint);
      } catch {
        live = [];
      }
      results.push(...live.filter((candidate) => !results.some((existing) => recordKey(existing) === recordKey(candidate))));
    }
    return results;
  }
}

/** One firm record: matters and contacts are separate id spaces; person and company are both contacts. */
function recordKey(candidate: Candidate): string {
  return `${candidate.kind === "matter" ? "matter" : "contact"}:${candidate.id}`;
}
