/**
 * run-detail-requests.js
 * The automation app's run detail reads (app.js builds this once). The run
 * the person asked for is recorded the moment they open it (subject, a
 * LanaLivePoller.requestedSubject), before anything is fetched; a read runs
 * only for the requested run and is applied only if it still is when the
 * answer lands. A linked run (#run/<id>) that cannot be opened is forgotten,
 * the same as every other way the drawer closes.
 *
 * Classic script (window.AutomationRunDetailRequests) so Jest can require it.
 */
(function (global) {
  'use strict';

  /**
   * @param {{ subject: Object|null, fetchDetail: function(string): Promise<Object>,
   *   apply: function(string, Object): void }} options
   */
  function createRunDetailRequests(options) {
    var subject = options.subject || null;

    function requestRun(executionId) {
      if (subject) subject.request(executionId || null);
    }

    function forgetRequestedRun() {
      if (subject) subject.clear();
    }

    function loadRunDetail(executionId) {
      if (!executionId) return Promise.resolve();
      if (subject && !subject.isRequested(executionId)) return Promise.resolve();
      var request = options.fetchDetail(executionId);
      var guarded = subject ? subject.guard(executionId, request) : Promise.resolve(request);
      return guarded.then(function (payload) {
        if (subject && payload === subject.STALE) return;
        options.apply(executionId, payload);
      });
    }

    // Open a run (a click or a button): record it first, then read it.
    function openRunDetail(executionId) {
      if (!executionId) return Promise.resolve();
      requestRun(executionId);
      return loadRunDetail(executionId);
    }

    // A #run/<id> link: read it; when it cannot be opened, forget it.
    function openLinkedRun(executionId) {
      return loadRunDetail(executionId).then(function () {
        return { ok: true };
      }, function () {
        if (subject && subject.isRequested(executionId)) forgetRequestedRun();
        return { ok: false };
      });
    }

    return {
      requestRun: requestRun,
      forgetRequestedRun: forgetRequestedRun,
      loadRunDetail: loadRunDetail,
      openRunDetail: openRunDetail,
      openLinkedRun: openLinkedRun
    };
  }

  var moduleApi = { createRunDetailRequests: createRunDetailRequests };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.AutomationRunDetailRequests = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
