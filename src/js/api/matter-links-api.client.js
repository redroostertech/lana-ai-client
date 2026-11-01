/**
 * Matter Links API Client
 *
 * Transport for typed links between matter records (design 4.2) and the
 * Core link target lookup a person picks a link target from. Request shapes
 * and target mapping live in shared/entity-links.js.
 *
 *   GET /api/v1/matters/:matter_id/links/targets?kind=&q=&cursor=&limit=
 *       -> { status, data: { kind, targets, next_cursor, available, reason? } }
 *       kinds matter_asset, contact, document, rulebook_rule; each target's
 *       `target` is exactly the POST /links target, and documents carry their
 *       retained releases (each with its own `target`).
 *
 * Server refusals reject with the api error (status, code) for the caller to word.
 *
 * @requires api.js (global api instance)
 * @requires LanaEntityLinks (shared/entity-links.js)
 */

// The picker searches what is loaded, so it reads a kind's pages up to this many.
const MAX_TARGET_PAGES = 10;

class MatterLinksAPIClient {
  /**
   * @param {Object} apiClient - global api instance
   * @param {Object} matter - { matterId: matter code }
   */
  constructor(apiClient, matter = {}) {
    this.api = apiClient;
    this.matterId = matter.matterId;
    this.reasons = {};
  }

  links() {
    if (typeof window !== 'undefined' && window.LanaEntityLinks) return window.LanaEntityLinks;
    return require('../shared/entity-links.js');
  }

  async send(request) {
    if (request.method === 'GET') return this.api.get(request.path);
    if (request.method === 'DELETE') return this.api.delete(request.path);
    return this.api.post(request.path, request.body);
  }

  /**
   * Link a source record to a target record on this matter.
   * @param {{kind: string, id: string}} source
   * @param {string} kind - target kind
   * @param {Object} target - a candidate's (or release's) server target
   * @returns {Promise<Object>} the server response ({ data: { link } })
   */
  async createLink(source, kind, target) {
    return this.send(this.links().createLinkRequest(this.matterId, source, kind, target));
  }

  /**
   * Remove a link (the server records removed_at and removed_by).
   */
  async removeLink(linkId) {
    return this.send(this.links().removeLinkRequest(this.matterId, linkId));
  }

  /**
   * The link targets of one kind on this matter, as [{ id, label, target,
   * releases? }]. A kind the server does not offer (available false) is
   * empty and its reason is kept for unavailableReason(); a failed lookup is
   * empty too.
   */
  async loadCandidates(kind) {
    const links = this.links();
    const candidates = [];
    let cursor = null;
    delete this.reasons[kind];
    try {
      for (let page = 0; page < MAX_TARGET_PAGES; page++) {
        const found = links.targetsPage(kind, await this.send(links.targetsRequest(this.matterId, kind, cursor)));
        if (!found.available) {
          this.reasons[kind] = found.reason;
          return [];
        }
        candidates.push(...found.candidates);
        cursor = found.nextCursor;
        if (!cursor) break;
      }
    } catch (error) {
      console.warn('[MatterLinks] Could not load ' + kind + ' link targets:', error && error.message);
    }
    return candidates;
  }

  /** Why the server does not offer a kind here, after loadCandidates. */
  unavailableReason(kind) {
    return this.reasons[kind] || '';
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MatterLinksAPIClient;
}

// Make available globally for browser use
if (typeof window !== 'undefined') {
  window.MatterLinksAPIClient = MatterLinksAPIClient;
}
