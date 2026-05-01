import { badge, filterCollection, filterToolbar, listItem, sectionIntro, surface } from '../shared/ui.js';
import { escapeAttribute, escapeHtml, formatDate, timeAgo } from '../shared/utils.js';

function matchesAutomationState(item, filterState) {
  if (filterState === 'enabled') return Boolean(item.is_enabled);
  if (filterState === 'disabled') return !item.is_enabled;
  return true;
}

const SORT_FIELDS = {
  'created_at': (a) => new Date(a.created_at || 0).getTime(),
  'updated_at': (a) => new Date(a.updated_at || 0).getTime(),
  'automation_name': (a) => String(a.automation_name || '').toLowerCase(),
  'category': (a) => String(a.category || '').toLowerCase()
};

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
  const filters = context.state.filters.library || {};
  const isLoading = Boolean(context.state.libraryLoading);
  const templateLibrary = context.getTemplateLibrary();
  const filteredAutomations = filterCollection(
    context.state.automations,
    filters,
    (automation) => [
      automation.automation_name,
      automation.automation_description,
      automation.category,
      automation.automation_type
    ],
    (automation, filters) => matchesAutomationState(automation, filters.state)
  );
  const visibleAutomations = sortAutomations(filteredAutomations, filters);
  const perPage = Math.max(25, parseInt(filters.perPage, 10) || 25);
  const totalPages = Math.max(1, Math.ceil(visibleAutomations.length / perPage));
  const page = Math.min(Math.max(parseInt(filters.page, 10) || 1, 1), totalPages);
  const start = (page - 1) * perPage;
  const pagedAutomations = visibleAutomations.slice(start, start + perPage);

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
            <article class="choice-card template-carousel-card ${template.id === context.state.builder.templateId ? 'selected' : ''}">
              <div class="badge-row">
                ${badge(template.category)}
                ${badge(template.trigger)}
              </div>
              <h3>${escapeHtml(template.name)}</h3>
              <p class="template-preview-line">${escapeHtml(template.description || '')}</p>
              <div class="badge-row">
                ${(template.connectorHints || []).map((hint) => badge(hint)).join('')}
              </div>
              <div class="row-actions">
                <lex-btn variant="primary" size="sm" data-template-id="${escapeAttribute(template.id)}">Use Template</lex-btn>
                <lex-btn variant="ghost" size="sm" data-template-check-data="${escapeAttribute(template.id)}">Check Data First</lex-btn>
              </div>
            </article>
          `).join('')}
          </div>
        </div>
      `
    })}

    ${surface({
      title: 'Live Automations',
      subtitle: 'Existing automations already published through the shared API.',
      body: `
        ${filterToolbar({
          viewKey: 'library',
          searchPlaceholder: 'Search live automations by name, category, or description',
          totalCount: context.state.automations.length,
          visibleCount: visibleAutomations.length,
          filterDefs: [
            {
              field: 'state',
              label: 'State',
              options: [
                ['all', 'All'],
                ['enabled', 'Enabled'],
                ['disabled', 'Disabled']
              ]
            },
            {
              field: 'sortBy',
              label: 'Sort by',
              options: [
                ['created_at', 'Created'],
                ['updated_at', 'Last updated'],
                ['automation_name', 'Name'],
                ['category', 'Category']
              ]
            },
            {
              field: 'sortDir',
              label: 'Order',
              options: [
                ['desc', 'Newest first'],
                ['asc', 'Oldest first']
              ]
            }
          ],
          filters: {
            ...filters,
            sortBy: SORT_FIELDS[filters.sortBy] ? filters.sortBy : 'created_at',
            sortDir: filters.sortDir === 'asc' ? 'asc' : 'desc'
          }
        })}
        <div class="list">
          ${isLoading
            ? `
              <div class="muted" style="margin-bottom:12px;">Updating automation list…</div>
              ${renderLibraryLoadingRows(Math.min(Math.max(perPage >= 50 ? 5 : 4, 3), 5))}
            `
            : pagedAutomations.length
            ? pagedAutomations.map((automation) => `
            <article class="list-item list-item--clickable" data-open-library-detail="${escapeAttribute(automation.automation_id || '')}">
              <div class="list-item-main">
                <strong>${escapeHtml(automation.automation_name || 'Unnamed automation')}</strong>
                <div class="muted">${escapeHtml(automation.automation_description || automation.category || 'No description')}</div>
                <div class="list-item-body">
                  <div class="badge-row">
                    ${badge(automation.automation_type || 'automation')}
                    ${badge(automation.category || 'uncategorized')}
                    ${badge(automation.visibility === 'org_wide' ? 'Org-Wide' : 'Private', automation.visibility === 'org_wide' ? 'info' : '')}
                  </div>
                </div>
                <div class="list-item-meta">
                  <span class="list-item-meta-item" title="Created ${escapeAttribute(formatDate(automation.created_at))}">
                    <span class="list-item-meta-label">Created</span>
                    <span class="list-item-meta-value">${escapeHtml(timeAgo(automation.created_at))}</span>
                  </span>
                  <span class="list-item-meta-sep">·</span>
                  <span class="list-item-meta-item" title="Updated ${escapeAttribute(formatDate(automation.updated_at))}">
                    <span class="list-item-meta-label">Updated</span>
                    <span class="list-item-meta-value">${escapeHtml(timeAgo(automation.updated_at))}</span>
                  </span>
                </div>
              </div>
              <div class="list-item-aside">
                <div class="stack-sm">
                  <div class="badge-row">
                    ${badge(automation.is_enabled ? 'Enabled' : 'Disabled', automation.is_enabled ? 'success' : '')}
                  </div>
                  <lex-btn variant="secondary" size="sm" class="automation-toggle" data-automation-id="${escapeAttribute(automation.automation_id || '')}" data-enabled="${automation.is_enabled}">
                    ${automation.is_enabled ? 'Deactivate' : 'Activate'}
                  </lex-btn>
                </div>
              </div>
            </article>
          `).join('')
            : '<lex-empty message="No live automations match the current filter." icon="inbox"></lex-empty>'}
        </div>
        <div class="connectors-pagination">
          <div class="connectors-page-meta">
            Showing ${visibleAutomations.length ? start + 1 : 0}-${Math.min(start + perPage, visibleAutomations.length)} of ${visibleAutomations.length}
          </div>
          <div class="row-actions">
            <lex-btn variant="secondary" size="sm" data-library-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</lex-btn>
            <span class="connectors-page-indicator">Page ${page} of ${totalPages}</span>
            <lex-btn variant="secondary" size="sm" data-library-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next</lex-btn>
          </div>
        </div>
      `
    })}
  `;
}
