import { badge, surface } from '../shared/ui.js';
import { escapeAttribute, escapeHtml, formatLabel, timeAgo } from '../shared/utils.js';
import { connectorScopeLabel, findConnectorById, isInstalled, normalizeConnector } from '../shared/connectors.js';
import { resolveAutomationApiBaseUrl } from '../shared/api-base-url.js';
import { loadCustomConnectorUi } from '../shared/custom-ui-loader.js';

/**
 * Connector detail view.
 *
 * Two render paths only:
 *   1. Connector has a `ui_entry_point` URL — iframe it via the standard
 *      custom-ui-loader pipeline. The connector's own ZIP UI handles
 *      configuration, sync, output display, etc. The automation app is
 *      just a viewer shell.
 *   2. Connector has no `ui_entry_point` — show a minimal info card with
 *      the connector's metadata and a note that it's currently managed
 *      elsewhere. This is the temporary state for legacy connectors
 *      (Leadly, ActionStep, GoHighLevel) until they're converted into
 *      ZIP-style imports with their own `ui/index.html`.
 *
 * No dashboard template. No tab system. No per-connector layout.
 * No metric cards, configuration forms, sync triggers, or output tables.
 * The connector's own UI handles all of that.
 */

const IFRAME_ID = 'connector-detail-frame';

let activeCleanup = null;
let currentEntryPoint = null;

export function teardownConnectorDetail() {
  if (typeof activeCleanup === 'function') {
    try { activeCleanup(); } catch (_e) {}
  }
  activeCleanup = null;
  currentEntryPoint = null;
}

/**
 * Render a single integration source row with a "Set as Default" button.
 * GAP #10: shown in the Managed Accounts section.
 *
 * @param {Object} source - integration_source row
 * @returns {string}
 */
function renderSourceRow(source) {
  const sourceId = escapeAttribute(source.id || '');
  const sourceName = escapeHtml(source.source_name || source.id || 'Account');
  const isDefault = Boolean(source.is_default);
  const statusLabel = escapeHtml(formatLabel(source.auth_status || 'unknown'));
  const statusTone = source.auth_status === 'connected' ? 'success'
    : source.auth_status === 'error' ? 'error' : '';
  return `
    <div class="connector-source-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--surface-border,#eee);">
      <div style="flex:1;">
        <strong>${sourceName}</strong>
        <span style="margin-left:8px;">${badge(statusLabel, statusTone)}</span>
        ${isDefault ? `<span style="margin-left:4px;">${badge('Default', 'success')}</span>` : ''}
      </div>
      ${!isDefault ? `
        <lex-btn
          variant="secondary"
          size="sm"
          data-connector-set-default="${sourceId}"
          title="Mark this account as the default for automations">Set as Default</lex-btn>
      ` : `<span class="muted" style="font-size:0.8rem;">Current default</span>`}
    </div>
  `;
}

export function renderConnectorDetail(context) {
  const { state, els } = context;
  const selectedId = state.connectorDetail?.selectedId || null;
  const container = els.viewContent;
  if (!container) return;

  if (!selectedId) {
    container.innerHTML = renderMissingSelection();
    return;
  }

  const connector = resolveConnector(state, selectedId);
  if (!connector) {
    container.innerHTML = renderNotFound(selectedId);
    return;
  }

  const hasCustomUi = Boolean(connector.ui_entry_point);
  const installed = isInstalled(connector);
  const statusTone = statusToTone(connector.status);
  const statusLabel = formatLabel(connector.status) || 'Installed';

  container.innerHTML = `
    <section class="connector-detail-shell" data-connector-detail-root>
      <header class="connector-detail-header">
        <div class="connector-detail-header-lead">
          <lex-btn variant="ghost" size="sm" data-connector-action="back">
            <span aria-hidden="true">&larr;</span>
            Back to Connectors
          </lex-btn>
          <div class="connector-detail-identity">
            <div class="connector-detail-logo">${renderLogo(connector)}</div>
            <div>
              <h2>${escapeHtml(connector.name)}</h2>
              <div class="connector-detail-meta">
                ${connector.vendor ? `<span>${escapeHtml(connector.vendor)}</span>` : ''}
                ${connector.vendor ? '<span class="dot">&middot;</span>' : ''}
                <span>${escapeHtml(formatLabel(connector.category) || 'Connector')}</span>
                ${connector.version ? `<span class="dot">&middot;</span><span>v${escapeHtml(connector.version)}</span>` : ''}
              </div>
              <div class="badge-row connector-detail-badges">
                ${badge(statusLabel, statusTone)}
                ${badge(connectorScopeLabel(connector), connectorScopeLabel(connector) === 'Personal' ? 'info' : '')}
                ${connector.isSystem ? badge('System', 'info') : ''}
                ${hasCustomUi ? badge('Custom UI', 'success') : ''}
              </div>
            </div>
          </div>
        </div>

        <div class="connector-detail-header-trailing">
          ${connector.last_sync ? renderLastSyncPill(connector) : ''}
          <div class="connector-detail-actions">
            <button type="button" class="lana-dock-trigger" data-lana-dock-trigger data-lana-context-type="full_chat" aria-label="Ask LANA" title="Ask LANA">
              <span class="lana-dock-trigger-icon" aria-hidden="true">
                <svg viewBox="0 0 12 12"><path d="M1 5V1h4"/><path d="M11 7v4H7"/></svg>
                <svg viewBox="0 0 12 12"><path d="M1 5V1h4"/><path d="M11 7v4H7"/></svg>
              </span>
              <span>LANA</span>
            </button>
            ${renderHeaderActions(connector)}
          </div>
        </div>
      </header>

      ${renderBreadcrumb(connector)}

      <div class="connector-detail-body" data-connector-detail-body>
        ${hasCustomUi
          ? renderIframeHost(connector)
          : renderManagedExternallyCard(connector, state.connectorDetail?.sourcesState || null)}
      </div>
    </section>
  `;

  if (hasCustomUi) {
    mountCustomUi(context, connector);
  } else {
    teardownConnectorDetail();
  }
}

function resolveConnector(state, id) {
  const direct = findConnectorById(state.connectorIndex || [], id);
  if (direct) return direct;
  const fromReadiness = findConnectorById(state.connectors || [], id);
  return fromReadiness ? normalizeConnector(fromReadiness) : null;
}

function renderHeaderActions(connector) {
  const installed = isInstalled(connector);
  const actions = [];

  if (installed) {
    actions.push(`
      <lex-btn variant="secondary" size="sm" data-connector-action="uninstall">Uninstall</lex-btn>
    `);
  }

  if (connector.allowDelete) {
    actions.push(`
      <lex-btn variant="danger" size="sm" data-connector-action="delete">Delete</lex-btn>
    `);
  }

  actions.push(`
    <lex-btn variant="ghost" size="sm" data-connector-action="use-in-builder">Use In Builder</lex-btn>
  `);

  if (connector.documentation_url) {
    actions.push(`
      <lex-btn variant="ghost" size="sm" as="a" href="${escapeAttribute(connector.documentation_url)}" target="_blank" rel="noopener noreferrer">Docs</lex-btn>
    `);
  }

  return actions.join('');
}

function renderLastSyncPill(connector) {
  const lastSync = connector.last_sync || null;
  const label = lastSync ? timeAgo(lastSync) : 'Never';
  return `
    <div class="connector-detail-last-sync">
      <span class="connector-detail-last-sync-label">Last Sync</span>
      <strong>${escapeHtml(label)}</strong>
    </div>
  `;
}

function renderBreadcrumb(connector) {
  const items = [
    { label: 'Connectors', href: '#connectors' },
    { label: connector.name || 'Connector' }
  ];
  return `<lex-breadcrumb class="connector-detail-breadcrumb" items="${escapeAttribute(JSON.stringify(items))}"></lex-breadcrumb>`;
}

function renderFallbackBreadcrumb(label) {
  const items = [
    { label: 'Connectors', href: '#connectors' },
    { label: label || 'Connector' }
  ];
  return `<lex-breadcrumb class="connector-detail-breadcrumb" items="${escapeAttribute(JSON.stringify(items))}"></lex-breadcrumb>`;
}

function renderIframeHost(connector) {
  return `
    <div class="connector-detail-iframe-wrap">
      <div class="connector-detail-iframe-overlay" data-connector-iframe-overlay>
        <div class="connector-detail-iframe-spinner"></div>
        <p>Loading ${escapeHtml(connector.name)}&hellip;</p>
      </div>
      <div class="connector-detail-iframe-error hidden" data-connector-iframe-error>
        <strong>Failed to load connector UI.</strong>
        <p data-connector-iframe-error-message></p>
        <lex-btn variant="secondary" size="sm" data-connector-action="retry-ui">Retry</lex-btn>
      </div>
      <iframe
        id="${IFRAME_ID}"
        class="connector-detail-iframe"
        title="${escapeAttribute(connector.name)}"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        allow="clipboard-read; clipboard-write"
      ></iframe>
    </div>
  `;
}

/**
 * Fallback shown for connectors that don't have a `ui_entry_point` yet.
 * Currently the only connectors that hit this path are the legacy system
 * connectors (Leadly, ActionStep, GoHighLevel). Once they're converted into
 * ZIP-style imports with their own `ui/index.html` uploaded to MinIO, this
 * branch becomes effectively unreachable.
 *
 * @param {Object} connector - normalized connector
 * @param {Object} sourcesState - { sources: [], loading: boolean, loaded: boolean }
 */
function renderManagedExternallyCard(connector, sourcesState) {
  const sections = [];

  if (connector.description) {
    sections.push(`<p class="connector-managed-externally-description">${escapeHtml(connector.description)}</p>`);
  }

  const meta = [];
  const categoryLabel = formatLabel(connector.category);
  if (categoryLabel && connector.category !== 'unknown') meta.push({ label: 'Category', value: categoryLabel });
  if (connector.auth_type && connector.auth_type !== 'unknown') meta.push({ label: 'Authentication', value: formatLabel(connector.auth_type) });
  meta.push({ label: 'Scope', value: connectorScopeLabel(connector) });
  if (connector.version) meta.push({ label: 'Version', value: `v${connector.version}` });
  if (connector.vendor) meta.push({ label: 'Vendor', value: connector.vendor });

  if (meta.length) {
    sections.push(`
      <div class="meta-grid">
        ${meta.map((item) => `
          <div class="meta-item">
            <span class="meta-label">${escapeHtml(item.label)}</span>
            <div class="meta-value">${escapeHtml(item.value)}</div>
          </div>
        `).join('')}
      </div>
    `);
  }

  if (connector.capabilities && connector.capabilities.length) {
    sections.push(`
      <div class="connector-detail-chips">
        <h4>Capabilities</h4>
        <div class="badge-row">
          ${connector.capabilities.map((cap) => badge(formatLabel(cap), 'info')).join('')}
        </div>
      </div>
    `);
  }

  // GAP #10: Managed Accounts section — show connected sources with Set Default button.
  // For connectors with multiple accounts, only one can be the default used by automations.
  const connectorSlug = connector.connector_id || connector.id || '';
  let accountsBody;
  if (sourcesState && sourcesState.loading) {
    accountsBody = '<div class="muted">Loading accounts…</div>';
  } else if (sourcesState && sourcesState.loaded && sourcesState.sources.length > 0) {
    accountsBody = sourcesState.sources.map((s) => renderSourceRow(s)).join('');
    if (sourcesState.sources.length > 1) {
      accountsBody += `
        <p class="muted" style="font-size:0.8rem;margin-top:8px;">
          The "Default" account is used by automations that reference
          <code>&#123;&#123;user.connectors.${escapeHtml(connectorSlug)}.id&#125;&#125;</code>.
        </p>
      `;
    }
  } else if (sourcesState && sourcesState.loaded) {
    accountsBody = '<p class="muted">No connected accounts found for this connector.</p>';
  } else {
    accountsBody = `
      <lex-btn variant="secondary" size="sm"
        data-connector-load-sources="${escapeAttribute(connectorSlug)}">View Connected Accounts</lex-btn>
    `;
  }

  sections.push(`
    <div class="connector-managed-externally-note" style="margin-top:16px;">
      <h4>Connected Accounts</h4>
      <p class="muted">Manage which account is the default for automations involving this connector.</p>
      <div class="connector-sources-list" style="margin-top:8px;">
        ${accountsBody}
      </div>
    </div>
  `);

  sections.push(`
    <div class="connector-managed-externally-note">
      <strong>Managed in the LANA AI client</strong>
      <p>
        This connector is currently managed inside the LANA AI desktop client.
        It will move into the standard connector pipeline once it has been
        converted into a connector ZIP with its own setup UI.
      </p>
    </div>
  `);

  return surface({
    title: 'Overview',
    subtitle: '',
    body: sections.join('')
  });
}

function renderLogo(connector) {
  if (connector.logo_url) {
    const alt = escapeAttribute(connector.name);
    const url = escapeAttribute(connector.logo_url);
    const initial = escapeHtml(firstInitial(connector.name));
    return `<img src="${url}" alt="${alt}" onerror="this.parentElement.innerHTML='<span>${initial}</span>'">`;
  }
  return `<span>${escapeHtml(firstInitial(connector.name))}</span>`;
}

function firstInitial(value) {
  const text = String(value || '').trim();
  return text ? text[0].toUpperCase() : '?';
}

function statusToTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'connected' || s === 'active') return 'success';
  if (s === 'error') return 'error';
  if (s === 'syncing' || s === 'installed') return 'info';
  return '';
}

function renderMissingSelection() {
  return `
    ${renderFallbackBreadcrumb('No selection')}
    ${surface({
      title: 'No connector selected',
      subtitle: '',
      body: `
        <lex-empty message="Pick a connector from the list to see its details." icon="plug"></lex-empty>
        <div class="row-actions" style="margin-top: 16px;">
          <lex-btn variant="primary" size="sm" data-connector-action="back">Back to Connectors</lex-btn>
        </div>
      `
    })}
  `;
}

function renderNotFound(id) {
  return `
    ${renderFallbackBreadcrumb('Not found')}
    ${surface({
      title: 'Connector not found',
      subtitle: '',
      body: `
        <lex-empty message="Couldn't find a connector with id ${escapeHtml(String(id))}. It may have been removed." icon="alert-triangle"></lex-empty>
        <div class="row-actions" style="margin-top: 16px;">
          <lex-btn variant="primary" size="sm" data-connector-action="back">Back to Connectors</lex-btn>
        </div>
      `
    })}
  `;
}

async function mountCustomUi(context, connector) {
  const root = document.querySelector('[data-connector-detail-root]');
  if (!root) return;
  const iframe = root.querySelector(`#${IFRAME_ID}`);
  const overlay = root.querySelector('[data-connector-iframe-overlay]');
  const errorBox = root.querySelector('[data-connector-iframe-error]');
  const errorMessage = root.querySelector('[data-connector-iframe-error-message]');
  if (!iframe) return;

  if (currentEntryPoint === connector.ui_entry_point && activeCleanup) {
    overlay?.classList.add('hidden');
    return;
  }
  teardownConnectorDetail();

  overlay?.classList.remove('hidden');
  errorBox?.classList.add('hidden');

  const lanaConfig = {
    ...(window.LanaConfig || {}),
    API_BASE_URL: resolveAutomationApiBaseUrl(context.state.apiBaseUrl || '')
  };

  try {
    const { cleanup } = await loadCustomConnectorUi({
      iframe,
      uiEntryPoint: connector.ui_entry_point,
      connectorId: connector.id || connector.connector_id,
      connectorType: connector.connector_id || connector.connector_type || connector.source_type || '',
      sourceId: connector.id || '',
      connectorScope: connector.connector_scope || '',
      connectorName: connector.name,
      token: context.state.token || '',
      lanaConfig
    });
    activeCleanup = cleanup;
    currentEntryPoint = connector.ui_entry_point;
    overlay?.classList.add('hidden');
  } catch (error) {
    console.error('[connector-detail] Failed to load custom UI:', error);
    overlay?.classList.add('hidden');
    if (errorBox) {
      errorBox.classList.remove('hidden');
      if (errorMessage) {
        errorMessage.textContent = error?.message || 'Unknown error.';
      }
    }
  }
}
