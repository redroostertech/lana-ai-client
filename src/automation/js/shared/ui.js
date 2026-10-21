import { escapeAttribute, escapeHtml, normalizeText } from './utils.js';

export function filterCollection(items, filters, searchFields, predicate) {
  return items.filter((item) => {
    if (!matchesQuery(filters.query, searchFields(item))) {
      return false;
    }

    if (predicate && !predicate(item, filters)) {
      return false;
    }

    return true;
  });
}

function matchesQuery(query, fields) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  return normalizeText(fields.join(' ')).includes(normalizedQuery);
}

export function sectionIntro({ eyebrow, title, copy, badges = [] }) {
  return `
    <section class="automation-page-banner" aria-label="${escapeAttribute(eyebrow)}">
      <lex-banner
        variant="light"
        lana
        lana-context-type="full_chat"
        heading="${escapeAttribute(title)}"
        subtitle="${escapeAttribute(copy)}"
      ></lex-banner>
      ${badges.length ? `<div class="automation-page-banner-badges">${badges.join('')}</div>` : ''}
    </section>
  `;
}

export function surface({ title, subtitle = '', body = '', footer = '' }) {
  const headingAttr = title ? ` heading="${escapeAttribute(title)}"` : '';
  const subtitleAttr = subtitle ? ` subtitle="${escapeAttribute(subtitle)}"` : '';
  return `
    <lex-card${headingAttr}${subtitleAttr}>
      <div class="surface-body">${body}</div>
      ${footer ? `<div data-slot="footer">${footer}</div>` : ''}
    </lex-card>
  `;
}

// ── Table cells ─────────────────────────────────────────────────────────
// Renderers format raw row values; dates go through Lex.Utils (API time is
// UTC, shown in the user's timezone: profile, then org, then browser).

export function mutedCell(text = '\u2014') {
  return `<span class="automation-cell-muted">${escapeHtml(text || '\u2014')}</span>`;
}

function lexDate(method, value) {
  const utils = typeof window !== 'undefined' && window.Lex && window.Lex.Utils;
  if (!value || !utils || typeof utils[method] !== 'function') return '';
  const text = utils[method](value);
  return text === 'Never' || text === '-' ? '' : text;
}

// "Created" / "Started": full date and time.
export function dateTimeCell(value) {
  const full = lexDate('formatDateTime', value);
  if (!full) return mutedCell();
  return `<time class="automation-cell-time" datetime="${escapeAttribute(value)}" title="${escapeAttribute(full)}">${escapeHtml(full)}</time>`;
}

// "Updated" / "Last run": relative time, full date in the title.
export function relativeTimeCell(value) {
  const relative = lexDate('timeAgo', value);
  if (!relative) return mutedCell();
  const full = lexDate('formatDateTime', value);
  return `<time class="automation-cell-time" datetime="${escapeAttribute(value)}" title="${escapeAttribute(full)}">${escapeHtml(relative)}</time>`;
}

export function textCell(text) {
  return text ? `<span class="automation-cell-text" title="${escapeAttribute(text)}">${escapeHtml(text)}</span>` : mutedCell();
}

// Primary name column: semibold, wraps between words; optional secondary line.
export function nameCell(name, secondary = '') {
  return `
    <span class="automation-cell-name"${secondary ? ` title="${escapeAttribute(secondary)}"` : ''}>${escapeHtml(name)}</span>
    ${secondary ? `<span class="automation-cell-secondary">${escapeHtml(secondary)}</span>` : ''}
  `;
}

export function matterLinkCell(matterId, matterName, fallback = '') {
  const label = String(matterName || '').trim();
  if (matterId) {
    const text = label || fallback || 'Open workspace';
    return `<button type="button" class="automation-matter-link" data-matter-id="${escapeAttribute(matterId)}" title="Open ${escapeAttribute(text)} workspace"><span>${escapeHtml(text)}</span></button>`;
  }
  return label ? textCell(label) : mutedCell();
}

// ── Server-paged tables (docs/TABLE-STANDARD.md) ─────────────────────────
// Toolbar card (search, Sort by, order toggle, one main filter, count), a
// section heading with the count, and a server-paged lex-table. The view
// re-renders by replacing innerHTML, so the table's query (page, sort,
// filters), the toolbar search and the last answer live in a store on app
// state: a re-render restores the query and answers from that cache instead
// of asking the server again.

const SORT_ICON = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path></svg>';
const SEARCH_DEBOUNCE_MS = 350;

export function createServerTableStore() {
  return { query: null, search: '', cache: null };
}

// Drop the cached page so the next render asks the server again.
export function invalidateServerTable(store) {
  if (store) store.cache = null;
}

function selectOptionsAttr(options) {
  return escapeAttribute(JSON.stringify(options.map(({ value, label }) => ({ value, label }))));
}

function savedFilterValue(store, key) {
  const filter = store?.query?.filters?.[key];
  const values = filter && Array.isArray(filter.value) ? filter.value : [];
  return values.length === 1 ? String(values[0]) : 'all';
}

/**
 * Markup for the toolbar card, section heading and lex-table.
 * @param {Object} config
 * @param {string} config.prefix - id prefix for the toolbar controls
 * @param {Object} config.store - createServerTableStore() kept on app state
 * @param {Object} config.table - { id, className, columns, labels, sortableColumns, sortBy, sortDir, idKey, emptyText, ariaLabel }
 */
export function serverTableSection({
  prefix,
  store,
  title,
  searchLabel,
  searchPlaceholder,
  sortOptions,
  filter = null,
  table
}) {
  const query = store?.query || {};
  const sortBy = query.sortBy || table.sortBy;
  const sortDir = query.sortDir || table.sortDir || 'desc';
  const limit = query.limit || 20;
  return `
    <div class="automation-table-toolbar bg-white rounded-lg shadow-sm border mb-4 mt-4 p-4" style="border-color: var(--lex-border-default)" role="search" aria-label="${escapeAttribute(searchLabel)}">
      <div class="flex items-center gap-4 flex-wrap">
        <div class="flex-1 min-w-[200px]">
          <lex-input id="${prefix}Search" placeholder="${escapeAttribute(searchPlaceholder)}" clearable="true" leading-icon="search" value="${escapeAttribute(store?.search || '')}"></lex-input>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">Sort by:</label>
          <lex-select id="${prefix}Sort" options='${selectOptionsAttr(sortOptions)}' value="${escapeAttribute(sortBy)}"></lex-select>
        </div>
        <lex-btn id="${prefix}SortOrder" variant="ghost" icon="true" title="Toggle sort order" data-order="${sortDir === 'asc' ? 'asc' : 'desc'}">${SORT_ICON}</lex-btn>
        ${filter ? `
          <div class="flex items-center gap-2">
            <label class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">${escapeHtml(filter.label)}:</label>
            <lex-select id="${prefix}Filter" options='${selectOptionsAttr([{ value: 'all', label: 'All' }, ...filter.options])}' value="${escapeAttribute(savedFilterValue(store, filter.key))}"></lex-select>
          </div>
        ` : ''}
        <div id="${prefix}Count" class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)"></div>
      </div>
    </div>

    <section class="automation-table-section" aria-labelledby="${prefix}Heading">
      <div class="flex items-center justify-between mb-3">
        <h2 id="${prefix}Heading" class="text-lg font-semibold" style="color: var(--lex-text-primary)">${escapeHtml(title)}</h2>
        <span id="${prefix}SectionCount" class="text-sm" style="color: var(--lex-text-secondary)" aria-live="polite"></span>
      </div>
      <lex-table
        id="${escapeAttribute(table.id)}"
        class="automation-table lex-table--card${table.className ? ` ${escapeAttribute(table.className)}` : ''}"
        column-filters
        server-paging
        columns="${escapeAttribute(table.columns.join(','))}"
        labels="${escapeAttribute(table.labels.join(','))}"
        sortable-columns="${escapeAttribute(table.sortableColumns.join(','))}"
        sort-by="${escapeAttribute(sortBy)}"
        sort-dir="${escapeAttribute(sortDir)}"
        limit="${escapeAttribute(String(limit))}"
        id-key="${escapeAttribute(table.idKey)}"
        empty-text="${escapeAttribute(table.emptyText)}"
        aria-label="${escapeAttribute(table.ariaLabel)}"
      ></lex-table>
    </section>
  `;
}

function cloneQuery(query) {
  const source = query || {};
  return {
    page: source.page || 1,
    limit: source.limit || 20,
    sortBy: source.sortBy || '',
    sortDir: source.sortDir || 'desc',
    filters: JSON.parse(JSON.stringify(source.filters || {}))
  };
}

// workspace-details is a host page beside the automation app.
export function openWorkspaceDetails(matterId) {
  const id = String(matterId || '').trim();
  if (!id || typeof window === 'undefined') return;
  window.location.href = new URL(`../workspace-details.html?id=${encodeURIComponent(id)}`, window.location.href).href;
}

/**
 * Wires the table rendered by serverTableSection: renderers, column filter
 * options, toolbar, row clicks and matter links, then restores the stored
 * query and loads. Safe to call on every render.
 * @param {Object} options
 * @param {string} options.id - table id
 * @param {string} options.prefix - toolbar id prefix
 * @param {Object} options.store - createServerTableStore()
 * @param {Function} options.fetchPage - (query, search) => Promise<{ rows, pagination }>
 * @param {Object} options.renderers - lex-table cell renderers
 * @param {Function} [options.filterOptions] - () => setColumnFilterOptions map
 * @param {string} [options.filterKey] - filter the toolbar's main select writes
 * @param {Array<string>} options.noun - [singular, plural] for the count
 * @param {Object} options.emptyText - { base, filtered }
 * @param {string} options.errorText
 * @param {Function} [options.onRowClick] - (row) => void
 * @param {Function} [options.onLoaded] - (result) => void
 */
export function mountServerTable(options) {
  const mount = () => {
    const table = document.getElementById(options.id);
    if (!table || table.dataset.serverTableBound === 'true' || typeof table.requestServerQuery !== 'function') return;
    table.dataset.serverTableBound = 'true';

    const { store, prefix } = options;
    const el = (suffix) => document.getElementById(`${prefix}${suffix}`);
    let restoring = false;
    let sequence = 0;
    let searchTimer = null;

    const setCount = (total) => {
      const text = total === '' ? '' : `${total} ${total === 1 ? options.noun[0] : options.noun[1]}`;
      ['Count', 'SectionCount'].forEach((suffix) => {
        const node = el(suffix);
        if (node) node.textContent = text;
      });
    };

    const syncToolbar = (query) => {
      const sort = el('Sort');
      const order = el('SortOrder');
      if (sort && query.sortBy && sort.value !== query.sortBy) sort.value = query.sortBy;
      if (order) order.dataset.order = query.sortDir === 'asc' ? 'asc' : 'desc';
      const filter = el('Filter');
      if (filter && options.filterKey) {
        const values = query.filters?.[options.filterKey]?.value;
        const value = Array.isArray(values) && values.length === 1 ? String(values[0]) : 'all';
        if (filter.value !== value) filter.value = value;
      }
    };

    const syncEmptyState = (query) => {
      const filtered = Boolean(store.search || Object.keys(query.filters || {}).length);
      table.emptyText = filtered ? options.emptyText.filtered : options.emptyText.base;
    };

    const load = async (query) => {
      if (restoring) return;
      const current = cloneQuery(query);
      store.query = current;
      syncToolbar(current);
      syncEmptyState(current);
      const seq = ++sequence;
      const key = JSON.stringify([current, store.search]);
      let cache = store.cache;
      if (!cache || cache.key !== key) {
        cache = { key, promise: Promise.resolve().then(() => options.fetchPage(current, store.search)) };
        store.cache = cache;
        cache.promise.catch(() => {
          if (store.cache === cache) store.cache = null;
        });
      }
      try {
        const result = await cache.promise;
        if (seq !== sequence || !table.isConnected) return;
        setCount(Number(result.pagination?.total) || 0);
        table.setServerData(result.rows, result.pagination);
        if (typeof options.onLoaded === 'function') options.onLoaded(result);
      } catch (error) {
        if (seq !== sequence || !table.isConnected) return;
        console.error(`[automation] ${options.id} failed to load`, error);
        setCount('');
        table.setServerError(options.errorText);
      }
    };

    table.setCellRenderers(options.renderers || {});
    if (typeof options.filterOptions === 'function') table.setColumnFilterOptions(options.filterOptions());

    table.addEventListener('lex-query-change', (event) => load(event.detail || table.serverQuery));
    table.addEventListener('sort-change', (event) => {
      if (event.detail) syncToolbar({ ...cloneQuery(store.query), sortBy: event.detail.sortBy, sortDir: event.detail.sortDir });
    });
    table.addEventListener('row-click', (event) => {
      if (typeof options.onRowClick === 'function' && event.detail?.row) options.onRowClick(event.detail.row);
    });
    // lex-table's row-click ignores buttons, so matter links get their own listener.
    table.addEventListener('click', (event) => {
      const link = event.target?.closest ? event.target.closest('[data-matter-id]') : null;
      if (!link) return;
      event.stopPropagation();
      openWorkspaceDetails(link.getAttribute('data-matter-id'));
    });

    const applySort = (column, direction) => {
      if (!table.dataSource) return;
      table.sortBy = column;
      table.sortDir = direction;
      table.dataSource.setSort(column, direction);
    };
    const sortOrder = () => (el('SortOrder')?.dataset.order === 'asc' ? 'asc' : 'desc');

    el('Sort')?.addEventListener('lex-change', (event) => {
      applySort(String(event.detail?.value || table.sortBy), sortOrder());
    });
    el('SortOrder')?.addEventListener('click', () => {
      const button = el('SortOrder');
      button.dataset.order = sortOrder() === 'asc' ? 'desc' : 'asc';
      applySort(el('Sort')?.value || table.sortBy, sortOrder());
    });
    // The main filter lives in the table's own filter state, so the table's
    // Clear filters resets it too.
    el('Filter')?.addEventListener('lex-change', (event) => {
      const value = String(event.detail?.value || 'all');
      if (value !== 'all') table.addFilter(options.filterKey, 'in', [value]);
      else table.removeFilter(options.filterKey);
    });
    // lex-input emits lex-input while typing and lex-change on clear.
    ['lex-input', 'lex-change'].forEach((name) => {
      el('Search')?.addEventListener(name, (event) => {
        const value = String(event.detail?.value || '').trim();
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          if (value === store.search) return;
          store.search = value;
          table.requestServerQuery({ resetPage: true });
        }, SEARCH_DEBOUNCE_MS);
      });
    });

    // Restore the stored filters and page without a request per step.
    const saved = store.query;
    if (saved) {
      restoring = true;
      try {
        if (Object.keys(saved.filters || {}).length) table.setFilters(saved.filters);
        if (saved.page > 1 && table.dataSource) table.dataSource.goToPage(saved.page);
      } finally {
        restoring = false;
      }
    }
    table.requestServerQuery();
  };

  const ready = typeof customElements !== 'undefined' && typeof customElements.whenDefined === 'function'
    ? customElements.whenDefined('lex-table')
    : Promise.resolve();
  ready.then(mount);
}

export function listItem({ title, detailLines = [], body = '', aside = '' }) {
  return `
    <article class="list-item">
      <div class="list-item-main">
        <strong>${escapeHtml(title)}</strong>
        ${detailLines.filter(Boolean).map((line) => `<div class="muted">${escapeHtml(line)}</div>`).join('')}
        ${body ? `<div class="list-item-body">${body}</div>` : ''}
      </div>
      ${aside ? `<div class="list-item-aside">${aside}</div>` : ''}
    </article>
  `;
}

export function metricCard(label, value) {
  return `
    <article class="metric-card">
      <div class="metric-label">${escapeHtml(label)}</div>
      <span class="metric-value">${escapeHtml(String(value))}</span>
    </article>
  `;
}

export function metaGrid(items, className = 'meta-grid') {
  return `
    <div class="${escapeAttribute(className)}">
      ${items.map((item) => `
        <div class="meta-item">
          <span class="meta-label">${escapeHtml(item.label)}</span>
          <div class="meta-value">${item.isHtml ? item.value : escapeHtml(item.value)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

export function badge(label, tone = '') {
  const color = tone === 'success'
    ? 'green'
    : tone === 'warning'
      ? 'yellow'
      : tone === 'error'
        ? 'red'
        : tone === 'info'
          ? 'blue'
          : 'gray';
  return `<lex-badge label="${escapeAttribute(label)}" color="${color}"></lex-badge>`;
}

export function emptyState(message) {
  return `<lex-empty message="${escapeAttribute(message)}" icon="inbox"></lex-empty>`;
}

export function lexEmpty({ message, description = '', icon = 'inbox' }) {
  return `
    <lex-empty
      message="${escapeAttribute(message)}"
      ${description ? `description="${escapeAttribute(description)}"` : ''}
      icon="${escapeAttribute(icon)}"
    ></lex-empty>
  `;
}

export function drawerSection({ title, body = '', className = '' }) {
  return `
    <section class="automation-detail-section ${escapeAttribute(className)}">
      <lex-card heading="${escapeAttribute(title)}" variant="outlined">
        <div class="automation-detail-section-body">${body}</div>
      </lex-card>
    </section>
  `;
}

export function drawerStatGrid(items) {
  return `
    <div class="automation-detail-stat-grid">
      ${items.map((item) => `
        <lex-card variant="flat" class="automation-detail-stat">
          <div class="automation-detail-stat-label">${escapeHtml(item.label)}</div>
          <div class="automation-detail-stat-value">${item.isHtml ? item.value : escapeHtml(item.value)}</div>
        </lex-card>
      `).join('')}
    </div>
  `;
}
