/**
 * Connector "Sync now" and "Sync all": what to tell the person. Pure, no DOM.
 *
 * The backend queues a sync and answers right away ({ message, job_id,
 * sync_status: 'queued' }); it has no record count yet. A connection that is
 * already syncing answers 409.
 *
 *   startedMessage(result)          toast text for one started sync
 *   isAlreadySyncing(error)         true for the 409 "Sync already in progress"
 *   syncAll(ids, trigger)           starts each in turn and never stops early
 *       -> { started, alreadySyncing, failed: [{ id, message }] }
 *   summaryToast(summary)           { level: 'success'|'info'|'warning', message }
 *
 * window.LanaConnectorSyncQueue (browser) / module.exports (tests).
 */
(function (root) {
  'use strict';

  var node = typeof module !== 'undefined' && module.exports;

  function startedMessage(result) {
    // Demo mode still answers with a count.
    if (result && typeof result.records_synced === 'number') {
      return 'Synced ' + result.records_synced + ' records';
    }
    return 'Sync started. New records show up when it finishes.';
  }

  function isAlreadySyncing(error) {
    return Boolean(error) && error.status === 409;
  }

  async function syncAll(ids, trigger) {
    var summary = { started: 0, alreadySyncing: 0, failed: [] };
    for (var i = 0; i < ids.length; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await trigger(ids[i]);
        summary.started += 1;
      } catch (error) {
        if (isAlreadySyncing(error)) {
          summary.alreadySyncing += 1;
        } else {
          summary.failed.push({ id: ids[i], message: (error && error.message) || 'Unknown error' });
        }
      }
    }
    return summary;
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function summaryToast(summary) {
    var parts = [];
    if (summary.started > 0) {
      parts.push('Started ' + plural(summary.started, 'sync', 'syncs') + '.');
    }
    if (summary.alreadySyncing > 0) {
      var verb = summary.alreadySyncing === 1 ? ' was' : ' were';
      parts.push(summary.started > 0 || summary.failed.length > 0
        ? summary.alreadySyncing + verb + ' already syncing.'
        : 'All ' + summary.alreadySyncing + verb + ' already syncing.');
    }
    if (summary.failed.length > 0) {
      parts.push(summary.failed.length + ' could not start.');
    }
    var level = summary.failed.length > 0 ? 'warning' : (summary.started > 0 ? 'success' : 'info');
    return { level: level, message: parts.join(' ') };
  }

  var api = {
    startedMessage: startedMessage,
    isAlreadySyncing: isAlreadySyncing,
    syncAll: syncAll,
    summaryToast: summaryToast
  };
  if (node) {module.exports = api;}
  else {root.LanaConnectorSyncQueue = api;}
})(typeof window !== 'undefined' ? window : this);
