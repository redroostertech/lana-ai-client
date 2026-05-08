import { badge, drawerSection, emptyState, lexEmpty, metaGrid, surface } from '../shared/ui.js';
import { escapeAttribute, escapeHtml, formatDate, formatLabel, getOrganizationTimezone, timeAgo } from '../shared/utils.js';
import { describeStep, humanizeTrigger, humanizeWhen } from '../shared/step-humanizer.js';
import { getApiUrl } from '../shared/api-base-url.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'success';
  if (s === 'failed' || s === 'rejected' || s === 'cancelled') return 'error';
  if (s === 'running' || s === 'in_progress' || s === 'pending') return 'warning';
  return '';
}

function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '--';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
  return `${(n / 60000).toFixed(1)} min`;
}

function visibilityTone(v) {
  return v === 'org_wide' ? 'info' : '';
}

function visibilityLabel(v) {
  return v === 'org_wide' ? 'Org-Wide' : 'Private';
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

function resolveAutomationScope(automation) {
  const config = automation?.automation_config || automation?.config || {};
  const scope = config.scope && typeof config.scope === 'object' ? config.scope : { type: config.scope };
  const type = normalizeScopeType(
    scope.type
    || scope.scope_type
    || automation?.scope_type
    || automation?.scopeType
    || ((scope.matter_id || scope.matterId || automation?.matter_id || automation?.client_matter_id) ? 'matter' : 'organization')
  ) || 'organization';
  const matterId = scope.matter_id
    || scope.matterId
    || (scope.resource_type === 'matter' ? scope.resource_id : '')
    || automation?.matter_id
    || automation?.client_matter_id
    || '';
  const matterName = scope.matter_name || automation?.matter_name || matterId;

  if (type === 'matter') {
    return {
      type,
      badge: 'Matter scope',
      label: `Matter: ${matterName || 'Selected matter'}`,
      matterId,
      matterName
    };
  }

  return {
    type,
    badge: 'Organization scope',
    label: 'Organization-wide',
    matterId: '',
    matterName: ''
  };
}

function resolveRunScope(run) {
  const rawScope = run.automation_config?.scope || run.scope || {};
  const configScope = rawScope && typeof rawScope === 'object' ? rawScope : { type: rawScope };
  const matterId = configScope.matter_id
    || configScope.matterId
    || run.client_matter_id
    || run.matter_id
    || '';
  const type = normalizeScopeType(configScope.type || configScope.scope_type || run.scope_type || run.scopeType)
    || (String(run.source_type || '').toLowerCase() === 'matter' || matterId ? 'matter' : 'organization');
  return type === 'matter'
    ? { type, label: 'Matter scope' }
    : { type, label: 'Organization scope' };
}

function canToggleVisibility(context, automation) {
  const user = context.state.user;
  if (!user || !automation) return false;
  const isOwner = String(user.id || '') === String(automation.created_by || '');
  const isAdmin = ['org_admin', 'system_admin'].includes(user.role);
  return isOwner || isAdmin;
}

function truncate(str, maxLen) {
  const s = String(str || '');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// ---------------------------------------------------------------------------
// Steps tab
// ---------------------------------------------------------------------------

function renderTriggerCard(trigger) {
  const { summary, conditionChips } = humanizeTrigger(trigger);
  const rawType = trigger.trigger_type || trigger.type || 'trigger';

  const conditionsHtml = conditionChips.length
    ? `<div class="ld-step-depends">
        <span class="ld-step-depends-label">Conditions:</span>
        ${conditionChips.map((c) => `<code class="ld-step-chip">${escapeHtml(c)}</code>`).join('')}
      </div>`
    : '';

  return `
    <article class="ld-step-card ld-step-trigger">
      <header class="ld-step-card__header">
        <span class="ld-step-index">Trigger</span>
        <lex-icon name="zap" size="sm"></lex-icon>
        <span class="ld-step-type-label">${escapeHtml(formatLabel(rawType))}</span>
      </header>
      <p class="ld-step-summary">${escapeHtml(summary)}</p>
      ${conditionsHtml}
      <details class="ld-step-raw">
        <summary>View raw config</summary>
        <pre><code>${escapeHtml(JSON.stringify(trigger, null, 2))}</code></pre>
      </details>
    </article>
  `;
}

function renderActionCard(action, idx) {
  const { icon, typeLabel, summary, details, whenSentence } = describeStep(action);
  const deps = Array.isArray(action.dependsOn) ? action.dependsOn : [];
  const config = action.config || {};

  const dependsHtml = deps.length
    ? `<div class="ld-step-depends">
        <span class="ld-step-depends-label">Runs after:</span>
        ${deps.map((d) => `<code class="ld-step-chip">${escapeHtml(String(d))}</code>`).join('')}
      </div>`
    : '';

  const detailsHtml = details.length
    ? `<dl class="ld-step-details">
        ${details.map((d) => `
          <div>
            <dt>${escapeHtml(d.label)}</dt>
            <dd>${escapeHtml(String(d.value))}</dd>
          </div>
        `).join('')}
      </dl>`
    : '';

  // Render the when-clause as a human-readable conditional sentence.
  // Uses humanizeWhen directly on action.when in case describeStep result is stale.
  const resolvedWhen = whenSentence || (action.when ? humanizeWhen(action.when) : '');
  const whenHtml = resolvedWhen
    ? `<p class="ld-step-when"><lex-icon name="git-branch" size="xs"></lex-icon> ${escapeHtml(resolvedWhen)}</p>`
    : '';

  return `
    <article class="ld-step-card${resolvedWhen ? ' ld-step-card--conditional' : ''}" data-step-index="${idx}">
      <header class="ld-step-card__header">
        <span class="ld-step-index">Step ${idx + 1}</span>
        <lex-icon name="${escapeAttribute(icon)}" size="sm"></lex-icon>
        <span class="ld-step-type-label">${escapeHtml(typeLabel)}</span>
        ${action.action_id ? `<code class="ld-step-action-id">${escapeHtml(action.action_id)}</code>` : ''}
      </header>
      <p class="ld-step-summary">${escapeHtml(summary)}</p>
      ${whenHtml}
      ${dependsHtml}
      ${detailsHtml}
      <details class="ld-step-raw">
        <summary>View raw config</summary>
        <pre><code>${escapeHtml(JSON.stringify(config, null, 2))}</code></pre>
      </details>
    </article>
  `;
}

function renderStepsTab(automation) {
  const config = automation.automation_config || {};
  const trigger = config.trigger || null;
  const actions = Array.isArray(config.actions) ? config.actions : [];

  const triggerBlock = trigger ? renderTriggerCard(trigger) : '';
  const actionBlocks = actions.map((action, idx) => renderActionCard(action, idx)).join('');

  const body = (triggerBlock || actionBlocks)
    ? `<div class="ld-steps-list">${triggerBlock}${actionBlocks}</div>`
    : emptyState('No steps configured for this automation.');

  return surface({ title: 'Steps', body });
}

// ---------------------------------------------------------------------------
// Runs tab
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GAP #12: friendly source label map
// ---------------------------------------------------------------------------
const TRIGGER_SOURCE_LABELS = {
  'manual-run-now': 'Run Now',
  'manual': 'Manual',
  'schedule.minutes': 'Schedule (minutes)',
  'schedule.hourly': 'Schedule (hourly)',
  'schedule.daily': 'Schedule (daily)',
  'schedule.weekly': 'Schedule (weekly)',
  'schedule.monthly': 'Schedule (monthly)',
  'email.received': 'Inbound email',
  'document.uploaded': 'Document upload',
  'document.updated': 'Document update',
  'matter.created': 'Matter created',
  'system': 'System'
};

function friendlyTriggerSource(raw) {
  if (!raw) return 'Unknown';
  const key = String(raw).toLowerCase().trim();
  // Prefix match for schedule.* variants not in map
  if (key.startsWith('schedule.')) return 'Schedule';
  return TRIGGER_SOURCE_LABELS[key] || raw;
}

function buildMatterDetailUrl(lanaClientUrl, matterId) {
  const baseUrl = String(lanaClientUrl || '').trim().replace(/\/$/, '');
  const id = String(matterId || '').trim();
  if (!baseUrl || !id) return '';
  return `${baseUrl}/workspace-details.html?id=${encodeURIComponent(id)}&tab=activity`;
}

function buildWorkspaceDetailUrl(lanaClientUrl, matterId, options = {}) {
  const id = String(matterId || '').trim();
  if (!id) return '';

  const params = new URLSearchParams({ id });
  if (options.tab) params.set('tab', options.tab);
  if (options.taskId) params.set('task', String(options.taskId));
  if (options.documentId) params.set('open_file', String(options.documentId));
  if (options.artifactId) params.set('artifact', String(options.artifactId));
  if (options.activityId) params.set('activity', String(options.activityId));

  const baseUrl = String(lanaClientUrl || '').trim().replace(/\/$/, '');
  const path = `workspace-details.html?${params.toString()}`;
  return baseUrl ? `${baseUrl}/${path}` : `../${path}`;
}

function renderMatterLink(lanaClientUrl, matterId, matterName, options = {}) {
  const text = `${options.prefix || ''}${String(matterName || matterId || 'Unknown matter')}`;
  const href = buildMatterDetailUrl(lanaClientUrl, matterId);
  if (!href) return escapeHtml(text);

  return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer" data-ld-matter-link="true" style="color:var(--lex-color-primary-600,#2563eb);text-decoration:none;" onclick="event.stopPropagation()">${escapeHtml(text)}</a>`;
}

function renderMatterBadge(lanaClientUrl, matterId, matterName) {
  return `<span class="ld-run-matter-badge" style="display:inline-flex;align-items:center;border-radius:999px;padding:4px 10px;background:rgba(37,99,235,0.10);font-size:0.75rem;line-height:1;">${renderMatterLink(lanaClientUrl, matterId, matterName, { prefix: 'Matter: ' })}</span>`;
}

function resolveResourceMatterId(resource) {
  if (!resource || typeof resource !== 'object') return '';
  return resource.matter_number
    || resource.matterNumber
    || resource.external_matter_id
    || resource.externalMatterId
    || resource.matter_id
    || resource.matterId
    || resource.client_matter_id
    || resource.clientMatterId
    || resource.context?.matter_id
    || resource.context?.matterId
    || resource.matter?.matter_id
    || resource.matter?.id
    || '';
}

function resolveResourceTaskId(resource) {
  if (!resource || typeof resource !== 'object') return '';
  return resource.task_id
    || resource.taskId
    || resource.resource_id
    || resource.resourceId
    || resource.id
    || '';
}

function getCreatedResourceUrl(resource, lanaClientUrl) {
  if (!resource || typeof resource !== 'object') return '';
  const type = String(resource.type || resource.resource_type || '').toLowerCase();
  const matterId = resolveResourceMatterId(resource);
  const resourceId = resolveResourceTaskId(resource);

  if (type === 'task') {
    const taskUrl = buildWorkspaceDetailUrl(lanaClientUrl, matterId, { tab: 'tasks', taskId: resourceId });
    if (taskUrl) return taskUrl;
  }
  if (type === 'document') {
    const documentUrl = buildWorkspaceDetailUrl(lanaClientUrl, matterId, { tab: 'documents', documentId: resourceId });
    if (documentUrl) return documentUrl;
  }
  if (type === 'artifact') {
    const artifactUrl = buildWorkspaceDetailUrl(lanaClientUrl, matterId, { tab: 'activity', artifactId: resourceId });
    if (artifactUrl) return artifactUrl;
  }
  if (type === 'activity') {
    const activityUrl = buildWorkspaceDetailUrl(lanaClientUrl, matterId, { tab: 'activity', activityId: resourceId });
    if (activityUrl) return activityUrl;
  }
  if (type === 'redline') {
    const documentId = resource.new_document_id || resource.newDocumentId || resource.document_id || resource.documentId || '';
    const redlineUrl = buildWorkspaceDetailUrl(lanaClientUrl, matterId, documentId
      ? { tab: 'documents', documentId }
      : { tab: 'activity' });
    if (redlineUrl) return redlineUrl;
  }
  return resource.url || '';
}

function openCreatedResourceUrl(resourceUrl) {
  const href = String(resourceUrl || '').trim();
  if (!href) return;

  if (href.includes('workspace-details.html') || href.includes('/matters/matter.html')) {
    const normalizedHref = href.replace(/^\.\.\//, '').replace(/^\.\//, '');
    let params = null;
    try {
      params = new URL(normalizedHref, window.location.href).searchParams;
    } catch (_err) {
      const query = normalizedHref.includes('?') ? normalizedHref.slice(normalizedHref.indexOf('?')) : '';
      params = new URLSearchParams(query);
    }

    const matterId = params.get('id') || '';
    if (!matterId) return;

    const nextParams = new URLSearchParams({ id: matterId });
    const passthroughParams = ['tab', 'task', 'task_id', 'open_file', 'artifact', 'activity'];
    for (const key of passthroughParams) {
      const value = params.get(key);
      if (value) nextParams.set(key, value);
    }
    if (!nextParams.get('tab')) nextParams.set('tab', 'activity');

    // workspace-details.html is a standalone host page, not an automation SPA
    // route. Use a full navigation to the concrete host file so Electron loads
    // the matter detail shell regardless of the automation SPA's current URL.
    window.location.href = new URL(`../../../workspace-details.html?${nextParams.toString()}`, import.meta.url).href;
    return;
  }

  if (window.Lex && Lex.Nav && !/^https?:\/\//i.test(href)) {
    Lex.Nav.go(href);
  } else {
    window.location.href = href;
  }
}

function renderRunRow(run, isExpanded, lanaClientUrl) {
  const runId = run.execution_id || '';
  const status = String(run.status || 'unknown');
  const stepCount = run.total_steps || run.step_count || '--';
  const createdOutputCount = Number(run.created_output_count || 0);
  const rowOutputCount = Number(run.row_output_count || 0);

  // GAP #2: matter context badge
  const matterId = run.client_matter_id || run.matter_id || '';
  const sourceType = run.source_type || (matterId ? 'matter' : 'direct');
  const matterBadge = sourceType === 'matter' && (run.matter_name || matterId)
    ? renderMatterBadge(lanaClientUrl, matterId, run.matter_name || matterId)
    : '';
  const runScope = resolveRunScope(run);

  // GAP #12: audit attribution
  const triggeredBy = escapeHtml(run.triggered_by_name || 'system');
  const triggerSrc = escapeHtml(friendlyTriggerSource(run.trigger_source || run.trigger_event_type));
  const auditLine = `<span class="muted ld-run-audit" style="font-size:0.75rem;">
    Triggered by ${triggeredBy} &middot; ${triggerSrc}
  </span>`;

  return `
    <div class="ld-run-row ${isExpanded ? 'ld-run-row--expanded' : ''}" data-run-id="${escapeAttribute(runId)}">
      <div class="ld-run-row-summary" data-ld-toggle-run="${escapeAttribute(runId)}">
        <div class="ld-run-row-lead">
          ${badge(formatLabel(status), statusTone(status))}
          ${badge(runScope.label, runScope.type === 'organization' ? 'info' : '')}
          ${matterBadge}
          <span class="muted" style="font-size:0.8rem;">${escapeHtml(timeAgo(run.triggered_at || run.started_at))}</span>
          <span class="muted" style="font-size:0.8rem;">${escapeHtml(formatDuration(run.duration_ms))}</span>
          <span class="muted" style="font-size:0.8rem;">${escapeHtml(String(stepCount))} steps</span>
          ${rowOutputCount ? `<span class="muted" style="font-size:0.8rem;">${escapeHtml(String(rowOutputCount))} rows</span>` : ''}
          ${createdOutputCount ? `<span class="muted" style="font-size:0.8rem;">${escapeHtml(String(createdOutputCount))} outputs</span>` : ''}
          ${auditLine}
        </div>
        <span class="ld-run-toggle-icon">${isExpanded ? '▲' : '▼'}</span>
      </div>
      ${isExpanded ? `<div class="ld-run-detail-host" data-ld-run-detail="${escapeAttribute(runId)}">
        <div class="ld-run-loading muted">Loading run detail…</div>
      </div>` : ''}
    </div>
  `;
}

function humanizeRunToken(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderReadableValue(value, key = '') {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return '';
  if (typeof value === 'string') {
    const normalizedKey = String(key || '').toLowerCase();
    if (normalizedKey === 'model' || normalizedKey.includes('email') || /^https?:\/\//.test(value)) {
      return value;
    }
    if (/[_-]/.test(value) && !/^[0-9a-f-]{24,}$/i.test(value)) {
      return humanizeRunToken(value);
    }
  }
  return String(value);
}

function isStructuredValue(value) {
  return Boolean(value && typeof value === 'object');
}

function shouldHideStepDetailKey(key, value, depth) {
  const normalized = String(key || '').toLowerCase();
  if (normalized.endsWith('_id')) return true;
  if (normalized === 'id') return true;
  if (normalized === 'organization_id') return true;
  if (normalized === 'user_id') return true;
  if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return true;
  return value === undefined || value === null || value === '';
}

function renderHumanStepObject(value, depth = 0) {
  if (Array.isArray(value)) {
    if (!value.length) return '<span class="muted">None</span>';
    return `
      <div class="ld-run-human-list">
        ${value.slice(0, 25).map((item, index) => `
          <div class="ld-run-human-list-item">
            <span class="meta-label">Item ${index + 1}</span>
            <div class="meta-value">${renderStepDetailValue(item, depth + 1)}</div>
          </div>
        `).join('')}
        ${value.length > 25 ? `<div class="muted">${escapeHtml(String(value.length - 25))} more item${value.length - 25 === 1 ? '' : 's'}</div>` : ''}
      </div>
    `;
  }

  if (!value || typeof value !== 'object') {
    return escapeHtml(renderReadableValue(value));
  }

  const entries = Object.entries(value).filter(([key, entryValue]) => !shouldHideStepDetailKey(key, entryValue, depth));
  if (!entries.length) return '<span class="muted">No user-facing details recorded.</span>';

  return `
    <div class="ld-run-human-object">
      ${entries.map(([key, entryValue]) => {
        const structured = isStructuredValue(entryValue);
        return `
          <div class="ld-run-human-row ${structured ? 'ld-run-human-row--nested' : ''}">
            <span class="meta-label">${escapeHtml(humanizeRunToken(key))}</span>
            <div class="meta-value">${renderStepDetailValue(entryValue, depth + 1, key)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderStepDetailValue(value, depth = 0, key = '') {
  if (!isStructuredValue(value)) {
    return escapeHtml(renderReadableValue(value, key));
  }

  return renderHumanStepObject(value, depth);
}

function renderStepOutcomeDetails(step, detailKey, isOpen = false) {
  const metrics = step.metrics && typeof step.metrics === 'object' ? step.metrics : {};
  const resultSummary = step.result_summary && typeof step.result_summary === 'object' ? step.result_summary : {};
  const logs = Array.isArray(step.logs) ? step.logs : [];
  const detailItems = [
    ...Object.entries(metrics).map(([key, value]) => ({
      label: humanizeRunToken(key),
      value: renderReadableValue(value),
      rawValue: value
    })),
    ...Object.entries(resultSummary)
      .filter(([key]) => metrics[key] === undefined)
      .map(([key, value]) => ({
        label: humanizeRunToken(key),
        value: renderReadableValue(value),
        rawValue: value
      }))
  ];

  if (!detailItems.length && !logs.length && !step.error_message && !step.message) {
    return '';
  }

  return `
    <details
      class="ld-step-raw ld-run-step-details"
      data-ld-step-detail="${escapeAttribute(detailKey)}"
      ${isOpen ? 'open' : ''}
    >
      <summary data-ld-step-detail-summary="${escapeAttribute(detailKey)}">View step details</summary>
      ${detailItems.length ? `
        <div class="ld-run-step-detail-grid">
          ${detailItems.map((item) => `
            <div class="ld-run-step-detail-item ${isStructuredValue(item.rawValue) ? 'ld-run-step-detail-item--wide' : ''}">
              <span class="meta-label">${escapeHtml(item.label)}</span>
              <div class="meta-value">${renderStepDetailValue(item.rawValue)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${logs.length ? `
        <div class="ld-run-step-log-list">
          ${logs.slice(0, 25).map((line) => `<div class="connector-mono">${escapeHtml(renderReadableValue(line))}</div>`).join('')}
        </div>
      ` : ''}
      ${(step.error_message || step.message) ? `<p class="ld-run-step-note">${escapeHtml(step.error_message || step.message)}</p>` : ''}
    </details>
  `;
}

function renderRunDetail(detail, lanaClientUrl = '') {
  if (!detail) return `<div class="muted">No detail available.</div>`;

  const stepOutcomes = Array.isArray(detail.step_outcomes) ? detail.step_outcomes : [];
  const artifacts = Array.isArray(detail.artifacts) ? detail.artifacts : [];
  const runResults = detail.run_results && typeof detail.run_results === 'object' ? detail.run_results : {};
  const connectorContext = detail.connector_context && typeof detail.connector_context === 'object' ? detail.connector_context : null;
  const createdResources = Array.isArray(runResults.created_resources) ? runResults.created_resources : [];
  const openStepDetails = detail.open_step_details && typeof detail.open_step_details === 'object'
    ? detail.open_step_details
    : {};

  const stepsBlock = stepOutcomes.length
    ? drawerSection({
      title: 'Step Outcomes',
      body: `
        ${stepOutcomes.map((s, index) => {
          const detailKey = `${s.action_id || s.step_id || `step_${index + 1}`}`;
          return `
          <lex-card variant="flat" class="automation-detail-item">
            <div class="ld-run-step-row">
              <div class="ld-run-step-copy">
                <strong>${escapeHtml(humanizeRunToken(s.action_id || s.step_id || 'Step'))}</strong>
                <span class="muted">${escapeHtml(humanizeRunToken(s.action_type || s.step_type || 'Action'))}${s.duration_ms ? ` · ${escapeHtml(formatDuration(s.duration_ms))}` : ''}</span>
                ${s.error_message || s.message ? `<span class="ld-run-step-error">${escapeHtml(s.error_message || s.message)}</span>` : ''}
              </div>
              ${badge(formatLabel(s.status || 'unknown'), statusTone(s.status))}
            </div>
            ${renderStepOutcomeDetails(s, detailKey, Boolean(openStepDetails[detailKey]))}
          </lex-card>
        `;
        }).join('')}
      `
    })
    : '';

  const outputBlock = '';

  const connectorBlock = connectorContext
    ? drawerSection({
      title: 'Connector Event',
      body: `
        ${metaGrid([
          connectorContext.event_type ? { label: 'Event', value: connectorContext.event_type } : null,
          connectorContext.entity_type ? { label: 'Entity', value: connectorContext.entity_type } : null,
          connectorContext.record_count !== null && connectorContext.record_count !== undefined ? { label: 'Rows in event', value: String(connectorContext.record_count) } : null,
          connectorContext.records_created !== null && connectorContext.records_created !== undefined ? { label: 'Created', value: String(connectorContext.records_created) } : null,
          connectorContext.records_updated !== null && connectorContext.records_updated !== undefined ? { label: 'Updated', value: String(connectorContext.records_updated) } : null,
          connectorContext.records_deleted !== null && connectorContext.records_deleted !== undefined ? { label: 'Deleted', value: String(connectorContext.records_deleted) } : null,
          connectorContext.chunk_index !== null && connectorContext.chunk_index !== undefined ? { label: 'Chunk', value: String(connectorContext.chunk_index) } : null
        ].filter(Boolean), 'meta-grid ld-run-result-grid')}
        ${Array.isArray(connectorContext.change_summary) && connectorContext.change_summary.length ? `
          ${metaGrid(connectorContext.change_summary.map((row) => ({
            label: `${formatLabel(row.entity_type)} ${formatLabel(row.change_type)}`,
            value: String(row.count)
          })), 'meta-grid ld-run-result-grid')}
        ` : ''}
        ${connectorContext.connector_records && Array.isArray(connectorContext.connector_records.sample) && connectorContext.connector_records.sample.length ? `
          <div class="muted" style="margin-top:8px;">Sampled ${escapeHtml(String(connectorContext.connector_records.sample.length))} of ${escapeHtml(String(connectorContext.connector_records.total_ids || connectorContext.connector_records.sample.length))} connector rows used by this run.</div>
        ` : ''}
      `
    })
    : '';

  const resourcesBlock = createdResources.length
    ? drawerSection({
      title: 'Created Outputs',
      body: (() => {
        const itemActionLabel = (type) => {
          const t = String(type || '').toLowerCase();
          if (t === 'task') return 'Open Task';
          if (t === 'document') return 'Open Document';
          if (t === 'redline') return 'Open Redline';
          if (t === 'activity') return 'Open Activity';
          if (t === 'artifact') return 'Open Artifact';
          return 'Open Output';
        };

        // Split into per-item resources vs. roll-up summary entries so the
        // summaries don't pose as clickable items. The backend currently
        // emits a single "summary" row that totals the rest of the run
        // (e.g. "+225 additional item results"); render it inline as context
        // rather than another full card.
        const items = createdResources.filter((r) =>
          String(r?.type || r?.resource_type || '').toLowerCase() !== 'summary' && r?.is_summary !== true
        );
        const summaries = createdResources.filter((r) =>
          String(r?.type || r?.resource_type || '').toLowerCase() === 'summary' || r?.is_summary === true
        );

        const itemsHtml = items.slice(0, 50).map((resource) => {
          const type = String(resource.type || resource.resource_type || 'output').toLowerCase();
          const resourceUrl = getCreatedResourceUrl(resource, lanaClientUrl);
          const matterId = resolveResourceMatterId(resource);
          const matterName = resource.matter_name || resource.matterName || matterId;
          const matterUrl = buildMatterDetailUrl(lanaClientUrl, matterId);
          const title = resource.title || resource.id || itemActionLabel(type);
          const resourceTypeLabel = resource.resource_type ? formatLabel(resource.resource_type) : '';

          return `
            <lex-card variant="flat" class="automation-detail-item">
              <div class="ld-artifact-meta">
                ${badge(formatLabel(type || 'output'))}
                <strong>${escapeHtml(title)}</strong>
                ${resourceTypeLabel && resourceTypeLabel.toLowerCase() !== type
                  ? `<span class="muted" style="font-size:0.8rem;">${escapeHtml(resourceTypeLabel)}</span>`
                  : ''}
              </div>
              ${matterId ? `
                <div style="margin-top:6px;">
                  ${renderMatterBadge(lanaClientUrl, matterId, matterName)}
                </div>
              ` : ''}
              <div class="row-actions" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
                ${resourceUrl ? `
                  <lex-btn
                    variant="primary"
                    size="sm"
                    data-ld-open-created-resource="${escapeAttribute(resourceUrl)}"
                  >${escapeHtml(itemActionLabel(type))}</lex-btn>
                ` : ''}
                ${matterUrl && resourceUrl !== matterUrl ? `
                  <lex-btn
                    variant="secondary"
                    size="sm"
                    data-ld-open-created-resource="${escapeAttribute(matterUrl)}"
                  >View Matter</lex-btn>
                ` : ''}
              </div>
            </lex-card>
          `;
        }).join('');

        const overflowCount = items.length > 50 ? items.length - 50 : 0;

        // Summary chips: count-only rolled-up entries from the backend, plus
        // a synthesized chip for any items beyond the first 50 we listed.
        const summaryChips = [
          ...summaries.map((s) => {
            const label = s.title || s.id || (s.count ? `+${s.count} additional items` : 'Additional items');
            return `<span class="ld-run-matter-badge" style="display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px;background:rgba(0,0,0,0.04);font-size:0.75rem;line-height:1;">${badge(formatLabel('summary'))} ${escapeHtml(String(label))}</span>`;
          }),
          overflowCount > 0
            ? `<span class="ld-run-matter-badge" style="display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px;background:rgba(0,0,0,0.04);font-size:0.75rem;line-height:1;">${badge(formatLabel('summary'))} +${overflowCount} more not shown</span>`
            : ''
        ].filter(Boolean).join(' ');

        return `
          <p class="muted" style="margin:0 0 10px;font-size:0.85rem;">
            Items created during this run. Items linked to a matter open the matter detail in the Lana AI client.
          </p>
          ${itemsHtml}
          ${summaryChips ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">${summaryChips}</div>` : ''}
        `;
      })()
    })
    : '';

  const artifactsBlock = artifacts.length
    ? drawerSection({
      title: 'Artifacts',
      body: `
        ${artifacts.map((a) => renderArtifactRow(a)).join('')}
      `
    })
    : '';

  return `
    <div class="ld-run-detail-body">
      ${connectorBlock}
      ${stepsBlock}
      ${outputBlock}
      ${resourcesBlock}
      ${artifactsBlock}
      ${!connectorBlock && !stepsBlock && !outputBlock && !resourcesBlock && !artifactsBlock ? lexEmpty({ message: 'No run results recorded', description: 'No step outcomes, outputs, or artifacts were recorded for this run.' }) : ''}
    </div>
  `;
}

function getArtifactDataPayload(artifact) {
  if (!artifact) return null;
  if (artifact.inline_data_preview && typeof artifact.inline_data_preview === 'object') {
    return artifact.inline_data_preview;
  }
  if (artifact.inline_data && typeof artifact.inline_data === 'object') {
    return artifact.inline_data;
  }
  return null;
}

function buildTestRunPreview(artifact) {
  const payload = getArtifactDataPayload(artifact);
  const summary = payload && payload.summary && typeof payload.summary === 'object'
    ? payload.summary
    : {};

  return [
    summary.verdict ? `Verdict: ${summary.verdict}` : null,
    summary.matrix_lane ? `Lane: ${summary.matrix_lane}` : null,
    summary.final_status ? `Status: ${summary.final_status}` : null,
    summary.execution_id ? `Execution: ${summary.execution_id}` : null,
    Number.isFinite(summary.verified_side_effects)
      ? `Verified side effects: ${summary.verified_side_effects}`
      : null
  ].filter(Boolean).join(' | ');
}

function buildArtifactPreviewText(artifact) {
  if (!artifact) return '';

  if ((artifact.artifact_type || artifact.type) === 'test_run_report') {
    return buildTestRunPreview(artifact);
  }

  if ((artifact.artifact_type || artifact.type) === 'document_redline') {
    return 'HTML redline artifact generated from the compared document versions.';
  }

  if (typeof artifact.inline_data_preview === 'string') {
    const trimmed = artifact.inline_data_preview.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        return buildReadableArtifactPreview(JSON.parse(trimmed));
      } catch (_err) {
        return artifact.inline_data_preview;
      }
    }
    return artifact.inline_data_preview;
  }

  const rawPreview = artifact.inline_data_preview ?? artifact.preview ?? null;
  if (rawPreview && typeof rawPreview === 'object') {
    return buildReadableArtifactPreview(rawPreview);
  }

  if (typeof rawPreview === 'number' || typeof rawPreview === 'boolean') {
    return String(rawPreview);
  }

  return '';
}

function buildReadableArtifactPreview(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => humanizeRunToken(item))
      .filter(Boolean)
      .join(' · ');
  }

  if (!value || typeof value !== 'object') {
    return renderReadableValue(value);
  }

  return Object.entries(value)
    .filter(([key, itemValue]) => !shouldHideStepDetailKey(key, itemValue, 1))
    .slice(0, 8)
    .map(([key, itemValue]) => {
      if (isStructuredValue(itemValue)) return humanizeRunToken(key);
      return `${humanizeRunToken(key)}: ${renderReadableValue(itemValue, key)}`;
    })
    .join(' · ');
}

function normalizeRedlineChangeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatRedlineChangeKind(kind) {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'added') return 'Added';
  if (normalized === 'removed') return 'Removed';
  return 'Changed';
}

function extractRedlineChanges(inlineHtml) {
  if (typeof inlineHtml !== 'string' || !inlineHtml || typeof DOMParser === 'undefined') {
    return [];
  }

  try {
    const doc = new DOMParser().parseFromString(inlineHtml, 'text/html');
    const anchoredNodes = Array.from(doc.querySelectorAll('[data-change-id]'));
    const nodes = anchoredNodes.length
      ? anchoredNodes
      : Array.from(doc.querySelectorAll('.added, .removed'));

    return nodes
      .map((node, index) => {
        const id = String(node.getAttribute('data-change-id') || `legacy-redline-change-${index + 1}`).trim();

        const kind = String(
          node.getAttribute('data-change-kind')
          || (node.classList.contains('added') ? 'added' : node.classList.contains('removed') ? 'removed' : 'changed')
        ).trim().toLowerCase();
        const snippet = normalizeRedlineChangeText(node.textContent || '');
        const title = snippet && snippet.length >= 4
          ? `${formatRedlineChangeKind(kind)}: ${truncate(snippet, 120)}`
          : `${formatRedlineChangeKind(kind)} change ${index + 1}`;

        return {
          id,
          kind,
          order: Number(node.getAttribute('data-change-order') || index + 1),
          snippet,
          title
        };
      })
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function renderRedlineChangeList(changes) {
  if (!changes.length) {
    return '<div class="muted">No indexed changes were found for this redline.</div>';
  }

  return `
    <div class="ld-redline-change-list">
      ${changes.map((change, index) => `
        <button
          type="button"
          class="ld-redline-change-item"
          data-ld-redline-jump="${escapeAttribute(change.id)}"
          data-ld-redline-order="${escapeAttribute(String(change.order || index + 1))}"
          aria-pressed="false"
        >
          <span class="ld-redline-change-item__index">${escapeHtml(String(index + 1))}</span>
          <span class="ld-redline-change-item__content">
            <strong>${escapeHtml(change.title)}</strong>
            <span class="muted">${escapeHtml(change.snippet || `${formatRedlineChangeKind(change.kind)} change ${index + 1}`)}</span>
          </span>
        </button>
      `).join('')}
    </div>
  `;
}

function clipContextSnippet(value, mode = 'tail', maxChars = 180) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return mode === 'head'
    ? `${text.slice(0, maxChars)}…`
    : `…${text.slice(-maxChars)}`;
}

function extractCompareBlocks(inlineHtml) {
  if (typeof inlineHtml !== 'string' || !inlineHtml || typeof DOMParser === 'undefined') {
    return [];
  }

  try {
    const doc = new DOMParser().parseFromString(inlineHtml, 'text/html');
    const nodes = Array.from(doc.querySelectorAll('.redline-document span'));
    if (!nodes.length) return [];

    const blocks = [];
    let currentBlock = null;
    let pendingLeadingContext = '';

    const appendPart = (block, part) => {
      block.originalParts.push(part.kind === 'added'
        ? { kind: 'placeholder', text: '' }
        : part
      );
      block.revisedParts.push(part.kind === 'removed'
        ? { kind: 'placeholder', text: '' }
        : part
      );
    };

    const finalizeBlock = () => {
      if (!currentBlock || !currentBlock.hasChange) {
        currentBlock = null;
        return;
      }
      blocks.push(currentBlock);
      currentBlock = null;
    };

    for (const node of nodes) {
      const text = node.textContent || '';
      const normalized = normalizeRedlineChangeText(text);
      const kind = node.classList.contains('added')
        ? 'added'
        : node.classList.contains('removed')
          ? 'removed'
          : 'unchanged';
      const part = {
        kind,
        text,
        id: String(node.getAttribute('data-change-id') || '').trim(),
        order: Number(node.getAttribute('data-change-order') || 0)
      };

      if (kind === 'unchanged') {
        if (!currentBlock) {
          if (normalized) {
            pendingLeadingContext = clipContextSnippet(`${pendingLeadingContext}${text}`, 'tail');
          }
          continue;
        }

        appendPart(currentBlock, part);
        currentBlock.trailingContextLength += normalized.length;
        if (currentBlock.trailingContextLength >= 180 || /\n\s*\n/.test(text)) {
          finalizeBlock();
        }
        continue;
      }

      if (!currentBlock) {
        currentBlock = {
          id: part.id || `compare-block-${blocks.length + 1}`,
          order: part.order || blocks.length + 1,
          originalParts: [],
          revisedParts: [],
          hasChange: false,
          trailingContextLength: 0
        };

        if (pendingLeadingContext) {
          appendPart(currentBlock, { kind: 'unchanged', text: pendingLeadingContext });
          pendingLeadingContext = '';
        }
      }

      currentBlock.hasChange = true;
      currentBlock.trailingContextLength = 0;
      if (part.id && !currentBlock.id) currentBlock.id = part.id;
      if (part.order && !currentBlock.order) currentBlock.order = part.order;
      appendPart(currentBlock, part);
    }

    finalizeBlock();

    return blocks.filter((block) => block.hasChange).map((block, index) => ({
      ...block,
      id: block.id || `compare-block-${index + 1}`,
      order: block.order || index + 1
    }));
  } catch (_error) {
    return [];
  }
}

function renderCompareParts(parts, side) {
  return parts.map((part) => {
    const safeText = escapeHtml(part.text || '');
    if (part.kind === 'placeholder') {
      return '<span class="ld-compare-placeholder">&nbsp;</span>';
    }
    if (part.kind === 'unchanged') {
      return `<span class="ld-compare-context">${safeText}</span>`;
    }
    if (part.kind === 'removed' && side === 'original') {
      return `<span class="ld-compare-removed">${safeText}</span>`;
    }
    if (part.kind === 'added' && side === 'revised') {
      return `<span class="ld-compare-added">${safeText}</span>`;
    }
    return `<span class="ld-compare-context">${safeText}</span>`;
  }).join('');
}

function renderComparedDocumentsView(documents, inlineHtml) {
  if (!documents.length) {
    return '<div class="muted">Compared source documents are not available for this artifact.</div>';
  }

  const [originalDocument, revisedDocument] = documents;
  const compareBlocks = extractCompareBlocks(inlineHtml);

  if (!compareBlocks.length) {
    return `
      <div class="ld-compared-documents-shell">
        ${documents.map((document) => `
          <section class="ld-compared-document-pane">
            <header class="ld-compared-document-pane__header">
              <div>
                <h4>${escapeHtml(document.label || document.filename || 'Document')}</h4>
                <div class="muted">${escapeHtml(document.filename || 'Unnamed document')}</div>
              </div>
              <div class="row-actions">
                ${document.download_url ? `<a href="${escapeAttribute(document.download_url)}" target="_blank" rel="noopener noreferrer">Download</a>` : ''}
              </div>
            </header>
            <div class="ld-compared-document-pane__meta muted">
              ${document.content_type ? `<span>${escapeHtml(document.content_type)}</span>` : ''}
              ${document.status ? `<span>${escapeHtml(document.status)}</span>` : ''}
            </div>
            <div class="ld-compared-document-pane__body">
              <div class="ld-compared-document-fallback">
                <div class="muted" style="margin-bottom:10px;">Aligned compare blocks are unavailable for this artifact. Showing extracted text instead.</div>
                <pre class="ld-compared-document-text">${escapeHtml(document.extracted_text_preview || 'No extracted text preview available.')}</pre>
              </div>
            </div>
          </section>
        `).join('')}
      </div>
    `;
  }

  return `
    <div class="ld-compare-shell">
      <div class="ld-compare-header-grid">
        <section class="ld-compare-header-card">
          <div>
            <div class="ld-compare-header-card__eyebrow">Original</div>
            <h4>${escapeHtml(originalDocument?.filename || originalDocument?.label || 'Original document')}</h4>
            <div class="muted">${escapeHtml(originalDocument?.content_type || '')}</div>
          </div>
          <div class="row-actions">
            ${originalDocument?.download_url ? `<a href="${escapeAttribute(originalDocument.download_url)}" target="_blank" rel="noopener noreferrer">Download</a>` : ''}
          </div>
        </section>
        <section class="ld-compare-header-card">
          <div>
            <div class="ld-compare-header-card__eyebrow">Revised</div>
            <h4>${escapeHtml(revisedDocument?.filename || revisedDocument?.label || 'Revised document')}</h4>
            <div class="muted">${escapeHtml(revisedDocument?.content_type || '')}</div>
          </div>
          <div class="row-actions">
            ${revisedDocument?.download_url ? `<a href="${escapeAttribute(revisedDocument.download_url)}" target="_blank" rel="noopener noreferrer">Download</a>` : ''}
          </div>
        </section>
      </div>
      <div class="ld-compare-block-list">
        ${compareBlocks.map((block, index) => `
          <button
            type="button"
            class="ld-compare-block"
            data-ld-redline-jump="${escapeAttribute(block.id)}"
            data-ld-redline-order="${escapeAttribute(String(block.order || index + 1))}"
          >
            <div class="ld-compare-block__marker">${escapeHtml(String(index + 1))}</div>
            <div class="ld-compare-block__columns">
              <div class="ld-compare-block__pane ld-compare-block__pane--original">
                ${renderCompareParts(block.originalParts, 'original')}
              </div>
              <div class="ld-compare-block__pane ld-compare-block__pane--revised">
                ${renderCompareParts(block.revisedParts, 'revised')}
              </div>
            </div>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function clusterRedlineChanges(changes, options = {}) {
  const maxGap = Number.isFinite(options.maxGap) ? options.maxGap : 2;
  const maxSnippetLength = Number.isFinite(options.maxSnippetLength) ? options.maxSnippetLength : 220;
  const sorted = [...changes].sort((a, b) => (a.order || 0) - (b.order || 0));
  const groups = [];
  let currentGroup = null;

  const finalizeGroup = () => {
    if (!currentGroup) return;
    const clusterIndex = groups.length + 1;
    const uniqueKinds = Array.from(currentGroup.kinds);
    const dominantKind = uniqueKinds.length === 1 ? uniqueKinds[0] : 'changed';
    const combinedSnippet = currentGroup.items
      .map((item) => item.snippet)
      .filter(Boolean)
      .join(' … ');

    groups.push({
      id: currentGroup.items[0].id,
      kind: dominantKind,
      order: currentGroup.items[0].order,
      itemCount: currentGroup.items.length,
      title: currentGroup.items.length > 1
        ? `${formatRedlineChangeKind(dominantKind)} cluster ${clusterIndex}`
        : currentGroup.items[0].title,
      snippet: truncate(combinedSnippet || currentGroup.items[0].snippet || '', 220),
      items: currentGroup.items
    });
    currentGroup = null;
  };

  for (const change of sorted) {
    if (!currentGroup) {
      currentGroup = {
        items: [change],
        kinds: new Set([change.kind]),
        snippetLength: (change.snippet || '').length
      };
      continue;
    }

    const previous = currentGroup.items[currentGroup.items.length - 1];
    const nextLength = currentGroup.snippetLength + (change.snippet || '').length;
    const isNearby = Math.abs((change.order || 0) - (previous.order || 0)) <= maxGap;

    if (!isNearby || nextLength > maxSnippetLength) {
      finalizeGroup();
      currentGroup = {
        items: [change],
        kinds: new Set([change.kind]),
        snippetLength: (change.snippet || '').length
      };
      continue;
    }

    currentGroup.items.push(change);
    currentGroup.kinds.add(change.kind);
    currentGroup.snippetLength = nextLength;
  }

  finalizeGroup();
  return groups;
}

function renderChangeSummaryView(changes, artifact) {
  const addedChanges = changes.filter((change) => change.kind === 'added');
  const removedChanges = changes.filter((change) => change.kind === 'removed');
  const changedChanges = changes.filter((change) => change.kind !== 'added' && change.kind !== 'removed');
  const addedGroups = clusterRedlineChanges(addedChanges);
  const removedGroups = clusterRedlineChanges(removedChanges);
  const metadataChanges = Number(artifact?.metadata?.changes);
  const totalChanges = Number.isFinite(metadataChanges) && metadataChanges > 0
    ? metadataChanges
    : changes.length;

  const renderSummaryList = (items, emptyMessage) => {
    if (!items.length) {
      return `<div class="muted">${escapeHtml(emptyMessage)}</div>`;
    }

    return `
      <div class="ld-change-summary-list">
        ${items.map((item, index) => `
          <button
            type="button"
            class="ld-change-summary-item"
            data-ld-redline-jump="${escapeAttribute(item.id)}"
            data-ld-redline-order="${escapeAttribute(String(item.order || index + 1))}"
          >
            <span class="ld-change-summary-item__index">${escapeHtml(String(index + 1))}</span>
            <span class="ld-change-summary-item__content">
              <strong>${escapeHtml(item.title)}</strong>
              <span class="muted">${escapeHtml(item.snippet || `${formatRedlineChangeKind(item.kind)} change ${index + 1}`)}</span>
              ${item.itemCount > 1 ? `<span class="muted">Includes ${escapeHtml(String(item.itemCount))} nearby edits</span>` : ''}
            </span>
          </button>
        `).join('')}
      </div>
    `;
  };

  return `
    <div class="ld-change-summary-shell">
      <div class="ld-change-summary-metrics">
        <article class="ld-change-summary-metric">
          <span class="ld-change-summary-metric__label">Total</span>
          <strong>${escapeHtml(String(totalChanges))}</strong>
        </article>
        <article class="ld-change-summary-metric ld-change-summary-metric--added">
          <span class="ld-change-summary-metric__label">Added</span>
          <strong>${escapeHtml(String(addedChanges.length))}</strong>
        </article>
        <article class="ld-change-summary-metric ld-change-summary-metric--removed">
          <span class="ld-change-summary-metric__label">Removed</span>
          <strong>${escapeHtml(String(removedChanges.length))}</strong>
        </article>
        <article class="ld-change-summary-metric">
          <span class="ld-change-summary-metric__label">Other</span>
          <strong>${escapeHtml(String(changedChanges.length))}</strong>
        </article>
      </div>
      <div class="ld-change-summary-columns">
        <section class="ld-change-summary-section">
          <header class="ld-change-summary-section__header">
            <h4>Added Text</h4>
            <span class="muted">${escapeHtml(String(addedGroups.length))} group${addedGroups.length === 1 ? '' : 's'}</span>
          </header>
          ${renderSummaryList(addedGroups, 'No additions were detected.')}
        </section>
        <section class="ld-change-summary-section">
          <header class="ld-change-summary-section__header">
            <h4>Removed Text</h4>
            <span class="muted">${escapeHtml(String(removedGroups.length))} group${removedGroups.length === 1 ? '' : 's'}</span>
          </header>
          ${renderSummaryList(removedGroups, 'No removals were detected.')}
        </section>
      </div>
    </div>
  `;
}

function renderArtifactRow(artifact) {
  const id = artifact.artifact_id || artifact.id || '';
  const preview = truncate(buildArtifactPreviewText(artifact), 500);
  const workspaceUrl = artifact.workspace_url || getCreatedResourceUrl({
    type: 'artifact',
    id,
    matter_id: artifact.client_matter_id || artifact.matter_id || ''
  }, '');
  return `
    <lex-card variant="flat" class="automation-detail-item ld-artifact-card">
      <div class="ld-artifact-meta">
        <strong>${escapeHtml(artifact.artifact_name || artifact.name || 'Artifact')}</strong>
        ${badge(formatLabel(artifact.artifact_type || artifact.type || 'output'))}
        <span class="muted" style="font-size:0.75rem;">${escapeHtml(timeAgo(artifact.created_at))}</span>
      </div>
      ${artifact.artifact_description ? `<div class="muted">${escapeHtml(artifact.artifact_description)}</div>` : ''}
      ${preview ? `<div class="ld-artifact-preview muted">${escapeHtml(preview)}</div>` : ''}
      <div class="row-actions" style="margin-top:6px;">
        ${id ? `
          <lex-btn variant="primary" size="sm" data-ld-artifact-view="${escapeAttribute(id)}">View Artifact</lex-btn>
          ${workspaceUrl ? `<lex-btn variant="secondary" size="sm" data-ld-open-created-resource="${escapeAttribute(workspaceUrl)}">Open in Workspace</lex-btn>` : ''}
          <lex-btn variant="secondary" size="sm" data-ld-artifact-download="${escapeAttribute(id)}">Download</lex-btn>
        ` : ''}
      </div>
    </lex-card>
  `;
}

function renderRunsTab(context) {
  const ld = context.state.libraryDetail;
  const runs = ld.runs || [];
  const expandedId = ld.expandedRunId || null;
  const expandedDetail = ld.expandedRunDetail || null;
  const totalRuns = ld.runsPagination ? ld.runsPagination.total : runs.length;
  const hasMore = ld.runsPagination ? ld.runsPagination.has_more : false;
  const offset = ld.runsOffset || 0;
  const limit = 25;
  const lanaClientUrl = context.state.links?.lana_client_url || '';

  const runsBody = runs.length
    ? runs.map((run) => {
      const id = run.execution_id || '';
      const isExpanded = id && id === expandedId;
      const rowHtml = renderRunRow(run, isExpanded, lanaClientUrl);

      if (isExpanded && expandedDetail) {
        return rowHtml.replace(
          '<div class="ld-run-loading muted">Loading run detail…</div>',
          renderRunDetail(expandedDetail, lanaClientUrl)
        );
      }
      return rowHtml;
    }).join('')
    : emptyState('No runs recorded for this automation.');

  const paginationBlock = `
    <div class="connectors-pagination" style="margin-top:12px;">
      <div class="connectors-page-meta">
        Showing ${offset + 1}–${Math.min(offset + limit, totalRuns)} of ${totalRuns}
      </div>
      <div class="row-actions">
        <lex-btn variant="secondary" size="sm" data-ld-runs-page="prev" ${offset <= 0 ? 'disabled' : ''}>Previous</lex-btn>
        <lex-btn variant="secondary" size="sm" data-ld-runs-page="next" ${!hasMore ? 'disabled' : ''}>Next</lex-btn>
      </div>
    </div>
  `;

  return surface({
    title: 'Run History',
    subtitle: `${totalRuns} run${totalRuns !== 1 ? 's' : ''} total`,
    body: `<div class="ld-runs-list">${runsBody}</div>${paginationBlock}`
  });
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

function renderMatterAttachmentsSection(context) {
  const ld = context.state.libraryDetail;
  const attachments = ld.matterAttachments || null;
  const loadingAttachments = ld.matterAttachmentsLoading || false;

  let body;
  if (loadingAttachments) {
    body = '<div class="muted">Loading matter attachments…</div>';
  } else if (!attachments) {
    body = `
      <div class="row-actions">
        <lex-btn variant="secondary" size="sm" data-ld-load-attachments>Load Attachments</lex-btn>
      </div>
    `;
  } else if (attachments.length === 0) {
    body = `
      <p class="muted">This automation is not attached to any matters.</p>
      <div class="row-actions" style="margin-top:8px;">
        <lex-btn variant="secondary" size="sm" data-ld-attach-to-matter>Attach to Matter</lex-btn>
      </div>
    `;
  } else {
    const rows = attachments.map((att) => {
      const msId = att.matter_automation_id || '';
      const mId = att.client_matter_id || '';
      const mName = escapeHtml(att.matter_name || mId);
      const mNum = att.matter_number ? ` (${escapeHtml(att.matter_number)})` : '';
      const isEnabled = att.is_enabled !== false;
      return `
        <div class="ld-attachment-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--surface-border,#eee);">
          <div style="flex:1;">
            <strong>${mName}</strong><span class="muted">${mNum}</span>
            ${badge(isEnabled ? 'Enabled' : 'Disabled', isEnabled ? 'success' : '')}
          </div>
          <div class="row-actions">
            <lex-btn variant="ghost" size="sm"
              data-ld-edit-overrides="${escapeAttribute(msId)}"
              data-ld-override-matter="${escapeAttribute(mId)}"
              title="Edit config overrides for this matter">Edit Overrides</lex-btn>
            <lex-btn variant="danger" size="sm"
              data-ld-detach-matter="${escapeAttribute(mId)}"
              title="Remove this automation from the matter">Detach</lex-btn>
          </div>
        </div>
      `;
    }).join('');

    body = `
      ${rows}
      <div class="row-actions" style="margin-top:12px;">
        <lex-btn variant="secondary" size="sm" data-ld-attach-to-matter>Attach to Another Matter</lex-btn>
      </div>
    `;
  }

  return `
    <div class="ld-settings-section">
      <h4>Matter Attachments</h4>
      <p class="muted">Attach this automation to specific matters to scope its execution.</p>
      ${body}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// GAP #1: Attach-to-matter modal
// ---------------------------------------------------------------------------

function renderAttachMatterModal(context) {
  const ld = context.state.libraryDetail;
  const modal = ld.attachMatterModal || {};
  if (!modal.open) return '';

  const matters = modal.matters || [];
  const query = modal.query || '';
  const loading = modal.loading || false;
  const filtered = matters.filter((m) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (m.name || '').toLowerCase().includes(q) ||
           (m.matter_id || '').toLowerCase().includes(q);
  });

  const mattorRows = loading
    ? '<div class="muted">Loading matters…</div>'
    : filtered.length
      ? filtered.map((m) => {
        const mId = escapeAttribute(m.id || '');
        const mNum = m.matter_id ? ` (${escapeHtml(m.matter_id)})` : '';
        return `
          <div class="ld-attach-matter-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--surface-border,#eee);">
            <div style="flex:1;">
              <strong>${escapeHtml(m.name || m.id || 'Matter')}</strong>
              <span class="muted">${mNum}</span>
            </div>
            <lex-btn variant="primary" size="sm" data-ld-confirm-attach-matter="${mId}">Attach</lex-btn>
          </div>
        `;
      }).join('')
      : '<div class="muted">No matters found.</div>';

  return `
    <div class="ld-delete-modal-overlay" data-ld-attach-matter-overlay style="z-index:200;">
      <div class="ld-delete-modal-panel" role="dialog" aria-modal="true" style="min-width:380px;max-width:560px;">
        <h3>Attach to Matter</h3>
        <p class="muted">Select an active matter to attach this automation to.</p>
        <input
          type="search"
          style="width:100%;padding:6px 10px;margin:8px 0;border:1px solid #ccc;border-radius:4px;font-size:0.9rem;"
          placeholder="Search by matter name or number…"
          value="${escapeHtml(query)}"
          data-ld-attach-matter-search
          autofocus
        >
        <div class="ld-attach-matter-list" style="max-height:300px;overflow-y:auto;margin:8px 0;">
          ${mattorRows}
        </div>
        <div class="row-actions" style="margin-top:16px;justify-content:flex-end;">
          <lex-btn variant="secondary" size="sm" data-ld-attach-matter-cancel>Cancel</lex-btn>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// GAP #1: Edit overrides modal
// ---------------------------------------------------------------------------

function renderEditOverridesModal(context) {
  const ld = context.state.libraryDetail;
  const modal = ld.editOverridesModal || {};
  if (!modal.open) return '';

  const raw = modal.overridesJson || '{}';

  return `
    <div class="ld-delete-modal-overlay" data-ld-overrides-overlay style="z-index:210;">
      <div class="ld-delete-modal-panel" role="dialog" aria-modal="true" style="min-width:420px;">
        <h3>Edit Config Overrides</h3>
        <p class="muted">Override automation config for this matter attachment. Must be valid JSON.</p>
        <textarea
          style="width:100%;min-height:160px;font-family:monospace;font-size:0.85rem;padding:8px;border:1px solid #ccc;border-radius:4px;margin:8px 0;"
          data-ld-overrides-textarea
        >${escapeHtml(raw)}</textarea>
        <div class="row-actions" style="margin-top:16px;justify-content:flex-end;">
          <lex-btn variant="secondary" size="sm" data-ld-overrides-cancel>Cancel</lex-btn>
          <lex-btn variant="primary" size="sm" data-ld-overrides-save
            data-ld-overrides-matter="${escapeAttribute(modal.matterId || '')}">Save</lex-btn>
        </div>
      </div>
    </div>
  `;
}

function renderSettingsTab(context, automation) {
  const canToggle = canToggleVisibility(context, automation);
  const currentVisibility = automation.visibility || 'private';
  const nextVisibility = currentVisibility === 'org_wide' ? 'private' : 'org_wide';
  const nextVisibilityLabel = nextVisibility === 'org_wide' ? 'Make Org-Wide' : 'Make Private';
  const automationScope = resolveAutomationScope(automation);
  const scopeValue = automationScope.type === 'matter'
    ? renderMatterLink(context.state.links?.lana_client_url || '', automationScope.matterId, automationScope.matterName || automationScope.matterId, { prefix: 'Matter: ' })
    : escapeHtml(automationScope.label);

  return surface({
    title: 'Settings',
    body: `
      <div class="ld-settings-section">
        <h4>Scope</h4>
        <p class="muted">Controls where this automation is intended to run.</p>
        <div class="row-actions" style="margin-top:8px;">
          ${badge(automationScope.badge, automationScope.type === 'organization' ? 'info' : '')}
          <span>${scopeValue}</span>
        </div>
      </div>

      <div class="ld-settings-section">
        <h4>Visibility</h4>
        <p class="muted">Controls who can view and trigger this automation.</p>
        <div class="row-actions" style="margin-top:8px;">
          ${badge(visibilityLabel(currentVisibility), visibilityTone(currentVisibility))}
          ${canToggle ? `
            <lex-btn variant="secondary" size="sm" data-ld-toggle-visibility="${escapeAttribute(nextVisibility)}">
              ${escapeHtml(nextVisibilityLabel)}
            </lex-btn>
          ` : `<span class="muted" style="font-size:0.8rem;">Only the owner or an admin can change visibility.</span>`}
        </div>
      </div>

      ${renderMatterAttachmentsSection(context)}

      <div class="ld-settings-section ld-settings-danger">
        <h4>Danger Zone</h4>
        <p class="muted">Permanently delete this automation. This cannot be undone.</p>
        <div class="row-actions" style="margin-top:8px;">
          <lex-btn variant="danger" size="sm" data-ld-delete-automation>Delete Automation</lex-btn>
        </div>
      </div>
    `
  });
}

// ---------------------------------------------------------------------------
// Delete confirmation inline modal
// ---------------------------------------------------------------------------

function renderDeleteModal(automation) {
  return `
    <div class="ld-delete-modal-overlay" data-ld-delete-cancel>
      <div class="ld-delete-modal-panel" role="dialog" aria-modal="true">
        <h3>Delete this automation?</h3>
        <p>Deleting <strong>${escapeHtml(automation.automation_name || 'this automation')}</strong> is permanent and cannot be undone. All run history will remain in the database but the automation will no longer execute.</p>
        <div class="row-actions" style="margin-top:16px; justify-content:flex-end;">
          <lex-btn variant="secondary" size="sm" data-ld-delete-cancel>Cancel</lex-btn>
          <lex-btn variant="danger" size="sm" data-ld-delete-confirm>Delete Permanently</lex-btn>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Artifact view modal
// ---------------------------------------------------------------------------

function renderArtifactModal(artifact, modalView = 'default') {
  if (!artifact) return '';
  const payload = getArtifactDataPayload(artifact);
  const isTestRunReport = (artifact.artifact_type || artifact.type) === 'test_run_report';
  const isRedlineArtifact = (artifact.artifact_type || artifact.type) === 'document_redline';
  const hasInlineHtml = (artifact.artifact_type || artifact.type) === 'document_redline'
    && artifact.inline_data_is_html
    && typeof artifact.inline_data_preview === 'string'
    && artifact.inline_data_preview.length > 0;
  const isHtmlRedline = (artifact.artifact_type || artifact.type) === 'document_redline'
    && artifact.storage_type === 'minio'
    && typeof artifact.download_url === 'string'
    && artifact.download_url.length > 0;
  const summary = payload && payload.summary && typeof payload.summary === 'object'
    ? payload.summary
    : null;
  const reportMarkdown = payload && typeof payload.report_markdown === 'string'
    ? payload.report_markdown
    : null;
  const comparedDocuments = Array.isArray(artifact.compared_documents) ? artifact.compared_documents : [];
  const hasComparedDocuments = comparedDocuments.length > 0;
  const redlineChanges = hasInlineHtml ? extractRedlineChanges(artifact.inline_data_preview) : [];
  const hasChangeSummary = redlineChanges.length > 0;
  const resolvedModalView = modalView === 'compare' && hasComparedDocuments
    ? 'compare'
    : modalView === 'summary' && hasChangeSummary
      ? 'summary'
      : 'redline';
  const preview = reportMarkdown
    || (typeof artifact.inline_data_preview === 'string'
      ? artifact.inline_data_preview
      : JSON.stringify(payload || artifact.inline_data_preview || {}, null, 2));

  const body = isRedlineArtifact && resolvedModalView === 'summary'
    ? renderChangeSummaryView(redlineChanges, artifact)
    : isRedlineArtifact && resolvedModalView === 'compare'
    ? renderComparedDocumentsView(comparedDocuments, artifact.inline_data_preview)
    : hasInlineHtml && isRedlineArtifact
    ? `
      <div class="ld-redline-modal-shell" data-ld-redline-modal>
        <style>
          .ld-artifact-modal-overlay {
            position: fixed;
            inset: 0;
            z-index: 4000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: rgba(15, 23, 42, 0.48);
            backdrop-filter: blur(4px);
          }
          .ld-artifact-modal-panel {
            width: min(760px, calc(100vw - 48px));
            max-height: calc(100vh - 48px);
            overflow: auto;
            border-radius: 18px;
            background: #fff;
            box-shadow: 0 20px 60px rgba(15, 23, 42, 0.24);
            padding: 20px 22px;
          }
          .ld-artifact-modal-panel--fullscreen {
            width: min(96vw, 1760px);
            height: min(94vh, 1320px);
            max-height: none;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .ld-artifact-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }
          .ld-artifact-modal-header h3 {
            margin: 0;
            font-size: 1.1rem;
          }
          .ld-artifact-modal-meta {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
          }
          .ld-artifact-modal-body {
            margin: 0;
            padding: 14px;
            border-radius: 12px;
            border: 1px solid var(--lex-border-subtle, #e5e7eb);
            background: #f8fafc;
            overflow: auto;
            white-space: pre-wrap;
            font-size: 0.9rem;
            line-height: 1.5;
          }
          .ld-redline-modal-shell {
            display: flex;
            flex: 1;
            min-height: 0;
            flex-direction: column;
            gap: 14px;
            margin-top: 12px;
          }
          .ld-redline-modal-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
          }
          .ld-redline-modal-layout {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 360px;
            gap: 18px;
            min-height: 0;
            flex: 1;
          }
          .ld-redline-document-pane {
            min-width: 0;
            min-height: 0;
            border: 1px solid var(--lex-border-subtle, #e5e7eb);
            border-radius: 16px;
            overflow: hidden;
            background: #fff;
          }
          .ld-redline-document-frame {
            width: 100%;
            height: 100%;
            min-height: 70vh;
            border: 0;
            background: #fff;
          }
          .ld-redline-sidebar {
            min-width: 0;
            min-height: 0;
            border: 1px solid var(--lex-border-subtle, #e5e7eb);
            border-radius: 16px;
            background: #fcfcfd;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .ld-redline-sidebar__header {
            padding: 16px 16px 12px;
            border-bottom: 1px solid var(--lex-border-subtle, #e5e7eb);
          }
          .ld-redline-sidebar__header h4 {
            margin: 0 0 4px;
            font-size: 0.95rem;
          }
          .ld-redline-change-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px;
            overflow: auto;
          }
          .ld-redline-change-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            width: 100%;
            border: 1px solid #dbe3f0;
            border-radius: 12px;
            background: #fff;
            padding: 12px;
            text-align: left;
            cursor: pointer;
            transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
          }
          .ld-redline-change-item:hover,
          .ld-redline-change-item--active {
            border-color: #2563eb;
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
          }
          .ld-redline-change-item__index {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border-radius: 999px;
            background: rgba(37, 99, 235, 0.1);
            color: #1d4ed8;
            font-size: 0.8rem;
            font-weight: 700;
          }
          .ld-redline-change-item__content {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
          }
          .ld-redline-change-item__content strong,
          .ld-redline-change-item__content span {
            overflow-wrap: anywhere;
          }
          @media (max-width: 1180px) {
            .ld-redline-modal-layout {
              grid-template-columns: minmax(0, 1fr);
            }
            .ld-redline-sidebar {
              max-height: 260px;
            }
          }
        </style>
        <div class="ld-redline-modal-toolbar">
          <div class="ld-artifact-modal-meta">
            <span class="muted">${escapeHtml(String(redlineChanges.length))} indexed change${redlineChanges.length === 1 ? '' : 's'}</span>
            <span class="muted">Tap an item on the right to jump inside the document.</span>
          </div>
          <div class="row-actions">
            ${typeof artifact.download_url === 'string' && artifact.download_url
              ? `<a href="${escapeAttribute(artifact.download_url)}" target="_blank" rel="noopener noreferrer">Open redline in new tab</a>`
              : ''}
          </div>
        </div>
        <div class="ld-redline-modal-layout">
          <div class="ld-redline-document-pane">
            <iframe
              class="ld-redline-document-frame"
              data-ld-redline-frame
              srcdoc="${escapeAttribute(artifact.inline_data_preview)}"
              title="${escapeAttribute(artifact.artifact_name || artifact.name || 'Artifact Preview')}"
            ></iframe>
          </div>
          <aside class="ld-redline-sidebar">
            <div class="ld-redline-sidebar__header">
              <h4>Redline Index</h4>
              <div class="muted">Each item maps to a specific insertion or removal in the document.</div>
            </div>
            ${renderRedlineChangeList(redlineChanges)}
          </aside>
        </div>
      </div>
    `
    : hasInlineHtml
      ? `
        <div class="ld-artifact-modal-meta" style="margin-top:10px;">
          ${typeof artifact.download_url === 'string' && artifact.download_url
            ? `<a href="${escapeAttribute(artifact.download_url)}" target="_blank" rel="noopener noreferrer">Open redline in new tab</a>`
            : ''}
        </div>
        <iframe
          class="ld-artifact-modal-body"
          srcdoc="${escapeAttribute(artifact.inline_data_preview)}"
          title="${escapeAttribute(artifact.artifact_name || artifact.name || 'Artifact Preview')}"
          style="width:100%;min-height:70vh;border:1px solid var(--lex-border-subtle, #e5e7eb);border-radius:12px;background:#fff;"
        ></iframe>
      `
      : isHtmlRedline
        ? `
          <div class="ld-artifact-modal-meta" style="margin-top:10px;">
            <a href="${escapeAttribute(artifact.download_url)}" target="_blank" rel="noopener noreferrer">Open redline in new tab</a>
          </div>
          <iframe
            class="ld-artifact-modal-body"
            src="${escapeAttribute(artifact.download_url)}"
            title="${escapeAttribute(artifact.artifact_name || artifact.name || 'Artifact Preview')}"
            style="width:100%;min-height:70vh;border:1px solid var(--lex-border-subtle, #e5e7eb);border-radius:12px;background:#fff;"
          ></iframe>
        `
        : `<pre class="ld-artifact-modal-body">${escapeHtml(preview)}</pre>`;

  return `
    <div class="ld-artifact-modal-overlay" data-ld-artifact-modal-overlay>
      <div class="ld-artifact-modal-panel${isRedlineArtifact && hasInlineHtml ? ' ld-artifact-modal-panel--fullscreen' : ''}" role="dialog" aria-modal="true">
        <div class="ld-artifact-modal-header">
          <h3>${escapeHtml(artifact.artifact_name || artifact.name || 'Artifact')}</h3>
          <lex-btn variant="ghost" size="sm" data-ld-artifact-modal-close>Close</lex-btn>
        </div>
      <div class="ld-artifact-modal-meta">
          ${badge(formatLabel(artifact.artifact_type || artifact.type || 'output'))}
          <span class="muted">${escapeHtml(timeAgo(artifact.created_at))}</span>
        </div>
        ${isRedlineArtifact && hasComparedDocuments ? `
          <div class="ld-artifact-modal-view-switch">
            <button type="button" class="ld-artifact-modal-view-pill ${resolvedModalView === 'redline' ? 'ld-artifact-modal-view-pill--active' : ''}" data-ld-artifact-modal-view="redline">Redline</button>
            ${hasChangeSummary ? `<button type="button" class="ld-artifact-modal-view-pill ${resolvedModalView === 'summary' ? 'ld-artifact-modal-view-pill--active' : ''}" data-ld-artifact-modal-view="summary">Change Summary</button>` : ''}
            <button type="button" class="ld-artifact-modal-view-pill ${resolvedModalView === 'compare' ? 'ld-artifact-modal-view-pill--active' : ''}" data-ld-artifact-modal-view="compare">Compared Documents</button>
          </div>
        ` : isRedlineArtifact && hasChangeSummary ? `
          <div class="ld-artifact-modal-view-switch">
            <button type="button" class="ld-artifact-modal-view-pill ${resolvedModalView === 'redline' ? 'ld-artifact-modal-view-pill--active' : ''}" data-ld-artifact-modal-view="redline">Redline</button>
            <button type="button" class="ld-artifact-modal-view-pill ${resolvedModalView === 'summary' ? 'ld-artifact-modal-view-pill--active' : ''}" data-ld-artifact-modal-view="summary">Change Summary</button>
          </div>
        ` : ''}
        ${isTestRunReport && summary ? `
          <div class="ld-artifact-modal-meta" style="display:grid;gap:4px;margin-top:10px;">
            ${summary.verdict ? `<div><strong>Verdict:</strong> ${escapeHtml(summary.verdict)}</div>` : ''}
            ${summary.matrix_lane ? `<div><strong>Lane:</strong> ${escapeHtml(summary.matrix_lane)}</div>` : ''}
            ${summary.final_status ? `<div><strong>Status:</strong> ${escapeHtml(summary.final_status)}</div>` : ''}
            ${summary.execution_id ? `<div><strong>Execution:</strong> ${escapeHtml(summary.execution_id)}</div>` : ''}
            ${Number.isFinite(summary.verified_side_effects) ? `<div><strong>Verified Side Effects:</strong> ${escapeHtml(String(summary.verified_side_effects))}</div>` : ''}
          </div>
        ` : ''}
        ${body}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderLibraryDetail(context) {
  const { state, els } = context;
  const ld = state.libraryDetail;
  const container = els.viewContent;
  if (!container) return;

  if (!ld || !ld.automationId) {
    container.innerHTML = surface({
      title: 'Automation Not Found',
      body: `
        ${emptyState('No automation selected.')}
        <div class="row-actions" style="margin-top:16px;">
          <lex-btn variant="primary" size="sm" data-ld-back>Back to Library</lex-btn>
        </div>
      `
    });
    return;
  }

  const automation = ld.automation;

  if (!automation) {
    container.innerHTML = `
      <div class="connector-detail-shell">
        <header class="connector-detail-header">
          <div class="connector-detail-header-lead">
            <lex-btn variant="ghost" size="sm" data-ld-back>&larr; Back to Library</lex-btn>
          </div>
        </header>
        ${surface({ title: 'Loading…', body: '<div class="muted">Fetching automation details…</div>' })}
      </div>
    `;
    return;
  }

  const activeTab = ld.activeTab || 'steps';
  const isEnabled = Boolean(automation.is_enabled);
  const visibility = automation.visibility || 'private';
  const automationScope = resolveAutomationScope(automation);
  const showDeleteModal = Boolean(ld.deleteModalOpen);
  const showArtifactModal = Boolean(ld.artifactModalOpen);
  const scopeMetaValue = automationScope.type === 'matter'
    ? renderMatterLink(context.state.links?.lana_client_url || '', automationScope.matterId, automationScope.matterName || automationScope.matterId, { prefix: 'Matter: ' })
    : escapeHtml(automationScope.label);
  const timeZone = getOrganizationTimezone(context);

  const tabContent = activeTab === 'steps'
    ? renderStepsTab(automation)
    : activeTab === 'runs'
      ? renderRunsTab(context)
      : renderSettingsTab(context, automation);

  container.innerHTML = `
    <div class="connector-detail-shell" data-ld-root>
      <header class="connector-detail-header">
        <div class="connector-detail-header-lead">
          <lex-btn variant="ghost" size="sm" data-ld-back>
            <span aria-hidden="true">&larr;</span> Back to Library
          </lex-btn>
          <div class="connector-detail-identity">
            <div>
              <h2>${escapeHtml(automation.automation_name || 'Unnamed Automation')}</h2>
              <div class="connector-detail-meta">
                ${automation.automation_description ? `<span>${escapeHtml(automation.automation_description)}</span>` : ''}
              </div>
              <div class="badge-row connector-detail-badges">
                ${badge(isEnabled ? 'Enabled' : 'Disabled', isEnabled ? 'success' : '')}
                ${badge(automationScope.badge, automationScope.type === 'organization' ? 'info' : '')}
                ${badge(visibilityLabel(visibility), visibilityTone(visibility))}
                ${automation.category ? badge(escapeHtml(automation.category)) : ''}
                ${automation.automation_type ? badge(formatLabel(automation.automation_type)) : ''}
              </div>
            </div>
          </div>
        </div>

        <div class="connector-detail-header-trailing">
          <div class="connector-detail-actions">
            <lex-btn variant="primary" size="sm" data-ld-run-now>Run Now</lex-btn>
            <lex-btn variant="secondary" size="sm" data-ld-edit data-ld-edit-automation="${escapeAttribute(ld.automationId || '')}">Edit</lex-btn>
            <lex-btn variant="ghost" size="sm" data-ld-attach-to-matter title="Attach this automation to a matter">Attach to Matter</lex-btn>
            <lex-btn variant="ghost" size="sm" data-ld-duplicate>Duplicate</lex-btn>
            <lex-btn variant="ghost" size="sm" data-ld-toggle-activation>
              ${isEnabled ? 'Deactivate' : 'Activate'}
            </lex-btn>
          </div>
        </div>
      </header>

      <div class="ld-meta-row">
        ${metaGrid([
          { label: 'Created', value: formatDate(automation.created_at, { timeZone }) },
          { label: 'Updated', value: formatDate(automation.updated_at, { timeZone }) },
          { label: 'Scope', value: scopeMetaValue, isHtml: true },
          { label: 'Created By', value: escapeHtml(automation.created_by_name || 'System') }
        ])}
      </div>

      <div class="ld-tabs">
        <button class="ld-tab ${activeTab === 'steps' ? 'ld-tab--active' : ''}" data-ld-tab="steps">Steps</button>
        <button class="ld-tab ${activeTab === 'runs' ? 'ld-tab--active' : ''}" data-ld-tab="runs">Runs</button>
        <button class="ld-tab ${activeTab === 'settings' ? 'ld-tab--active' : ''}" data-ld-tab="settings">Settings</button>
      </div>

      <div class="ld-tab-content">
        ${tabContent}
      </div>

      ${showDeleteModal ? renderDeleteModal(automation) : ''}
      ${showArtifactModal ? renderArtifactModal(ld.modalArtifact, ld.artifactModalView || 'redline') : ''}
      ${renderAttachMatterModal(context)}
      ${renderEditOverridesModal(context)}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Handler called from app.js onAppClick — returns true if event was handled
// ---------------------------------------------------------------------------

export async function handleLibraryDetailClick(context, event) {
  const { state, fetchJson, authHeaders, flash, setView, refreshCurrentView, loadAutomations } = context;
  const ld = state.libraryDetail;
  if (!ld) return false;

  // Back button
  if (event.target.closest('[data-ld-back]')) {
    closeRunStream();
    state.currentView = 'library';
    state.libraryDetail = createLibraryDetailState();
    setView('library');
    await refreshCurrentView();
    return true;
  }

  // Tab switch
  const tabEl = event.target.closest('[data-ld-tab]');
  if (tabEl) {
    const tab = tabEl.dataset.ldTab;
    ld.activeTab = tab;
    if (tab === 'runs') {
      if (!ld.runs.length && !ld.runsLoading) {
        await loadAutomationRuns(context, ld.automationId, 0);
      }
      openRunStream(context, ld.automationId);
    } else if (tab === 'settings') {
      closeRunStream();
      // GAP #1: auto-load matter attachments when settings tab first opened
      if (ld.matterAttachments === null && !ld.matterAttachmentsLoading) {
        await loadMatterAttachments(context, ld.automationId);
      }
    } else {
      closeRunStream();
    }
    context.renderCurrentView();
    return true;
  }

  // Toggle run expand
  if (event.target.closest('[data-ld-matter-link]')) {
    return true;
  }

  const openResourceEl = event.target.closest('[data-ld-open-created-resource]');
  if (openResourceEl) {
    const resourceUrl = openResourceEl.dataset.ldOpenCreatedResource || '';
    openCreatedResourceUrl(resourceUrl);
    return true;
  }

  const toggleRunEl = event.target.closest('[data-ld-toggle-run]');
  if (toggleRunEl) {
    const runId = toggleRunEl.dataset.ldToggleRun;
    if (!runId) return true;

    if (ld.expandedRunId === runId) {
      ld.expandedRunId = null;
      ld.expandedRunDetail = null;
      ld.openStepDetails = {};
    } else {
      ld.expandedRunId = runId;
      ld.expandedRunDetail = null;
      ld.openStepDetails = {};
      context.renderCurrentView();

      try {
        const payload = await fetchJson(`/api/v1/automation/executions/${encodeURIComponent(runId)}`, {
          headers: authHeaders()
        });
        ld.expandedRunDetail = payload || null;
        if (ld.expandedRunDetail && typeof ld.expandedRunDetail === 'object') {
          ld.expandedRunDetail.open_step_details = { ...ld.openStepDetails };
        }
      } catch (err) {
        flash(err.message || 'Failed to load run detail.', true);
        ld.expandedRunId = null;
      }
    }
    context.renderCurrentView();
    return true;
  }

  const stepDetailSummaryEl = event.target.closest('[data-ld-step-detail-summary]');
  if (stepDetailSummaryEl) {
    const detailKey = stepDetailSummaryEl.dataset.ldStepDetailSummary;
    const detailEl = stepDetailSummaryEl.closest('[data-ld-step-detail]');
    if (detailKey && detailEl) {
      ld.openStepDetails = ld.openStepDetails && typeof ld.openStepDetails === 'object'
        ? ld.openStepDetails
        : {};
      const nextOpen = !detailEl.open;
      if (nextOpen) {
        ld.openStepDetails[detailKey] = true;
      } else {
        delete ld.openStepDetails[detailKey];
      }
      if (ld.expandedRunDetail && typeof ld.expandedRunDetail === 'object') {
        ld.expandedRunDetail.open_step_details = { ...ld.openStepDetails };
      }
    }
    return false;
  }

  // Runs pagination
  const runsPageEl = event.target.closest('[data-ld-runs-page]');
  if (runsPageEl) {
    const dir = runsPageEl.dataset.ldRunsPage;
    const limit = 25;
    const currentOffset = ld.runsOffset || 0;
    const nextOffset = dir === 'next' ? currentOffset + limit : Math.max(0, currentOffset - limit);
    await loadAutomationRuns(context, ld.automationId, nextOffset);
    context.renderCurrentView();
    return true;
  }

  // Run Now — enqueues a one-shot pg-boss job, independent of the automation's schedule.
  if (event.target.closest('[data-ld-run-now]')) {
    try {
      await fetchJson(`/api/v1/automations/${encodeURIComponent(ld.automationId)}/execute`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      flash('Run triggered.');
      ld.activeTab = 'runs';
      // Small delay so the execution row has a chance to materialize before refetching
      setTimeout(() => loadAutomationRuns(context, ld.automationId, 0).then(() => context.renderCurrentView()), 500);
      context.renderCurrentView();
    } catch (err) {
      flash(err.message || 'Failed to trigger run.', true);
    }
    return true;
  }

  // Edit — app.js intercepts data-ld-edit-automation via a separate handler that
  // calls gotoBuilder(undefined, automationId). Return false here so the delegated
  // handler in app.js runs instead.
  if (event.target.closest('[data-ld-edit]')) {
    return false;
  }

  // Duplicate
  if (event.target.closest('[data-ld-duplicate]')) {
    try {
      const automation = ld.automation;
      if (!automation) return true;
      const dupeConfig = {
        automation_name: `${automation.automation_name} (copy)`,
        automation_description: automation.automation_description || '',
        automation_type: automation.automation_type,
        category: automation.category,
        scope_type: automation.scope_type,
        matter_id: automation.matter_id,
        automation_config: automation.automation_config,
        visibility: 'private'
      };
      await fetchJson('/api/automations', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(dupeConfig)
      });
      await loadAutomations();
      flash('Automation duplicated as private.');
      setView('library');
      await refreshCurrentView();
    } catch (err) {
      flash(err.message || 'Failed to duplicate automation.', true);
    }
    return true;
  }

  // Toggle activation
  if (event.target.closest('[data-ld-toggle-activation]')) {
    const automation = ld.automation;
    if (!automation) return true;
    const isEnabled = Boolean(automation.is_enabled);
    try {
      await fetchJson(`/api/automations/${encodeURIComponent(ld.automationId)}/${isEnabled ? 'deactivate' : 'activate'}`, {
        method: 'POST',
        headers: authHeaders()
      });
      await reloadAutomation(context, ld.automationId);
      await loadAutomations();
      flash(`Automation ${isEnabled ? 'deactivated' : 'activated'}.`);
      context.renderCurrentView();
    } catch (err) {
      flash(err.message || 'Failed to toggle activation.', true);
    }
    return true;
  }

  // Visibility toggle
  const visibilityEl = event.target.closest('[data-ld-toggle-visibility]');
  if (visibilityEl) {
    const nextVisibility = visibilityEl.dataset.ldToggleVisibility;
    try {
      await fetchJson(`/api/v1/automations/${encodeURIComponent(ld.automationId)}/visibility`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ visibility: nextVisibility })
      });
      await reloadAutomation(context, ld.automationId);
      await loadAutomations();
      flash(`Visibility changed to ${visibilityLabel(nextVisibility)}.`);
      context.renderCurrentView();
    } catch (err) {
      flash(err.message || 'Failed to update visibility.', true);
    }
    return true;
  }

  // Delete — open confirm modal
  if (event.target.closest('[data-ld-delete-automation]')) {
    ld.deleteModalOpen = true;
    context.renderCurrentView();
    return true;
  }

  // Delete — cancel
  if (event.target.closest('[data-ld-delete-cancel]')) {
    ld.deleteModalOpen = false;
    context.renderCurrentView();
    return true;
  }

  // Delete — confirm
  if (event.target.closest('[data-ld-delete-confirm]')) {
    try {
      await fetchJson(`/api/v1/automations/${encodeURIComponent(ld.automationId)}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      await loadAutomations();
      flash('Automation deleted.');
      state.libraryDetail = createLibraryDetailState();
      setView('library');
      await refreshCurrentView();
    } catch (err) {
      flash(err.message || 'Failed to delete automation.', true);
      ld.deleteModalOpen = false;
      context.renderCurrentView();
    }
    return true;
  }

  // Artifact download
  const downloadEl = event.target.closest('[data-ld-artifact-download]');
  if (downloadEl) {
    const artifactId = downloadEl.dataset.ldArtifactDownload;
    if (artifactId) {
      window.open(getApiUrl(`/api/v1/automation/artifacts/${encodeURIComponent(artifactId)}/download`), '_blank', 'noopener,noreferrer');
    }
    return true;
  }

  // Artifact view modal
  const viewArtifactEl = event.target.closest('[data-ld-artifact-view]');
  if (viewArtifactEl) {
    const artifactId = viewArtifactEl.dataset.ldArtifactView;
    if (!artifactId) return true;
    try {
      const payload = await fetchJson(`/api/v1/automation/artifacts/${encodeURIComponent(artifactId)}`, {
        headers: authHeaders()
      });
      ld.modalArtifact = payload && payload.data ? payload.data : payload || null;
      ld.artifactModalOpen = true;
      ld.artifactModalView = 'redline';
    } catch (err) {
      flash(err.message || 'Failed to load artifact.', true);
    }
    context.renderCurrentView();
    return true;
  }

  const artifactModalViewEl = event.target.closest('[data-ld-artifact-modal-view]');
  if (artifactModalViewEl) {
    ld.artifactModalView = artifactModalViewEl.dataset.ldArtifactModalView || 'redline';
    context.renderCurrentView();
    return true;
  }

  const jumpChangeEl = event.target.closest('[data-ld-redline-jump]');
  if (jumpChangeEl) {
    const changeId = jumpChangeEl.dataset.ldRedlineJump;
    const changeOrder = Number(jumpChangeEl.dataset.ldRedlineOrder || 0);
    const modalEl = jumpChangeEl.closest('[data-ld-redline-modal]');
    if (!modalEl) {
      ld.artifactModalView = 'redline';
      context.renderCurrentView();

      const pendingJump = () => {
        const redlineModal = document.querySelector('[data-ld-redline-modal]');
        if (!redlineModal) return;
        const jumpCandidates = Array.from(redlineModal.querySelectorAll('[data-ld-redline-jump]'));
        const nextJumpEl = jumpCandidates.find((el) => el.dataset.ldRedlineJump === changeId)
          || jumpCandidates.find((el) => Number(el.dataset.ldRedlineOrder || 0) === changeOrder);
        if (nextJumpEl) {
          nextJumpEl.click();
        }
      };

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(pendingJump);
      } else {
        setTimeout(pendingJump, 0);
      }
      return true;
    }

    const frameEl = modalEl && modalEl.querySelector('[data-ld-redline-frame]');
    const targetDoc = frameEl && frameEl.contentDocument;
    if (frameEl && !targetDoc) {
      frameEl.addEventListener('load', () => {
        jumpChangeEl.click();
      }, { once: true });
      return true;
    }
    let targetNode = targetDoc && changeId ? targetDoc.getElementById(changeId) : null;

    if (!targetNode && targetDoc && changeOrder > 0) {
      const legacyNodes = Array.from(targetDoc.querySelectorAll('.added, .removed'));
      targetNode = legacyNodes[changeOrder - 1] || null;
    }

    if (modalEl) {
      modalEl.querySelectorAll('[data-ld-redline-jump]').forEach((el) => {
        el.classList.remove('ld-redline-change-item--active');
        el.setAttribute('aria-pressed', 'false');
      });
      jumpChangeEl.classList.add('ld-redline-change-item--active');
      jumpChangeEl.setAttribute('aria-pressed', 'true');
    }

    if (targetDoc) {
      targetDoc.querySelectorAll('.redline-change--active').forEach((el) => {
        el.classList.remove('redline-change--active');
      });
    }

    if (targetNode) {
      targetNode.classList.add('redline-change--active');
      targetNode.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }

    return true;
  }

  // Artifact modal close
  if (event.target.matches('[data-ld-artifact-modal-overlay]') || event.target.closest('[data-ld-artifact-modal-close]')) {
    ld.artifactModalOpen = false;
    ld.modalArtifact = null;
    ld.artifactModalView = 'redline';
    context.renderCurrentView();
    return true;
  }

  // ---------------------------------------------------------------------------
  // GAP #1: Load matter attachments
  // ---------------------------------------------------------------------------
  if (event.target.closest('[data-ld-load-attachments]')) {
    await loadMatterAttachments(context, ld.automationId);
    context.renderCurrentView();
    return true;
  }

  // ---------------------------------------------------------------------------
  // GAP #1: Open "Attach to Matter" modal
  // ---------------------------------------------------------------------------
  if (event.target.closest('[data-ld-attach-to-matter]')) {
    // Ensure settings tab is active if coming from header button
    if (ld.activeTab !== 'settings') {
      ld.activeTab = 'settings';
    }
    ld.attachMatterModal = { open: true, matters: [], query: '', loading: true };
    context.renderCurrentView();

    // Load active matters
    try {
      const payload = await fetchJson('/api/v1/matters?limit=100&status=active', {
        headers: authHeaders()
      });
      const matters = payload.matters || payload.data || [];
      ld.attachMatterModal.matters = matters;
      ld.attachMatterModal.loading = false;
    } catch (err) {
      ld.attachMatterModal.loading = false;
      flash(err.message || 'Failed to load matters.', true);
    }
    context.renderCurrentView();
    return true;
  }

  // Search filter in attach modal
  const attachSearchEl = event.target.closest('[data-ld-attach-matter-search]');
  if (attachSearchEl) {
    if (ld.attachMatterModal) {
      ld.attachMatterModal.query = attachSearchEl.value || '';
      context.renderCurrentView();
    }
    return true;
  }

  // Cancel attach modal — Cancel button or backdrop click (matches() only fires on direct overlay target)
  if (event.target.closest('[data-ld-attach-matter-cancel]') ||
      (event.target.matches && event.target.matches('[data-ld-attach-matter-overlay]'))) {
    ld.attachMatterModal = null;
    context.renderCurrentView();
    return true;
  }

  // Confirm attach — POST /api/v1/matters/:matterId/automations
  const confirmAttachEl = event.target.closest('[data-ld-confirm-attach-matter]');
  if (confirmAttachEl) {
    const matterId = confirmAttachEl.dataset.ldConfirmAttachMatter;
    if (!matterId) return true;
    try {
      await fetchJson(`/api/v1/matters/${encodeURIComponent(matterId)}/automations`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation_id: ld.automationId, enabled: true, config_overrides: {} })
      });
      ld.attachMatterModal = null;
      flash('Automation attached to matter.');
      // Reload attachments list
      await loadMatterAttachments(context, ld.automationId);
    } catch (err) {
      flash(err.message || 'Failed to attach to matter.', true);
    }
    context.renderCurrentView();
    return true;
  }

  // Detach from matter — DELETE /api/v1/matters/:matterId/automations/:automationId
  const detachEl = event.target.closest('[data-ld-detach-matter]');
  if (detachEl) {
    const matterId = detachEl.dataset.ldDetachMatter;
    if (!matterId) return true;
    try {
      await fetchJson(`/api/v1/matters/${encodeURIComponent(matterId)}/automations/${encodeURIComponent(ld.automationId)}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      flash('Automation detached from matter.');
      await loadMatterAttachments(context, ld.automationId);
    } catch (err) {
      flash(err.message || 'Failed to detach from matter.', true);
    }
    context.renderCurrentView();
    return true;
  }

  // Open edit-overrides modal
  const editOverridesEl = event.target.closest('[data-ld-edit-overrides]');
  if (editOverridesEl) {
    const matterId = editOverridesEl.dataset.ldOverrideMatter;
    const attachment = (ld.matterAttachments || []).find((a) => a.client_matter_id === matterId);
    const current = attachment ? JSON.stringify(attachment.config_overrides || {}, null, 2) : '{}';
    ld.editOverridesModal = { open: true, matterId, overridesJson: current };
    context.renderCurrentView();
    return true;
  }

  // Cancel edit overrides — Cancel button or backdrop click
  if (event.target.closest('[data-ld-overrides-cancel]') ||
      (event.target.matches && event.target.matches('[data-ld-overrides-overlay]'))) {
    ld.editOverridesModal = null;
    context.renderCurrentView();
    return true;
  }

  // Save overrides — PATCH /api/v1/matters/:matterId/automations/:automationId/config
  const saveOverridesEl = event.target.closest('[data-ld-overrides-save]');
  if (saveOverridesEl) {
    const matterId = saveOverridesEl.dataset.ldOverridesMatter;
    const textarea = document.querySelector('[data-ld-overrides-textarea]');
    const raw = textarea ? textarea.value : '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_e) {
      flash('Invalid JSON. Please fix and try again.', true);
      return true;
    }
    try {
      await fetchJson(`/api/v1/matters/${encodeURIComponent(matterId)}/automations/${encodeURIComponent(ld.automationId)}/config`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_overrides: parsed })
      });
      ld.editOverridesModal = null;
      flash('Config overrides saved.');
      await loadMatterAttachments(context, ld.automationId);
    } catch (err) {
      flash(err.message || 'Failed to save overrides.', true);
    }
    context.renderCurrentView();
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// GAP #9: SSE live run updates
// ---------------------------------------------------------------------------

// Module-level handle so we can close the stream when the detail view unmounts.
let _runStream = null;
let _runStreamAutomationId = null;
let _runStreamPollFallback = null;

/**
 * Open an EventSource to stream live execution status for the given automation.
 * Called when the Runs tab becomes active.
 *
 * On each `execution.started` / `execution.completed` / `execution.failed` event,
 * refreshes the run list in state and re-renders.
 *
 * Falls back to 5-second polling if EventSource is not supported or fails.
 *
 * @param {Object} context
 * @param {string} automationId
 */
export function openRunStream(context, automationId) {
  // Already streaming for this automation — no-op
  if (_runStream && _runStreamAutomationId === automationId) return;

  // Close any existing stream for a different automation
  closeRunStream();

  const { authHeaders, state, renderCurrentView } = context;
  const token = (authHeaders()['Authorization'] || '').replace('Bearer ', '');
  const url = getApiUrl(`/api/v1/automations/executions/stream?automationId=${encodeURIComponent(automationId)}&token=${encodeURIComponent(token)}`);

  function startPollingFallback() {
    _runStreamPollFallback = setInterval(async () => {
      const ld = state.libraryDetail;
      if (!ld || ld.activeTab !== 'runs') return;
      await loadAutomationRuns(context, automationId, ld.runsOffset || 0);
      renderCurrentView();
    }, 5000);
  }

  if (typeof EventSource === 'undefined') {
    startPollingFallback();
    return;
  }

  try {
    const es = new EventSource(url);
    _runStream = es;
    _runStreamAutomationId = automationId;

    const handleStatusChange = async () => {
      const ld = state.libraryDetail;
      if (!ld || ld.activeTab !== 'runs') return;
      await loadAutomationRuns(context, automationId, ld.runsOffset || 0);
      renderCurrentView();
    };

    es.addEventListener('execution.started', handleStatusChange);
    es.addEventListener('execution.completed', handleStatusChange);
    es.addEventListener('execution.failed', handleStatusChange);

    es.onerror = () => {
      // EventSource auto-reconnects on transient failures, but if it keeps
      // failing we fall back to polling.
      es.close();
      _runStream = null;
      _runStreamAutomationId = null;
      startPollingFallback();
    };
  } catch (_err) {
    startPollingFallback();
  }
}

/**
 * Close the active run stream (EventSource or polling fallback).
 * Call this when the detail view unmounts or the tab is switched away.
 */
export function closeRunStream() {
  if (_runStream) {
    _runStream.close();
    _runStream = null;
    _runStreamAutomationId = null;
  }
  if (_runStreamPollFallback) {
    clearInterval(_runStreamPollFallback);
    _runStreamPollFallback = null;
  }
}

// ---------------------------------------------------------------------------
// State factory (exported so app.js can reset it)
// ---------------------------------------------------------------------------

export function createLibraryDetailState(automationId = null) {
  return {
    automationId,
    automation: null,
    activeTab: 'steps',
    runs: [],
    runsLoading: false,
    runsOffset: 0,
    runsPagination: null,
    expandedRunId: null,
    expandedRunDetail: null,
    openStepDetails: {},
    deleteModalOpen: false,
    artifactModalOpen: false,
    modalArtifact: null,
    artifactModalView: 'redline',
    // GAP #1: matter attachments
    matterAttachments: null,
    matterAttachmentsLoading: false,
    attachMatterModal: null,
    editOverridesModal: null
  };
}

// ---------------------------------------------------------------------------
// Data loaders (exported so app.js can call them in refreshCurrentView)
// ---------------------------------------------------------------------------

export async function loadLibraryDetailAutomation(context, automationId) {
  const { fetchJson, authHeaders } = context;
  try {
    const payload = await fetchJson(`/api/v1/automations/${encodeURIComponent(automationId)}`, {
      headers: authHeaders()
    });
    context.state.libraryDetail.automation = payload.automation || payload || null;
  } catch (err) {
    context.state.libraryDetail.automation = null;
    throw err;
  }
}

export async function loadAutomationRuns(context, automationId, offset = 0) {
  const { fetchJson, authHeaders, state } = context;
  const ld = state.libraryDetail;
  if (!ld) return;
  ld.runsLoading = true;
  try {
    // GAP #2: Use unified endpoint that includes both direct and matter-attached runs,
    // plus triggered_by_name and trigger_source for GAP #12 audit display.
    const params = new URLSearchParams({ limit: '25', offset: String(offset) });
    const payload = await fetchJson(`/api/v1/automation/automations/${encodeURIComponent(automationId)}/runs-unified?${params.toString()}`, {
      headers: authHeaders()
    });
    ld.runs = payload.data || payload.runs || [];
    ld.runsOffset = offset;
    ld.runsPagination = payload.pagination || null;
  } catch (_err) {
    ld.runs = [];
  } finally {
    ld.runsLoading = false;
  }
}

/**
 * Load matter attachments for a automation into state.
 * GAP #1: Calls GET /api/v1/automation/automations/:automationId/matter-attachments.
 *
 * @param {Object} context
 * @param {string} automationId
 */
export async function loadMatterAttachments(context, automationId) {
  const { fetchJson, authHeaders, state } = context;
  const ld = state.libraryDetail;
  if (!ld || !automationId) return;
  ld.matterAttachmentsLoading = true;
  try {
    const payload = await fetchJson(
      `/api/v1/automation/automations/${encodeURIComponent(automationId)}/matter-attachments`,
      { headers: authHeaders() }
    );
    ld.matterAttachments = payload.data || [];
  } catch (_err) {
    ld.matterAttachments = [];
  } finally {
    ld.matterAttachmentsLoading = false;
  }
}

async function reloadAutomation(context, automationId) {
  try {
    await loadLibraryDetailAutomation(context, automationId);
  } catch (_err) {
    // best-effort
  }
}
