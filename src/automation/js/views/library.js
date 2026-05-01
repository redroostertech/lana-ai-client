import { badge, hydrateLexDataTable, lexDataTable, sectionIntro, surface } from '../shared/ui.js';
import { escapeAttribute } from '../shared/utils.js';

const SORT_FIELDS = {
  'created_at': (a) => new Date(a.created_at || 0).getTime(),
  'updated_at': (a) => new Date(a.updated_at || 0).getTime(),
  'automation_name': (a) => String(a.automation_name || '').toLowerCase(),
  'category': (a) => String(a.category || '').toLowerCase()
};

function formatTableDateTime(value) {
  if (!value) return 'Unknown';

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';

  const pad = (part) => String(part).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  ].join(' ');
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

function scopeLabel(automation) {
  const config = automation.automation_config || automation.config || {};
  const scope = config.scope && typeof config.scope === 'object' ? config.scope : { type: config.scope };
  const type = normalizeScopeType(
    scope.type
    || scope.scope_type
    || automation.scope_type
    || automation.scopeType
    || ((scope.matter_id || scope.matterId || automation.matter_id || automation.client_matter_id) ? 'matter' : 'organization')
  );

  if (type === 'matter') {
    return `Matter: ${automation.matter_name || scope.matter_name || scope.matter_id || scope.matterId || automation.matter_id || automation.client_matter_id || 'Selected matter'}`;
  }

  return 'Organization-wide';
}

function sortAutomations(items, filters) {
  const sortBy = SORT_FIELDS[filters.sortBy] ? filters.sortBy : 'created_at';
  const sortDir = filters.sortDir === 'asc' ? 'asc' : 'desc';
  const getKey = SORT_FIELDS[sortBy];
  const getTieBreaker = SORT_FIELDS.automation_name;

  return [...items].sort((a, b) => {
    const aKey = getKey(a);
    const bKey = getKey(b);
    if (aKey < bKey) return sortDir === 'asc' ? -1 : 1;
    if (aKey > bKey) return sortDir === 'asc' ? 1 : -1;

    const aTie = getTieBreaker(a);
    const bTie = getTieBreaker(b);
    if (aTie < bTie) return -1;
    if (aTie > bTie) return 1;

    const aCreated = SORT_FIELDS.created_at(a);
    const bCreated = SORT_FIELDS.created_at(b);
    if (aCreated < bCreated) return sortDir === 'asc' ? -1 : 1;
    if (aCreated > bCreated) return sortDir === 'asc' ? 1 : -1;

    return 0;
  });
}

function renderLibraryLoadingRows(count = 4) {
  return `
    <style>
      .library-loading-list {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .library-loading-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 160px;
        gap: 18px;
        padding: 22px;
        border: 1px solid var(--lex-border-subtle, #e5e7eb);
        border-radius: 16px;
        background: linear-gradient(180deg, rgba(248,250,252,0.9), rgba(241,245,249,0.7));
      }
      .library-loading-stack {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .library-loading-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .library-loading-meta-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .library-loading-block {
        position: relative;
        overflow: hidden;
        border-radius: 999px;
        background: #e5e7eb;
        color: transparent;
        user-select: none;
      }
      .library-loading-block--soft {
        border-radius: 10px;
      }
      .library-loading-block::after {
        content: "";
        position: absolute;
        inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent);
        animation: library-loading-shimmer 1.35s ease-in-out infinite;
      }
      @keyframes library-loading-shimmer {
        100% { transform: translateX(100%); }
      }
      @media (max-width: 900px) {
        .library-loading-card {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    </style>
    <div class="library-loading-list" aria-busy="true" aria-live="polite">
      ${Array.from({ length: count }, (_, index) => `
        <article class="library-loading-card" aria-hidden="true">
          <div class="library-loading-stack">
            <div class="library-loading-block library-loading-block--soft" style="width:${index % 2 === 0 ? '36%' : '44%'};height:24px;">&nbsp;</div>
            <div class="library-loading-block library-loading-block--soft" style="width:92%;height:14px;">&nbsp;</div>
            <div class="library-loading-chip-row">
              <span class="library-loading-block" style="width:92px;height:26px;">&nbsp;</span>
              <span class="library-loading-block" style="width:108px;height:26px;">&nbsp;</span>
              <span class="library-loading-block" style="width:82px;height:26px;">&nbsp;</span>
            </div>
            <div class="library-loading-meta-row">
              <span class="library-loading-block" style="width:124px;height:12px;">&nbsp;</span>
              <span class="library-loading-block" style="width:132px;height:12px;">&nbsp;</span>
            </div>
          </div>
          <div class="library-loading-stack" style="align-items:flex-end;">
            <span class="library-loading-block" style="width:88px;height:26px;">&nbsp;</span>
            <span class="library-loading-block library-loading-block--soft" style="width:108px;height:34px;">&nbsp;</span>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

export async function toggleAutomation(context, automationId, isEnabled) {
  try {
    await context.fetchJson(`/api/automations/${automationId}/${isEnabled ? 'deactivate' : 'activate'}`, {
      method: 'POST',
      headers: context.authHeaders()
    });
    await context.loadAutomations();
    context.renderCurrentView();
    context.flash(`Automation ${isEnabled ? 'deactivated' : 'activated'}.`);
  } catch (error) {
    context.flash(error.message, true);
  }
}

export function renderLibrary(context) {
  const isLoading = Boolean(context.state.libraryLoading);
  const templateLibrary = context.getTemplateLibrary();
  const automationRows = sortAutomations(context.state.automations, { sortBy: 'updated_at', sortDir: 'desc' }).map((automation) => ({
    automation_id: automation.automation_id || '',
    automation_name: automation.automation_name || 'Unnamed automation',
    automation_description: automation.automation_description || automation.category || '',
    category: automation.category || 'uncategorized',
    automation_type: automation.automation_type || 'automation',
    scope: scopeLabel(automation),
    visibility: automation.visibility === 'org_wide' ? 'Org-Wide' : 'Private',
    state: automation.is_enabled ? 'active' : 'inactive',
    updated_at: formatTableDateTime(automation.updated_at || automation.created_at),
    created_at: automation.created_at || ''
  }));

  context.els.viewContent.innerHTML = `
    ${sectionIntro({
      eyebrow: 'Templates',
      title: 'Start from a known workflow pattern.',
      copy: 'Templates are the safe default. Pick one, then move into the builder to confirm data, scope, and publish settings.',
      badges: [
        badge(`${templateLibrary.length} starter templates`),
        badge(`${context.state.actionCatalog.length} registered action types`)
      ]
    })}

    ${surface({
      title: `Template Library (${templateLibrary.length})`,
      subtitle: 'Filesystem-backed templates from the project. Each one loads the builder with its starting trigger, scope, and workflow config.',
      body: `
        <div class="template-carousel">
          <div class="template-carousel-track">
            ${templateLibrary.map((template) => `
            <lex-action-card
              class="template-carousel-card ${template.id === context.state.builder.templateId ? 'selected' : ''}"
              title="${escapeAttribute(template.name)}"
              description="${escapeAttribute(template.description || '')}"
              tag="${escapeAttribute(template.category || template.trigger || 'Template')}"
              action="use-template"
              data-template-id="${escapeAttribute(template.id)}"
            ></lex-action-card>
          `).join('')}
          </div>
        </div>
      `
    })}

    ${surface({
      title: 'Live Automations',
      subtitle: 'Existing automations already published through the shared API.',
      body: `
        ${isLoading
          ? `
            <div class="muted" style="margin-bottom:12px;">Updating automation list...</div>
            ${renderLibraryLoadingRows(4)}
          `
          : lexDataTable({
            id: 'libraryAutomationsTable',
            columns: ['automation_name', 'category', 'automation_type', 'scope', 'visibility', 'state', 'updated_at'],
            labels: ['Name', 'Category', 'Type', 'Scope', 'Visibility', 'State', 'Updated'],
            emptyText: 'No live automations found',
            sortBy: 'updated_at',
            sortDir: 'desc',
            idKey: 'automation_id',
            limit: 20,
            ariaLabel: 'Live automations'
          })}
      `
    })}
  `;

  if (!isLoading) {
    hydrateLexDataTable('libraryAutomationsTable', automationRows, async (row) => {
      if (row?.automation_id && typeof context.gotoLibraryDetail === 'function') {
        await context.gotoLibraryDetail(row.automation_id);
      }
    });
  }
}
