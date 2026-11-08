import { SYSTEM_CONNECTORS } from '../constants.js';
import { badge } from './ui.js';
import { escapeHtml, formatLabel, normalizeText } from './utils.js';

/**
 * Flexible match function used by findSystemDefaults. Case-insensitive.
 *
 *   match.ids   — checked against raw.connector_type / connector_id / id /
 *                 source_type / type
 *   match.names — checked against raw.name / connector_name / source_name /
 *                 metadata.name
 *
 * Returns true on first match, false if nothing lines up.
 */
function matchRaw(raw, match) {
  if (!raw || !match) return false;
  const idCandidates = [
    raw.connector_type,
    raw.connector_id,
    raw.id,
    raw.source_type,
    raw.type
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase().trim());
  const nameCandidate = String(
    raw.name || raw.connector_name || raw.source_name || raw.metadata?.name || ''
  ).toLowerCase().trim();

  if (Array.isArray(match.ids)) {
    const ids = match.ids.map((v) => String(v).toLowerCase().trim());
    if (idCandidates.some((c) => ids.includes(c))) return true;
  }
  if (nameCandidate && Array.isArray(match.names)) {
    const names = match.names.map((v) => String(v).toLowerCase().trim());
    if (names.includes(nameCandidate)) return true;
  }
  return false;
}


/**
 * Normalize a connector record into the shape the detail/list views expect.
 *
 * Handles two upstream shapes:
 *   1. Readiness/catalog shape from /api/connectors:
 *      { id, metadata: {name, description, category}, auth: {type}, version }
 *   2. Integrations shape from /api/integrations/connectors:
 *      { id, name, status, auth_type, ui_entry_point, manifest, last_sync_at, ... }
 *
 * Prefers manifest > raw field > metadata > system defaults > safe fallback.
 */
export function normalizeConnector(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const manifest = raw.manifest || {};
  const metadata = raw.metadata || {};
  const systemDefaults = findSystemDefaults(raw);

  const id = raw.id || raw.connector_id || raw.connector_type || raw.source_type || raw.type || manifest.id || null;
  // Backend path id — mirrors the simple string the backend uses in its per-connector
  // routes (e.g. 'leadly', 'actionstep'). Never falls back to systemDefaults so the
  // hardcoded metadata can't contaminate the real identifier.
  const connectorType = raw.connector_type
    || raw.source_type
    || raw.type
    || raw.connector_id
    || id;
  const sourceType = raw.source_type || raw.type || null;

  return {
    id,
    connector_id: raw.connector_id || id,
    connector_type: connectorType,
    instance_key: raw.instance_key || 'default',
    // Multi-instance capability flag from the manifest. When `enabled: true`,
    // the per-connector page should show an "Add another instance" button.
    // Source of truth is the backend's /api/v1/integrations/connectors response.
    multi_instance: raw.multi_instance || raw.manifest?.multi_instance || null,
    source_type: sourceType,
    type: sourceType,
    name: manifest.name
      || raw.name
      || raw.connector_name
      || metadata.name
      || systemDefaults?.name
      || 'Unnamed Connector',
    vendor: manifest.vendor
      || raw.vendor
      || metadata.vendor
      || systemDefaults?.vendor
      || null,
    description: manifest.description
      || raw.description
      || raw.connector_description
      || metadata.description
      || systemDefaults?.description
      || '',
    category: manifest.category
      || raw.category
      || raw.connector_category
      || metadata.category
      || systemDefaults?.category
      || 'unknown',
    auth_type: raw.auth_type
      || raw.authType
      || raw.auth?.type
      || manifest.auth?.type
      || systemDefaults?.auth_type
      || 'unknown',
    connector_scope: normalizeConnectorScope(
      raw.connector_scope
      || raw.scope
      || manifest.scope
      || metadata.scope
      || systemDefaults?.connector_scope
      || systemDefaults?.scope
    ),
    status: raw.status || 'disconnected',
    records: raw.records || raw.total_records || 0,
    last_sync: raw.lastSync || raw.last_sync || raw.last_sync_at || null,
    logo_url: manifest.icon
      || raw.logo_url
      || raw.logo
      || raw.icon
      || metadata.icon
      || null,
    capabilities: raw.capabilities?.length ? raw.capabilities : (systemDefaults?.capabilities || []),
    tags: raw.tags?.length ? raw.tags : (systemDefaults?.tags || []),
    documentation_url: raw.documentation_url || systemDefaults?.documentation_url || null,
    ui_entry_point: raw.ui_entry_point || manifest.ui_entry_point || null,
    ui_layout_id: raw.ui_layout_id || null,
    manifest,
    version: raw.version || manifest.version || null,
    allowDelete: systemDefaults ? systemDefaults.allowDelete !== false : true,
    isSystem: Boolean(systemDefaults),
    _raw: raw
  };
}

export function normalizeConnectorScope(scope) {
  const value = String(scope || '').trim().toLowerCase();
  if (value === 'user' || value === 'personal') return 'user';
  if (value === 'organization' || value === 'org' || value === 'firm') return 'org';
  return 'org';
}

export function connectorScopeLabel(connector) {
  return normalizeConnectorScope(
    connector?.connector_scope ||
    connector?.scope ||
    connector?.manifest?.scope ||
    connector?.metadata?.scope ||
    connector?._raw?.connector_scope ||
    connector?._raw?.manifest?.scope
  ) === 'user'
    ? 'Personal'
    : 'Firm';
}

/**
 * Match lookup across every field the backend might use to identify a
 * connector. Bridges the readiness-catalog side (`id: 'google-sheets'`) and
 * the installed-record side (`id: <UUID>, source_type: 'google-sheets',
 * connector_type: 'google-sheets', type: 'google-sheets', name: 'Google Sheets'`).
 *
 * Match priority:
 *   1. Exact id fields: id, connector_id, connector_type, source_type, type
 *   2. Normalized name match: raw.name / raw.connector_name / raw.source_name / raw.metadata?.name
 *
 * Normalization lowercases and collapses whitespace, hyphens, and underscores
 * so `"Google Sheets"`, `"google-sheets"`, and `"google_sheets"` all match.
 */
export function findConnectorById(list, id) {
  if (!Array.isArray(list) || !id) return null;
  const target = String(id);
  const normalizedTarget = normalizeMatchToken(target);

  return list.find((entry) => {
    if (!entry) return false;
    const idFields = [
      entry.id,
      entry.connector_id,
      entry.connector_type,
      entry.source_type,
      entry.type
    ];
    for (const field of idFields) {
      if (field == null) continue;
      if (String(field) === target) return true;
    }
    const nameFields = [
      entry.name,
      entry.connector_name,
      entry.source_name,
      entry.metadata?.name
    ];
    for (const field of nameFields) {
      if (!field) continue;
      if (normalizeMatchToken(String(field)) === normalizedTarget) return true;
    }
    return false;
  }) || null;
}

function normalizeMatchToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .trim();
}

function findSystemDefaults(raw) {
  if (!raw) return null;
  return SYSTEM_CONNECTORS.find((system) => {
    // Preferred path: explicit match criteria on the system entry.
    if (system.match && matchRaw(raw, system.match)) return true;
    // Legacy fallback: exact id / connector_type equality.
    const legacyMatch = {
      ids: [system.id, system.connector_type].filter(Boolean)
    };
    return matchRaw(raw, legacyMatch);
  }) || null;
}

/**
 * Build a normalized, deduplicated list of connectors by merging the
 * platform's installed list with the built-in system connectors.
 *
 * System connectors always appear, even when the backend returns nothing.
 * When an installed record matches a system seed (via id, connector_type,
 * source_type, or match criteria), their fields are merged: the installed
 * record wins for live fields (`ui_entry_point`, `manifest`, `status`,
 * `last_sync`, `config`), the system seed keeps its dashboard config and
 * allowDelete=false.
 */
export function indexConnectors(installed = []) {
  const entries = [];

  for (const system of SYSTEM_CONNECTORS) {
    const normalized = normalizeConnector({ ...system, status: 'disconnected' });
    if (normalized && normalized.id) {
      normalized.hasIntegrationSource = false;
      entries.push(normalized);
    }
  }

  for (const rawInstalled of installed) {
    const normalized = normalizeConnector(rawInstalled);
    if (!normalized) continue;
    normalized.hasIntegrationSource = true;

    // Installed rows must remain distinct. Only merge an installed row into
    // an existing non-installed seed entry, or back into itself by exact id.
    let existingIdx = entries.findIndex((e) => {
      if (normalized.id && e.id === normalized.id) return true;
      if (e.hasIntegrationSource) return false;
      if (normalized.connector_type && e.connector_type === normalized.connector_type) return true;
      if (normalized.source_type && e.source_type === normalized.source_type) return true;
      return false;
    });

    if (existingIdx === -1) {
      const candidateIds = [
        normalized.connector_type,
        normalized.source_type,
        normalized.id,
        normalized.name
      ].filter(Boolean);
      for (const candidate of candidateIds) {
        const hit = findConnectorById(entries, candidate);
        if (hit && (!hit.hasIntegrationSource || hit.id === normalized.id)) {
          existingIdx = entries.indexOf(hit);
          break;
        }
      }
    }

    if (existingIdx !== -1) {
      const existing = entries[existingIdx];
      entries[existingIdx] = {
        ...existing,
        ...normalized,
        ui_entry_point: normalized.ui_entry_point || existing.ui_entry_point,
        ui_layout_id: normalized.ui_layout_id || existing.ui_layout_id,
        manifest: normalized.manifest || existing.manifest,
        dashboard: normalized.dashboard || existing.dashboard,
        allowDelete: existing.allowDelete === false ? false : normalized.allowDelete,
        isSystem: existing.isSystem || normalized.isSystem,
        hasIntegrationSource: true
      };
    } else {
      entries.push(normalized);
    }
  }

  return entries;
}

// ── Readiness helpers for Home and the builder ─────────────────────────────
// Connectors are managed on the app-wide Data Connectors page. Automate only
// reads readiness: Home counts ready connectors, and the builder lists the
// connectors a template suggests.

export function connectorDisplayName(connector) {
  const raw = connector.metadata?.name || connector.name || connector.id || connector.connector_id || 'Connector';
  const base = formatLabel(raw);
  const instanceKey = connector.instance_key;
  if (instanceKey && instanceKey !== 'default') {
    return `${base} (${instanceKey})`;
  }
  return base;
}

/**
 * Status to label map. The backend pre-creates an integration_source row for
 * every known connector, so row presence does NOT mean "configured". The
 * real signal is `connector.status`:
 *
 *   connected | active | installed: configured and usable, "Ready"
 *   syncing: transient active state, "Syncing"
 *   error: actionable failure, "Error"
 *   coming_soon: catalog placeholder, "Coming Soon"
 *   not_configured | disconnected: needs setup, "Not Installed"
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
