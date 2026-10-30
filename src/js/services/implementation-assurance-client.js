/* Thin transport and review interaction state. All conclusions and authority are server-owned. */
(function (root) {
  'use strict';
  function createReviewSession(api, matterId, makeId, store) {
    var base = '/api/v1/implementation-assurance/matters/' + encodeURIComponent(matterId);
    var current = null;
    var pending = null;
    var busy = false;
    var recoveryError = null;
    try {
      pending = store ? store.read() : null;
      if (pending && (!pending.targetId || !pending.expectedBinding || !pending.requestId || !pending.decision || typeof pending.rationale !== 'string')) throw new Error('Invalid pending decision');
    } catch (error) { recoveryError = 'Saved decision recovery is unavailable. Do not submit another decision until recovery is restored.'; }
    function clearPending() {
      if (store) { try { store.clear(); } catch (error) { /* A retained key safely replays the already confirmed request. */ } }
      pending = null;
    }
    var id = makeId || function () { return root.crypto.randomUUID(); };
    function request(method, path, body) { return api.request(method, base + path, body); }
    function assertIdle() { if (busy) throw new Error('A request is already in progress.'); }
    return {
      load: function (assetCursor, targetCursor, include) {
        assertIdle();
        if (pending) return Promise.reject(new Error('Recover the pending decision before refreshing.'));
        current = null;
        include = include || { assets: true, targets: true };
        return Promise.all([
          include.assets ? request('GET', '/assets?limit=50' + (assetCursor ? '&after_id=' + encodeURIComponent(assetCursor) : ''), null) : Promise.resolve({ assets: [], next_cursor: null }),
          include.targets ? request('GET', '/records/target?limit=50' + (targetCursor ? '&afterId=' + encodeURIComponent(targetCursor) : ''), null) : Promise.resolve({ items: [], nextCursor: null })
        ]).then(function (pages) { return { assets: pages[0], targets: pages[1] }; });
      },
      assess: async function (targetId) {
        assertIdle();
        if (pending) throw new Error('Recover the pending decision before assessing another target.');
        current = null;
        busy = true;
        try {
          var response = await request('POST', '/assessments', { targetId: targetId });
          var evaluation = response && response.record && response.record.evaluation;
          if (!evaluation || !evaluation.binding || !evaluation.target || evaluation.target.id !== targetId) {
            throw new Error('The server did not return an assessment for this target.');
          }
          current = response;
          return response;
        } finally { busy = false; }
      },
      decide: async function (decision, rationale) {
        assertIdle();
        if (recoveryError) throw new Error(recoveryError);
        if (!store) throw new Error('Scoped decision recovery is unavailable. Review is read-only.');
        if (!current && !pending) throw new Error('Assess this target before recording a decision.');
        if (!String(rationale || '').trim()) throw new Error('Explain the basis for your decision.');
        if (pending && (pending.decision !== decision || pending.rationale !== rationale.trim())) {
          throw new Error('Recover the pending decision before changing it.');
        }
        pending = pending || { targetId: current.record.evaluation.target.id,
          expectedBinding: current.record.evaluation.binding, requestId: id(), decision: decision, rationale: rationale.trim() };
        store.write(pending); // Persist the exact request before dispatch, never after it.
        busy = true;
        try {
          var result = await request('POST', '/decisions', pending);
          if (!result || !result.record || result.record.decision !== pending.decision || result.record.subject_id !== pending.targetId || result.record.payload_sha256 !== pending.expectedBinding) {
            throw new Error('The server did not confirm the decision. Retry the same request to recover its result.');
          }
          clearPending();
          current = null;
          return result;
        } catch (error) {
          // Only definitive validation/conflict responses clear this submission.
          // Authentication loss, timeouts and server errors preserve recovery identity.
          if ([400, 409, 422].includes(error.status)) {
            clearPending();
            current = null;
          }
          throw error;
        } finally { busy = false; }
      },
      recoveryError: function () { return recoveryError; },
      canPersist: function () { return Boolean(store) && !recoveryError; },
      assessment: function () { return current; },
      pendingDecision: function () { return pending && Object.assign({}, pending); },
      busy: function () { return busy; }
    };
  }
  function scopedDecisionStore(storage, server, user, matterId) {
    var organizationId = user && (user.organizationId || user.organization_id);
    if (!storage || !server || !user || !user.id || !organizationId || !matterId) return null;
    var key = 'lana:assurance:pending:' + [server, organizationId, user.id, matterId].map(encodeURIComponent).join(':');
    return { read: function () { var text = storage.getItem(key); return text ? JSON.parse(text) : null; },
      write: function (value) { storage.setItem(key, JSON.stringify(value)); }, clear: function () { storage.removeItem(key); } };
  }
  function errorMessage(error) {
    if (error.status === 404 || error.status === 503) return 'Implementation assurance is not available on this server. Ask an administrator to check availability.';
    if (error.status === 409) return 'The reviewed records changed. Assess the target again and review the updated evidence before deciding.';
    if (error.status === 401) return 'Sign in again to recover this decision with the same account.';
    if (error.status === 403) return 'You do not have access to this review action. An authorized professional must record the decision.';
    return error.message || 'The request could not be completed.';
  }
  var exported = { createReviewSession: createReviewSession, scopedDecisionStore: scopedDecisionStore, errorMessage: errorMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.ImplementationAssuranceClient = exported;
})(typeof window !== 'undefined' ? window : globalThis);
