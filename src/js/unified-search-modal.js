/* Unified Search Modal
   Shell-level search across indexed platform entities plus related data. */

(function () {
  'use strict';

  const state = {
    mounted: false,
    open: false,
    query: '',
    selected: null,
    searchTimer: null,
    abortController: null,
    shortcutBound: false,
    pendingQueryHandled: false,
    // Full normalized result set for the current query plus the active entity
    // filter. The filter is sent to the search API so narrowing to a type is
    // not limited to whichever records happened to appear on the first page.
    lastResults: [],
    activeType: null
  };

  const RECENT_SEARCHES_KEY = 'lana-recent-global-searches';
  const MAX_RECENT_SEARCHES = 8;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function css() {
    if (document.getElementById('unified-search-styles')) return;
    const style = document.createElement('style');
    style.id = 'unified-search-styles';
    style.textContent = `
      .unified-search-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10000;
        display: none;
        align-items: stretch;
        justify-content: stretch;
        padding: 0;
        background: #ffffff;
      }

      .unified-search-backdrop[data-open="true"] {
        display: flex;
      }

      .unified-search-modal {
        width: 100%;
        height: 100vh;
        max-height: 100vh;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(24rem, 36rem);
        background: #ffffff;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        overflow: hidden;
      }

      .unified-search-main,
      .unified-search-detail {
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .unified-search-input-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem;
        border-bottom: 1px solid #e5e7eb;
      }

      .unified-search-input-row svg {
        width: 1.25rem;
        height: 1.25rem;
        color: #6b7280;
        flex-shrink: 0;
      }

      .unified-search-input {
        width: 100%;
        border: 0;
        outline: 0;
        color: #111827;
        font-size: 1rem;
        line-height: 1.5rem;
      }

      .unified-search-entity-filter {
        flex: 0 0 auto;
        height: 2.125rem;
        min-width: 10rem;
        max-width: 13rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #ffffff;
        color: #374151;
        font-size: 0.8125rem;
        line-height: 1;
        padding: 0 0.625rem;
        cursor: pointer;
      }

      .unified-search-entity-filter:focus {
        outline: 2px solid rgba(79, 70, 229, 0.22);
        outline-offset: 1px;
        border-color: #4f46e5;
      }

      .unified-search-close {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        border: 0;
        background: transparent;
        color: #374151;
        border-radius: 6px;
        padding: 0.25rem;
        font-size: 0.75rem;
        cursor: pointer;
      }

      .unified-search-close-x {
        color: #4f46e5;
        font-size: 1.25rem;
        font-weight: 700;
        line-height: 1;
      }

      .unified-search-close-key {
        border: 1px solid #d1d5db;
        background: #f9fafb;
        color: #374151;
        border-radius: 6px;
        padding: 0.375rem 0.625rem;
        font-size: 0.75rem;
      }

      .unified-search-results {
        min-height: 18rem;
        overflow: auto;
        padding: 0.5rem;
      }

      .unified-search-result {
        width: 100%;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: #111827;
        cursor: pointer;
        text-align: left;
        outline: none;
      }

      /* Column 1 wrapper. min-width: 0 is required for the grid track's
         minmax(0, 1fr) to actually constrain inner content; without it
         the title's text-overflow: ellipsis never fires. */
      .unified-search-result-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        overflow: hidden;
      }

      .unified-search-result-submeta {
        display: flex;
        gap: 0.5rem;
        align-items: baseline;
        min-width: 0;
      }
      .unified-search-result-submeta > * {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .unified-search-result:hover,
      .unified-search-result[data-active="true"] {
        background: #f8fafc;
        border-color: #dbe3ef;
      }

      .unified-search-result:focus {
        border-color: #94a3b8;
      }

      .unified-search-result-title {
        font-size: 0.9375rem;
        font-weight: 600;
        color: #111827;
        min-width: 0;
        /* Allow up to 2 lines; anything beyond gets ellipsis. Standard
           line-clamp pattern via -webkit-box; supported everywhere
           Electron renders. */
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
        line-height: 1.3;
      }

      .unified-search-result-meta,
      .unified-search-result-snippet,
      .unified-search-result-count {
        font-size: 0.8125rem;
        color: #6b7280;
      }

      .unified-search-result-hint {
        margin-top: 0.25rem;
        font-size: 0.75rem;
        color: #4f46e5;
      }

      .unified-search-result-snippet {
        margin-top: 0.25rem;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .unified-search-result-type {
        align-self: start;
        border: 1px solid #dbe3ef;
        border-radius: 999px;
        padding: 0.1875rem 0.5rem;
        color: #475569;
        background: #f8fafc;
        font-size: 0.75rem;
        white-space: nowrap;
      }

      .unified-search-result-open {
        border: 0;
        background: transparent;
        color: #4f46e5;
        cursor: pointer;
        font-size: 0.8125rem;
        font-weight: 600;
        padding: 0.1875rem 0;
        white-space: nowrap;
      }

      .unified-search-detail {
        border-left: 1px solid #e5e7eb;
        background: #f9fafb;
        overflow: hidden;
      }

      .unified-search-detail-header {
        padding: 1rem;
        border-bottom: 1px solid #e5e7eb;
        background: #ffffff;
      }

      .unified-search-detail-title {
        margin: 0;
        color: #111827;
        font-size: 0.9375rem;
        font-weight: 700;
      }

      .unified-search-detail-subtitle {
        margin-top: 0.25rem;
        color: #6b7280;
        font-size: 0.8125rem;
      }

      .unified-search-detail-body {
        min-height: 0;
        overflow: auto;
        padding: 0.75rem;
      }

      .unified-search-detail-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 0.75rem;
      }

      .unified-search-detail-action {
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #ffffff;
        color: #374151;
        font-size: 0.8125rem;
        padding: 0.375rem 0.625rem;
        cursor: pointer;
      }

      .unified-search-detail-action[data-primary="true"] {
        border-color: #4f46e5;
        background: #4f46e5;
        color: #ffffff;
      }

      .unified-search-section {
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: #ffffff;
        margin-bottom: 0.75rem;
        overflow: hidden;
      }

      .unified-search-section-title {
        margin: 0;
        padding: 0.625rem 0.75rem;
        border-bottom: 1px solid #e5e7eb;
        color: #111827;
        font-size: 0.8125rem;
        font-weight: 700;
        text-transform: uppercase;
      }

      .unified-search-kv {
        display: grid;
        grid-template-columns: minmax(7.5rem, 38%) minmax(0, 1fr);
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid #f1f5f9;
        font-size: 0.8125rem;
      }

      .unified-search-kv:last-child {
        border-bottom: 0;
      }

      .unified-search-kv-key {
        color: #64748b;
      }

      .unified-search-kv-value {
        min-width: 0;
        color: #111827;
        overflow-wrap: anywhere;
      }

      .unified-search-preview {
        margin: 0;
        padding: 0.75rem;
        color: #374151;
        font-size: 0.875rem;
        line-height: 1.45;
        white-space: pre-wrap;
      }

      .unified-search-json {
        margin: 0;
        max-height: 16rem;
        overflow: auto;
        padding: 0.75rem;
        background: #0f172a;
        color: #dbeafe;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 0.75rem;
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .unified-search-related {
        padding: 0;
      }

      .unified-search-related-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.25rem;
        padding: 0.75rem;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: #ffffff;
        margin-bottom: 0.5rem;
      }

      .unified-search-related-type {
        color: #64748b;
        font-size: 0.75rem;
        text-transform: uppercase;
      }

      .unified-search-empty {
        padding: 3rem 1rem;
        color: #6b7280;
        text-align: center;
        font-size: 0.875rem;
      }

      .unified-search-recents {
        padding: 1rem;
      }

      .unified-search-recents-title {
        margin: 0 0 0.75rem;
        color: #64748b;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
      }

      .unified-search-recent-item {
        width: 100%;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.75rem;
        padding: 0.625rem 0.75rem;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: #111827;
        cursor: pointer;
        text-align: left;
      }

      .unified-search-recent-item:hover {
        background: #f8fafc;
        border-color: #dbe3ef;
      }

      .unified-search-recent-item svg {
        width: 1rem;
        height: 1rem;
        color: #94a3b8;
      }

      .unified-search-recent-query {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.9375rem;
      }

      .unified-search-recent-remove {
        border: 0;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        font-size: 1rem;
        line-height: 1;
      }

      @media (max-width: 760px) {
        .unified-search-backdrop {
          padding: 0;
        }

        .unified-search-modal {
          min-height: 100vh;
          max-height: 100vh;
          border-radius: 0;
          grid-template-columns: 1fr;
        }

        .unified-search-detail {
          display: none;
        }

        .unified-search-input-row {
          gap: 0.5rem;
        }

        .unified-search-entity-filter {
          min-width: 7.75rem;
          max-width: 8.75rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function searchIcon() {
    return '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-4.35-4.35m1.1-5.15a6.25 6.25 0 1 1-12.5 0 6.25 6.25 0 0 1 12.5 0Z"></path></svg>';
  }

  function ensureMounted() {
    if (state.mounted) return;
    css();
    const html = `
      <div id="unifiedSearchBackdrop" class="unified-search-backdrop" data-open="false">
        <div class="unified-search-modal" role="dialog" aria-modal="true" aria-label="Search Lana">
          <section class="unified-search-main">
            <div class="unified-search-input-row">
              ${searchIcon()}
              <input id="unifiedSearchInput" class="unified-search-input" type="search" placeholder="Search Lana — matters, contacts, documents, conversations, messages, tasks…" autocomplete="off">
              <select id="unifiedSearchEntityFilter" class="unified-search-entity-filter" aria-label="Filter search by entity type">
                ${entityFilterOptionsHtml()}
              </select>
              <button id="unifiedSearchClose" class="unified-search-close" type="button" aria-label="Close search">
                <span class="unified-search-close-x" aria-hidden="true">&times;</span>
                <span class="unified-search-close-key" aria-hidden="true">Esc</span>
              </button>
            </div>
            <div id="unifiedSearchResults" class="unified-search-results">
              <div class="unified-search-empty">Start typing to search all indexed data.</div>
            </div>
          </section>
          <aside id="unifiedSearchDetail" class="unified-search-detail">
            <div class="unified-search-detail-header">
              <h3 class="unified-search-detail-title">Result Details</h3>
              <div class="unified-search-detail-subtitle">Select a result to inspect fields and relationships.</div>
            </div>
            <div id="unifiedSearchDetailBody" class="unified-search-detail-body"></div>
          </aside>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    document.getElementById('unifiedSearchBackdrop').addEventListener('mousedown', (event) => {
      if (event.target.id === 'unifiedSearchBackdrop') close();
    });
    document.getElementById('unifiedSearchClose').addEventListener('click', close);
    document.getElementById('unifiedSearchInput').addEventListener('input', onInput);
    document.getElementById('unifiedSearchEntityFilter').addEventListener('change', onEntityFilterChange);
    renderStartState();
    bindShortcut();
    state.mounted = true;
  }

  function bindShortcut() {
    if (state.shortcutBound) return;
    state.shortcutBound = true;
    document.addEventListener('keydown', onKeydown, true);
  }

  function onKeydown(event) {
    const isShortcut = (event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k';
    if (isShortcut) {
      event.preventDefault();
      event.stopPropagation();
      open();
      return;
    }
    if (event.key === 'Escape' && state.open) {
      close();
    }
  }

  function onInput(event) {
    const query = event.target.value.trim();
    state.query = query;
    clearTimeout(state.searchTimer);
    if (query.length < 2) {
      if (query) {
        renderEmpty('Type at least 2 characters to search.');
      } else {
        renderStartState();
      }
      renderDetails(null);
      return;
    }
    state.searchTimer = setTimeout(() => search(query), 180);
  }

  function onEntityFilterChange(event) {
    state.activeType = event.target.value === 'all' ? null : event.target.value;
    if (state.query && state.query.length >= 2) {
      search(state.query);
      return;
    }
    renderStartState();
  }

  function renderEmpty(message) {
    document.getElementById('unifiedSearchResults').innerHTML = `<div class="unified-search-empty">${escapeHtml(message)}</div>`;
  }

  function renderLoading() {
    renderEmpty('Searching...');
  }

  function getRecentSearches() {
    try {
      const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, MAX_RECENT_SEARCHES) : [];
    } catch (_err) {
      return [];
    }
  }

  function saveRecentSearch(query) {
    const normalized = String(query || '').trim();
    if (normalized.length < 2) return;
    const lower = normalized.toLowerCase();
    const next = [normalized]
      .concat(getRecentSearches().filter((item) => String(item).toLowerCase() !== lower))
      .slice(0, MAX_RECENT_SEARCHES);
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch (_err) {}
  }

  function removeRecentSearch(query) {
    const lower = String(query || '').toLowerCase();
    const next = getRecentSearches().filter((item) => String(item).toLowerCase() !== lower);
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch (_err) {}
    renderStartState();
  }

  function renderStartState() {
    const recents = getRecentSearches();
    if (!recents.length) {
      renderEmpty('Start typing to search all indexed data.');
      return;
    }

    document.getElementById('unifiedSearchResults').innerHTML = `
      <div class="unified-search-recents">
        <h3 class="unified-search-recents-title">Recent Searches</h3>
        ${recents.map((query) => `
          <button type="button" class="unified-search-recent-item" data-recent-query="${escapeHtml(query)}">
            ${searchIcon()}
            <span class="unified-search-recent-query">${escapeHtml(query)}</span>
            <span class="unified-search-recent-remove" data-remove-recent="${escapeHtml(query)}" aria-label="Remove recent search">&times;</span>
          </button>
        `).join('')}
      </div>
    `;

    document.querySelectorAll('[data-recent-query]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const remove = event.target.closest('[data-remove-recent]');
        if (remove) {
          event.preventDefault();
          event.stopPropagation();
          removeRecentSearch(remove.getAttribute('data-remove-recent'));
          return;
        }
        const query = button.getAttribute('data-recent-query') || '';
        const input = document.getElementById('unifiedSearchInput');
        input.value = query;
        state.query = query;
        search(query);
      });
    });
  }

  var ENTITY_FILTER_OPTIONS = [
    { value: 'all', label: 'All entities' },
    { value: 'matter', label: 'Workspaces' },
    { value: 'document', label: 'Documents' },
    { value: 'conversation', label: 'Conversations' },
    { value: 'conversation_message', label: 'Messages' },
    { value: 'task', label: 'Tasks' },
    { value: 'contact', label: 'Contacts' },
    { value: 'user', label: 'Users' },
    { value: 'approval', label: 'Approvals' },
    { value: 'note', label: 'Notes' },
    { value: 'email', label: 'Emails' },
    { value: 'calendar_event', label: 'Calendar events' }
  ];

  // Friendly type-badge labels (override the underscored default).
  var TYPE_LABELS = {
    matter: 'Workspace',
    conversation: 'Conversation',
    conversation_message: 'Message',
    calendar_event: 'Calendar event'
  };

  // Entity types that open the REAL entity directly (deep-link via result.url)
  // instead of the generic result-details inspector, with a context-specific
  // button label. Falls back to the inspector when the result has no url.
  var OPEN_ACTIONS = {
    conversation: 'Open chat',
    conversation_message: 'Open chat',
    matter: 'Open workspace'
  };

  function entityFilterOptionsHtml() {
    return ENTITY_FILTER_OPTIONS.map((option) => (
      `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
    )).join('');
  }

  function syncEntityFilterSelect() {
    const select = document.getElementById('unifiedSearchEntityFilter');
    if (!select) return;
    select.value = state.activeType || 'all';
  }

  function entityTypeOf(result) {
    return (result && (result.entity_type || result.source_type)) || '';
  }

  // Returns the deep-link button label for a result, or null to use the
  // generic inspector. Requires a url so the label never promises a jump we
  // can't make.
  function openActionLabel(result) {
    if (!result || !result.url) return null;
    return OPEN_ACTIONS[entityTypeOf(result)] || null;
  }

  function typeLabel(type) {
    return TYPE_LABELS[type] || formatType(type);
  }

  function formatType(type) {
    return String(type || 'entity').replace(/_/g, ' ');
  }

  function formatLabel(key) {
    return String(key || '')
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function displayText(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed.display_name ||
          parsed.name ||
          [parsed.first_name, parsed.middle_name, parsed.last_name].filter(Boolean).join(' ') ||
          value;
      }
    } catch (_err) {
      return value;
    }
    return value;
  }

  function normalizeResult(result) {
    const metadata = result.metadata || {};
    const title = displayText(result.title || result.name || metadata.name || metadata.title || result.external_id || 'Untitled');
    const subtitle = displayText(result.subtitle || result.matter_name || result.source_system || result.source_table || result.connector_type || '');
    const snippet = displayText(result.snippet || result.description || metadata.description || metadata.summary || '');
    const entityType = result.entity_type || result.source_type || result.connector_type || metadata.entity_type || 'record';

    return {
      ...result,
      id: result.entity_id || result.id || result.external_id || '',
      entity_id: result.entity_id || result.id || result.external_id || '',
      entity_type: entityType,
      source_type: entityType,
      title,
      subtitle,
      snippet,
      url: result.url || result.web_url || result.external_url || '',
      related_entity_count: result.related_entity_count || 0,
      relevanceScore: result.relevanceScore || result.relevance_score || 0
    };
  }

  function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function valueText(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return displayText(value);
    if (Array.isArray(value)) {
      return value.map(valueText).filter(Boolean).join(', ');
    }
    if (isPlainObject(value)) {
      return displayText(JSON.stringify(value));
    }
    return String(value);
  }

  function metadataForDetails(result) {
    const metadata = isPlainObject(result.metadata) ? result.metadata : {};
    const data = isPlainObject(metadata.data) ? metadata.data : {};
    const raw = isPlainObject(data.raw) ? data.raw : {};
    return { metadata, data, raw };
  }

  function rawJsonForResult(result) {
    const metadata = isPlainObject(result.metadata) ? result.metadata : {};
    const data = isPlainObject(metadata.data) ? metadata.data : {};
    const raw = isPlainObject(data.raw) ? data.raw : null;
    return raw || (Object.keys(data).length ? data : result);
  }

  function pickFields(source, keys) {
    if (!isPlainObject(source)) return [];
    return keys.map((key) => [key, valueText(source[key])]).filter((entry) => entry[1]);
  }

  function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter((row) => {
      const id = row[0] + ':' + row[1];
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function renderKvRows(rows) {
    return uniqueRows(rows).map(([key, value]) => `
      <div class="unified-search-kv">
        <span class="unified-search-kv-key">${escapeHtml(formatLabel(key))}</span>
        <span class="unified-search-kv-value">${escapeHtml(value)}</span>
      </div>
    `).join('');
  }

  function renderSection(title, rows) {
    if (!rows.length) return '';
    return `<section class="unified-search-section">
      <h4 class="unified-search-section-title">${escapeHtml(title)}</h4>
      ${renderKvRows(rows)}
    </section>`;
  }

  function detailRowsForResult(result) {
    const { metadata, data, raw } = metadataForDetails(result);
    const baseRows = [
      ['type', formatType(result.entity_type || result.source_type)],
      ['source', result.source_system || result.source_table],
      ['matter', result.matter_id],
      ['external_id', result.external_id],
      ['updated', result.source_updated_at ? new Date(result.source_updated_at).toLocaleString() : ''],
      ['indexed', result.indexed_at ? new Date(result.indexed_at).toLocaleString() : '']
    ].filter((entry) => valueText(entry[1]));

    const commonKeys = [
      'display_name', 'name', 'first_name', 'last_name', 'email', 'phone',
      'company_name', 'status', 'stage', 'priority', 'category', 'reference',
      'subject', 'from_address', 'to_address', 'sent_date', 'received_date',
      'amount', 'total', 'due_date', 'created_at', 'updated_at'
    ];

    return {
      baseRows,
      dataRows: pickFields(data, commonKeys),
      rawRows: pickFields(raw, commonKeys)
    };
  }

  async function search(query) {
    if (!window.api || typeof window.api.post !== 'function') {
      renderEmpty('Search is unavailable until the API client is ready.');
      return;
    }

    if (state.abortController) state.abortController.abort();
    renderLoading();

    try {
      saveRecentSearch(query);
      const payload = {
        query,
        limit: 20,
        page: 1
      };
      if (state.activeType) {
        payload.entity_types = [state.activeType];
      }
      syncEntityFilterSelect();
      const response = await window.api.post('/api/v1/search', payload);
      renderResults((response.results || []).map(normalizeResult), response);
    } catch (error) {
      renderEmpty(error.message || 'Search failed.');
    }
  }

  // Lazily resolved so load order between this module and the filter helper
  // never matters: the helper is only consulted at search time, by which point
  // both scripts are present. If it is somehow absent, the modal degrades to an
  // unfiltered list (current pre-feature behavior) rather than breaking.
  function searchFilter() {
    return (typeof window !== 'undefined' && window.UnifiedSearchFilter) || null;
  }

  function applyActiveFilter() {
    const filter = searchFilter();
    if (!filter) return state.lastResults;
    return filter.filterResultsByType(state.lastResults, state.activeType);
  }

  function renderResults(results, response) {
    state.lastResults = Array.isArray(results) ? results : [];
    syncEntityFilterSelect();

    if (!state.lastResults.length) {
      renderEmpty(response && response.message ? response.message : 'No results found.');
      renderDetails(null);
      return;
    }

    renderResultList(applyActiveFilter(), { autoSelect: true });
  }

  function renderResultList(results, options) {
    options = options || {};
    const container = document.getElementById('unifiedSearchResults');
    if (!container) return;
    if (!results.length) {
      container.innerHTML = '<div class="unified-search-empty">No results of this type.</div>';
      renderDetails(null);
      return;
    }

    // Decide which row is active and whether to (re)load the detail pane. On a
    // fresh query (autoSelect) we select the first result. On a filter toggle we
    // keep the current selection if it survived the filter, so the detail pane
    // and its related-data fetch are not needlessly redone (which would also
    // race overlapping fetches). Only when the selected result was filtered out
    // do we move selection to the first visible row.
    const filter = searchFilter();
    const selectedKey = state.selected ? resultKey(state.selected) : '';
    const active = filter
      ? filter.resolveActiveSelection(results, selectedKey, resultKey, options.autoSelect)
      : { index: 0, preserved: false };
    const activeIndex = active.index;
    const selectionPreserved = active.preserved;

    container.innerHTML = results.map((result, index) => `
      <div role="button" tabindex="0" class="unified-search-result" data-result-index="${index}" data-active="${index === activeIndex}">
        <div class="unified-search-result-main">
          <span class="unified-search-result-title">${escapeHtml(result.title || 'Untitled')}</span>
          <span class="unified-search-result-submeta">
            <span class="unified-search-result-meta">${escapeHtml(result.subtitle || result.source_system || result.source_table || '')}</span>
            <span class="unified-search-result-count">${Number(result.related_entity_count || 0)} related</span>
          </span>
          ${result.snippet ? `<span class="unified-search-result-snippet">${escapeHtml(result.snippet)}</span>` : ''}
        </div>
        <button type="button" class="unified-search-result-open" data-open-result-index="${index}">${openActionLabel(result) || 'Open details'}</button>
        <span class="unified-search-result-type">${escapeHtml(typeLabel(result.entity_type || result.source_type))}</span>
      </div>
    `).join('');

    // Scope listener binding to the results container (not document-wide) so it
    // can never cross-bind to like-named rows elsewhere in the document.
    const buttons = Array.from(container.querySelectorAll('.unified-search-result'));
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => {
        buttons.forEach((el) => { el.dataset.active = 'false'; });
        button.dataset.active = 'true';
        selectResult(results[index]);
      });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        buttons.forEach((el) => { el.dataset.active = 'false'; });
        button.dataset.active = 'true';
        selectResult(results[index]);
      });
      button.addEventListener('dblclick', () => openResult(results[index]));
    });
    container.querySelectorAll('[data-open-result-index]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(button.getAttribute('data-open-result-index'));
        openResult(results[index]);
      });
    });

    if (!selectionPreserved) {
      selectResult(results[activeIndex]);
    }
  }

  // Monotonic token so a slower related-data response from a prior selection
  // can never overwrite the detail pane of the current one (last-write-wins
  // race when the user changes selection or toggles a filter quickly).
  let relatedRequestId = 0;

  function selectResult(result) {
    state.selected = result;
    renderDetails(result, { loading: true });
    loadRelated(result);
  }

  async function loadRelated(result) {
    const requestId = ++relatedRequestId;
    if (!result || !window.api || typeof window.api.get !== 'function') {
      renderDetails(result, { relationships: [] });
      return;
    }

    const params = new URLSearchParams();
    params.set('entity_id', result.entity_id || result.id || '');
    if (result.external_id) params.set('external_id', result.external_id);
    if (result.matter_id) params.set('matter_id', result.matter_id);
    params.set('entity_type', result.entity_type || result.source_type || '');
    params.set('title', result.title || '');
    params.set('limit', '25');

    try {
      const graph = await window.api.get('/api/v1/search/related?' + params.toString());
      if (requestId !== relatedRequestId) return; // a newer selection superseded this
      renderDetails(result, graph);
    } catch (error) {
      if (requestId !== relatedRequestId) return; // a newer selection superseded this
      renderDetails(result, { error: error.message || 'Failed to load related data.' });
    }
  }

  function renderRelated(graph) {
    if (!graph) {
      return '';
    }
    if (graph.loading) {
      return '<div class="unified-search-empty">Loading related data...</div>';
    }
    if (graph.error) {
      return `<div class="unified-search-empty">${escapeHtml(graph.error)}</div>`;
    }
    const relationships = graph.relationships || [];
    if (!relationships.length) {
      return '<div class="unified-search-empty">No related records found yet.</div>';
    }
    return relationships.map((relationship) => {
      const node = relationship.linked_node || {};
      return `<div class="unified-search-related-item">
        <span class="unified-search-related-type">${escapeHtml(formatType(relationship.relationship_type))}</span>
        <strong>${escapeHtml(node.title || node.id || 'Related record')}</strong>
        <span class="unified-search-result-meta">${escapeHtml(formatType(node.type))}${node.subtitle ? ' · ' + escapeHtml(node.subtitle) : ''}</span>
      </div>`;
    }).join('');
  }

  function renderDetails(result, graph) {
    const detail = document.getElementById('unifiedSearchDetailBody');
    if (!detail) return;
    if (!result) {
      detail.innerHTML = '<div class="unified-search-empty">Select a result to inspect its fields and related data.</div>';
      return;
    }

    const rows = detailRowsForResult(result);
    const preview = result.snippet ? `<section class="unified-search-section">
      <h4 class="unified-search-section-title">Preview</h4>
      <p class="unified-search-preview">${escapeHtml(result.snippet)}</p>
    </section>` : '';

    const actions = `<div class="unified-search-detail-actions">
      <button type="button" class="unified-search-detail-action" data-search-action="open-result" data-primary="true">${openActionLabel(result) || 'Open Details'}</button>
      <button type="button" class="unified-search-detail-action" data-search-action="copy-id">Copy ID</button>
    </div>`;

    detail.innerHTML = `
      <div class="unified-search-detail-header">
        <h3 class="unified-search-detail-title">${escapeHtml(result.title || 'Untitled')}</h3>
        <div class="unified-search-detail-subtitle">${escapeHtml(formatType(result.entity_type || result.source_type))}${result.subtitle ? ' · ' + escapeHtml(result.subtitle) : ''}</div>
        ${actions}
      </div>
      ${preview}
      ${renderSection('Overview', rows.baseRows)}
      ${renderSection('Fields', rows.dataRows)}
      ${renderSection('Source Fields', rows.rawRows)}
      <section class="unified-search-section">
        <h4 class="unified-search-section-title">Raw JSON</h4>
        <pre class="unified-search-json">${escapeHtml(JSON.stringify(rawJsonForResult(result), null, 2))}</pre>
      </section>
      <section class="unified-search-section">
        <h4 class="unified-search-section-title">Related Data</h4>
        <div class="unified-search-related">${renderRelated(graph)}</div>
      </section>
    `;

    const openButton = detail.querySelector('[data-search-action="open-result"]');
    if (openButton) openButton.addEventListener('click', () => openResult(result));
    const copyButton = detail.querySelector('[data-search-action="copy-id"]');
    if (copyButton) {
      copyButton.addEventListener('click', () => {
        const id = result.entity_id || result.id || result.external_id || '';
        if (navigator.clipboard && id) navigator.clipboard.writeText(id);
      });
    }
  }

  function openResult(result) {
    if (!result) return;
    // Types with a dedicated open action (conversations -> chat, matters ->
    // workspace) deep-link to the real entity via the unified-index url instead
    // of the generic result-details inspector.
    if (openActionLabel(result)) {
      close();
      if (window.Lex && window.Lex.Nav && window.Lex.Nav.go && !/^(https?:)?\/\//.test(result.url)) {
        window.Lex.Nav.go(result.url);
      } else {
        window.location.href = result.url;
      }
      return;
    }
    const key = resultKey(result);
    try {
      sessionStorage.setItem('lana-search-result:' + key, JSON.stringify(result));
    } catch (_err) {}
    const params = new URLSearchParams();
    params.set('result_key', key);
    params.set('entity_type', result.entity_type || result.source_type || 'record');
    if (result.entity_id || result.id) params.set('entity_id', result.entity_id || result.id);
    if (result.external_id) params.set('external_id', result.external_id);
    if (result.title) params.set('title', result.title);
    close();
    if (window.Lex && window.Lex.Nav && window.Lex.Nav.go) {
      window.Lex.Nav.go('search-results.html?' + params.toString());
    } else {
      window.location.href = 'search-results.html?' + params.toString();
    }
  }

  function openOriginal(result) {
    if (!result || !result.url) return;
    if (window.Lex && window.Lex.Nav && window.Lex.Nav.go && !/^(https?:)?\/\//.test(result.url)) {
      window.Lex.Nav.go(result.url);
    } else {
      window.location.href = result.url;
    }
  }

  function resultKey(result) {
    return [
      result.entity_type || result.source_type || 'record',
      result.entity_id || result.id || '',
      result.external_id || '',
      result.title || ''
    ].join(':').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 180);
  }

  function open(initialQuery) {
    ensureMounted();
    document.getElementById('unifiedSearchBackdrop').dataset.open = 'true';
    state.open = true;
    setTimeout(() => {
      const input = document.getElementById('unifiedSearchInput');
      input.focus();
      if (initialQuery) {
        input.value = initialQuery;
        state.query = initialQuery;
        search(initialQuery);
      } else if (!input.value.trim()) {
        renderStartState();
      }
    }, 20);
  }

  function close() {
    if (!state.mounted) return;
    document.getElementById('unifiedSearchBackdrop').dataset.open = 'false';
    state.open = false;
  }

  function consumePendingQuery(options) {
    options = options || {};
    if (state.pendingQueryHandled && !options.force) return { shouldOpen: !!options.openEmpty, query: '' };
    state.pendingQueryHandled = true;

    let query = '';
    let shouldOpen = !!options.openEmpty;
    try {
      shouldOpen = shouldOpen || sessionStorage.getItem('lana-open-global-search') === '1';
      query = sessionStorage.getItem('lana-pending-global-search') || '';
      sessionStorage.removeItem('lana-open-global-search');
      sessionStorage.removeItem('lana-pending-global-search');
    } catch (_err) {
      query = '';
    }

    if (!query && window.name && window.name.indexOf('lana-pending-global-search:') === 0) {
      query = window.name.substring('lana-pending-global-search:'.length);
      shouldOpen = true;
      window.name = '';
    } else if (window.name === 'lana-open-global-search') {
      shouldOpen = true;
      window.name = '';
    }

    let params = null;
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.getParams === 'function') {
      params = window.Lex.Nav.getParams();
    } else {
      params = new URLSearchParams(window.location.search || '');
    }
    query = query || params.get('globalSearch') || params.get('q') || '';
    shouldOpen = shouldOpen || !!query;

    return { shouldOpen, query };
  }

  function openPending(options) {
    const pending = consumePendingQuery(options);
    if (pending.shouldOpen) {
      open(pending.query);
    }
  }

  window.UnifiedSearchModal = {
    open,
    close,
    init: ensureMounted,
    openPending
  };

  bindShortcut();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureMounted);
  } else {
    ensureMounted();
  }

  function openFromUrl() {
    openPending();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', openFromUrl);
  } else {
    openFromUrl();
  }
})();
