/*
 * ActivateFlow - the decisions behind activate.html when the firm has to be
 * found by hand.
 *
 * Chef's "Your LANA account is ready" email carries an app link (the firm comes
 * with it) and, as a fallback, the Organization ID and activation code to type.
 * On a computer that never connected to a firm, the typed Organization ID is
 * the only way to find it, so the page asks for it first.
 *
 * Plain module: no DOM, no network. Discovery, the activate call and saving
 * the firm are passed in, so tests use fakes. A browser global
 * (window.ActivateFlow) and a CommonJS module for Jest.
 */
(function (global) {
  'use strict';

  function hasSavedFirm(savedServer) {
    return Boolean(savedServer && savedServer.url);
  }

  /**
   * Whether the Organization ID field shows when the page opens: only when
   * the app link named no firm and no firm is saved on this computer.
   * @param {{ linkOrg?: string, linkDomain?: string, savedServer?: Object|null }} opts
   */
  function needsOrgField(opts) {
    var o = opts || {};
    if (o.linkOrg || o.linkDomain) return false;
    return !hasSavedFirm(o.savedServer);
  }

  /** The Organization ID as discovery wants it: trimmed and lowercase. */
  function normalizeOrgId(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  /**
   * Find the firm (when an Organization ID was typed), activate, then save the
   * firm that was found so sign in opens on it.
   *
   * input:
   *   orgId        - typed Organization ID, or '' to use the saved firm
   *   savedServer  - the firm saved on this computer, or null
   *   code, password
   * deps:
   *   resolveOrganization(orgId) -> Promise<server>; rejects with a DiscoveryError
   *   activate(server, body)     -> Promise; rejects as AppLinkPageKit.postPublic does
   *   saveServer(server)         -> Promise; only called for a firm found here
   *
   * Resolves to { ok: true, server } or { ok: false, stage: 'discovery' | 'activate', error }.
   * A discovery failure stops before anything is sent to a firm.
   */
  async function submitActivation(input, deps) {
    var orgId = normalizeOrgId(input && input.orgId);
    var server = (input && input.savedServer) || null;
    var found = false;

    if (orgId) {
      try {
        server = await deps.resolveOrganization(orgId);
        found = true;
      } catch (error) {
        return { ok: false, stage: 'discovery', error: error };
      }
    }

    try {
      await deps.activate(server, { activation_code: input.code, password: input.password });
    } catch (error) {
      return { ok: false, stage: 'activate', error: error };
    }

    if (found && deps.saveServer) {
      // The account is active either way; a firm that did not save is typed
      // again on sign in.
      try { await deps.saveServer(server); } catch (_error) { /* sign in asks again */ }
    }
    return { ok: true, server: server };
  }

  var api = {
    needsOrgField: needsOrgField,
    normalizeOrgId: normalizeOrgId,
    submitActivation: submitActivation
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.ActivateFlow = api;
  }
})(typeof window !== 'undefined' ? window : this);
