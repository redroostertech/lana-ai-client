import { badge, sectionIntro, surface } from '../shared/ui.js';
import { escapeHtml, formatDate, normalizeText } from '../shared/utils.js';

function statusClass(status) {
  const normalized = normalizeText(status);
  if (normalized === 'completed') return 'success';
  if (normalized === 'failed' || normalized === 'rejected' || normalized === 'cancelled') return 'warning';
  if (normalized === 'awaiting_approval' || normalized === 'pending' || normalized === 'in_progress' || normalized === 'running') return 'warning';
  return '';
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

function sortIndicator(filters, field) {
  if (filters.sortBy !== field) return '';
  return filters.sortDir === 'desc' ? ' ↓' : ' ↑';
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
  return `${baseUrl}/workspace-details.html?id=${encodeURIComponent(id)}&tab=activity`;
}

function renderMatterLink(lanaClientUrl, matterId, matterName) {
  const label = String(matterName || matterId || 'Org-wide');
  const href = buildMatterDetailUrl(lanaClientUrl, matterId);
  if (!href) return escapeHtml(label);

  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-run-matter-link="true" style="color:var(--lex-color-primary-600,#2563eb);text-decoration:none;" onclick="event.stopPropagation()">${escapeHtml(label)}</a>`;
}

function runTableRow(run, lanaClientUrl) {
  const runId = run.execution_id || '';
  return `
    <tr class="run-row-selectable" data-open-run-detail="${escapeHtml(runId)}">
      <td>
        <div class="stack-sm">
          <strong>${escapeHtml(run.automation_name || run.automation_id || 'Automation')}</strong>
          <span class="muted">${escapeHtml(runId)}</span>
        </div>
      </td>
      <td>${renderMatterLink(lanaClientUrl, run.client_matter_id, run.matter_name || run.client_matter_id || 'Org-wide')}</td>
      <td>${escapeHtml(run.trigger_event_type || 'manual')}</td>
      <td>${escapeHtml(formatDate(run.created_at || run.started_at))}</td>
      <td>
        <div class="badge-row">
          ${badge(statusLabel(run.status), statusClass(run.status))}
        </div>
      </td>
      <td>${escapeHtml(formatDuration(run.execution_duration_ms))}</td>
    </tr>
  `;
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

  return `
    <aside class="run-detail-drawer">
      <div class="run-detail-head">
        <div>
          <h3>${escapeHtml(run.automation_name || run.automation_id || 'Run')}</h3>
          <p class="muted">${escapeHtml(run.execution_id || '')}</p>
        </div>
        <button type="button" class="template-modal-close" data-close-run-detail aria-label="Close run details">×</button>
      </div>

      <div class="badge-row">
        ${badge(statusLabel(run.status), statusClass(run.status))}
        ${badge(run.trigger_event_type || 'manual')}
      </div>

      <div class="run-detail-section">
        <h4>Run Controls</h4>
        ${runActionButtons(run)}
      </div>

      <div class="run-detail-section">
        <h4>Execution</h4>
        <div class="meta-grid run-detail-grid">
          <div class="meta-item">
            <span class="meta-label">Started</span>
            <div class="meta-value">${escapeHtml(formatDate(run.started_at || run.created_at))}</div>
          </div>
          <div class="meta-item">
            <span class="meta-label">Completed</span>
            <div class="meta-value">${escapeHtml(formatDate(run.completed_at))}</div>
          </div>
          <div class="meta-item">
            <span class="meta-label">Duration</span>
            <div class="meta-value">${escapeHtml(formatDuration(run.execution_duration_ms))}</div>
          </div>
          <div class="meta-item">
            <span class="meta-label">Matter</span>
            <div class="meta-value">${renderMatterLink(lanaClientUrl, run.client_matter_id, run.matter_name || run.client_matter_id || 'Org-wide')}</div>
          </div>
        </div>
      </div>

      <div class="run-detail-section">
        <h4>Step Outcomes</h4>
        ${steps.length
          ? `
            <div class="run-detail-list">
              ${steps.map((step) => `
                <article class="run-step-card">
                  <div class="row-between">
                    <strong>${escapeHtml(step.step_id || `Step ${step.step_index || '?'}`)}</strong>
                    <span>${badge(statusLabel(step.status), statusClass(step.status))}</span>
                  </div>
                  <p class="muted">${escapeHtml(step.step_type || 'step')} ${step.duration_ms ? `• ${escapeHtml(formatDuration(step.duration_ms))}` : ''}</p>
                  ${step.message ? `<p>${escapeHtml(step.message)}</p>` : ''}
                </article>
              `).join('')}
            </div>
          `
          : '<p class="muted">No step-level outcome data was captured for this run.</p>'}
      </div>

      <div class="run-detail-section">
        <h4>Artifacts</h4>
        ${artifacts.length
          ? `
            <div class="run-detail-list">
              ${artifacts.map((artifact) => `
                <article class="run-step-card">
                  <strong>${escapeHtml(artifact.artifact_name || artifact.artifact_id || 'Artifact')}</strong>
                  <p class="muted">${escapeHtml(artifact.artifact_type || 'artifact')} • ${escapeHtml(artifact.storage_type || 'storage')} ${artifact.file_size_bytes ? `• ${escapeHtml(formatBytes(artifact.file_size_bytes))}` : ''}</p>
                  ${artifact.artifact_description ? `<p>${escapeHtml(artifact.artifact_description)}</p>` : ''}
                </article>
              `).join('')}
            </div>
          `
          : '<p class="muted">No artifacts generated for this run.</p>'}
      </div>
    </aside>
  `;
}

export function renderRuns(context) {
  const filters = context.state.filters.runs || {};
  const visibleRuns = context.state.runs || [];
  const totalRuns = context.state.runsPagination?.total || visibleRuns.length;
  const perPage = Math.max(parseInt(filters.perPage, 10) || 25, 1);
  const page = Math.max(parseInt(filters.page, 10) || 1, 1);
  const totalPages = Math.max(1, Math.ceil(totalRuns / perPage));
  const safePage = Math.min(page, totalPages);
  const offset = Number(context.state.runsPagination?.offset || ((safePage - 1) * perPage));
  const visibleCount = visibleRuns.length;
  const start = visibleCount ? offset + 1 : 0;
  const end = visibleCount ? offset + visibleCount : 0;

  const hasSelectedRun = Boolean(
    context.state.selectedRunId
    && context.state.selectedRunDetail
    && context.state.selectedRunDetail.data
  );
  const lanaClientUrl = context.state.links?.lana_client_url || '';

  context.els.viewContent.innerHTML = `
    ${sectionIntro({
      eyebrow: 'Operations',
      title: 'Run History',
      copy: 'Track every triggered run, inspect step outcomes, review artifacts, and control active executions.',
      badges: [
        badge(`${totalRuns} total runs`),
        badge(
          `${context.state.runs.filter((run) => normalizeText(run.status) === 'failed').length} failed in this page`,
          context.state.runs.some((run) => normalizeText(run.status) === 'failed') ? 'warning' : ''
        )
      ]
    })}

    <div class="runs-history-layout ${hasSelectedRun ? '' : 'no-detail'}">
      ${surface({
        title: 'Triggered Runs',
        subtitle: 'All automation executions across the organization.',
        body: `
          <div class="connectors-table-toolbar">
            <label class="toolbar-search">
              <span class="sr-only">Search runs</span>
              <input
                type="search"
                value="${escapeHtml(String(filters.query || ''))}"
                placeholder="Search by run ID, automation, matter, trigger, or status"
                data-filter-view="runs"
                data-filter-field="query"
              >
            </label>
            <label class="toolbar-select">
              <span>State</span>
              <select data-filter-view="runs" data-filter-field="state">
                <option value="all" ${filters.state === 'all' ? 'selected' : ''}>All</option>
                <option value="running" ${filters.state === 'running' ? 'selected' : ''}>Running</option>
                <option value="pending" ${filters.state === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="awaiting_approval" ${filters.state === 'awaiting_approval' ? 'selected' : ''}>Awaiting Approval</option>
                <option value="completed" ${filters.state === 'completed' ? 'selected' : ''}>Completed</option>
                <option value="failed" ${filters.state === 'failed' ? 'selected' : ''}>Failed</option>
                <option value="cancelled" ${filters.state === 'cancelled' ? 'selected' : ''}>Cancelled</option>
              </select>
            </label>
            <label class="toolbar-select">
              <span>Rows</span>
              <select data-filter-view="runs" data-filter-field="perPage">
                <option value="25" ${perPage === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${perPage === 50 ? 'selected' : ''}>50</option>
                <option value="100" ${perPage === 100 ? 'selected' : ''}>100</option>
              </select>
            </label>
          </div>

          <div class="connectors-table-wrap">
            <table class="connectors-table">
              <thead>
                <tr>
                  <th><button type="button" class="connectors-sort-btn" data-runs-sort="name">Automation${sortIndicator(filters, 'name')}</button></th>
                  <th><button type="button" class="connectors-sort-btn" data-runs-sort="matter">Matter${sortIndicator(filters, 'matter')}</button></th>
                  <th><button type="button" class="connectors-sort-btn" data-runs-sort="trigger">Trigger${sortIndicator(filters, 'trigger')}</button></th>
                  <th><button type="button" class="connectors-sort-btn" data-runs-sort="created_at">Started${sortIndicator(filters, 'created_at')}</button></th>
                  <th><button type="button" class="connectors-sort-btn" data-runs-sort="status">Status${sortIndicator(filters, 'status')}</button></th>
                  <th><button type="button" class="connectors-sort-btn" data-runs-sort="duration">Duration${sortIndicator(filters, 'duration')}</button></th>
                </tr>
              </thead>
              <tbody>
                ${visibleRuns.length
                  ? visibleRuns.map((run) => runTableRow(run, lanaClientUrl)).join('')
                  : '<tr><td colspan="6" class="connectors-empty">No runs match the current filters.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="connectors-pagination">
            <div class="connectors-page-meta">
              Showing ${start}-${end} of ${totalRuns}
            </div>
            <div class="row-actions">
              <lex-btn variant="secondary" size="sm" data-runs-page="${safePage - 1}" ${safePage <= 1 ? 'disabled' : ''}>Previous</lex-btn>
              <span class="connectors-page-indicator">Page ${safePage} of ${totalPages}</span>
              <lex-btn variant="secondary" size="sm" data-runs-page="${safePage + 1}" ${safePage >= totalPages ? 'disabled' : ''}>Next</lex-btn>
            </div>
          </div>
        `
      })}

      ${renderRunDetailsPanel(context)}
    </div>
  `;
}
