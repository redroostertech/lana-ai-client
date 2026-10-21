import { badge, sectionIntro, surface } from '../shared/ui.js';
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

function connectorPinKey(connector) {
  return connector?.id || connector?.connector_id || connector?.connector_type || '';
}

export function isConnectorPinned(context, connector) {
  const pinned = context?.state?.pinnedConnectors;
  if (!Array.isArray(pinned) || pinned.length === 0) return false;
  const key = connectorPinKey(connector);
  return key ? pinned.includes(key) : false;
}

// ── Connector Catalog table (js/shared/connector-table.js) ────────────────
// The same lex-table as Data Connectors: client-side over the merged catalog,
// raw values in rows, readiness badges, and a Created column from the
// configured integration source (catalog-only rows have none).

const TABLE_ID = 'automationConnectorsTable';
const TABLE_PREFIX = 'automationConnectors';

function ConnectorTable() {
  return typeof window !== 'undefined' ? window.LanaConnectorTable : null;
}

function connectorTableStore(context) {
  context.state.tables = context.state.tables || {};
  if (!context.state.tables.connectors) context.state.tables.connectors = { query: null };
  return context.state.tables.connectors;
}

/**
 * One row of raw values for a connector.
 * @param {Object} context
 * @param {Object} connector - an entry of getConnectorList(context)
 */
export function connectorTableRow(context, connector) {
  const table = ConnectorTable();
  const raw = connector?._raw || {};
  const scope = connectorScopeLabel(connector) === 'Personal' ? 'user' : 'org';
  return {
    id: String(connector.id || connector.connector_id || ''),
    pin_key: connectorPinKey(connector),
    pinned: isConnectorPinned(context, connector) ? 'yes' : 'no',
    name: connectorDisplayName(connector),
    vendor: connector.vendor || connector.metadata?.vendor || '',
    description: connector.description || connector.metadata?.description || '',
    logo_url: connector.logo_url || connector.manifest?.icon || '',
    category: String(connector.category || connector.metadata?.category || '').toLowerCase(),
    auth_type: String(connector.auth_type || connector.auth?.type || '').toLowerCase(),
    scope,
    status: table ? table.automationStatusKey(resolveConnectorStatus(connector)) : resolveConnectorStatus(connector),
    version: String(connector.version || '').replace(/^v/i, ''),
    created_at: connector.created_at || raw.created_at || '',
    connector_id: connector.connector_id || '',
    multi_instance: isMultiInstanceEnabled(connector),
    _raw: connector
  };
}

// Open, Add instance and Update keep their data attributes: app.js handles
// them with its document-level click listener.
function connectorActionsCell(row) {
  const name = escapeAttribute(row.name);
  return `
    <lex-btn variant="secondary" size="sm" data-open-connector-detail="${escapeAttribute(row.id)}">Open</lex-btn>
    ${row.multi_instance ? `
      <lex-btn variant="ghost" size="sm" icon="true" data-connector-add-instance="${escapeAttribute(row.connector_id)}" aria-label="Add another instance of ${name}" title="Add another instance">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      </lex-btn>
    ` : ''}
    ${row.connector_id ? `
      <lex-btn variant="ghost" size="sm" icon="true" data-connector-update="${escapeAttribute(row.connector_id)}" data-connector-update-name="${name}" aria-label="Update ${name}" title="Update connector (upload new version)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
      </lex-btn>
    ` : ''}
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

  const Table = ConnectorTable();
  const store = connectorTableStore(context);
  // The view re-renders by replacing innerHTML: keep the table's query.
  const previous = typeof document !== 'undefined' ? document.getElementById(TABLE_ID) : null;
  if (previous && Table) store.query = Table.snapshot(previous) || store.query;

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

    ${Table
      ? Table.sectionMarkup({
        prefix: TABLE_PREFIX,
        tableId: TABLE_ID,
        title: 'Connector Catalog',
        subtitle: 'Filesystem-backed connector definitions with runtime readiness overlaid from configured instances.',
        query: store.query
      })
      : emptyStateMarkup()}
  `;

  if (Table) {
    Table.mount({
      prefix: TABLE_PREFIX,
      tableId: TABLE_ID,
      rows: tableSource.map((connector) => connectorTableRow(context, connector)),
      statuses: Table.AUTOMATION_STATUSES,
      store,
      actionsCell: connectorActionsCell,
      // A row click does what its Open button does (app.js opens the connector).
      onRowClick: (row) => {
        const table = document.getElementById(TABLE_ID);
        const open = table ? Array.from(table.querySelectorAll('[data-open-connector-detail]'))
          .find((button) => button.getAttribute('data-open-connector-detail') === row.id) : null;
        if (open) open.click();
      }
    });
  }
}

function emptyStateMarkup() {
  return '<p class="muted">The connector table could not be loaded.</p>';
}
