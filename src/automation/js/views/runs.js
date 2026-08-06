import {
  badge,
  drawerSection,
  drawerStatGrid,
  hydrateLexDataTable,
  lexDataTable,
  lexEmpty,
  sectionIntro,
  surface
} from '../shared/ui.js';
import { escapeAttribute, escapeHtml, formatDate, formatDateTime, getOrganizationTimezone, normalizeText } from '../shared/utils.js';

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

      <div class="badge-row">
        ${badge(statusLabel(run.status), statusClass(run.status))}
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
          ? `
            <div class="run-detail-list">
              ${steps.map((step) => `
                <lex-card variant="flat" class="automation-detail-item">
                  <div class="row-between">
                    <strong>${escapeHtml(step.step_id || `Step ${step.step_index || '?'}`)}</strong>
                    <span>${badge(statusLabel(step.status), statusClass(step.status))}</span>
                  </div>
                  <p class="muted">${escapeHtml(step.step_type || 'step')} ${step.duration_ms ? `• ${escapeHtml(formatDuration(step.duration_ms))}` : ''}</p>
                  ${step.message ? `<p>${escapeHtml(step.message)}</p>` : ''}
                </lex-card>
              `).join('')}
            </div>
          `
          : lexEmpty({
            message: 'No step outcomes captured',
            description: 'This run did not return step-level execution data.',
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
  const timeZone = getOrganizationTimezone(context);

  const runRows = visibleRuns.map((run) => {
    const scope = runScope(run);
    return {
      execution_id: run.execution_id || '',
      automation_name: run.automation_name || run.automation_id || 'Automation',
      scope: scope.label,
      matter_name: run.matter_name || run.client_matter_id || 'Org-wide',
      trigger_event_type: run.trigger_event_type || 'manual',
      started_at: formatDateTime(run.started_at || run.created_at, { timeZone }),
      status: normalizeText(run.status) || 'pending',
      duration: formatDuration(run.execution_duration_ms)
    };
  });

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

    <div class="runs-history-layout no-detail">
      ${surface({
        title: 'Triggered Runs',
        subtitle: 'All automation executions across the organization.',
        body: `
          ${lexDataTable({
            id: 'automationRunsTable',
            columns: ['automation_name', 'scope', 'matter_name', 'trigger_event_type', 'started_at', 'status', 'duration'],
            labels: ['Automation', 'Scope', 'Matter', 'Trigger', 'Started', 'Status', 'Duration'],
            emptyText: 'No runs found',
            sortBy: 'started_at',
            sortDir: 'desc',
            idKey: 'execution_id',
            limit: perPage,
            ariaLabel: 'Triggered runs'
          })}

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

    </div>
    ${renderRunDetailsPanel(context)}
  `;

  hydrateLexDataTable('automationRunsTable', runRows, async (row) => {
    if (row?.execution_id && typeof context.loadRunDetail === 'function') {
      await context.loadRunDetail(row.execution_id);
      context.renderCurrentView();
    }
  });
}
