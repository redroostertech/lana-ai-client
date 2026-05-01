import { SYSTEM_CONNECTORS } from '../constants.js';

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

export function isInstalled(connector) {
  if (!connector) return false;
  const status = String(connector.status || '').toLowerCase();
  return ['connected', 'active', 'installed', 'error', 'syncing'].includes(status);
}

/**
 * Build the URL for the lana-client page that manages a given connector.
 * Mirrors the routing in lana-client/src/js/data_connectors.js so a click
 * in the automation app opens the same page a lana-client user would see.
 *
 * The automation server mounts lana-client/src under /lex-framework on its
 * own origin (see @automation/server.js: `app.use('/lex-framework', ...)`),
 * so the URL is same-origin and needs no separate base.
 *
 * Precedence:
 *   1. Legacy system connectors (actionstep, leadly) → their dedicated page
 *   2. Connectors with a ui_entry_point → connector-viewer wrapper
 *   3. Everything else → generic integration-config page
 *
 * @param {Object} connector - Normalized connector record
 * @param {string} [baseUrl='/lex-framework'] - Optional override for the
 *        lana-client mount point. Defaults to the /lex-framework path that
 *        the automation server exposes.
 * @returns {string|null} Target URL, or null when the connector is missing.
 */
export function buildLanaClientConnectorUrl(connector, baseUrl = '/lex-framework') {
  if (!connector) return null;

  const base = String(baseUrl || '/lex-framework').replace(/\/+$/, '');
  const rowId = connector.id || '';
  // `connector_id` is the catalog slug (e.g., 'actionstep', 'google-sheets', 'mysql').
  // `connector_type` is now kept in sync with it by the backend, so match on both.
  const connectorSlug = String(
    connector.connector_id || connector.connector_type || connector.source_type || ''
  ).toLowerCase();

  if (connectorSlug === 'actionstep') {
    return `${base}/integrations/actionstep.html?id=${encodeURIComponent(rowId)}`;
  }

  if (connectorSlug === 'leadly') {
    return `${base}/integrations/leadly.html?id=${encodeURIComponent(rowId)}`;
  }

  if (connector.ui_entry_point) {
    const params = new URLSearchParams({
      ui: connector.ui_entry_point,
      name: connector.name || 'Connector',
      connectorId: rowId
    });
    return `${base}/integrations/connector-viewer.html?${params.toString()}`;
  }

  return `${base}/integrations/integration-config.html?id=${encodeURIComponent(rowId)}`;
}
