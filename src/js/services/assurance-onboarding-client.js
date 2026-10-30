/* Application-owned onboarding contracts; this module only transports and recovers exact commands. */
(function (global) {
  'use strict';
  var definitions = {
    createAsset: { path: '/assets', asset: true }, updateAsset: { path: '/assets', asset: true, update: true },
    savePlan: { path: '/plans' }, saveTarget: { path: '/targets' },
    recordObservation: { path: '/observations' }, reviewObservation: { path: '/observations/review' },
    decide: { path: '/decisions' }, prepareCloseout: { path: '/closeouts' },
    acceptCloseout: { path: '/closeouts/accept' }, publishProtocol: { path: '/protocols', global: true }
  };
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function normalizePending(value) {
    if (!value) return null;
    // Recover a decision submitted before the onboarding command mailbox existed.
    if (value.requestId && value.targetId && value.expectedBinding && value.decision && typeof value.rationale === 'string') {
      return { schemaVersion: 1, operation: 'decide', payload: clone(value) };
    }
    if (value.schemaVersion !== 1 || !definitions[value.operation] || !value.payload || typeof value.payload.requestId !== 'string') {
      throw new Error('The saved command is incomplete. Recovery must be restored before submitting another change.');
    }
    return clone(value);
  }
  function createCommandSession(api, matterId, store, makeId) {
    var base = '/api/v1/implementation-assurance';
    var pending = null;
    var recoveryError = null;
    var busy = false;
    var id = makeId || function () { return global.crypto.randomUUID(); };
    try { pending = normalizePending(store && store.read()); } catch (error) { recoveryError = error.message; }
    function clear() {
      // A key retained by a failing storage adapter remains a safe exact replay.
      if (store) { try { store.clear(); } catch (error) { /* keep server receipt recoverable */ } }
      pending = null;
    }
    async function dispatch() {
      if (busy) throw new Error('A request is already in progress.');
      if (recoveryError) throw new Error(recoveryError);
      if (!store) throw new Error('Scoped recovery is unavailable. Changes are read-only.');
      if (!pending) throw new Error('There is no pending command to recover.');
      store.write(pending);
      var sent = clone(pending);
      var definition = definitions[sent.operation];
      var path = base + (definition.global ? '' : '/matters/' + encodeURIComponent(matterId)) + definition.path + (definition.update ? '/' + encodeURIComponent(sent.payload.assetId) : '');
      var body = clone(sent.payload);
      if (definition.asset) { body.request_id = body.requestId; delete body.requestId; delete body.assetId; }
      busy = true;
      try {
        var response = await api.request(definition.update ? 'PATCH' : 'POST', path, body);
        if (definition.asset && response) {
          var asset = definition.update ? response : response.asset;
          if (!asset || !asset.id || (definition.update && asset.id !== sent.payload.assetId)) throw new Error('The server did not confirm the requested asset. Recover the saved request.');
          response = Object.assign({}, response, { record: asset, reference: { id: asset.id, revision: asset.revision } });
        }
        var receipt = response && response.command;
        if (!receipt || receipt.requestId !== sent.payload.requestId || receipt.operation !== sent.operation || !receipt.sha256 || !response.record || !response.reference) {
          throw new Error('The server did not confirm this exact command. Recover the saved request before continuing.');
        }
        if (sent.operation === 'decide' && (response.record.subject_id !== sent.payload.targetId || response.record.payload_sha256 !== sent.payload.expectedBinding || response.record.decision !== sent.payload.decision)) {
          throw new Error('The server did not confirm the bound decision. Recover the saved request before continuing.');
        }
        if (sent.operation === 'acceptCloseout' && (response.record.subject_id !== sent.payload.closeoutId || response.record.payload_sha256 !== sent.payload.expectedBinding || response.record.decision !== 'accept_closeout')) {
          throw new Error('The server did not confirm the bound closeout acceptance. Recover the saved request before continuing.');
        }
        clear();
        return response;
      } catch (error) {
        if ([400, 409, 422].includes(error.status)) clear();
        throw error;
      } finally { busy = false; }
    }
    return {
      execute: function (operation, payload) {
        if (busy) return Promise.reject(new Error('A request is already in progress.'));
        if (recoveryError) return Promise.reject(new Error(recoveryError));
        if (pending) return Promise.reject(new Error('Recover the pending command before submitting another change.'));
        if (!definitions[operation]) return Promise.reject(new Error('This operation is not available.'));
        pending = { schemaVersion: 1, operation: operation, payload: Object.assign({}, clone(payload), { requestId: payload.requestId || id() }) };
        return dispatch();
      },
      retry: dispatch,
      pending: function () { return pending && clone(pending); },
      busy: function () { return busy; },
      recoveryError: function () { return recoveryError; },
      canPersist: function () { return Boolean(store) && !recoveryError; }
    };
  }
  function createOnboardingClient(api, matterId) {
    var base = '/api/v1/implementation-assurance/matters/' + encodeURIComponent(matterId);
    function get(path) { return api.request('GET', base + path, null); }
    function query(afterId) { return '?limit=50' + (afterId ? '&afterId=' + encodeURIComponent(afterId) : ''); }
    return {
      status: function () { return get('/onboarding'); },
      lookup: function (kind, afterId) {
        if (!['contacts', 'releases', 'protocols'].includes(kind)) return Promise.reject(new Error('Unknown lookup.'));
        return get('/lookups/' + kind + query(afterId));
      },
      records: function (kind, afterId) {
        if (!['plan', 'target', 'observation', 'assessment', 'closeout'].includes(kind)) return Promise.reject(new Error('Unknown record type.'));
        return get('/records/' + kind + query(afterId));
      },
      closeout: function (id) { return get('/records/closeout/' + encodeURIComponent(id)); },
      downloadCloseout: function (id) { return get('/records/closeout/' + encodeURIComponent(id)); }
    };
  }
  var exported = { createCommandSession: createCommandSession, createOnboardingClient: createOnboardingClient, normalizePending: normalizePending };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else global.AssuranceOnboardingClient = exported;
})(typeof window !== 'undefined' ? window : globalThis);
