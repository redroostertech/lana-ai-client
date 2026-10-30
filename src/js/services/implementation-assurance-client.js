/* Thin transport and review interaction state. All conclusions and authority are server-owned. */
(function (root) {
  'use strict';
  function createReviewSession(api, matterId, makeId, store, sharedCommands) {
    var base = '/api/v1/implementation-assurance/matters/' + encodeURIComponent(matterId);
    var commandApi = typeof module !== 'undefined' && module.exports ? require('./assurance-onboarding-client') : globalThis.AssuranceOnboardingClient;
    var commands = sharedCommands || commandApi.createCommandSession(api, matterId, store, makeId);
    var current = null;
    var assessing = false;
    function request(method, path, body) { return api.request(method, base + path, body); }
    function assertIdle() { if (assessing || commands.busy()) throw new Error('A request is already in progress.'); }
    return {
      load: function (assetCursor, targetCursor, include) {
        assertIdle();
        if (commands.pending()) return Promise.reject(new Error('Recover the pending command before refreshing.'));
        current = null;
        include = include || { assets: true, targets: true };
        return Promise.all([
          include.assets ? request('GET', '/assets?limit=50' + (assetCursor ? '&after_id=' + encodeURIComponent(assetCursor) : ''), null) : Promise.resolve({ assets: [], next_cursor: null }),
          include.targets ? request('GET', '/records/target?limit=50' + (targetCursor ? '&afterId=' + encodeURIComponent(targetCursor) : ''), null) : Promise.resolve({ items: [], nextCursor: null })
        ]).then(function (pages) { return { assets: pages[0], targets: pages[1] }; });
      },
      assess: async function (targetId) {
        assertIdle();
        if (commands.pending()) throw new Error('Recover the pending command before assessing another target.');
        current = null; assessing = true;
        try {
          var response = await request('POST', '/assessments', { targetId: targetId });
          var evaluation = response && response.record && response.record.evaluation;
          if (!evaluation || !evaluation.binding || !evaluation.target || evaluation.target.id !== targetId) throw new Error('The server did not return an assessment for this target.');
          current = response; return response;
        } finally { assessing = false; }
      },
      decide: async function (decision, rationale) {
        assertIdle();
        if (commands.recoveryError()) throw new Error(commands.recoveryError());
        if (!commands.canPersist()) throw new Error('Scoped decision recovery is unavailable. Review is read-only.');
        var saved = commands.pending();
        if (saved && saved.operation !== 'decide') throw new Error('Recover the pending command before recording a decision.');
        var pending = saved && saved.payload;
        if (!current && !pending) throw new Error('Assess this target before recording a decision.');
        if (!String(rationale || '').trim()) throw new Error('Explain the basis for your decision.');
        if (pending && (pending.decision !== decision || pending.rationale !== rationale.trim())) throw new Error('Recover the pending decision before changing it.');
        var command = pending || { targetId: current.record.evaluation.target.id, expectedBinding: current.record.evaluation.binding, decision: decision, rationale: rationale.trim() };
        try {
          var response = pending ? await commands.retry() : await commands.execute('decide', command);
          current = null; return response;
        } catch (error) {
          if (!commands.pending()) current = null;
          throw error;
        }
      },
      recoveryError: commands.recoveryError,
      canPersist: commands.canPersist,
      assessment: function () { return current; },
      invalidateAssessment: function () { current = null; },
      pendingDecision: function () { var pending = commands.pending(); return pending && pending.operation === 'decide' ? pending.payload : null; },
      busy: function () { return assessing || commands.busy(); }
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
