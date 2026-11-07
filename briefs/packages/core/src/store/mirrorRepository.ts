import { integer, optionalText, text, type SqlValue } from "./database.js";
import type { StoreContext } from "./storeContext.js";
import { MIRROR_KINDS, type MirrorEntity, type MirrorKind } from "./types.js";

/** Local full-text mirror of firm entities (FTS5, diacritics removed) for offline candidate search. */
export class MirrorRepository {
  constructor(private readonly ctx: StoreContext) {}

  /** Replaces every mirrored entity from one source (for example a full Clio sync). */
  replace(source: string, entities: readonly MirrorEntity[]): void {
    const { db } = this.ctx;
    db.write(() => {
      db.run("DELETE FROM entity_mirror WHERE source = ?", source);
      for (const entity of entities) {
        if (entity.source !== source) continue;
        db.run("INSERT INTO entity_mirror (source, external_id, kind, name, email, display_number, client_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
          entity.source, entity.externalID, entity.kind, entity.name, entity.email ?? null, entity.displayNumber ?? null, entity.clientName ?? null);
      }
    });
  }

  /** How many entities one source has mirrored. */
  count(source: string): number {
    const row = this.ctx.db.get("SELECT COUNT(*) AS count FROM entity_mirror WHERE source = ?", source);
    return row === undefined ? 0 : integer(row, "count");
  }

  /** Prefix search: each word becomes `"word"*`, joined with OR, ranked by bm25. Scoring is the resolver's job. */
  search(query: string, kind?: MirrorKind, limit = 25): MirrorEntity[] {
    const tokens = query.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((token) => token.length > 0).map((token) => `"${token}"*`);
    if (tokens.length === 0) return [];
    let sql = "SELECT * FROM entity_mirror WHERE entity_mirror MATCH ?";
    const params: SqlValue[] = [tokens.join(" OR ")];
    if (kind !== undefined) {
      sql += " AND kind = ?";
      params.push(kind);
    }
    sql += " ORDER BY bm25(entity_mirror) LIMIT ?";
    params.push(limit);
    return this.ctx.db.all(sql, ...params).map((row) => {
      const rowKind = text(row, "kind");
      return {
        source: text(row, "source"),
        externalID: text(row, "external_id"),
        kind: (MIRROR_KINDS as readonly string[]).includes(rowKind) ? (rowKind as MirrorKind) : "contact",
        name: text(row, "name"),
        email: optionalText(row, "email") ?? undefined,
        displayNumber: optionalText(row, "display_number") ?? undefined,
        clientName: optionalText(row, "client_name") ?? undefined,
      };
    });
  }
}
