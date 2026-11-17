import { emptyState, surface } from '../shared/ui.js';
import { escapeAttribute, escapeHtml, formatDateOnly, formatTimeOnly } from '../shared/utils.js';

/**
 * Generic step settings: a tab for each step of an automation that declares
 * settings, operations or related views on the server
 * (GET /api/v1/automations/:id/steps). The tab is named from the step's
 * declared label and rendered from the declaration alone: a schema-driven
 * form (text, number, boolean, select, multiselect, repeatable groups and
 * conditions with pickers), declared operations behind their confirm text,
 * and declared views as lex-tables with row actions. The server enforces
 * every permission; this view only hides what the flags say is not allowed.
 * It names no step and no automation. Form state lives in
 * js/shared/step-settings-form.js (window.AutomationStepSettings).
 */

const POLL_MS = 2500;
const VIEW_PAGE_SIZE = 20; // one of lex-table's page sizes
const POLL_LIMIT = 48;
const TAB_PREFIX = 'step:';

function F() {
  return (typeof window !== 'undefined' && window.AutomationStepSettings) || null;
}

function base(context) {
  return `/api/v1/automations/${encodeURIComponent(context.state.libraryDetail.automationId)}/steps`;
}

function stepUrl(context, actionId, rest = '') {
  return `${base(context)}/${encodeURIComponent(actionId)}${rest}`;
}

function json(context, method, body) {
  return {
    method,
    headers: { ...context.authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  };
}

function uiState(ld) {
  if (!ld.stepUi) ld.stepUi = { loaded: false, error: null, steps: [], byStep: {} };
  return ld.stepUi;
}

function stepState(ld, actionId) {
  return uiState(ld).byStep[actionId];
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadStepUi(context) {
  const ld = context.state.libraryDetail;
  if (!ld || !ld.automationId) return;
  const ui = uiState(ld);
  try {
    const payload = await context.fetchJson(base(context), { headers: context.authHeaders() });
    ui.steps = Array.isArray(payload.steps) ? payload.steps : [];
    ui.error = null;
  } catch (err) {
    ui.steps = [];
    ui.error = err && err.message ? err.message : 'Step settings could not be loaded.';
  }
  ui.loaded = true;
  const reopened = [];
  for (const step of ui.steps) {
    const fields = (step.settings && step.settings.fields) || [];
    const values = (step.settings && step.settings.values) || {};
    const kept = ui.byStep[step.action_id];
    if (kept) {
      // A reload (activate toggle, refresh) keeps what the person typed and
      // the lists already loaded, with the version that form was opened at
      // (so a save of it is checked against that); untouched forms take the
      // saved values and their version.
      if (!kept.dirty) {
        kept.form = F().initialState(fields, values);
        kept.version = step.settings ? step.settings.version : null;
      }
      reopened.push(step.action_id);
      continue;
    }
    ui.byStep[step.action_id] = {
      form: F().initialState(fields, values), dirty: false, version: step.settings ? step.settings.version : null, viewSeq: {},
      errors: [], saving: false, options: {}, loadingOptions: {},
      confirm: null, op: null, views: {}, rowAction: null
    };
  }
  // Steps already open are refreshed: their option lists and views are fetched again.
  await Promise.all(reopened.map((actionId) => Promise.all([loadOptions(context, actionId, { refresh: true }), loadViews(context, actionId)])));
}

/** One tab per step that declares UI, named from its declaration. */
export function stepTabs(context) {
  const ld = context.state.libraryDetail;
  if (!ld || !ld.stepUi) return [];
  return ld.stepUi.steps.map((step) => ({ id: TAB_PREFIX + step.action_id, label: step.label }));
}

export function stepIdOfTab(tab) {
  return typeof tab === 'string' && tab.startsWith(TAB_PREFIX) ? tab.slice(TAB_PREFIX.length) : null;
}

async function loadOptions(context, actionId, { refresh = false } = {}) {
  const ld = context.state.libraryDetail;
  const step = ld.stepUi.steps.find((entry) => entry.action_id === actionId);
  const st = stepState(ld, actionId);
  if (!step || !st) return false;
  const fields = (step.settings && step.settings.fields) || [];
  const missing = F().optionRequests(fields, st.form).filter((req) => (refresh || !st.options[req.key]) && !st.loadingOptions[req.key]);
  if (!missing.length) return false;
  await Promise.all(missing.map(async (req) => {
    st.loadingOptions[req.key] = true;
    try {
      const params = new URLSearchParams({ source: req.source, depends: JSON.stringify(req.depends) });
      const payload = await context.fetchJson(stepUrl(context, actionId, `/options?${params.toString()}`), { headers: context.authHeaders() });
      st.options[req.key] = Array.isArray(payload.options) ? payload.options : [];
    } catch (_err) {
      st.options[req.key] = [];
    } finally {
      st.loadingOptions[req.key] = false;
    }
  }));
  return true;
}

/** One page of a declared view (page from 1; the server pages and counts). */
async function loadViewPage(context, actionId, viewKey, page, limit = VIEW_PAGE_SIZE) {
  const st = stepState(context.state.libraryDetail, actionId);
  if (!st) return null;
  // Only the latest request for a view may land: an older page answering late is dropped.
  if (!st.viewSeq) st.viewSeq = {};
  const seq = (st.viewSeq[viewKey] || 0) + 1;
  st.viewSeq[viewKey] = seq;
  const params = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit) });
  let next;
  try {
    const payload = await context.fetchJson(stepUrl(context, actionId, `/views/${encodeURIComponent(viewKey)}?${params.toString()}`), { headers: context.authHeaders() });
    next = { rows: Array.isArray(payload.rows) ? payload.rows : [], total: Number(payload.total) || 0, page, limit, error: null };
  } catch (err) {
    next = { rows: [], total: 0, page, limit, error: err.message || 'This list could not be loaded.' };
  }
  if (st.viewSeq[viewKey] !== seq) return null;
  st.views[viewKey] = next;
  return next;
}

/** Every declared view of a step, each at the page it was on. */
async function loadViews(context, actionId) {
  const ld = context.state.libraryDetail;
  const step = ld.stepUi.steps.find((entry) => entry.action_id === actionId);
  const st = stepState(ld, actionId);
  if (!step || !st) return;
  await Promise.all((step.views || []).map((view) => {
    const current = st.views[view.key];
    return loadViewPage(context, actionId, view.key, (current && current.page) || 1, (current && current.limit) || VIEW_PAGE_SIZE);
  }));
}

function pagination(data) {
  return { page: data.page, limit: data.limit, total: data.total, totalPages: Math.max(1, Math.ceil(data.total / data.limit)) };
}

/** Called when a step tab opens. */
export async function openStepTab(context, actionId) {
  await Promise.all([loadOptions(context, actionId), loadViews(context, actionId)]);
  context.renderCurrentView();
}

// ---------------------------------------------------------------------------
// Rendering: the schema-driven form
// ---------------------------------------------------------------------------

function pathAttr(actionId, path) {
  return `data-ss-step="${escapeAttribute(actionId)}" data-ss-path="${escapeAttribute(JSON.stringify(path))}"`;
}

function withSelected(options, selected) {
  const list = Array.isArray(options) ? options.slice() : [];
  for (const value of [].concat(selected || [])) {
    if (value !== '' && !list.some((option) => String(option.value) === String(value))) list.push({ value, label: value });
  }
  return list;
}

function optionsFor(st, source, depends) {
  return st.options[F().requestKey(source, depends || [])] || [];
}

function renderCondition(rc, field, value, path) {
  const { actionId, st, disabled } = rc;
  const groups = (value && value.groups) || [];
  const fieldOptions = (field.fields || []).map((option) => ({ value: option.value, label: option.label || option.value }));
  const groupHtml = groups.map((group, g) => {
    const rows = (group.rows || []).map((row, r) => {
      const declared = (field.fields || []).find((option) => option.value === row.field);
      const source = declared && declared.options ? declared.options.source : null;
      const valueOptions = withSelected(source ? optionsFor(st, source, F().dependsFor(declared, group)) : [], row.values);
      const rowPath = [...path, 'groups', g, 'rows', r];
      return `
        <div class="ss-cond-row">
          <lex-select size="sm" placeholder="Field" ${pathAttr(actionId, [...rowPath, 'field'])} data-ss-kind="condition-field"
            options="${escapeAttribute(JSON.stringify(withSelected(fieldOptions, row.field)))}" value="${escapeAttribute(row.field || '')}" ${disabled}></lex-select>
          <span class="ss-cond-op">is one of</span>
          <lex-select size="sm" multiple searchable placeholder="Values" ${pathAttr(actionId, [...rowPath, 'values'])} data-ss-kind="condition-values"
            options="${escapeAttribute(JSON.stringify(valueOptions))}" value="${escapeAttribute(JSON.stringify(row.values || []))}" ${disabled}></lex-select>
          ${disabled ? '' : `<lex-btn variant="ghost" size="sm" data-ss-step="${escapeAttribute(actionId)}" data-ss-remove="${escapeAttribute(JSON.stringify(rowPath))}" aria-label="Remove this row">Remove</lex-btn>`}
        </div>`;
    }).join('');
    return `
      <div class="ss-cond-group">
        <div class="ss-cond-group-head">
          <span class="ss-cond-group-label">${g === 0 ? 'Match when all of these' : 'Or when all of these'}</span>
          ${disabled || groups.length < 2 ? '' : `<lex-btn variant="ghost" size="sm" data-ss-step="${escapeAttribute(actionId)}" data-ss-remove="${escapeAttribute(JSON.stringify([...path, 'groups', g]))}">Remove group</lex-btn>`}
        </div>
        ${rows}
        ${disabled ? '' : `<lex-btn variant="ghost" size="sm" data-ss-step="${escapeAttribute(actionId)}" data-ss-add="${escapeAttribute(JSON.stringify([...path, 'groups', g]))}">And</lex-btn>`}
      </div>`;
  }).join('');
  return `
    <div class="ss-field ss-field--condition">
      <div class="ss-field-label">${escapeHtml(field.label || field.key)}</div>
      ${field.help ? `<p class="ss-help">${escapeHtml(field.help)}</p>` : ''}
      ${groupHtml}
      ${disabled ? '' : `<lex-btn variant="ghost" size="sm" data-ss-step="${escapeAttribute(actionId)}" data-ss-add="${escapeAttribute(JSON.stringify(path))}">Or add a group</lex-btn>`}
    </div>`;
}

function renderField(rc, field, value, path) {
  const { actionId, st, disabled } = rc;
  const common = `label="${escapeAttribute(field.label || field.key)}" size="sm" ${pathAttr(actionId, path)} ${field.help ? `help="${escapeAttribute(field.help)}"` : ''} ${disabled}`;
  switch (field.type) {
    case 'text':
      return `<div class="ss-field"><lex-input ${common} value="${escapeAttribute(value || '')}"></lex-input></div>`;
    case 'number':
      return `<div class="ss-field"><lex-input type="number" ${common} ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} value="${escapeAttribute(value || '')}"></lex-input></div>`;
    case 'boolean':
      return `<div class="ss-field ss-field--boolean"><lex-checkbox ${common} ${value ? 'checked' : ''}></lex-checkbox></div>`;
    case 'select':
    case 'multiselect': {
      const source = field.options && field.options.source;
      const declared = Array.isArray(field.options && field.options.values) ? field.options.values.map((v) => ({ value: v, label: v })) : [];
      const options = withSelected(source ? optionsFor(st, source, []) : declared, value);
      const multiple = field.type === 'multiselect';
      return `<div class="ss-field"><lex-select ${common} ${multiple ? 'multiple searchable' : 'searchable'}
        options="${escapeAttribute(JSON.stringify(options))}" value="${escapeAttribute(multiple ? JSON.stringify(value || []) : (value || ''))}"></lex-select></div>`;
    }
    case 'condition':
      return renderCondition(rc, field, value, path);
    case 'group_list': {
      const items = (value || []).map((item, index) => {
        const title = field.item_label && item[field.item_label] ? item[field.item_label] : `${field.label || field.key} ${index + 1}`;
        return `
          <div class="ss-group-item">
            <div class="ss-group-item-head">
              <h5 class="ss-group-item-title">${escapeHtml(title)}</h5>
              ${disabled ? '' : `<lex-btn variant="ghost" size="sm" data-ss-step="${escapeAttribute(actionId)}" data-ss-remove="${escapeAttribute(JSON.stringify([...path, index]))}">Remove</lex-btn>`}
            </div>
            <div class="ss-group-item-fields">
              ${(field.fields || []).map((child) => renderField(rc, child, item[child.key], [...path, index, child.key])).join('')}
            </div>
          </div>`;
      }).join('');
      return `
        <div class="ss-field ss-field--group">
          <div class="ss-field-label">${escapeHtml(field.label || field.key)}</div>
          ${field.help ? `<p class="ss-help">${escapeHtml(field.help)}</p>` : ''}
          <div class="ss-group-list">${items || emptyState('None yet.')}</div>
          ${disabled ? '' : `<lex-btn variant="ghost" size="sm" data-ss-step="${escapeAttribute(actionId)}" data-ss-add="${escapeAttribute(JSON.stringify(path))}">${escapeHtml(field.add_label || 'Add')}</lex-btn>`}
        </div>`;
    }
    default:
      return '';
  }
}

function renderOperations(step, st, actionId) {
  if (!step.operations || !step.operations.length) return '';
  const buttons = step.operations.map((op) => `
    <lex-btn variant="${op.primary ? 'primary' : 'secondary'}" size="sm" data-ss-step="${escapeAttribute(actionId)}" data-ss-op="${escapeAttribute(op.key)}"
      ${op.can_run ? '' : 'disabled title="You do not have permission to run this."'}>${escapeHtml(op.label)}</lex-btn>`).join('');
  let panel = '';
  if (st.op && st.op.status === 'running') {
    panel = `<div class="ss-run-panel" data-ss-run-status="running"><lex-spinner size="sm"></lex-spinner><span class="muted">${escapeHtml(st.op.label)}: running...</span></div>`;
  } else if (st.op && st.op.status === 'error') {
    panel = `<div class="ss-run-panel ss-run-panel--error" data-ss-run-status="error"><p>${escapeHtml(st.op.error)}</p></div>`;
  } else if (st.op && st.op.summary) {
    const failed = st.op.status === 'failed';
    panel = `
      <div class="ss-run-panel${failed ? ' ss-run-panel--error' : ''}" data-ss-run-status="${failed ? 'failed' : 'done'}" ${failed ? 'role="alert"' : ''}>
        <h5 class="ss-run-title">${escapeHtml(st.op.summary.title || '')}</h5>
        <ul class="ss-run-lines">${(st.op.summary.lines || []).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      </div>`;
  }
  return surface({ title: 'Run', body: `<div class="row-actions ss-actions">${buttons}</div>${panel}` });
}

function renderViews(step, st, actionId) {
  return (step.views || []).map((view) => {
    const data = st.views[view.key];
    // lex-table takes labels as one comma list, so a comma inside a declared label is dropped.
    const hasActions = (view.row_actions || []).length > 0;
    const columns = [...(view.columns || []).map((c) => c.key), ...(hasActions ? ['actions'] : [])];
    const labels = [...(view.columns || []).map((c) => String(c.label || c.key).replace(/,/g, ' ')), ...(hasActions ? ['Actions'] : [])];
    const body = data && data.error
      ? emptyState(data.error)
      : `<lex-table class="automation-table lex-table--card ss-view-table" data-ss-table data-ss-step="${escapeAttribute(actionId)}" data-ss-view="${escapeAttribute(view.key)}"
          server-paging limit="${VIEW_PAGE_SIZE}" columns="${escapeAttribute(columns.join(','))}" labels="${escapeAttribute(labels.join(','))}" sortable-columns=""
          empty-text="Nothing here yet." id-key="id"></lex-table>`;
    return surface({ title: view.label, subtitle: view.help || '', body });
  }).join('');
}

export function renderStepTab(context, actionId) {
  const ld = context.state.libraryDetail;
  const step = ld && ld.stepUi && ld.stepUi.steps.find((entry) => entry.action_id === actionId);
  const st = step && stepState(ld, actionId);
  if (!step || !st) return surface({ title: 'Step settings', body: emptyState('This step has no settings.') });
  const canEdit = Boolean(step.settings && step.settings.can_edit);
  const rc = { actionId, st, disabled: canEdit ? '' : 'disabled' };
  const fields = (step.settings && step.settings.fields) || [];
  const settings = step.settings ? surface({
    title: 'Settings',
    subtitle: canEdit ? 'Saved changes apply to the next run.' : 'You can see these settings. Changing them needs a permission an organization admin can give you.',
    body: `
      ${st.errors.length ? `<div class="ss-errors" role="alert"><ul>${st.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>${st.conflict ? `<lex-btn variant="secondary" size="sm" data-ss-step="${escapeAttribute(actionId)}" data-ss-load-latest>Load latest</lex-btn>` : ''}</div>` : ''}
      <div class="ss-form">${fields.map((field) => renderField(rc, field, st.form[field.key], [field.key])).join('')}</div>
      ${canEdit ? `<div class="row-actions ss-actions"><lex-btn variant="primary" size="sm" data-ss-step="${escapeAttribute(actionId)}" data-ss-save ${st.saving ? 'loading' : ''}>Save settings</lex-btn></div>` : ''}`
  }) : '';
  return `<div class="ss-tab" data-ss-root="${escapeAttribute(actionId)}">${renderOperations(step, st, actionId)}${settings}${renderViews(step, st, actionId)}</div>`;
}

/** After the tab's markup is in the page: fill the view tables (rows and row action buttons). */
export function afterStepTabRender(context, actionId) {
  const ld = context.state.libraryDetail;
  const step = ld && ld.stepUi && ld.stepUi.steps.find((entry) => entry.action_id === actionId);
  const st = step && stepState(ld, actionId);
  if (!step || !st || typeof document === 'undefined') return;
  for (const table of document.querySelectorAll(`[data-ss-table][data-ss-step="${CSS.escape(actionId)}"]`)) {
    const view = (step.views || []).find((entry) => entry.key === table.dataset.ssView);
    const data = st.views[table.dataset.ssView];
    if (!view || !data || typeof table.setServerData !== 'function') continue;
    const formats = {};
    for (const column of view.columns || []) {
      // A column may declare value labels ({ value: label }). A date shows the
      // shared format as the date over the time, never broken mid-time.
      const labels = column.labels && typeof column.labels === 'object' ? column.labels : {};
      if (column.format === 'date') {
        formats[column.key] = (value) => (value
          ? `<span class="ss-date">${escapeHtml(formatDateOnly(value))}</span><span class="ss-time">${escapeHtml(formatTimeOnly(value))}</span>`
          : '');
      } else {
        formats[column.key] = (value) => {
          const text = value === null || value === undefined ? '' : String(value);
          return escapeHtml(Object.prototype.hasOwnProperty.call(labels, text) ? String(labels[text]) : text);
        };
      }
    }
    formats.actions = (_value, row) => (view.row_actions || [])
      .filter((action) => (row._actions || []).includes(action.key))
      .map((action) => `<lex-btn variant="ghost" size="sm" data-ss-step="${escapeAttribute(actionId)}" data-ss-view-action="${escapeAttribute(view.key)}"
        data-ss-row="${escapeAttribute(String(row.id))}" data-ss-action="${escapeAttribute(action.key)}">${escapeHtml(action.label)}</lex-btn>`).join('');
    table.setCellRenderers(formats);
    table.setServerData(data.rows, pagination(data));
    if (table.dataset.ssBound !== 'true') {
      table.dataset.ssBound = 'true';
      table.addEventListener('lex-query-change', async (event) => {
        const page = Number(event.detail && event.detail.page) || 1;
        const limit = Number(event.detail && event.detail.limit) || VIEW_PAGE_SIZE;
        const loaded = await loadViewPage(context, actionId, view.key, page, limit);
        if (loaded && table.isConnected) table.setServerData(loaded.rows, pagination(loaded));
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Dialogs (specs for library-detail's syncLibraryDetailModals)
// ---------------------------------------------------------------------------

export function stepModalSpecs(context) {
  const ld = context.state.libraryDetail;
  const ui = ld && ld.stepUi;
  let confirm = null;
  let rowAction = null;
  if (ui) {
    for (const step of ui.steps) {
      const st = ui.byStep[step.action_id];
      if (st && st.confirm) {
        const op = (step.operations || []).find((entry) => entry.key === st.confirm);
        if (op) {
          confirm = {
            heading: op.confirm_title || op.label,
            size: 'sm',
            body: `<p class="muted">${escapeHtml(op.confirm_text || '')}</p>`,
            footer: `<lex-btn variant="secondary" size="sm" data-ss-cancel data-ss-step="${escapeAttribute(step.action_id)}">Cancel</lex-btn>
              <lex-btn variant="primary" size="sm" data-ss-step="${escapeAttribute(step.action_id)}" data-ss-op-confirm="${escapeAttribute(op.key)}">${escapeHtml(op.confirm_label || op.label)}</lex-btn>`
          };
        }
      }
      if (st && st.rowAction) {
        const view = (step.views || []).find((entry) => entry.key === st.rowAction.view);
        const action = view && (view.row_actions || []).find((entry) => entry.key === st.rowAction.action);
        if (action) {
          const reason = action.reason ? `<lex-textarea label="${escapeAttribute(action.reason.label || 'Reason')}" rows="3" ${action.reason.required ? 'required' : ''}
            data-ss-reason value="${escapeAttribute(st.rowAction.reason || '')}" ${st.rowAction.error ? `error="${escapeAttribute(st.rowAction.error)}"` : ''}></lex-textarea>` : '';
          rowAction = {
            heading: action.confirm_title || action.label,
            size: 'sm',
            body: `<p class="muted ss-dialog-text">${escapeHtml(action.confirm_text || '')}</p>${reason}`,
            footer: `<lex-btn variant="secondary" size="sm" data-ss-cancel data-ss-step="${escapeAttribute(step.action_id)}">Cancel</lex-btn>
              <lex-btn variant="${action.danger ? 'danger' : 'primary'}" size="sm" data-ss-step="${escapeAttribute(step.action_id)}" data-ss-action-confirm>${escapeHtml(action.confirm_label || action.label)}</lex-btn>`
          };
        }
      }
    }
  }
  return { stepConfirm: confirm, stepRowAction: rowAction };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function stepOf(ld, actionId) {
  return ld.stepUi && ld.stepUi.steps.find((entry) => entry.action_id === actionId);
}

async function runOperation(context, actionId, opKey) {
  const ld = context.state.libraryDetail;
  const step = stepOf(ld, actionId);
  const st = stepState(ld, actionId);
  const op = step && (step.operations || []).find((entry) => entry.key === opKey);
  if (!op) return;
  st.confirm = null;
  st.op = { key: opKey, label: op.label, status: 'running' };
  context.renderCurrentView();
  let enqueuedAt;
  try {
    const started = await context.fetchJson(stepUrl(context, actionId, `/operations/${encodeURIComponent(opKey)}`), json(context, 'POST'));
    enqueuedAt = started && (started.enqueued_at || (started.data && started.data.enqueued_at));
  } catch (err) {
    st.op = { key: opKey, label: op.label, status: 'error', error: err.message || 'It could not start.' };
    context.renderCurrentView();
    return;
  }
  const token = {};
  st.op.token = token;
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- one poll at a time
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const current = context.state.libraryDetail && stepState(context.state.libraryDetail, actionId);
    if (!current || !current.op || current.op.token !== token) return;
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop -- one poll at a time
      result = await context.fetchJson(stepUrl(context, actionId, `/operations/${encodeURIComponent(opKey)}/result?enqueued_at=${encodeURIComponent(enqueuedAt || '')}`), { headers: context.authHeaders() });
    } catch (_err) { continue; }
    if (!result || result.status === 'running') continue;
    current.op = { key: opKey, label: op.label, status: result.status, summary: result.summary || { title: 'Finished', lines: [] } };
    // eslint-disable-next-line no-await-in-loop -- once
    await loadViews(context, actionId);
    context.renderCurrentView();
    return;
  }
  const current = context.state.libraryDetail && stepState(context.state.libraryDetail, actionId);
  if (current && current.op && current.op.token === token) {
    current.op = { key: opKey, label: op.label, status: 'error', error: 'It is taking longer than expected. Open Runs to follow it.' };
    context.renderCurrentView();
  }
}

async function saveSettings(context, actionId) {
  const ld = context.state.libraryDetail;
  const step = stepOf(ld, actionId);
  const st = stepState(ld, actionId);
  const fields = (step.settings && step.settings.fields) || [];
  st.errors = F().requiredErrors(fields, st.form);
  if (st.errors.length) { context.renderCurrentView(); return; }
  st.saving = true;
  context.renderCurrentView();
  try {
    const payload = await context.fetchJson(stepUrl(context, actionId, '/settings'), json(context, 'PUT', { values: F().toValues(fields, st.form), version: st.version }));
    if (payload && payload.step) {
      const index = ld.stepUi.steps.findIndex((entry) => entry.action_id === actionId);
      if (index >= 0) ld.stepUi.steps[index] = payload.step;
      st.form = F().initialState(fields, payload.step.settings.values || {});
      st.version = payload.step.settings.version;
    }
    st.errors = [];
    st.dirty = false;
    st.conflict = false;
    context.flash('Settings saved.');
  } catch (err) {
    // 409: someone else saved first. Saving again would be refused again, so
    // the person is offered their settings (Load latest).
    st.conflict = Boolean(err && err.status === 409);
    st.errors = st.conflict
      ? ['Someone else changed these settings after you opened them. Load the latest settings, then make your change again.']
      : [err.message || 'The settings could not be saved.'];
  } finally {
    st.saving = false;
    context.renderCurrentView();
  }
}

async function confirmRowAction(context, actionId) {
  const ld = context.state.libraryDetail;
  const step = stepOf(ld, actionId);
  const st = stepState(ld, actionId);
  const view = (step.views || []).find((entry) => entry.key === st.rowAction.view);
  const action = view && (view.row_actions || []).find((entry) => entry.key === st.rowAction.action);
  const field = typeof document !== 'undefined' ? document.querySelector('[data-ss-reason]') : null;
  const reason = String(field ? field.value : st.rowAction.reason || '').trim();
  if (action && action.reason && action.reason.required && !reason) {
    st.rowAction = { ...st.rowAction, reason, error: `${action.reason.label || 'A reason'} is required.` };
    context.renderCurrentView();
    return;
  }
  try {
    const payload = await context.fetchJson(
      stepUrl(context, actionId, `/views/${encodeURIComponent(st.rowAction.view)}/rows/${encodeURIComponent(st.rowAction.row)}/actions/${encodeURIComponent(st.rowAction.action)}`),
      json(context, 'POST', reason ? { reason } : {})
    );
    st.rowAction = null;
    context.flash((payload && payload.message) || 'Done.');
    await loadViews(context, actionId);
  } catch (err) {
    st.rowAction = { ...st.rowAction, reason, error: err.message || 'It could not be done.' };
  }
  context.renderCurrentView();
}

function parsePath(raw) {
  try {
    const path = JSON.parse(raw);
    return Array.isArray(path) ? path : null;
  } catch (_err) {
    return null;
  }
}

/**
 * @returns {Promise<boolean>} true when the click belonged to a step tab or its dialogs
 */
export async function handleStepClick(context, event) {
  const ld = context.state.libraryDetail;
  const el = event.target.closest && event.target.closest('[data-ss-step]');
  if (!ld || !el) return false;
  const actionId = el.dataset.ssStep;
  const step = stepOf(ld, actionId);
  const st = stepState(ld, actionId);
  if (!step || !st) return false;
  const fields = (step.settings && step.settings.fields) || [];

  if (el.hasAttribute('data-ss-cancel')) { st.confirm = null; st.rowAction = null; context.renderCurrentView(); return true; }
  if (el.dataset.ssOp) {
    const op = (step.operations || []).find((entry) => entry.key === el.dataset.ssOp);
    if (!op || !op.can_run) return true;
    if (op.confirm) { st.confirm = op.key; context.renderCurrentView(); } else { await runOperation(context, actionId, op.key); }
    return true;
  }
  if (el.dataset.ssOpConfirm) { await runOperation(context, actionId, el.dataset.ssOpConfirm); return true; }
  if (el.dataset.ssAdd) {
    const path = parsePath(el.dataset.ssAdd);
    if (path) { F().addAt(fields, st.form, path); st.dirty = true; }
    context.renderCurrentView();
    await loadOptions(context, actionId) && context.renderCurrentView();
    return true;
  }
  if (el.dataset.ssRemove) {
    const path = parsePath(el.dataset.ssRemove);
    if (path) { F().removeAt(st.form, path); st.dirty = true; }
    context.renderCurrentView();
    return true;
  }
  if (el.hasAttribute('data-ss-save')) { await saveSettings(context, actionId); return true; }
  if (el.hasAttribute('data-ss-load-latest')) {
    // Drop this form's edits and take the saved settings and their version.
    st.dirty = false;
    st.conflict = false;
    st.errors = [];
    await loadStepUi(context);
    context.renderCurrentView();
    return true;
  }
  if (el.dataset.ssViewAction) {
    st.rowAction = { view: el.dataset.ssViewAction, row: el.dataset.ssRow, action: el.dataset.ssAction, reason: '', error: null };
    context.renderCurrentView();
    return true;
  }
  if (el.hasAttribute('data-ss-action-confirm')) { await confirmRowAction(context, actionId); return true; }
  return false;
}

/**
 * Keep every edit in the form state as it is made, so nothing typed is lost
 * when the view re-renders. A change that alters what other pickers offer (a
 * condition row's field, a value another field depends on) re-renders.
 *
 * @returns {Promise<boolean>} true when the input belonged to a step form
 */
export async function handleStepInput(context, event) {
  const ld = context.state.libraryDetail;
  const el = event.target && event.target.closest && event.target.closest('[data-ss-path]');
  if (!ld || !el) return false;
  const actionId = el.dataset.ssStep;
  const st = stepState(ld, actionId);
  const path = parsePath(el.dataset.ssPath);
  if (!st || !path) return false;
  const tag = String(el.tagName || '').toLowerCase();
  let value;
  if (tag === 'lex-checkbox') {
    value = event.detail && typeof event.detail.value === 'boolean' ? event.detail.value : Boolean(el.checked);
  } else if (tag === 'lex-select' && el.hasAttribute('multiple')) {
    const raw = event.detail && event.detail.value !== undefined ? event.detail.value : el.value;
    value = Array.isArray(raw) ? raw.map(String) : (raw ? [String(raw)] : []);
  } else {
    value = event.detail && event.detail.value !== undefined ? event.detail.value : el.value;
    value = value === undefined || value === null ? '' : value;
  }
  F().setAt(st.form, path, value);
  st.dirty = true;
  const kind = el.dataset.ssKind;
  if (kind === 'condition-field') {
    F().setAt(st.form, [...path.slice(0, -1), 'values'], []);
  }
  const commit = event.type === 'change' || event.type === 'lex-change';
  if (commit && (kind === 'condition-field' || kind === 'condition-values')) {
    context.renderCurrentView();
    if (await loadOptions(context, actionId)) context.renderCurrentView();
  }
  return true;
}
