import type { EntityHint, EntityKind } from "../intent/entityHint.js";
import type { Candidate, CandidateSource } from "../executors/resolver/candidate.js";
import type { MirrorEntity, MirrorKind } from "../store/types.js";

/** The mirror reads the hub needs (`MirrorRepository` satisfies it). */
export interface MirrorSearching {
  search(query: string, kind?: MirrorKind, limit?: number): MirrorEntity[];
}

const DEFAULT_LIMIT = 25;

/**
 * Resolver candidates from the gateway's local, offline mirror of firm records (Swift
 * `MirrorCandidateSource`). The mirror keeps the external ids, so a candidate from here and
 * the same record from live Clio search collapse into one in the resolver.
 */
export class MirrorCandidateSource implements CandidateSource {
  readonly name = "mirror";

  constructor(private readonly mirror: MirrorSearching, private readonly limit: number = DEFAULT_LIMIT) {}

  async search(hint: EntityHint): Promise<Candidate[]> {
    if (hint.kind === "matter") return this.mirror.search(hint.name, "matter", this.limit).map((entity) => MirrorCandidateSource.candidate(entity, hint));
    const found = this.mirror.search(hint.name, "contact", this.limit);
    if (hint.email !== undefined && hint.email.length > 0) {
      const byEmail = this.mirror.search(hint.email, "contact", this.limit);
      found.push(...byEmail.filter((entity) => !found.some((existing) => existing.externalID === entity.externalID)));
    }
    return found.map((entity) => MirrorCandidateSource.candidate(entity, hint));
  }

  /** Free text search for the "choose explicitly" box on an action card. */
  searchText(text: string, kind: EntityKind): Promise<Candidate[]> {
    return this.search({ kind, name: text, email: text.includes("@") ? text : undefined });
  }

  /**
   * The mirror does not record person versus company, so the hint decides, which keeps
   * the resolver's kind penalty neutral for mirrored contacts.
   */
  static candidate(entity: MirrorEntity, hint: EntityHint): Candidate {
    return {
      id: entity.externalID,
      kind: entity.kind === "matter" ? "matter" : hint.kind === "company" ? "company" : "person",
      name: entity.name,
      email: entity.email,
      displayNumber: entity.displayNumber,
      clientName: entity.clientName,
      source: entity.source,
    };
  }
}
