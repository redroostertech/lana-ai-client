import { LANA_ERROR_MESSAGES, LanaError, MATTER_SEARCH_MIN_LENGTH, matterHitOf, type LanaClient } from "@lana/core/lana";
import type { MatterHit, MattersApi, Result } from "../../shared/api.js";
import type { MainLog } from "../log.js";

/** Longest query sent to LANA. */
const MAX_QUERY = 200;

export interface MattersServiceDependencies {
  /** The LANA client over the signed-in session. */
  readonly client: () => Pick<LanaClient, "searchMatters">;
  readonly isSignedIn: () => boolean;
  readonly log: MainLog;
}

/**
 * Matter search for the matter picker, on the firm's LANA server with the person's own
 * session, so LANA's matter access rules decide what is found. Fewer than 2 characters
 * finds nothing without calling LANA. Logs carry counts and codes, never the query.
 */
export class MattersService implements MattersApi {
  constructor(private readonly deps: MattersServiceDependencies) {}

  async search(query: string): Promise<Result<MatterHit[]>> {
    const text = [...String(query ?? "").trim()].slice(0, MAX_QUERY).join("");
    if ([...text].length < MATTER_SEARCH_MIN_LENGTH) return { ok: true, value: [] };
    if (!this.deps.isSignedIn()) return { ok: false, error: { code: "signedOut", message: LANA_ERROR_MESSAGES.signedOut } };
    try {
      const hits = (await this.deps.client().searchMatters(text)).map((matter) => ({ ...matterHitOf(matter) }));
      this.deps.log.info("matters.searched", { results: hits.length });
      return { ok: true, value: hits };
    } catch (error) {
      if (error instanceof LanaError) {
        this.deps.log.notice("matters.search_failed", { code: error.kind });
        return { ok: false, error: { code: error.kind, message: error.message } };
      }
      this.deps.log.notice("matters.search_failed", { code: "unknown" });
      return { ok: false, error: { code: "unknown", message: "Matter search is not available right now." } };
    }
  }
}
