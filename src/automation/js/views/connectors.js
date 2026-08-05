import { badge, filterCollection, sectionIntro, surface } from '../shared/ui.js';
import { escapeAttribute, escapeHtml, formatLabel, normalizeText } from '../shared/utils.js';
import { hasAdminRole } from '../shared/access.js';
import { connectorScopeLabel } from '../shared/connectors.js';

export function connectorDisplayName(connector) {
  const raw = connector.metadata?.name || connector.name || connector.id || connector.connector_id || 'Connector';
  const base = formatLabel(raw);
  const instanceKey = connector.instance_key;
  if (instanceKey && instanceKey !== 'default') {
    return `${base} — ${instanceKey}`;
  }
  return base;
}

export function isMultiInstanceEnabled(connector) {
  return Boolean(connector?.multi_instance?.enabled);
}

/**
 * Status → label map. The backend pre-creates an integration_source row for
 * every known connector, so row presence does NOT mean "configured". The
 * real signal is `connector.status`:
 *
 *   connected | active | installed → user configured + usable → "Ready"
 *   syncing                        → transient active state   → "Syncing"
 *   error                          → actionable failure       → "Error"
 *   coming_soon                    → catalog placeholder      → "Coming Soon"
 *   not_configured | disconnected  → needs setup              → "Not Installed"
 */
const STATUS_MAP = {
  connected:      { label: 'Ready',         tone: 'success' },
  active:         { label: 'Ready',         tone: 'success' },
  installed:      { label: 'Ready',         tone: 'success' },
  syncing:        { label: 'Syncing',       tone: 'info'    },
  error:          { label: 'Error',         tone: 'error'   },
  coming_soon:    { label: 'Coming Soon',   tone: 'warning' },
  not_configured: { label: 'Not Installed', tone: ''        },
  disconnected:   { label: 'Not Installed', tone: ''        }
};

const READY_STATUSES = new Set(['connected', 'active', 'installed']);
const NOT_INSTALLED_STATUSES = new Set(['not_configured', 'disconnected']);

function resolveConnectorStatus(connector) {
  if (!connector) return 'not_configured';
  const raw = connector.status || connector._raw?.status;
  return String(raw || 'not_configured').toLowerCase();
}

export function connectorReadiness(_context, connector) {
  const status = resolveConnectorStatus(connector);
  return STATUS_MAP[status] || STATUS_MAP.not_configured;
}

export function isConnectorReady(connector) {
  return READY_STATUSES.has(resolveConnectorStatus(connector));
}

export function getConnectorList(context) {
  const catalog = Array.isArray(context?.state?.connectors) ? context.state.connectors : [];
  const indexed = Array.isArray(context?.state?.connectorIndex) ? context.state.connectorIndex : [];

  if (catalog.length === 0) return indexed;
  if (indexed.length === 0) return catalog;

  const installedById = new Map();
  for (const connector of indexed) {
    const keys = [
      connector?.id,
      connector?.connector_id,
      connector?.connector_type,
      connector?.source_type
    ];

    for (const key of keys) {
      const normalized = String(key || '').trim().toLowerCase();
      if (normalized && !installedById.has(normalized)) {
        installedById.set(normalized, connector);
      }
    }
  }

  return catalog.map((connector) => {
    const connectorId = String(connector?.id || connector?.connector_id || '').trim().toLowerCase();
    const installed = installedById.get(connectorId);
    if (!installed) return connector;

    return {
      ...installed,
      ...connector,
      id: connector.id || installed.id,
      connector_id: connector.connector_id || connector.id || installed.connector_id,
      status: installed.status || connector.status,
      ui_entry_point: installed.ui_entry_point || connector.ui_entry_point,
      dashboard: installed.dashboard || connector.dashboard,
      instance_key: installed.instance_key || connector.instance_key,
      multi_instance: installed.multi_instance || connector.multi_instance,
      _raw: installed._raw || installed
    };
  });
}

export function countReadyConnectors(context) {
  return getConnectorList(context).filter((connector) => isConnectorReady(connector)).length;
}

function getRecommendedTemplatesForConnector(context, connector) {
  const haystack = normalizeText([
    connectorDisplayName(connector),
    connector.metadata?.description,
    connector.metadata?.category,
    connector.auth?.type
  ].filter(Boolean).join(' '));

  return context.getTemplateLibrary().filter((template) =>
    (template.connectorHints || []).some((hint) => haystack.includes(normalizeText(hint)))
  );
}

export function connectorCompact(context, connector) {
  const readiness = connectorReadiness(context, connector);
  const snapshot = context.state.connectorHealth.find((entry) => entry.connector_id === (connector.id || connector.connector_id));
  const templateMatches = getRecommendedTemplatesForConnector(context, connector);

  return `
    <article class="check-item">
      <div class="badge-row">
        ${badge(readiness.label, readiness.tone)}
        ${badge(connectorScopeLabel(connector), connectorScopeLabel(connector) === 'Personal' ? 'info' : '')}
        ${badge(connector.auth?.type || connector.metadata?.category || 'runtime')}
      </div>
      <strong>${escapeHtml(connectorDisplayName(connector))}</strong>
      <p>${escapeHtml(connector.metadata?.description || 'No connector description available.')}</p>
      ${templateMatches.length ? `<div class="badge-row">${templateMatches.slice(0, 2).map((template) => badge(template.name)).join('')}</div>` : ''}
      ${snapshot && snapshot.status_reason ? `<p>${escapeHtml(snapshot.status_reason)}</p>` : ''}
    </article>
  `;
}

function matchesConnectorState(context, connector, filterState) {
  if (!filterState || filterState === 'all') return true;
  const status = resolveConnectorStatus(connector);

  if (filterState === 'ready') return isConnectorReady(connector);
  if (filterState === 'not_installed') return NOT_INSTALLED_STATUSES.has(status);
  if (filterState === 'error') return status === 'error';
  return true;
}

function connectorCategoryRaw(connector) {
  return String(connector?.category || connector?.metadata?.category || '').toLowerCase();
}

function connectorAuthRaw(connector) {
  return String(connector?.auth_type || connector?.auth?.type || '').toLowerCase();
}

function connectorVersionRaw(connector) {
  return String(connector?.version || '').trim();
}

function connectorScopeRaw(connector) {
  return connectorScopeLabel(connector).toLowerCase();
}

function matchesConnectorFilters(context, connector, filters) {
  if (!matchesConnectorState(context, connector, filters.state)) return false;
  if (filters.category && filters.category !== 'all' && connectorCategoryRaw(connector) !== filters.category) return false;
  if (filters.auth && filters.auth !== 'all' && connectorAuthRaw(connector) !== filters.auth) return false;
  if (filters.scope && filters.scope !== 'all' && connectorScopeRaw(connector) !== filters.scope) return false;
  if (filters.version && filters.version !== 'all' && connectorVersionRaw(connector) !== filters.version) return false;
  return true;
}

// Pull unique lowercased values for a given accessor, paired with the
// original raw value so we can prettify the label via formatLabel.
function uniqueOptions(list, accessor) {
  const seen = new Map();
  for (const item of list) {
    const raw = accessor(item);
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, raw);
    }
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([value, raw]) => ({ value, raw }));
}

function connectorSortValue(context, connector, sortBy) {
  if (sortBy === 'status') return connectorReadiness(context, connector).label;
  if (sortBy === 'category') return connector.category || connector.metadata?.category || '';
  if (sortBy === 'auth') return connector.auth_type || connector.auth?.type || '';
  if (sortBy === 'scope') return connectorScopeLabel(connector);
  if (sortBy === 'version') return connector.version || '1.0.0';
  if (sortBy === 'id') return connector.id || connector.connector_id || '';
  return connectorDisplayName(connector);
}

function connectorPinKey(connector) {
  return connector?.id || connector?.connector_id || connector?.connector_type || '';
}

export function isConnectorPinned(context, connector) {
  const pinned = context?.state?.pinnedConnectors;
  if (!Array.isArray(pinned) || pinned.length === 0) return false;
  const key = connectorPinKey(connector);
  return key ? pinned.includes(key) : false;
}

function sortConnectors(context, connectors, sortBy, sortDir) {
  const dir = sortDir === 'desc' ? -1 : 1;
  return [...connectors].sort((a, b) => {
    // Pinned connectors always float to the top, regardless of sort field
    const aPinned = isConnectorPinned(context, a);
    const bPinned = isConnectorPinned(context, b);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    const left = normalizeText(connectorSortValue(context, a, sortBy));
    const right = normalizeText(connectorSortValue(context, b, sortBy));
    if (left < right) return -1 * dir;
    if (left > right) return 1 * dir;
    return 0;
  });
}

function sortIndicator(filters, field) {
  if (filters.sortBy !== field) return '';
  return filters.sortDir === 'desc' ? ' ↓' : ' ↑';
}

function connectorTableRow(context, connector) {
  const readiness = connectorReadiness(context, connector);
  const connectorId = connector.id || connector.connector_id || '';
  const safeId = escapeAttribute(connectorId);
  const pinKey = connectorPinKey(connector);
  const safePinKey = escapeAttribute(pinKey);
  const pinned = isConnectorPinned(context, connector);
  const pinLabel = pinned ? 'Unpin connector' : 'Pin connector to top';
  const pinIcon = pinned
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.39 6.96L22 9.27l-5.45 4.73L17.82 22 12 18.27 6.18 22l1.27-7.99L2 9.27l7.61-.31L12 2z"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l2.39 6.96L22 9.27l-5.45 4.73L17.82 22 12 18.27 6.18 22l1.27-7.99L2 9.27l7.61-.31L12 2z"/></svg>';
  return `
    <tr class="connectors-row${pinned ? ' connectors-row-pinned' : ''}" data-open-connector-detail="${safeId}" tabindex="0" role="button" aria-label="Open ${escapeAttribute(connectorDisplayName(connector))}">
      <td class="connectors-pin-cell">
        <button
          type="button"
          class="connectors-pin-btn${pinned ? ' is-pinned' : ''}"
          data-connector-pin="${safePinKey}"
          aria-pressed="${pinned ? 'true' : 'false'}"
          aria-label="${escapeAttribute(pinLabel)}"
          title="${escapeAttribute(pinLabel)}"
        >${pinIcon}</button>
      </td>
      <td>${escapeHtml(connectorDisplayName(connector))}</td>
      <td>${escapeHtml(formatLabel(connector.category || connector.metadata?.category || 'connector'))}</td>
      <td>${escapeHtml(formatLabel(connector.auth_type || connector.auth?.type || 'runtime'))}</td>
      <td>${badge(connectorScopeLabel(connector), connectorScopeLabel(connector) === 'Personal' ? 'info' : '')}</td>
      <td>${badge(readiness.label, readiness.tone)}</td>
      <td>${escapeHtml(connector.version || '1.0.0')}</td>
      <td>
        <div class="connectors-row-actions">
          <lex-btn variant="secondary" size="sm" data-open-connector-detail="${safeId}">Open</lex-btn>
          ${isMultiInstanceEnabled(connector) ? `
            <lex-btn
              variant="ghost"
              size="sm"
              icon="true"
              data-connector-add-instance="${escapeAttribute(connector.connector_id || '')}"
              aria-label="Add another instance of ${escapeAttribute(connectorDisplayName(connector))}"
              title="Add another instance"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </lex-btn>
          ` : ''}
          ${connector.connector_id ? `
            <lex-btn
              variant="ghost"
              size="sm"
              icon="true"
              data-connector-update="${escapeAttribute(connector.connector_id)}"
              data-connector-update-name="${escapeAttribute(connectorDisplayName(connector))}"
              aria-label="Update ${escapeAttribute(connectorDisplayName(connector))}"
              title="Update connector (upload new version)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 11-3-6.7L21 8"/>
                <path d="M21 3v5h-5"/>
              </svg>
            </lex-btn>
          ` : ''}
        </div>
      </td>
    </tr>
  `;
}

// ---------------------------------------------------------------------------
// GAP #3: OAuth re-authorization warning banner helpers
// ---------------------------------------------------------------------------

/**
 * Write scopes that are required for write-capable actions for each connector.
 * Key = connector_id slug, value = array of required write scopes.
 */
const WRITE_SCOPES_REQUIRED = {
  gmail: ['https://www.googleapis.com/auth/gmail.send', 'https://mail.google.com/'],
  'google-gmail': ['https://www.googleapis.com/auth/gmail.send', 'https://mail.google.com/'],
  'google-calendar': ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'],
  'google-sheets': ['https://www.googleapis.com/auth/spreadsheets']
};

// Cut-off date: connections authorized before this date may lack write scopes
const WRITE_SCOPE_CUTOFF = new Date('2026-04-17T00:00:00Z');

/**
 * Check whether a connected source has the write scopes needed for automations.
 *
 * Strategy:
 *  1. If the source stores granted_scopes (array or space-separated string), check them.
 *  2. If scopes are unavailable (encrypted creds), fall back to checking the
 *     `updated_at` / `connected_at` date — connections before WRITE_SCOPE_CUTOFF
 *     may be missing write scopes.
 *
 * @param {Object} source - integration_source row (from context.state.integrationSources or connector._raw)
 * @param {string} connectorSlug
 * @returns {{ needsReauth: boolean, reason: string }}
 */
function checkWriteScopeGap(source, connectorSlug) {
  const required = WRITE_SCOPES_REQUIRED[connectorSlug];
  if (!required) return { needsReauth: false, reason: '' };

  // Try to read granted scopes from config or metadata
  const config = source.config || source.metadata || {};
  const rawScopes = config.granted_scopes || config.scopes || source.granted_scopes || null;

  if (rawScopes) {
    const granted = Array.isArray(rawScopes)
      ? rawScopes
      : String(rawScopes).split(/[\s,]+/).filter(Boolean);
    const hasAll = required.some((req) => granted.includes(req));
    return hasAll
      ? { needsReauth: false, reason: '' }
      : { needsReauth: true, reason: 'Missing required write scopes' };
  }

  // Scopes unavailable — use date-based heuristic
  const connectedAt = source.updated_at || source.connected_at || source.created_at;
  if (connectedAt && new Date(connectedAt) < WRITE_SCOPE_CUTOFF) {
    return {
      needsReauth: true,
      reason: 'Connected before April 17 2026 — may be missing write scopes'
    };
  }

  return { needsReauth: false, reason: '' };
}

/**
 * Return connector label used in banner copy.
 *
 * @param {string} slug
 * @returns {string}
 */
function connectorWriteLabel(slug) {
  if (slug === 'gmail' || slug === 'google-gmail') return 'send emails';
  if (slug === 'google-calendar') return 'create calendar events';
  if (slug === 'google-sheets') return 'write to Sheets';
  return 'perform write actions';
}

/**
 * Build re-auth warning banners for any ready connectors that may lack write
 * scopes.  Returns HTML string (empty if no warnings needed).
 *
 * @param {Object} context
 * @param {Array} connectorList
 * @returns {string}
 */
function buildReauthBanners(context, connectorList) {
  const dismissed = context.state.dismissedReauthBanners || [];
  const banners = [];

  // Find connected Google connectors that need re-auth
  const googleSlug = ['gmail', 'google-gmail', 'google-calendar', 'google-sheets'];

  for (const connector of connectorList) {
    const slug = String(connector.id || connector.connector_id || '').toLowerCase();
    if (!googleSlug.includes(slug)) continue;
    if (!isConnectorReady(connector)) continue;
    if (dismissed.includes(slug)) continue;

    // Use the connector's _raw source data if available, otherwise use the connector itself
    const source = connector._raw || connector;
    const { needsReauth, reason } = checkWriteScopeGap(source, slug);
    if (!needsReauth) continue;

    const label = connectorWriteLabel(slug);
    const name = escapeHtml(connectorDisplayName(connector));
    banners.push(`
      <div class="connector-reauth-banner" data-reauth-banner="${escapeAttribute(slug)}">
        <span class="connector-reauth-banner-icon" aria-hidden="true">&#9888;</span>
        <div class="connector-reauth-banner-body">
          <strong>${name} — Re-authorization required</strong>
          Automations that ${escapeHtml(label)} will fail until you re-connect this account.
          ${reason ? `<span class="muted" style="font-size:0.78rem;">(${escapeHtml(reason)})</span>` : ''}
          <div class="connector-reauth-banner-actions">
            <lex-btn variant="secondary" size="sm" data-connector-reauth="${escapeAttribute(connector.id || connector.connector_id || '')}">Re-authorize</lex-btn>
            <lex-btn variant="ghost" size="sm" data-dismiss-reauth-banner="${escapeAttribute(slug)}">Dismiss</lex-btn>
          </div>
        </div>
      </div>
    `);
  }

  return banners.join('');
}

export function renderConnectors(context) {
  const filters = context.state.filters.connectors || {};
  const checklistItems = [
    {
      done: context.state.connectors.length > 0,
      doneLabel: 'Done',
      todoLabel: 'Next',
      title: 'Connector catalog available',
      descriptionDone: 'The automation app can see registered connectors from LANA.',
      descriptionTodo: 'No connectors are visible yet. Review the LANA connector registry first.'
    },
    {
      done: countReadyConnectors(context) > 0,
      doneLabel: 'Done',
      todoLabel: 'Review',
      title: 'Usable connector runtime',
      descriptionDone: 'At least one connector looks ready for use in automations.',
      descriptionTodo: 'The catalog is visible, but the auth and runtime footprint still need review.'
    },
    {
      done: Boolean(context.state.onboardingState?.setup_state?.template_selected),
      doneLabel: 'Done',
      todoLabel: 'Next',
      title: 'Choose a workflow template',
      descriptionDone: 'A template has been selected and is ready for builder confirmation.',
      descriptionTodo: 'Select a template only after you know the data source exists and looks usable.'
    }
  ];
  const allChecklistDone = checklistItems.every((item) => item.done);
  const tableSource = getConnectorList(context);

  // Options for the new per-column dropdowns. Computed from the UNFILTERED
  // source so picking one filter doesn't erase the choices in the others.
  const categoryOptions = uniqueOptions(tableSource, (c) => connectorCategoryRaw(c));
  const authOptions = uniqueOptions(tableSource, (c) => connectorAuthRaw(c));
  const versionOptions = uniqueOptions(tableSource, (c) => connectorVersionRaw(c));

  const visibleConnectors = filterCollection(
    tableSource,
    filters,
    (connector) => [
      connectorDisplayName(connector),
      connector.description || connector.metadata?.description,
      connector.auth_type || connector.auth?.type,
      connectorScopeLabel(connector),
      connector.category || connector.metadata?.category
    ],
    (connector, activeFilters) => matchesConnectorFilters(context, connector, activeFilters)
  );
  const sorted = sortConnectors(context, visibleConnectors, filters.sortBy || 'name', filters.sortDir || 'asc');
  const perPage = Math.max(25, parseInt(filters.perPage, 10) || 25);
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const page = Math.min(Math.max(parseInt(filters.page, 10) || 1, 1), totalPages);
  const start = (page - 1) * perPage;
  const paged = sorted.slice(start, start + perPage);

  const canImport = hasAdminRole(context);

  const reauthBanners = buildReauthBanners(context, tableSource);

  context.els.viewContent.innerHTML = `
    ${sectionIntro({
      eyebrow: 'Data Readiness',
      title: 'Make sure the right connectors exist before you build.',
      copy: 'This page should answer a simple question: do we have the data source and auth shape needed for the automation we want to publish?',
      badges: [
        badge(`${context.state.connectors.length} connectors in catalog`, context.state.connectors.length ? 'success' : ''),
        badge(`${countReadyConnectors(context)} marked ready`, countReadyConnectors(context) ? 'success' : '')
      ]
    })}

    ${reauthBanners}

    ${canImport ? `
      <div class="connectors-admin-toolbar">
        <div class="connectors-admin-toolbar-copy">
          <strong>Import a custom connector</strong>
          <p class="muted">Upload a signed ZIP package containing a manifest, connector config, and optional custom UI.</p>
        </div>
        <lex-btn variant="primary" size="sm" data-connector-action="open-import">Import Connector ZIP</lex-btn>
      </div>
    ` : ''}

    ${context.state.connectorsChecklistHidden ? '' : surface({
      title: 'Connector Checklist',
      subtitle: 'Review auth type, runtime status, and where each connector helps in the builder.',
      body: `
        <div class="checklist connectors-checklist-row">
          ${checklistItems.map((item) => `
            <article class="check-item">
              <span class="check-state ${item.done ? 'done' : ''}">${item.done ? item.doneLabel : item.todoLabel}</span>
              <strong>${item.title}</strong>
              <p>${item.done ? item.descriptionDone : item.descriptionTodo}</p>
            </article>
          `).join('')}
        </div>
      `,
      footer: `
        <div class="row-actions">
          <lex-btn variant="primary" size="sm" data-app-action="refresh-connector-health">Refresh Readiness</lex-btn>
          <lex-btn variant="ghost" size="sm" data-open-view="library">Go To Template Library</lex-btn>
          ${allChecklistDone ? '<lex-btn variant="ghost" size="sm" data-app-action="hide-connectors-checklist">Hide Checklist</lex-btn>' : ''}
        </div>
      `
    })}

    ${surface({
      title: 'Connector Catalog',
      subtitle: 'Filesystem-backed connector definitions with runtime readiness overlaid from configured instances.',
      body: `
        <div class="connectors-table-toolbar">
          <label class="toolbar-search">
            <span class="sr-only">Search connectors</span>
            <input
              type="search"
              value="${escapeHtml(String(filters.query || ''))}"
              placeholder="Search connectors by name, auth type, or description"
              data-filter-view="connectors"
              data-filter-field="query"
            >
          </label>
          <label class="toolbar-select">
            <span>State</span>
            <select data-filter-view="connectors" data-filter-field="state">
              <option value="all" ${filters.state === 'all' ? 'selected' : ''}>All</option>
              <option value="ready" ${filters.state === 'ready' ? 'selected' : ''}>Ready</option>
              <option value="not_installed" ${filters.state === 'not_installed' ? 'selected' : ''}>Not Installed</option>
              <option value="error" ${filters.state === 'error' ? 'selected' : ''}>Error</option>
            </select>
          </label>
          <label class="toolbar-select">
            <span>Category</span>
            <select data-filter-view="connectors" data-filter-field="category">
              <option value="all" ${(filters.category || 'all') === 'all' ? 'selected' : ''}>All</option>
              ${categoryOptions.map(({ value, raw }) => `
                <option value="${escapeAttribute(value)}" ${filters.category === value ? 'selected' : ''}>${escapeHtml(formatLabel(raw))}</option>
              `).join('')}
            </select>
          </label>
          <label class="toolbar-select">
            <span>Auth</span>
            <select data-filter-view="connectors" data-filter-field="auth">
              <option value="all" ${(filters.auth || 'all') === 'all' ? 'selected' : ''}>All</option>
              ${authOptions.map(({ value, raw }) => `
                <option value="${escapeAttribute(value)}" ${filters.auth === value ? 'selected' : ''}>${escapeHtml(formatLabel(raw))}</option>
              `).join('')}
            </select>
          </label>
          <label class="toolbar-select">
            <span>Scope</span>
            <select data-filter-view="connectors" data-filter-field="scope">
              <option value="all" ${(filters.scope || 'all') === 'all' ? 'selected' : ''}>All</option>
              <option value="personal" ${filters.scope === 'personal' ? 'selected' : ''}>Personal</option>
              <option value="firm" ${filters.scope === 'firm' ? 'selected' : ''}>Firm</option>
            </select>
          </label>
          <label class="toolbar-select">
            <span>Version</span>
            <select data-filter-view="connectors" data-filter-field="version">
              <option value="all" ${(filters.version || 'all') === 'all' ? 'selected' : ''}>All</option>
              ${versionOptions.map(({ value, raw }) => `
                <option value="${escapeAttribute(value)}" ${filters.version === value ? 'selected' : ''}>${escapeHtml('v' + raw)}</option>
              `).join('')}
            </select>
          </label>
          <label class="toolbar-select">
            <span>Rows</span>
            <select data-filter-view="connectors" data-filter-field="perPage">
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
                <th class="connectors-pin-col"><span class="sr-only">Pinned</span></th>
                <th><button type="button" class="connectors-sort-btn" data-connectors-sort="name">Name${sortIndicator(filters, 'name')}</button></th>
                <th><button type="button" class="connectors-sort-btn" data-connectors-sort="category">Category${sortIndicator(filters, 'category')}</button></th>
                <th><button type="button" class="connectors-sort-btn" data-connectors-sort="auth">Auth${sortIndicator(filters, 'auth')}</button></th>
                <th><button type="button" class="connectors-sort-btn" data-connectors-sort="scope">Scope${sortIndicator(filters, 'scope')}</button></th>
                <th><button type="button" class="connectors-sort-btn" data-connectors-sort="status">Status${sortIndicator(filters, 'status')}</button></th>
                <th><button type="button" class="connectors-sort-btn" data-connectors-sort="version">Version${sortIndicator(filters, 'version')}</button></th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${paged.length
                ? paged.map((connector) => connectorTableRow(context, connector)).join('')
                : `<tr><td colspan="8" class="connectors-empty">No connectors match the current filters.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="connectors-pagination">
          <div class="connectors-page-meta">
            Showing ${sorted.length ? start + 1 : 0}-${Math.min(start + perPage, sorted.length)} of ${sorted.length}
          </div>
          <div class="row-actions">
            <lex-btn variant="secondary" size="sm" data-connectors-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</lex-btn>
            <span class="connectors-page-indicator">Page ${page} of ${totalPages}</span>
            <lex-btn variant="secondary" size="sm" data-connectors-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next</lex-btn>
          </div>
        </div>
      `
    })}
  `;
}
