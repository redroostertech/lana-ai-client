import {
  badge,
  createServerTableStore,
  dateTimeCell,
  drawerSection,
  drawerStatGrid,
  invalidateServerTable,
  keepServerTableLive,
  lexEmpty,
  matterLinkCell,
  mountServerTable,
  mutedCell,
  nameCell,
  runStatusMark,
  sectionIntro,
  serverTableSection,
  textCell
} from '../shared/ui.js';
import { escapeAttribute, escapeHtml, formatDate, getOrganizationTimezone, normalizeText } from '../shared/utils.js';

const TABLE_ID = 'automationRunsTable';
const TOOLBAR_PREFIX = 'automationRuns';
const Queries = () => window.AutomationTableQueries;

function isLiveStatus(status) {
  const RunStatus = window.LanaRunStatus;
  return Boolean(RunStatus && RunStatus.isLive(RunStatus.stateOf(status)));
}

function statusLabel(status) {
  const normalized = String(status || 'unknown').replace(/_/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDuration(durationMs) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return '--';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function artifactId(artifact) {
  return String(artifact?.artifact_id || artifact?.id || '').trim();
}

function artifactType(artifact) {
  return artifact?.artifact_type || artifact?.type || 'artifact';
}

function artifactName(artifact) {
  return artifact?.artifact_name || artifact?.name || artifactId(artifact) || 'Artifact';
}

function artifactPayload(artifact) {
  if (!artifact) return null;
  if (artifact.inline_data_preview !== undefined && artifact.inline_data_preview !== null) {
    return artifact.inline_data_preview;
  }
  if (artifact.inline_data !== undefined && artifact.inline_data !== null) {
    return artifact.inline_data;
  }
  if (artifact.preview !== undefined && artifact.preview !== null) {
    return artifact.preview;
  }
  return null;
}

function artifactPreviewText(artifact) {
  const payload = artifactPayload(artifact);
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'number' || typeof payload === 'boolean') return String(payload);
  try {
    return JSON.stringify(payload, null, 2);
  } catch (_error) {
    return String(payload);
  }
}

function renderArtifactPreviewBody(artifact) {
  if (!artifact) {
    return lexEmpty({
      message: 'Artifact unavailable',
      description: 'The selected artifact could not be loaded.',
      icon: 'document'
    });
  }

  const payload = artifactPayload(artifact);
  const type = artifactType(artifact);
  const hasInlineHtml = artifact.inline_data_is_html && typeof payload === 'string' && payload.trim();
  const hasRemotePreview = type === 'document_redline'
    && typeof artifact.download_url === 'string'
    && artifact.download_url.trim();

  if (hasInlineHtml) {
    return `
      <iframe
        class="run-artifact-preview-frame"
        srcdoc="${escapeAttribute(payload)}"
        title="${escapeAttribute(artifactName(artifact))}"
      ></iframe>
    `;
  }

  if (hasRemotePreview) {
    return `
      <iframe
        class="run-artifact-preview-frame"
        src="${escapeAttribute(artifact.download_url)}"
        title="${escapeAttribute(artifactName(artifact))}"
      ></iframe>
    `;
  }

  const text = artifactPreviewText(artifact);
  if (!text) {
    return lexEmpty({
      message: 'No preview available',
      description: 'This artifact did not include inline preview data.',
      icon: 'document'
    });
  }

  return `<pre class="automation-detail-code run-artifact-preview-code">${escapeHtml(text)}</pre>`;
}

function renderArtifactCard(artifact, context) {
  const id = artifactId(artifact);
  const preview = artifactPreviewText(artifact).replace(/\s+/g, ' ').trim();
  const isSelected = id && id === context.state.selectedRunArtifactId;
  const canView = Boolean(id);
  const workspaceUrl = artifact.workspace_url || '';
  const type = artifactType(artifact);
  const meta = [
    type,
    artifact.storage_type || 'storage',
    artifact.file_size_bytes ? formatBytes(artifact.file_size_bytes) : ''
  ].filter(Boolean).join(' • ');

  return `
    <lex-card variant="flat" class="automation-detail-item run-artifact-card ${isSelected ? 'run-artifact-card--selected' : ''}">
      <div class="row-between run-artifact-card-header">
        <div>
          <strong>${escapeHtml(artifactName(artifact))}</strong>
          <p class="muted">${escapeHtml(meta)}</p>
        </div>
        <div class="row-actions">
          ${canView ? `<lex-btn variant="${isSelected ? 'secondary' : 'ghost'}" size="sm" data-run-artifact-view="${escapeAttribute(id)}">View</lex-btn>` : ''}
          ${workspaceUrl ? `<lex-btn variant="ghost" size="sm" data-run-artifact-open-workspace="${escapeAttribute(workspaceUrl)}">Open in Workspace</lex-btn>` : ''}
          ${canView ? `<lex-btn variant="ghost" size="sm" data-run-artifact-download="${escapeAttribute(id)}">Download</lex-btn>` : ''}
        </div>
      </div>
      ${artifact.artifact_description ? `<p>${escapeHtml(artifact.artifact_description)}</p>` : ''}
      ${preview ? `<p class="muted run-artifact-card-preview">${escapeHtml(preview.slice(0, 220))}${preview.length > 220 ? '...' : ''}</p>` : ''}
    </lex-card>
  `;
}

function renderSelectedArtifactPreview(context, artifacts) {
  if (!context.state.selectedRunArtifactId) return '';

  const fallback = artifacts.find((artifact) => artifactId(artifact) === context.state.selectedRunArtifactId);
  const selected = context.state.selectedRunArtifactDetail || fallback || null;

  return `
    <lex-card
      variant="outlined"
      heading="${escapeAttribute(selected ? artifactName(selected) : 'Artifact')}"
      subtitle="${escapeAttribute(selected ? statusLabel(artifactType(selected)) : 'Loading artifact')}"
      class="run-artifact-preview-card"
    >
      <div class="run-artifact-preview-toolbar">
        <div class="badge-row">
          ${selected ? badge(statusLabel(artifactType(selected))) : ''}
          ${selected?.storage_type ? badge(selected.storage_type) : ''}
          ${selected?.file_size_bytes ? badge(formatBytes(selected.file_size_bytes)) : ''}
        </div>
        <div class="row-actions">
          ${selected?.workspace_url ? `<lex-btn variant="secondary" size="sm" data-run-artifact-open-workspace="${escapeAttribute(selected.workspace_url)}">Open in Workspace</lex-btn>` : ''}
          ${selected?.download_url ? `<a href="${escapeAttribute(selected.download_url)}" target="_blank" rel="noopener noreferrer">Open in new window</a>` : ''}
          <lex-btn variant="ghost" size="sm" data-close-run-artifact-preview>Close</lex-btn>
        </div>
      </div>
      ${context.state.selectedRunArtifactLoading
        ? lexEmpty({
          message: 'Loading artifact',
          description: 'Fetching the full generated output.',
          icon: 'loader'
        })
        : renderArtifactPreviewBody(selected)}
    </lex-card>
  `;
}

function runActionButtons(run) {
  const status = normalizeText(run.status);
  const runId = run.execution_id || '';

  if (status === 'in_progress' || status === 'running') {
    return `
      <div class="row-actions">
        <lex-btn variant="secondary" size="sm" data-run-action="pause" data-run-id="${escapeHtml(runId)}">Pause</lex-btn>
        <lex-btn variant="ghost" size="sm" data-run-action="cancel" data-run-id="${escapeHtml(runId)}">Cancel</lex-btn>
      </div>
    `;
  }

  if (status === 'awaiting_approval' || status === 'paused') {
    return `
      <div class="row-actions">
        <lex-btn variant="secondary" size="sm" data-run-action="resume" data-run-id="${escapeHtml(runId)}">Resume</lex-btn>
        <lex-btn variant="ghost" size="sm" data-run-action="cancel" data-run-id="${escapeHtml(runId)}">Cancel</lex-btn>
      </div>
    `;
  }

  if (status === 'pending') {
    return `
      <div class="row-actions">
        <lex-btn variant="ghost" size="sm" data-run-action="cancel" data-run-id="${escapeHtml(runId)}">Cancel</lex-btn>
      </div>
    `;
  }

  return '<span class="muted">No actions</span>';
}

function buildMatterDetailUrl(lanaClientUrl, matterId) {
  const baseUrl = String(lanaClientUrl || '').trim().replace(/\/$/, '');
  const id = String(matterId || '').trim();
  if (!baseUrl || !id) return '';
  return `${baseUrl}/workspace-details.html?id=${encodeURIComponent(id)}&tab=summary`;
}

function renderMatterLink(lanaClientUrl, matterId, matterName) {
  const label = String(matterName || matterId || 'Org-wide');
  const href = buildMatterDetailUrl(lanaClientUrl, matterId);
  if (!href) return escapeHtml(label);

  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-run-matter-link="true" style="color:var(--lex-color-primary-600,#2563eb);text-decoration:none;" onclick="event.stopPropagation()">${escapeHtml(label)}</a>`;
}

function normalizeScopeType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'organization' || normalized === 'org' || normalized === 'org_wide' || normalized === 'organization-wide') {
    return 'organization';
  }
  if (normalized === 'matter' || normalized === 'matter_scoped' || normalized === 'specific_matter') {
    return 'matter';
  }
  return '';
}

function runScope(run) {
  const rawScope = run.automation_config?.scope || run.scope || {};
  const configScope = rawScope && typeof rawScope === 'object' ? rawScope : { type: rawScope };
  const matterId = configScope.matter_id
    || configScope.matterId
    || run.client_matter_id
    || run.matter_id
    || '';
  const type = normalizeScopeType(configScope.type || configScope.scope_type || run.scope_type || run.scopeType)
    || (String(run.source_type || '').toLowerCase() === 'matter' || matterId ? 'matter' : 'organization');
  const matterLabel = configScope.matter_name || run.matter_name || matterId || 'Selected matter';

  if (type === 'matter') {
    return {
      type,
      label: `Matter: ${matterLabel}`,
      badge: 'Matter scope'
    };
  }

  return {
    type,
    label: 'Organization-wide',
    badge: 'Organization scope'
  };
}

function renderRunDetailsPanel(context) {
  const detail = context.state.selectedRunDetail;
  if (!context.state.selectedRunId || !detail || !detail.data) {
    return '';
  }

  const run = detail.data;
  const steps = Array.isArray(detail.step_outcomes) ? detail.step_outcomes : [];
  const artifacts = Array.isArray(detail.artifacts) ? detail.artifacts : [];
  const lanaClientUrl = context.state.links?.lana_client_url || '';
  const scope = runScope(run);
  const timeZone = getOrganizationTimezone(context);

  return `
    <lex-drawer
      heading="${escapeAttribute(run.automation_name || run.automation_id || 'Run')}"
      subtitle="${escapeAttribute(run.execution_id || '')}"
      side="right"
      width="xl"
      open
      data-run-detail-drawer
    >
      <div class="automation-detail-drawer run-detail-content">

      <div class="badge-row" data-run-detail-status>
        ${runStatusMark({ status: run.status, bar: true })}
        ${badge(run.trigger_event_type || 'manual')}
        ${badge(scope.badge, scope.type === 'organization' ? 'info' : '')}
      </div>

      ${drawerSection({
        title: 'Run Controls',
        body: runActionButtons(run)
      })}

      ${drawerSection({
        title: 'Execution',
        body: drawerStatGrid([
          { label: 'Started', value: formatDate(run.started_at || run.created_at, { timeZone }) },
          { label: 'Completed', value: formatDate(run.completed_at, { timeZone }) },
          { label: 'Duration', value: formatDuration(run.execution_duration_ms) },
          { label: 'Scope', value: scope.label },
          {
            label: 'Matter',
            value: renderMatterLink(lanaClientUrl, run.client_matter_id, run.matter_name || run.client_matter_id || 'Org-wide'),
            isHtml: true
          }
        ])
      })}

      ${drawerSection({
        title: 'Step Outcomes',
        body: steps.length
          ? `<lex-run-trace data-run-trace${isLiveStatus(run.status) ? ' live' : ''}></lex-run-trace>`
          : lexEmpty({
            message: isLiveStatus(run.status) ? 'Waiting for the first step' : 'No step outcomes captured',
            description: isLiveStatus(run.status)
              ? 'Steps appear here as the run works through them.'
              : 'This run did not return step-level execution data.',
            icon: 'inbox'
          })
      })}

      ${drawerSection({
        title: 'Artifacts',
        body: artifacts.length
          ? `
            <div class="run-detail-list">
              ${artifacts.map((artifact) => renderArtifactCard(artifact, context)).join('')}
            </div>
            ${renderSelectedArtifactPreview(context, artifacts)}
          `
          : lexEmpty({
            message: 'No artifacts generated',
            description: 'Generated documents and structured outputs will appear here.',
            icon: 'document'
          })
      })}
      </div>
    </lex-drawer>
  `;
}

// Rows keep raw values; the renderers format them.
export function mapRunRow(run) {
  const scope = runScope(run);
  const matterId = scope.type === 'matter'
    ? (run.client_matter_id || run.matter_id || run.automation_config?.scope?.matter_id || '')
    : '';
  const duration = Number(run.execution_duration_ms ?? run.duration_ms);
  return {
    execution_id: run.execution_id || run.id || '',
    automation_name: run.automation_name || run.automation_id || 'Automation',
    scope: scope.type,
    matter: matterId,
    matter_name: scope.type === 'matter' ? (run.matter_name || '') : '',
    trigger_event_type: run.trigger_event_type || 'manual',
    started_at: run.started_at || '',
    created_at: run.created_at || '',
    status: normalizeText(run.status) || 'pending',
    duration: run.execution_duration_ms === null || run.execution_duration_ms === undefined || !Number.isFinite(duration) ? null : duration,
    _raw: run
  };
}

function runsStore(context) {
  context.state.tables = context.state.tables || {};
  if (!context.state.tables.runs) {
    context.state.tables.runs = {
      ...createServerTableStore(),
      facets: null,
      workspaces: [],
      seen: { trigger_event_type: [], status: [], matter: [] },
      total: null,
      failedOnPage: 0
    };
  }
  return context.state.tables.runs;
}

export function invalidateRunsTable(context) {
  invalidateServerTable(context.state.tables?.runs);
}

function cellRenderers() {
  const Q = Queries();
  return {
    automation_name: (value) => nameCell(value),
    scope: (value) => (value ? textCell(Q.humanizeLabel(value)) : mutedCell()),
    matter: (value, row) => matterLinkCell(value, row.matter_name, 'Matter'),
    trigger_event_type: (value) => (value ? textCell(Q.humanizeEvent(value)) : mutedCell()),
    started_at: dateTimeCell,
    created_at: dateTimeCell,
    status: (value, row) => runStatusMark({ status: value || 'pending', settled: Boolean(row._settled) }),
    duration: (value) => {
      const text = Q.humanizeDuration(value);
      return text ? textCell(Q.capitalizeFirst(text)) : mutedCell();
    }
  };
}

function statusOptions(store) {
  const Q = Queries();
  const statuses = store.facets?.statuses?.length ? store.facets.statuses : [...Q.RUN_STATUSES, ...store.seen.status];
  return Q.optionsFromValues(statuses);
}

function filterOptions(store) {
  const Q = Queries();
  const shared = window.LanaLibraryColumnFilters;
  const triggers = store.facets?.trigger_event_types?.length
    ? store.facets.trigger_event_types
    : ['manual', ...store.seen.trigger_event_type];
  const map = {
    automation_name: { text: true, placeholder: 'Automation name contains...' },
    scope: { options: Q.SCOPE_OPTIONS },
    trigger_event_type: { options: Q.optionsFromValues(triggers, Q.humanizeEvent) },
    status: { options: statusOptions(store) },
    duration: { single: true, options: Q.durationOptions() }
  };
  // Every workspace when the list loads; until then the matters seen on loaded pages.
  const matters = store.workspaces.length ? store.workspaces : store.seen.matter;
  if (matters.length) map.matter = { options: matters };
  if (shared) {
    map.started_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
    map.created_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
  }
  return map;
}

function applyFilterOptions(store) {
  const table = document.getElementById(TABLE_ID);
  if (table && typeof table.setColumnFilterOptions === 'function') {
    table.setColumnFilterOptions(filterOptions(store));
  }
}

// Trigger and status values in use, and the workspace list for the Matter
// column. A missing facet route (older servers) falls back to built-in
// statuses and the triggers seen on loaded pages.
function loadFilterSources(context, store) {
  if (store.sourcesRequested) return;
  store.sourcesRequested = true;
  context.fetchJson('/api/executions/facets', { headers: context.authHeaders() })
    .then((response) => {
      const Q = Queries();
      store.facets = {
        trigger_event_types: Q.facetValues(response, 'trigger_event_types'),
        statuses: Q.facetValues(response, 'statuses')
      };
      applyFilterOptions(store);
    })
    .catch(() => {
      store.facets = null;
    });
  const shared = window.LanaLibraryColumnFilters;
  if (shared && window.api) {
    // Runs carry the workspace uuid (client_matter_id), so filter by id.
    shared.loadWorkspaces(window.api).then((matters) => {
      store.workspaces = shared.workspaceOptions(matters, 'id');
      applyFilterOptions(store);
    }).catch(() => {});
  }
}

function rememberSeen(store, rows) {
  let changed = false;
  ['trigger_event_type', 'status'].forEach((field) => {
    rows.forEach((row) => {
      const value = row[field];
      if (value && !store.seen[field].includes(value)) {
        store.seen[field].push(value);
        changed = true;
      }
    });
  });
  rows.forEach((row) => {
    if (row.matter && !store.seen.matter.some((option) => option.value === row.matter)) {
      store.seen.matter.push({ value: row.matter, label: row.matter_name || row.matter });
      if (!store.workspaces.length) changed = true;
    }
  });
  if (changed) applyFilterOptions(store);
}

// Rows whose run just went from live to ended pop once; anyLive sets the
// refresh rhythm (LanaRunStatus.trackTransitions, shared with the agents app).
function markSettledRuns(store, rows) {
  const RunStatus = window.LanaRunStatus;
  if (!RunStatus) return;
  const seen = RunStatus.trackTransitions(store.runStates || null, rows.map((row) => ({
    id: row.execution_id, state: RunStatus.stateOf(row.status)
  })));
  store.runStates = seen.next;
  const ended = new Set(seen.ended.map((entry) => entry.id));
  rows.forEach((row) => { row._settled = ended.has(String(row.execution_id)); });
  store.anyLive = rows.some((row) => RunStatus.isLive(RunStatus.stateOf(row.status)));
}

async function fetchRunsPage(context, query, search) {
  const Q = Queries();
  const params = Q.runsParams(query, search);
  const response = await context.fetchJson(`/api/executions?${params.toString()}`, { headers: context.authHeaders() });
  const runs = response?.data || response?.executions || [];
  context.state.runs = runs;
  const rows = runs.map(mapRunRow);
  markSettledRuns(runsStore(context), rows);
  return {
    rows,
    pagination: Q.tablePagination(response, query, runs.length)
  };
}

function bannerBadges(store) {
  return `
    <span id="automationRunsTotalBadge">${badge(store.total === null ? 'Loading runs' : `${store.total} total ${store.total === 1 ? 'run' : 'runs'}`)}</span>
    <span id="automationRunsFailedBadge">${badge(`${store.failedOnPage} failed on this page`, store.failedOnPage ? 'warning' : '')}</span>
  `;
}

function updateBannerBadges(store, result) {
  store.total = Number(result.pagination?.total) || 0;
  store.failedOnPage = result.rows.filter((row) => row.status === 'failed').length;
  const total = document.getElementById('automationRunsTotalBadge');
  const failed = document.getElementById('automationRunsFailedBadge');
  if (!total || !failed) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = bannerBadges(store);
  total.replaceWith(wrapper.querySelector('#automationRunsTotalBadge'));
  failed.replaceWith(wrapper.querySelector('#automationRunsFailedBadge'));
}

export function renderRuns(context) {
  const store = runsStore(context);
  const Q = Queries();

  context.els.viewContent.innerHTML = `
    ${sectionIntro({
      eyebrow: 'Operations',
      title: 'Run History',
      copy: 'Track every triggered run, inspect step outcomes, review artifacts, and control active executions.',
      badges: [bannerBadges(store)]
    })}

    ${serverTableSection({
      prefix: TOOLBAR_PREFIX,
      store,
      title: 'Triggered Runs',
      searchLabel: 'Search and filter runs',
      searchPlaceholder: 'Search runs...',
      sortOptions: [
        { value: 'started_at', label: 'Started' },
        { value: 'created_at', label: 'Created' },
        { value: 'automation_name', label: 'Automation' },
        { value: 'scope', label: 'Scope' },
        { value: 'matter', label: 'Matter' },
        { value: 'trigger_event_type', label: 'Trigger' },
        { value: 'status', label: 'Status' },
        { value: 'duration', label: 'Duration' }
      ],
      filter: { label: 'Status', key: 'status', options: statusOptions(store) },
      table: {
        id: TABLE_ID,
        columns: ['automation_name', 'scope', 'matter', 'trigger_event_type', 'started_at', 'created_at', 'status', 'duration'],
        labels: ['Automation', 'Scope', 'Matter', 'Trigger', 'Started', 'Created', 'Status', 'Duration'],
        sortableColumns: Object.keys(Q.RUNS_SORT_BY),
        sortBy: 'started_at',
        sortDir: 'desc',
        idKey: 'execution_id',
        emptyText: 'No runs yet',
        ariaLabel: 'Triggered runs'
      }
    })}
    ${renderRunDetailsPanel(context)}
  `;

  mountServerTable({
    id: TABLE_ID,
    prefix: TOOLBAR_PREFIX,
    store,
    fetchPage: (query, search) => fetchRunsPage(context, query, search),
    renderers: cellRenderers(),
    filterOptions: () => filterOptions(store),
    filterKey: 'status',
    noun: ['run', 'runs'],
    emptyText: {
      base: 'No runs yet',
      filtered: 'No matching runs. Try a different search or filter.'
    },
    errorText: 'Runs could not be loaded. Check your connection and try again.',
    onLoaded: (result) => {
      rememberSeen(store, result.rows);
      updateBannerBadges(store, result);
    },
    onRowClick: async (row) => {
      if (row?.execution_id && typeof context.loadRunDetail === 'function') {
        await context.loadRunDetail(row.execution_id);
        context.renderCurrentView();
      }
    }
  });
  loadFilterSources(context, store);
  keepServerTableLive({ id: TABLE_ID, store, isLive: () => store.anyLive });
  fillRunTrace(context);
  keepRunDetailLive(context);
}

// The drawer's live trace takes its steps as a property, after render.
function fillRunTrace(context) {
  const trace = document.querySelector('[data-run-trace]');
  const detail = context.state.selectedRunDetail;
  if (trace && detail) trace.steps = Array.isArray(detail.step_outcomes) ? detail.step_outcomes : [];
}

/**
 * While the open run is live, re-read it every few seconds and update the
 * drawer in place: the trace gets its new steps (they rise in, the live step
 * pulses) without rebuilding the page. When the run ends, the whole view
 * renders once so the status, controls and artifacts settle.
 */
function keepRunDetailLive(context) {
  const { state } = context;
  const Poller = window.LanaLivePoller;
  if (!Poller || !state.selectedRunId || (state.runDetailPoller && state.runDetailPoller.running)) return;
  const runId = state.selectedRunId;
  state.runDetailPoller = Poller.createLivePoller({
    intervalMs: 3000,
    idleIntervalMs: 3000,
    isActive: () => state.currentView === 'runs' && state.selectedRunId === runId
      && isLiveStatus(state.selectedRunDetail?.data?.status),
    refresh: async () => {
      const before = state.selectedRunDetail?.data?.status;
      await context.loadRunDetail(runId);
      if (state.selectedRunId !== runId) return;
      const after = state.selectedRunDetail?.data?.status;
      if (after !== before) {
        invalidateRunsTable(context);
        context.renderCurrentView();
        const mark = document.querySelector('[data-run-detail-status] lex-run-status');
        if (mark && !isLiveStatus(after)) mark.setAttribute('settled', '');
        return;
      }
      fillRunTrace(context);
    }
  }).start();
}
