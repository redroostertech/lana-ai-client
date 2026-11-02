/**
 * Background jobs on this computer, for the renderer (local-ai-engine plan,
 * phase 8d). Pure mapping from what the main process reports (the engine's
 * running and recent jobs plus the organization's server's attempt history)
 * to what Settings shows. The server decides where every run goes; this only
 * says it in plain words.
 *
 * Loaded as a classic script (window.LanaEngineBackgroundJobs) and under Jest (module.exports).
 */
(function (global) {
  'use strict';

  if (global.LanaEngineBackgroundJobs) {
    if (typeof module !== 'undefined' && module.exports) module.exports = global.LanaEngineBackgroundJobs;
    return;
  }

  var MOVED_TO_CLOUD = 'This run moved to the cloud';

  var KIND_LABELS = {
    document_embedding: 'Document indexing',
    agent_run: 'Agent run',
    automation_execution: 'Automation',
    scheduled_agentic: 'Scheduled task'
  };

  var DECLINE_REASONS = {
    embedding_model_mismatch: 'this computer has a different indexing model',
    engine_busy: 'this computer was already running a job',
    about_to_sleep: 'this computer was going to sleep',
    opted_out: 'background jobs are off on this computer',
    offline: 'this computer was offline',
    kind_not_supported: 'this computer cannot run this kind of job',
    not_signed_in: 'nobody was signed in'
  };

  var MAX_ROWS = 8;

  function kindLabel(kind) {
    return KIND_LABELS[kind] || 'Background job';
  }

  /** One history entry from the server, seen from this computer. */
  function historyRow(job, engineId, recentByJob) {
    var local = recentByJob[job.job_id] || null;
    var here = Boolean(job.engine_id && engineId && job.engine_id === engineId);
    if (job.moved_to_cloud || (local && (local.outcome === 'handed_off' || local.outcome === 'moved_to_cloud'))) {
      var there = job.where === 'ended' ? (job.status === 'completed' ? 'and finished there' : 'and ended there') : 'and is still running there';
      return { id: job.job_id, title: kindLabel(job.kind), detail: MOVED_TO_CLOUD + ' ' + there + '.', badge: 'Moved to the cloud', tone: 'blue', movedToCloud: true };
    }
    if (job.where === 'computer') {
      return here
        ? { id: job.job_id, title: kindLabel(job.kind), detail: 'Running on this computer.', badge: 'Running here', tone: 'green', movedToCloud: false }
        : { id: job.job_id, title: kindLabel(job.kind), detail: 'Running on your other computer.', badge: 'Running', tone: 'green', movedToCloud: false };
    }
    if (job.where === 'cloud') {
      return { id: job.job_id, title: kindLabel(job.kind), detail: 'Running in your organization\'s cloud.', badge: 'In the cloud', tone: 'blue', movedToCloud: false };
    }
    if (job.where === 'waiting') {
      return { id: job.job_id, title: kindLabel(job.kind), detail: 'Waiting to start.', badge: 'Waiting', tone: 'gray', movedToCloud: false };
    }
    var finished = job.status === 'completed';
    var where = here ? 'on this computer' : (job.engine_id ? 'on your other computer' : 'in your organization\'s cloud');
    var declined = local && local.outcome === 'declined' && DECLINE_REASONS[local.reason]
      ? ' It went to the cloud because ' + DECLINE_REASONS[local.reason] + '.'
      : '';
    return {
      id: job.job_id,
      title: kindLabel(job.kind),
      detail: (finished ? 'Finished ' : (job.status === 'cancelled' ? 'Cancelled ' : 'Did not finish ')) + where + '.' + declined,
      badge: finished ? 'Done' : (job.status === 'cancelled' ? 'Cancelled' : 'Failed'),
      tone: finished ? 'green' : (job.status === 'cancelled' ? 'gray' : 'red'),
      movedToCloud: false
    };
  }

  /**
   * @param {Object|null} data - the engine's background-jobs answer, or null when it could not be read
   * @param {Object} [status] - the engine status (backgroundJobs: { enabled })
   * @returns {{ state: string, summary: string, tone: string, rows: Array, empty: string|null }}
   */
  function jobsView(data, status) {
    var enabled = Boolean(status && status.backgroundJobs && status.backgroundJobs.enabled);
    if (!status || !status.inUse) {
      return { state: 'off', summary: 'Off', tone: 'gray', rows: [], empty: 'Background jobs run in your organization\'s cloud while the local AI service is off.' };
    }
    if (!data) {
      return { state: 'unavailable', summary: 'Not available', tone: 'gray', rows: [], empty: 'LANA could not read the background jobs of this computer right now.' };
    }
    var recentByJob = {};
    (data.recent || []).forEach(function (entry) { if (!recentByJob[entry.job_id]) recentByJob[entry.job_id] = entry; });
    var running = data.running || [];
    var rows = running.map(function (job) {
      return { id: job.job_id, title: kindLabel(job.kind), detail: 'Running on this computer.', badge: 'Running here', tone: 'green', movedToCloud: false };
    });
    var seen = {};
    rows.forEach(function (row) { seen[row.id] = true; });
    (data.history || []).forEach(function (job) {
      if (seen[job.job_id]) return;
      seen[job.job_id] = true;
      rows.push(historyRow(job, data.engine_id, recentByJob));
    });
    rows = rows.slice(0, MAX_ROWS);
    var summary;
    var tone;
    var state;
    if (running.length > 0) {
      state = 'running'; summary = running.length === 1 ? '1 running here' : running.length + ' running here'; tone = 'green';
    } else if (!enabled) {
      state = 'disabled'; summary = 'Off on this computer'; tone = 'gray';
    } else {
      state = 'idle'; summary = 'Ready'; tone = 'green';
    }
    var empty = null;
    if (rows.length === 0) {
      empty = data.history_error
        ? 'Your organization\'s server could not be reached, so recent jobs are not shown.'
        : 'No background jobs yet.';
    }
    return { state: state, summary: summary, tone: tone, rows: rows, empty: empty };
  }

  /** The toggle for "Run my background jobs on this computer when possible". */
  function toggleView(status) {
    var configured = Boolean(status && status.configured);
    var inUse = Boolean(status && status.inUse);
    var checked = Boolean(status && status.backgroundJobs && status.backgroundJobs.enabled);
    return {
      checked: checked,
      disabled: !configured || !inUse,
      note: !inUse ? 'Turn on the local AI service to run background jobs here.' : ''
    };
  }

  var api = { MOVED_TO_CLOUD: MOVED_TO_CLOUD, jobsView: jobsView, toggleView: toggleView, kindLabel: kindLabel };
  global.LanaEngineBackgroundJobs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
