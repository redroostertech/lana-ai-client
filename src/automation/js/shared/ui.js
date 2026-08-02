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

export function resourceSurface({
  title,
  subtitle = '',
  viewKey,
  searchPlaceholder,
  totalCount,
  visibleCount,
  filterDefs = [],
  items,
  emptyMessage,
  filters,
  bodyClassName = 'list'
}) {
  return surface({
    title,
    subtitle,
    body: `
      ${filterToolbar({
        viewKey,
        searchPlaceholder,
        totalCount,
        visibleCount,
        filterDefs,
        filters
      })}
      <div class="${bodyClassName}">
        ${items.length ? items.join('') : emptyState(emptyMessage)}
      </div>
    `
  });
}

export function filterToolbar({ viewKey, searchPlaceholder, totalCount, visibleCount, filterDefs = [], filters }) {
  return `
    <div class="toolbar">
      <div class="toolbar-copy">
        <div class="toolbar-count">${escapeHtml(String(visibleCount))} of ${escapeHtml(String(totalCount))} visible</div>
      </div>
      <div class="toolbar-controls">
        <label class="toolbar-search">
          <span class="sr-only">Search</span>
          <input
            type="search"
            value="${escapeAttribute(filters.query || '')}"
            placeholder="${escapeAttribute(searchPlaceholder)}"
            data-filter-view="${viewKey}"
            data-filter-field="query"
          >
        </label>
        ${filterDefs.map((filterDef) => `
          <label class="toolbar-select">
            <span>${escapeHtml(filterDef.label)}</span>
            <select data-filter-view="${viewKey}" data-filter-field="${filterDef.field}">
              ${filterDef.options.map(([value, label]) => `
                <option value="${value}" ${filters[filterDef.field] === value ? 'selected' : ''}>${escapeHtml(label)}</option>
              `).join('')}
            </select>
          </label>
        `).join('')}
      </div>
    </div>
  `;
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

export function lexDataTable({
  id,
  columns,
  labels,
  emptyText,
  sortBy = '',
  sortDir = 'asc',
  idKey = '',
  limit = 20,
  ariaLabel = '',
  selectable = false
}) {
  return `
    <lex-table
      id="${escapeAttribute(id)}"
      columns="${escapeAttribute(columns.join(','))}"
      labels="${escapeAttribute(labels.join(','))}"
      ${sortBy ? `sort-by="${escapeAttribute(sortBy)}"` : ''}
      sort-dir="${escapeAttribute(sortDir)}"
      ${idKey ? `id-key="${escapeAttribute(idKey)}"` : ''}
      limit="${escapeAttribute(String(limit))}"
      empty-text="${escapeAttribute(emptyText)}"
      ${ariaLabel ? `aria-label="${escapeAttribute(ariaLabel)}"` : ''}
      ${selectable ? 'selectable' : ''}
      searchable
      filterable
      column-filters
      compact
    ></lex-table>
  `;
}

export function hydrateLexDataTable(id, rows, onRowClick) {
  const hydrate = () => {
    const table = document.getElementById(id);
    if (!table || typeof table.setData !== 'function') return;

    table.setData(rows);

    if (typeof onRowClick === 'function' && table.dataset.rowClickBound !== 'true') {
      table.dataset.rowClickBound = 'true';
      table.addEventListener('row-click', (event) => {
        onRowClick(event.detail?.row, event.detail?.id, event);
      });
    }
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(hydrate);
  } else {
    setTimeout(hydrate, 0);
  }
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
