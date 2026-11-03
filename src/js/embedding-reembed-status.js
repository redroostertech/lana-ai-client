/**
 * Search re-indexing progress for organization admins (local AI engine plan,
 * phase 8k, decision E3).
 *
 * The organization's server re-indexes stored passages whose search model is
 * not the current one and answers GET /api/v1/admin/embedding-reembed with
 * the run, documents done of total, the documents left out with the reason
 * and the last problem as a label. This module only turns that answer into
 * what the Settings card shows. Every count and every sentence about why
 * comes from the server.
 *
 * Loaded as a classic script (window.LanaEmbeddingReembed) and under Jest (module.exports).
 */
(function (global) {
  'use strict';

  var STATES = {
    unavailable: { badge: 'Unavailable', tone: 'gray' },
    not_configured: { badge: 'Not set up', tone: 'gray' },
    not_started: { badge: 'Not started', tone: 'gray' },
    running: { badge: 'Re-indexing', tone: 'blue' },
    completed: { badge: 'Up to date', tone: 'green' }
  };

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function count(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }

  function formatWhen(iso, locale) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString(locale || undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function stateOf(data) {
    if (!data.identity) return 'not_configured';
    if (data.run && data.run.status === 'running') return 'running';
    if (data.run && data.run.status === 'completed') return 'completed';
    var docs = data.documents || {};
    return docs.total && count(docs.done) < count(docs.total) ? 'not_started' : 'completed';
  }

  /**
   * @param {Object|null} body - the response ({ status, data } or data alone); null when it could not be read
   * @param {string} [locale]
   * @returns {{ state: string, badge: string, tone: string, percent: number|null, rows: Array<{label: string, value: string}>,
   *   excluded: {title: string, reason: string}|null, error: {label: string, when: string}|null, note: string }}
   */
  function reembedView(body, locale) {
    var data = body && body.data !== undefined ? body.data : body;
    if (!data || typeof data !== 'object') {
      return { state: 'unavailable', badge: STATES.unavailable.badge, tone: STATES.unavailable.tone, percent: null, rows: [], excluded: null, error: null,
        note: 'Re-indexing progress could not be loaded right now.' };
    }
    var state = stateOf(data);
    var view = { state: state, badge: STATES[state].badge, tone: STATES[state].tone, percent: null, rows: [], excluded: null, error: null,
      note: typeof data.label === 'string' ? data.label : '' };
    if (state === 'not_configured') return view;

    var docs = data.documents || {};
    var done = count(docs.done);
    var total = count(docs.total);
    view.percent = total ? Math.min(100, Math.round((done / total) * 100)) : 100;
    view.rows.push({ label: 'Documents re-indexed', value: done + ' of ' + total });

    if (data.excluded && count(data.excluded.documents) + count(data.excluded.passages) > 0) {
      view.excluded = {
        title: plural(count(data.excluded.documents), 'document', 'documents') + ' left out (' + plural(count(data.excluded.passages), 'passage', 'passages') + ')',
        reason: data.excluded.reason || ''
      };
    }
    if (data.last_error && data.last_error.label) {
      view.error = { label: data.last_error.label, when: formatWhen(data.last_error.at, locale) };
    }
    return view;
  }

  var api = { STATES: STATES, reembedView: reembedView, formatWhen: formatWhen };

  global.LanaEmbeddingReembed = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
