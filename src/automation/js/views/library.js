import {
  badge,
  createServerTableStore,
  dateTimeCell,
  invalidateServerTable,
  matterLinkCell,
  mountServerTable,
  mutedCell,
  nameCell,
  relativeTimeCell,
  sectionIntro,
  serverTableSection,
  surface,
  textCell
} from '../shared/ui.js';
import { escapeAttribute } from '../shared/utils.js';

const TABLE_ID = 'libraryAutomationsTable';
const TOOLBAR_PREFIX = 'libraryAutomations';
const Queries = () => window.AutomationTableQueries;

const STATE_COLORS = { active: 'success', inactive: '' };

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

function automationScope(automation) {
  const config = automation.automation_config || automation.config || {};
  const scope = config.scope && typeof config.scope === 'object' ? config.scope : { type: config.scope };
  const matterId = automation.matter_id || scope.matter_id || scope.matterId || automation.client_matter_id || '';
  const type = normalizeScopeType(scope.type || scope.scope_type || automation.scope_type || automation.scopeType)
    || (matterId ? 'matter' : 'organization');
  return {
    type,
    matterId: type === 'matter' ? matterId : '',
    matterName: type === 'matter' ? (automation.matter_name || scope.matter_name || '') : ''
  };
}

function automationState(automation) {
  if (typeof automation.is_enabled === 'boolean') return automation.is_enabled ? 'active' : 'inactive';
  if (typeof automation.is_active === 'boolean') return automation.is_active ? 'active' : 'inactive';
  const state = String(automation.state || automation.status || '').toLowerCase();
  return state === 'active' || state === 'enabled' ? 'active' : 'inactive';
}

// Rows keep raw values; the renderers format them.
export function mapAutomationRow(automation) {
  const scope = automationScope(automation);
  return {
    automation_id: automation.automation_id || automation.id || '',
    name: automation.automation_name || automation.name || 'Unnamed automation',
    description: automation.automation_description || automation.description || '',
    category: automation.category || '',
    automation_type: automation.automation_type || '',
    scope: scope.type,
    matter_id: scope.matterId,
    matter_name: scope.matterName,
    visibility: automation.visibility || 'private',
    state: automationState(automation),
    last_executed_at: automation.last_executed_at || '',
    created_at: automation.created_at || '',
    updated_at: automation.updated_at || '',
    _raw: automation
  };
}

function libraryStore(context) {
  context.state.tables = context.state.tables || {};
  if (!context.state.tables.library) {
    context.state.tables.library = { ...createServerTableStore(), facets: null, seen: { category: [], automation_type: [] } };
  }
  return context.state.tables.library;
}

export function invalidateLibraryTable(context) {
  invalidateServerTable(context.state.tables?.library);
}

function cellRenderers() {
  const Q = Queries();
  const label = (value) => (value ? textCell(Q.humanizeLabel(value)) : mutedCell());
  return {
    name: (value, row) => nameCell(value, row.description),
    category: label,
    automation_type: label,
    scope: (value, row) => {
      if (value === 'matter') return matterLinkCell(row.matter_id, row.matter_name, 'Matter');
      return value ? textCell(Q.humanizeLabel(value)) : mutedCell();
    },
    visibility: (value) => {
      const option = Q.VISIBILITY_OPTIONS.find((entry) => entry.value === value);
      return value ? textCell(option ? option.label : Q.humanizeLabel(value)) : mutedCell();
    },
    state: (value) => badge(Q.humanizeLabel(value || 'inactive'), STATE_COLORS[value] || ''),
    last_executed_at: relativeTimeCell,
    created_at: dateTimeCell,
    updated_at: relativeTimeCell
  };
}

function filterOptions(context, store) {
  const Q = Queries();
  const shared = window.LanaLibraryColumnFilters;
  const known = (context.state.automations || []);
  const categories = store.facets?.categories?.length
    ? store.facets.categories
    : [...known.map((item) => item.category), ...store.seen.category];
  const types = store.facets?.automation_types?.length
    ? store.facets.automation_types
    : [...known.map((item) => item.automation_type), ...store.seen.automation_type];
  // Every column filters: until the server lists types, offer the one the
  // builder creates.
  if (!types.filter(Boolean).length) types.push('automation');
  const map = {
    name: { text: true, placeholder: 'Name contains...' },
    category: { options: Q.optionsFromValues(categories) },
    automation_type: { options: Q.optionsFromValues(types) },
    scope: { options: Q.SCOPE_OPTIONS },
    visibility: { options: Q.VISIBILITY_OPTIONS },
    state: { options: Q.STATE_OPTIONS }
  };
  if (shared) {
    map.last_executed_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
    map.created_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
    map.updated_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
  }
  return map;
}

function applyFilterOptions(context, store) {
  const table = document.getElementById(TABLE_ID);
  if (table && typeof table.setColumnFilterOptions === 'function') {
    table.setColumnFilterOptions(filterOptions(context, store));
  }
}

// Category and type values in use; falls back to values seen when the
// facet endpoint is missing (servers before the automations facets route).
function loadFacets(context, store) {
  if (store.facetsRequested) return;
  store.facetsRequested = true;
  context.fetchJson('/api/automations/facets', { headers: context.authHeaders() })
    .then((response) => {
      const Q = Queries();
      store.facets = {
        categories: Q.facetValues(response, 'categories'),
        automation_types: Q.facetValues(response, 'automation_types')
      };
      applyFilterOptions(context, store);
    })
    .catch(() => {
      store.facets = null;
    });
}

function rememberSeen(context, store, rows) {
  let changed = false;
  ['category', 'automation_type'].forEach((field) => {
    rows.forEach((row) => {
      const value = row[field];
      if (value && !store.seen[field].includes(value)) {
        store.seen[field].push(value);
        changed = true;
      }
    });
  });
  if (changed && !store.facets) applyFilterOptions(context, store);
}

async function fetchAutomationsPage(context, query, search) {
  const Q = Queries();
  const params = Q.libraryParams(query, search);
  const response = await context.fetchJson(`/api/automations?${params.toString()}`, { headers: context.authHeaders() });
  const automations = response?.automations || response?.data || [];
  return {
    rows: automations.map(mapAutomationRow),
    pagination: Q.tablePagination(response, query, automations.length)
  };
}

export async function toggleAutomation(context, automationId, isEnabled) {
  try {
    await context.fetchJson(`/api/automations/${automationId}/${isEnabled ? 'deactivate' : 'activate'}`, {
      method: 'POST',
      headers: context.authHeaders()
    });
    invalidateLibraryTable(context);
    await context.loadAutomations();
    context.renderCurrentView();
    context.flash(`Automation ${isEnabled ? 'deactivated' : 'activated'}.`);
  } catch (error) {
    context.flash(error.message, true);
  }
}

export function renderLibrary(context) {
  const templateLibrary = context.getTemplateLibrary();
  const store = libraryStore(context);
  const Q = Queries();

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
            ${templateLibrary.map((template) => {
              const type = template.category || template.trigger || 'Template';
              return `
                <button
                  type="button"
                  class="template-carousel-card"
                  data-template-id="${escapeAttribute(template.id)}"
                  aria-label="Use ${escapeAttribute(template.name)} template"
                >
                  <span class="template-card-title">${escapeAttribute(template.name)}</span>
                  <span class="template-card-description">${escapeAttribute(template.description || '')}</span>
                  <span class="template-card-type">${escapeAttribute(type)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `
    })}

    ${serverTableSection({
      prefix: TOOLBAR_PREFIX,
      store,
      title: 'Live Automations',
      searchLabel: 'Search and filter automations',
      searchPlaceholder: 'Search automations...',
      sortOptions: [
        { value: 'updated_at', label: 'Updated' },
        { value: 'created_at', label: 'Created' },
        { value: 'last_executed_at', label: 'Last run' },
        { value: 'name', label: 'Name' },
        { value: 'category', label: 'Category' },
        { value: 'automation_type', label: 'Type' },
        { value: 'scope', label: 'Scope' },
        { value: 'visibility', label: 'Visibility' },
        { value: 'state', label: 'State' }
      ],
      filter: { label: 'State', key: 'state', options: Q.STATE_OPTIONS },
      table: {
        id: TABLE_ID,
        columns: ['name', 'category', 'automation_type', 'scope', 'visibility', 'state', 'last_executed_at', 'created_at', 'updated_at'],
        labels: ['Name', 'Category', 'Type', 'Scope', 'Visibility', 'State', 'Last run', 'Created', 'Updated'],
        sortableColumns: Object.keys(Q.LIBRARY_SORT_BY),
        sortBy: 'updated_at',
        sortDir: 'desc',
        idKey: 'automation_id',
        emptyText: 'No live automations yet',
        ariaLabel: 'Live automations'
      }
    })}
  `;

  mountServerTable({
    id: TABLE_ID,
    prefix: TOOLBAR_PREFIX,
    store,
    fetchPage: (query, search) => fetchAutomationsPage(context, query, search),
    renderers: cellRenderers(),
    filterOptions: () => filterOptions(context, store),
    filterKey: 'state',
    noun: ['automation', 'automations'],
    emptyText: {
      base: 'No live automations yet',
      filtered: 'No matching automations. Try a different search or filter.'
    },
    errorText: 'Automations could not be loaded. Check your connection and try again.',
    onLoaded: (result) => rememberSeen(context, store, result.rows),
    onRowClick: async (row) => {
      if (row?.automation_id && typeof context.gotoLibraryDetail === 'function') {
        await context.gotoLibraryDetail(row.automation_id);
      }
    }
  });
  loadFacets(context, store);
}
