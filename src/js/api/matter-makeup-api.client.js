/**
 * Matter Makeup API Client
 *
 * The one place the client talks to the makeup, tab, form and task action
 * routes (design 4.1 and 4.3). If a backend shape changes, adjust it here.
 *
 *   GET  /api/v1/matters/:matter_id/makeup                    -> makeup view model
 *   GET  /api/v1/matters/:matter_id/tabs/:tab_id?cursor=       -> tab content
 *   GET  /api/v1/matters/:matter_id/forms/:form_key?subject=   -> form descriptor
 *   POST /api/v1/matters/:matter_id/forms/:form_key            -> { request_id, subject, binding, values }
 *        Descriptor and submit result are bare bodies (no { status, data }): 201 { status: 'recorded',
 *        record_ref, message }, 200 replayed; 409 FORM_STALE, REQUEST_ID_REUSED, FORM_IN_PROGRESS
 *        (error.retryable), 400 { error: { field } } (shared/pending-submit.js classifies them)
 *   POST /api/v1/tasks/:task_id/actions/:action_id/start       -> { request_id }
 *        202 { outcome: started|queued, action, run }, 200 { outcome: replayed, ... } (shared/task-actions.js)
 *   GET  /api/v1/tasks/:task_id/actions/:action_id/form        -> form descriptor
 *   POST /api/v1/tasks/:task_id/actions/:action_id/form        -> same body and result as a form submit
 *
 * Makeups (design 4.1, decisions 6 and 7), backend src/services/matter-makeups. Bare bodies:
 *   GET  /api/v1/matter-makeups
 *        -> { makeups: [{ key, name, description, latest_version, scope: 'system'|'organization' }] }
 *   GET  /api/v1/matters/:matter_id/makeup  (matter code or uuid)
 *        -> { makeup: { key, name, description, version, latest_version, version_id },
 *             tabs: [{ id, kind, label, hidden?, available, reason? }], fact_labels: [{ key, label }],
 *             rulebook: { module } | null, runnables: [runnable], can_configure_makeup }
 *        404 (no makeup route, or a provider matter with no LANA record) and network failures mean
 *        "no makeup here": the page shows the standard tabs. Any other failure is an error.
 *   PUT  /api/v1/matters/:matter_id/makeup                     -> { makeup_key, version?, reason }
 *        200 { outcome: 'switched'|'unchanged', assignment,
 *              effects: { status: 'complete', skills_disabled, starter_tasks_created } | { status: 'incomplete' },
 *              ...view }; 403 MAKEUP_CONFIGURE_FORBIDDEN, 404 unknown makeup or version,
 *        409 MAKEUP_SWITCH_IN_PROGRESS (error.retryable: another switch holds the matter; resend the same body),
 *        503 MAKEUP_SWITCH_INCOMPLETE (recorded, follow-up steps failed: resend the same body to finish)
 *   GET  /api/v1/matters/:matter_id/tabs/:tab_id?cursor=
 *        -> { tab, available: true, ...content } | { tab, available: false, reason }
 *           | { tab, available: true, built_in: true } (the built-in renderer shows it); 404 tab not in the makeup
 *
 * Runnables and readiness (design 4.1, 6.3):
 *   agent: { kind: 'agent', key, name, description, available, reason?, definition_id?, readiness,
 *            can_start, start_blocked_reason: null|'unavailable'|'permission'|'active_run',
 *            active_run: { id, status, state } | null (its run already going on this matter) }
 *   skill: { kind: 'skill', key, name, description, available, reason?, automation_id?, enabled,
 *            trigger_summary, readiness }
 *   readiness: { status: 'ready'|'incomplete'|'unknown', total, ready, missing, unknown } | null (null for an
 *   unavailable runnable). While it is null, or total is 0, the readiness route below is never called.
 *   GET  /api/v1/matters/:matter_id/makeup/readiness?runnable=agent:<slug>|skill:<key>   (bare body)
 *        -> { runnable: { kind, key }, status, total, ready, missing, unknown, reason?,
 *             checks: [{ code, status: 'ready'|'missing'|'unknown', label, need, found: <int>|null,
 *                        fix?: { tab?: <tab id>, form?: <form key> }, reason? }] }
 *        a check's reason says why it is unknown (the rulebook check without a deployment jurisdiction)
 *        codes apps.<app>, entities.<kind>[.<role>], facts.<label>[.supported], rulebook.<module>,
 *        records.<kind>[.<state>]; 404 when the runnable is not in the matter's makeup
 *   POST /api/v1/agents/:slug/runs                             -> existing agents start path, matter scope
 *        body { input: {}, title, scope: 'workspace', matter_id, definition_id? }
 *        202 { outcome: 'started', run, queue }                 (unwrapped, as the agents app answers)
 *        202 { outcome: 'queued', run: null }                    (debounced; the job records the outcome)
 *        202 { outcome: 'deferred'|'coalesced', run: null, active_run_id }
 *        409 { error: { code: <outcome key>, message }, outcome } (a gate refused; code equals the outcome)
 *        409 { error: { code: 'ACTIVE_RUN_EXISTS', message, active_run_id, details?: { active_run_id } }, active_run_id }
 *            (a person's start while one runs; details.active_run_id is read first)
 *   POST  /api/v1/matters/:matter_id/automations               -> { automation_id } (first enable)
 *   PATCH /api/v1/matters/:matter_id/automations/:id/toggle    -> { is_enabled }
 *
 * Run history (design 14), backend src/services/processor/runs:
 *   GET  /api/v1/matters/:matter_id/activity/runs?cursor=
 *        -> { status, data: { runs: [row], next_cursor } }   (newest first)
 *   GET  /api/v1/runs/:run_kind/:run_id/causation
 *        -> { status, data: { causation: row, root: [row] } } (root: every attempt under the same root)
 *   row: { id, run_kind, run: { kind, id, status, state, finished_at, execution_trace_id } | null (null unless started),
 *          runnable_key, outcome, matter_id,
 *          origin, origin_event: { type, id } | null, trigger_type, root_id, parent: { kind, id } | null,
 *          depth, chain: [{ kind, id, runnable_key }] (root to parent; the row is the leaf),
 *          actor: { kind, user_id }, actor_name, acting_user_id, acting_user_name, trace_id, detail, created_at }
 *   outcome: run-causation.contract RUN_OUTCOMES (shared/run-history.js words each one).
 *   run.state: RUN_STATES (active | completed | failed | cancelled) or null when the run's owner did not
 *          answer; run.status: the owner's own word for it; run.execution_trace_id: the run's own trace
 *          (agent runs), opened on the Traces page (admin/traces.html?trace_id=).
 *
 * Tab content the generic renderers read (shared/matter-generic-tabs.js; backend tab-content.models.js):
 *   { description?, notice?, columns?: [{ key, label }], rows?: [row], groups?: [{ id, title, subtitle?, rows }],
 *     actions?: [action], next_cursor?: string | null }
 *   row: { id, title?, summary?, cells?: { [key]: value }, badges?: [{ label, tone }], details?: [string],
 *          citations?: [{ label, url? }], references?: [{ label }], recorded_at?, recorded_by?, actions?: [action],
 *          downloads?: [{ id, label }] }
 *   action: { id, label, form, subject? }
 *   GET  /api/v1/matters/:matter_id/tabs/:tab_id/downloads/:ref  (ref <kind>:<uuid>, a row download id)
 *        -> the file as an attachment (Content-Disposition filename, no-store), for example a closeout
 *        package. 403 TAB_UNAVAILABLE (the tab is not available to this viewer), 404 (no such file on
 *        this tab), 404 CLOSEOUT_NOT_ACCEPTED (a closeout not yet accepted is not a file; its message says so). downloadTabFile() fetches it with the session's Authorization header (as the other
 *        authenticated file downloads do) and resolves { blob, filename }; a refusal rejects with
 *        { status, code, message } read from the error body.
 *
 * @requires api.js (global api instance)
 */

(function (global) {
  'use strict';

  function enc(value) { return encodeURIComponent(String(value)); }

  function query(params) {
    var parts = Object.keys(params).filter(function (key) {
      return params[key] !== undefined && params[key] !== null && params[key] !== '';
    }).map(function (key) { return enc(key) + '=' + enc(params[key]); });
    return parts.length ? '?' + parts.join('&') : '';
  }

  // Request shapes, pure so tests can check them without transport.
  var requests = {
    makeup: function (matterId) {
      return { method: 'GET', path: '/api/v1/matters/' + enc(matterId) + '/makeup' };
    },
    tab: function (matterId, tabId, cursor) {
      return { method: 'GET', path: '/api/v1/matters/' + enc(matterId) + '/tabs/' + enc(tabId) + query({ cursor: cursor }) };
    },
    tabDownload: function (matterId, tabId, downloadId) {
      return { method: 'GET', path: '/api/v1/matters/' + enc(matterId) + '/tabs/' + enc(tabId) + '/downloads/' + enc(downloadId) };
    },
    form: function (matterId, formKey, subject) {
      return { method: 'GET', path: '/api/v1/matters/' + enc(matterId) + '/forms/' + enc(formKey) + query({ subject: subject }) };
    },
    submitForm: function (matterId, formKey, body) {
      return { method: 'POST', path: '/api/v1/matters/' + enc(matterId) + '/forms/' + enc(formKey), body: body };
    },
    startTaskAction: function (taskId, actionId, requestId) {
      if (!requestId) throw new Error('A request id is required to start a task action.');
      return { method: 'POST', path: '/api/v1/tasks/' + enc(taskId) + '/actions/' + enc(actionId) + '/start', body: { request_id: requestId } };
    },
    taskActionForm: function (taskId, actionId) {
      return { method: 'GET', path: '/api/v1/tasks/' + enc(taskId) + '/actions/' + enc(actionId) + '/form' };
    },
    submitTaskActionForm: function (taskId, actionId, body) {
      return { method: 'POST', path: '/api/v1/tasks/' + enc(taskId) + '/actions/' + enc(actionId) + '/form', body: body };
    },
    listMakeups: function () {
      return { method: 'GET', path: '/api/v1/matter-makeups' };
    },
    switchMakeup: function (matterId, body) {
      if (!body || !body.makeup_key || !body.reason) throw new Error('A makeup key and a reason are required.');
      return { method: 'PUT', path: '/api/v1/matters/' + enc(matterId) + '/makeup', body: body };
    },
    readiness: function (matterId, runnableRef) {
      return { method: 'GET', path: '/api/v1/matters/' + enc(matterId) + '/makeup/readiness' + query({ runnable: runnableRef }) };
    },
    // The agents app start path (agents catalog buildRunPayload), scoped to
    // this matter. The server adds the readiness snapshot to the run input.
    startAgent: function (slug, matterRef, options) {
      var opts = options || {};
      if (!matterRef) throw new Error('A matter is required to start an agent here.');
      var body = { input: {}, title: opts.title || '', scope: 'workspace', matter_id: String(matterRef) };
      if (opts.definitionId) body.definition_id = String(opts.definitionId);
      return { method: 'POST', path: '/api/v1/agents/' + enc(slug) + '/runs', body: body };
    },
    enableSkill: function (matterId, automationId) {
      return { method: 'POST', path: '/api/v1/matters/' + enc(matterId) + '/automations', body: { automation_id: String(automationId) } };
    },
    toggleSkill: function (matterId, automationId, enabled) {
      return { method: 'PATCH', path: '/api/v1/matters/' + enc(matterId) + '/automations/' + enc(automationId) + '/toggle', body: { is_enabled: enabled === true } };
    },
    runs: function (matterId, cursor) {
      return { method: 'GET', path: '/api/v1/matters/' + enc(matterId) + '/activity/runs' + query({ cursor: cursor }) };
    },
    causation: function (runKind, runId) {
      return { method: 'GET', path: '/api/v1/runs/' + enc(runKind) + '/' + enc(runId) + '/causation' };
    }
  };

  // A 404 (no makeup route, or a matter with no LANA record) or a network
  // failure (status 0) means "no makeup here". Everything else is an error.
  function isUnavailable(error) {
    return Boolean(error) && (error.status === 404 || error.status === 0);
  }

  // The attachment name the server gave the file, or '' when it gave none.
  function dispositionFilename(header) {
    var match = /filename="([^"]+)"/i.exec(String(header || ''));
    return match ? match[1] : '';
  }

  async function downloadError(response) {
    var body = null;
    try { body = JSON.parse(await response.text()); } catch (error) { body = null; }
    var info = (body && body.error) || {};
    return Object.assign(new Error(info.message || ('Download failed: ' + response.status)), { status: response.status, code: info.code || null, data: body });
  }

  // One tab content answer as the renderer acts on it.
  function tabPage(response) {
    var page = response || {};
    if (page.available === false) return { state: 'unavailable', reason: page.reason || '' };
    if (page.built_in === true) return { state: 'built_in' };
    var content = Object.assign({}, page);
    delete content.tab;
    delete content.available;
    return { state: 'content', content: content };
  }

  class MatterMakeupAPIClient {
    constructor(apiClient) {
      this.api = apiClient;
    }

    send(request) {
      if (request.method === 'GET') return this.api.get(request.path);
      if (request.method === 'PUT') return this.api.put(request.path, request.body);
      if (request.method === 'PATCH') return this.api.patch(request.path, request.body);
      return this.api.post(request.path, request.body);
    }

    /**
     * The makeup view model, or null when the server has no makeup for this
     * matter (isUnavailable). Any other failure, or an answer without tabs,
     * rejects: the page must not show the standard tabs in its place.
     */
    async getMakeup(matterId) {
      var response;
      try {
        response = await this.send(requests.makeup(matterId));
      } catch (error) {
        if (isUnavailable(error)) return null;
        throw error;
      }
      if (!response || !Array.isArray(response.tabs)) throw new Error('The server answered the matter makeup without tabs.');
      return response;
    }

    getTab(matterId, tabId, cursor) { return this.send(requests.tab(matterId, tabId, cursor)); }
    async downloadTabFile(matterId, tabId, ref) {
      var api = this.api;
      if (api && api._readyPromise && typeof api._readyPromise.then === 'function') await api._readyPromise;
      var request = requests.tabDownload(matterId, tabId, ref);
      var headers = api && typeof api.getHeaders === 'function' ? api.getHeaders() : {};
      var response = await global.fetch(String((api && api.baseUrl) || '').replace(/\/+$/, '') + request.path, { method: 'GET', headers: headers, cache: 'no-store' });
      if (!response.ok) throw await downloadError(response);
      return { blob: await response.blob(), filename: dispositionFilename(response.headers && response.headers.get('Content-Disposition')) };
    }
    getForm(matterId, formKey, subject) { return this.send(requests.form(matterId, formKey, subject)); }
    submitForm(matterId, formKey, body) { return this.send(requests.submitForm(matterId, formKey, body)); }
    startTaskAction(taskId, actionId, requestId) { return this.send(requests.startTaskAction(taskId, actionId, requestId)); }
    getTaskActionForm(taskId, actionId) { return this.send(requests.taskActionForm(taskId, actionId)); }
    submitTaskActionForm(taskId, actionId, body) { return this.send(requests.submitTaskActionForm(taskId, actionId, body)); }
    listMakeups() { return this.send(requests.listMakeups()); }
    switchMakeup(matterId, body) { return this.send(requests.switchMakeup(matterId, body)); }
    getReadiness(matterId, runnableRef) { return this.send(requests.readiness(matterId, runnableRef)); }
    startAgent(slug, matterRef, options) { return this.send(requests.startAgent(slug, matterRef, options)); }
    getRuns(matterId, cursor) { return this.send(requests.runs(matterId, cursor)); }
    getCausation(runKind, runId) { return this.send(requests.causation(runKind, runId)); }

    /**
     * Turn a makeup skill on or off for this matter. The first enable has no
     * matter binding yet, so a 404 from the toggle falls back to creating it.
     */
    async setSkillEnabled(matterId, automationId, enabled) {
      try {
        return await this.send(requests.toggleSkill(matterId, automationId, enabled));
      } catch (error) {
        if (!enabled || !error || error.status !== 404) throw error;
        return this.send(requests.enableSkill(matterId, automationId));
      }
    }
  }

  MatterMakeupAPIClient.requests = requests;
  MatterMakeupAPIClient.isUnavailable = isUnavailable;
  MatterMakeupAPIClient.tabPage = tabPage;

  if (typeof module !== 'undefined' && module.exports) module.exports = MatterMakeupAPIClient;
  if (global) global.MatterMakeupAPIClient = MatterMakeupAPIClient;
})(typeof window !== 'undefined' ? window : globalThis);
