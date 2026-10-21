/**
 * record-table-kit.js
 * Builds a standard record table (docs/TABLE-STANDARD.md) from a column spec:
 * toolbar card (search, Sort by, order, count), section heading with count,
 * and a lex-table.lex-table--card with column filters, cell renderers and
 * widths. Shared by the Insights pages (dashboard, module-execution,
 * predictions) and the Integrations pages (leadly, actionstep,
 * connector-viewer, sync-status, connector-crm), which used to hand-build
 * their <table> markup, sort, search and pagers.
 *
 * Requires on the page: lex-table, lex-input, lex-select, lex-btn, lex-badge,
 * lex-empty, Lex.Utils, and js/shared/library-column-filters.js (date ranges).
 *
 * Spec:
 *   {
 *     id: 'leadsTable',                 // lex-table id; toolbar ids derive from it
 *     title: 'Leads',                   // section heading
 *     noun: ['lead', 'leads'],          // count text
 *     ariaLabel, emptyText, filteredEmptyText,
 *     searchPlaceholder: 'Search leads...',
 *     sortBy: 'created_at', sortDir: 'desc',
 *     minWidth: 820,                    // px, table min-width (narrow windows scroll)
 *     light: true,                      // lighter toolbar for tables inside a dashboard section / modal
 *     mainFilter: { key, label, options: [{ value, label }] },  // optional toolbar filter
 *     columns: [{
 *       key, label,
 *       kind: 'name' | 'text' | 'email' | 'code' | 'enum' | 'badge' | 'created'
 *           | 'datetime' | 'relative' | 'date' | 'number' | 'currency' | 'percent'
 *           | 'matter' | 'actions' | 'html',
 *       width: '176px' | '20%',         // header width (name column: none)
 *       sortable: true (default; actions: false),
 *       options: [{ value, label }],    // enum/badge filter values (else derived from rows)
 *       labels: { value: 'Label' },     // enum/badge display labels (else humanized)
 *       colors: { value: 'green' },     // badge colours (lex-badge color names)
 *       ranges: [{ value, label, min, max }],  // number filter ranges (min incl., max excl.)
 *       matterKey: 'matter_id',         // matter: row key holding the workspace id
 *       render: function (value, row) -> html,  // custom renderer (wins over kind)
 *       filter: false | { ...lex-table filter config }  // override the derived filter
 *     }]
 *   }
 *
 * Public API (window.LanaRecordTableKit, or module.exports in Node):
 *   - esc, muted, label, capitalize
 *   - cells: { name, text, email, code, badge, created, datetime, relative, date,
 *              number, currency, percent, matter }
 *   - renderersFor(spec, options)        -> lex-table cell renderers
 *   - filterOptionsFor(spec, rows)       -> setColumnFilterOptions map (client tables)
 *   - sortOptionsFor(spec)               -> [{ value, label }] for the Sort by select
 *   - widthCss(spec)                     -> CSS text for the table's widths
 *   - markup(spec)                       -> toolbar + heading + lex-table HTML
 *   - countText(total, noun)             -> "3 leads"
 *   - mount(container, spec, options)    -> Promise of a controller (see mount)
 */

(function (global) {
  'use strict';

  var DEFAULT_MATTER_HREF = '../workspace-details.html?id=';

  function utils() {
    return global && global.Lex && global.Lex.Utils ? global.Lex.Utils : null;
  }

  function ranges() {
    if (global && global.LanaLibraryColumnFilters) return global.LanaLibraryColumnFilters;
    if (typeof require === 'function') {
      try { return require('../../js/shared/library-column-filters.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isBlank(value) {
    return value === null || value === undefined || value === '' ||
      (typeof value === 'number' && !Number.isFinite(value));
  }

  function muted(text) {
    return '<span class="rtk-muted">' + esc(text || '—') + '</span>';
  }

  function capitalize(value) {
    var u = utils();
    if (u && typeof u.capitalizeFirst === 'function') return u.capitalizeFirst(value);
    var text = value == null ? '' : String(value);
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  /** Enum, slug or dotted code as a label: "in_progress" -> "In progress". */
  function label(value) {
    var text = value == null ? '' : String(value).split('.').join(' ');
    var u = utils();
    if (u && typeof u.humanizeLabel === 'function') return u.humanizeLabel(text);
    return capitalize(text.split('_').join(' ').split('-').join(' ').split(' ').filter(Boolean).join(' '));
  }

  function columnLabel(column, value) {
    if (column && column.labels && Object.prototype.hasOwnProperty.call(column.labels, value)) {
      return column.labels[value];
    }
    return label(value);
  }

  // ---------------------------------------------------------------------------
  // Cells
  // ---------------------------------------------------------------------------

  function formatted(fn, value) {
    var u = utils();
    if (isBlank(value) || !u || typeof u[fn] !== 'function') return '';
    var text = u[fn](value);
    return text === 'Never' || text === '-' || text === '—' ? '' : text;
  }

  var cells = {
    name: function (value) {
      if (isBlank(value)) return muted('');
      return '<span class="rtk-name" title="' + esc(value) + '">' + esc(value) + '</span>';
    },
    text: function (value) {
      if (isBlank(value)) return muted('');
      return '<span class="rtk-text" title="' + esc(value) + '">' + esc(value) + '</span>';
    },
    email: function (value) {
      if (isBlank(value)) return muted('');
      return '<span class="rtk-text" title="' + esc(value) + '">' + esc(value) + '</span>';
    },
    code: function (value) {
      if (isBlank(value)) return muted('');
      return '<span class="rtk-text rtk-code" title="' + esc(value) + '">' + esc(value) + '</span>';
    },
    badge: function (value, column) {
      if (isBlank(value)) return muted('');
      var key = String(value);
      var colors = (column && column.colors) || {};
      var color = colors[key] || colors[key.toLowerCase()] || 'gray';
      return '<lex-badge label="' + esc(columnLabel(column, key)) + '" color="' + esc(color) + '"></lex-badge>';
    },
    enumText: function (value, column) {
      if (isBlank(value)) return muted('');
      var text = columnLabel(column, String(value));
      return '<span class="rtk-text" title="' + esc(text) + '">' + esc(text) + '</span>';
    },
    // "Created" and other timestamps: full date and time, relative in the tooltip.
    created: function (value) {
      var full = formatted('formatDateTime', value);
      if (!full) return muted('');
      return '<time class="rtk-time" datetime="' + esc(value) + '" title="' + esc(formatted('timeAgo', value)) + '">' + esc(full) + '</time>';
    },
    // "Last edited" / "Updated": relative, full value in the tooltip.
    relative: function (value) {
      var rel = formatted('timeAgo', value);
      if (!rel) return muted('');
      return '<time class="rtk-time" datetime="' + esc(value) + '" title="' + esc(formatted('formatDateTime', value)) + '">' + esc(rel) + '</time>';
    },
    // Date-only values (due dates).
    date: function (value) {
      var text = formatted('formatDate', value);
      if (!text) return muted('');
      return '<time class="rtk-time" datetime="' + esc(value) + '">' + esc(text) + '</time>';
    },
    number: function (value) {
      if (isBlank(value)) return muted('');
      var n = Number(value);
      return '<span class="rtk-num">' + esc(Number.isFinite(n) ? n.toLocaleString('en-US') : value) + '</span>';
    },
    currency: function (value) {
      if (isBlank(value)) return muted('');
      var n = Number(value);
      if (!Number.isFinite(n)) return muted('');
      return '<span class="rtk-num">' + esc(n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })) + '</span>';
    },
    percent: function (value) {
      if (isBlank(value)) return muted('');
      var n = Number(value);
      if (!Number.isFinite(n)) return muted('');
      return '<span class="rtk-num">' + esc((Math.round(n * 10) / 10).toLocaleString('en-US')) + '%</span>';
    },
    // Workspace/matter name as a link to workspace-details (a button, because
    // lex-table's row-click ignores buttons; mount() handles the click).
    matter: function (value, matterId) {
      if (isBlank(value) && isBlank(matterId)) return muted('');
      var text = isBlank(value) ? String(matterId) : String(value);
      if (isBlank(matterId)) return '<span class="rtk-text" title="' + esc(text) + '">' + esc(text) + '</span>';
      return '<button type="button" class="rtk-matter-link" data-matter-id="' + esc(matterId) + '" title="Open ' + esc(text) + '">' + esc(text) + '</button>';
    }
  };

  function kindOf(column) {
    return (column && column.kind) || 'text';
  }

  /**
   * Cell renderers for every column. options.esc lets a page reuse its own
   * escaper; custom column.render wins.
   */
  function renderersFor(spec) {
    var map = {};
    (spec.columns || []).forEach(function (column) {
      var kind = kindOf(column);
      if (typeof column.render === 'function') {
        map[column.key] = column.render;
        return;
      }
      switch (kind) {
        case 'name': map[column.key] = cells.name; break;
        case 'email': map[column.key] = cells.email; break;
        case 'code': map[column.key] = cells.code; break;
        case 'badge': map[column.key] = function (v) { return cells.badge(v, column); }; break;
        case 'enum': map[column.key] = function (v) { return cells.enumText(v, column); }; break;
        case 'created':
        case 'datetime': map[column.key] = cells.created; break;
        case 'relative': map[column.key] = cells.relative; break;
        case 'date': map[column.key] = cells.date; break;
        case 'number': map[column.key] = cells.number; break;
        case 'currency': map[column.key] = cells.currency; break;
        case 'percent': map[column.key] = cells.percent; break;
        case 'matter':
          map[column.key] = function (v, row) {
            return cells.matter(v, row ? row[column.matterKey || 'matter_id'] : '');
          };
          break;
        case 'actions':
        case 'html': map[column.key] = function (v) { return v == null ? '' : String(v); }; break;
        default: map[column.key] = cells.text;
      }
    });
    return map;
  }

  // ---------------------------------------------------------------------------
  // Filters, sort options, widths
  // ---------------------------------------------------------------------------

  function distinct(rows, key) {
    var seen = {};
    var values = [];
    (rows || []).forEach(function (row) {
      var value = row ? row[key] : null;
      if (isBlank(value)) return;
      var text = String(value);
      if (seen[text]) return;
      seen[text] = true;
      values.push(text);
    });
    return values;
  }

  function rangeFilter(columnRanges) {
    return {
      single: true,
      options: columnRanges.map(function (r) { return { value: r.value, label: r.label }; }),
      match: function (cell, values) {
        var picked = columnRanges.filter(function (r) { return r.value === values[0]; })[0];
        if (!picked) return true;
        if (picked.value === 'none') return isBlank(cell);
        var n = Number(cell);
        if (isBlank(cell) || !Number.isFinite(n)) return false;
        if (picked.min !== null && picked.min !== undefined && n < picked.min) return false;
        if (picked.max !== null && picked.max !== undefined && n >= picked.max) return false;
        return true;
      }
    };
  }

  function presenceFilter() {
    return {
      single: true,
      options: [{ value: 'has_value', label: 'Has a value' }, { value: 'no_value', label: 'No value' }],
      match: function (cell, values) {
        return values[0] === 'no_value' ? isBlank(cell) : !isBlank(cell);
      }
    };
  }

  function dateFilter() {
    var r = ranges();
    if (!r) return null;
    return {
      single: true,
      options: r.EDITED_RANGE_OPTIONS,
      match: function (cell, values) { return r.inEditedRange(cell, values[0]); }
    };
  }

  /**
   * Header filters for every column of a client-side table: name-like
   * columns take a text box, enums take their values with readable labels,
   * dates take the shared ranges, numbers take ranges (or Has a value).
   */
  function filterOptionsFor(spec, rows) {
    var map = {};
    (spec.columns || []).forEach(function (column) {
      if (column.filter === false || !column.label) return;
      if (column.filter && typeof column.filter === 'object') { map[column.key] = column.filter; return; }
      var kind = kindOf(column);
      switch (kind) {
        case 'name':
        case 'text':
        case 'email':
        case 'code':
        case 'matter':
          map[column.key] = { text: true, placeholder: column.label + ' contains...' };
          break;
        case 'badge':
        case 'enum': {
          var options = column.options || distinct(rows, column.key)
            .map(function (v) { return { value: v, label: columnLabel(column, v) }; })
            .sort(function (a, b) { return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }); });
          map[column.key] = { options: options };
          break;
        }
        case 'created':
        case 'datetime':
        case 'relative':
        case 'date': {
          var date = dateFilter();
          if (date) map[column.key] = date;
          break;
        }
        case 'number':
        case 'currency':
        case 'percent':
          map[column.key] = column.ranges ? rangeFilter(column.ranges) : presenceFilter();
          break;
        default:
          break;
      }
    });
    return map;
  }

  function isSortable(column) {
    if (!column.label) return false;
    if (column.sortable === false) return false;
    return kindOf(column) !== 'actions' && kindOf(column) !== 'html';
  }

  function sortOptionsFor(spec) {
    return (spec.columns || []).filter(isSortable).map(function (column) {
      return { value: column.key, label: column.label };
    });
  }

  function cssId(id) {
    return String(id).replace(/[^A-Za-z0-9_-]/g, '');
  }

  function widthCss(spec) {
    var id = '#' + cssId(spec.id);
    var lines = [
      id + ' table { min-width: ' + (Number(spec.minWidth) || 720) + 'px; }',
      id + ' th { white-space: nowrap; }'
    ];
    (spec.columns || []).forEach(function (column, index) {
      var kind = kindOf(column);
      var width = column.width;
      if (!width && (kind === 'created' || kind === 'datetime')) width = '176px';
      if (width) lines.push(id + ' th:nth-child(' + (index + 1) + ') { width: ' + width + '; }');
      if (kind === 'created' || kind === 'datetime' || kind === 'relative' || kind === 'date') {
        lines.push(id + ' td:nth-child(' + (index + 1) + ') { white-space: nowrap; }');
      }
    });
    return lines.join('\n');
  }

  var BASE_CSS = [
    '.rtk-muted { color: var(--lex-text-tertiary, #9ca3af); }',
    '.rtk-name { font-weight: 600; color: var(--lex-text-primary, #111827); overflow-wrap: break-word; }',
    '.rtk-text { color: var(--lex-text-secondary, #4b5563); overflow: hidden; text-overflow: ellipsis; }',
    '.rtk-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; }',
    '.rtk-time { white-space: nowrap; color: var(--lex-text-secondary, #4b5563); }',
    '.rtk-num { font-variant-numeric: tabular-nums; color: var(--lex-text-primary, #111827); }',
    '.rtk-matter-link { background: none; border: 0; padding: 0; cursor: pointer; text-align: left; font: inherit;',
    '  font-weight: 600; color: var(--lex-accent-primary, #8B7355); text-decoration: underline; text-underline-offset: 2px; }',
    '.rtk-matter-link:hover { color: var(--lex-accent-hover, #6F5B43); }',
    '.rtk-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }',
    '.rtk-action { border: 1px solid var(--lex-border-default, #E8E5E1); background: var(--lex-bg-primary, #fff);',
    '  border-radius: 6px; padding: 4px 10px; font-size: 0.75rem; font-weight: 600; cursor: pointer;',
    '  color: var(--lex-text-primary, #111827); white-space: nowrap; }',
    '.rtk-action:hover { background: var(--lex-bg-secondary, #F5F5F0); }',
    '.rtk-toolbar-icon { width: 20px; height: 20px; }',
    '.rtk-section + .rtk-section { margin-top: 24px; }'
  ].join('\n');

  function ensureStyles(spec) {
    var doc = global.document;
    if (!doc || !doc.head) return;
    if (!doc.getElementById('rtk-base-styles')) {
      var base = doc.createElement('style');
      base.id = 'rtk-base-styles';
      base.textContent = BASE_CSS;
      doc.head.appendChild(base);
    }
    var styleId = 'rtk-style-' + cssId(spec.id);
    var style = doc.getElementById(styleId);
    if (!style) {
      style = doc.createElement('style');
      style.id = styleId;
      doc.head.appendChild(style);
    }
    style.textContent = widthCss(spec);
  }

  // ---------------------------------------------------------------------------
  // Markup
  // ---------------------------------------------------------------------------

  function ids(spec) {
    var base = cssId(spec.id);
    return {
      table: base,
      search: base + 'Search',
      sort: base + 'Sort',
      order: base + 'SortOrder',
      filter: base + 'MainFilter',
      count: base + 'Count',
      sectionCount: base + 'SectionCount'
    };
  }

  function attrJson(value) {
    return esc(JSON.stringify(value));
  }

  function countText(total, noun) {
    var n = Number(total) || 0;
    var words = noun || ['item', 'items'];
    return n.toLocaleString('en-US') + ' ' + (n === 1 ? words[0] : words[1]);
  }

  function markup(spec) {
    var id = ids(spec);
    var columns = spec.columns || [];
    var sortOptions = sortOptionsFor(spec);
    var sortBy = spec.sortBy || (sortOptions[0] && sortOptions[0].value) || '';
    var sortDir = spec.sortDir === 'asc' ? 'asc' : 'desc';
    var sortable = sortOptions.map(function (o) { return o.value; }).join(',');
    var toolbarClass = spec.light
      ? 'rounded-lg border mb-3 p-3'
      : 'bg-white rounded-lg shadow-sm border mb-4 mt-4 p-4';
    var mainFilter = spec.mainFilter
      ? '<div class="flex items-center gap-2">' +
          '<label class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">' + esc(spec.mainFilter.label) + ':</label>' +
          '<lex-select id="' + id.filter + '" options=\'' + attrJson([{ value: 'all', label: 'All' }].concat(spec.mainFilter.options || [])) + '\' value="all"></lex-select>' +
        '</div>'
      : '';
    var headingTag = spec.light ? 'h4' : 'h2';
    var headingClass = spec.light ? 'text-base font-semibold' : 'text-lg font-semibold';
    return '' +
      '<section class="rtk-section" data-rtk-table="' + id.table + '">' +
        '<div class="' + toolbarClass + '" style="border-color: var(--lex-border-default); background: var(--lex-bg-primary, #fff)" role="search" aria-label="Search and filter ' + esc((spec.title || '').toLowerCase()) + '">' +
          '<div class="flex items-center gap-4 flex-wrap">' +
            '<div class="flex-1 min-w-[200px]">' +
              '<lex-input id="' + id.search + '" placeholder="' + esc(spec.searchPlaceholder || 'Search...') + '" clearable="true" leading-icon="search"></lex-input>' +
            '</div>' +
            (sortOptions.length ? (
              '<div class="flex items-center gap-2">' +
                '<label class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">Sort by:</label>' +
                '<lex-select id="' + id.sort + '" options=\'' + attrJson(sortOptions) + '\' value="' + esc(sortBy) + '"></lex-select>' +
              '</div>' +
              '<lex-btn id="' + id.order + '" variant="ghost" icon="true" title="Toggle sort order" data-order="' + sortDir + '">' +
                '<svg class="rtk-toolbar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path></svg>' +
              '</lex-btn>'
            ) : '') +
            mainFilter +
            '<div id="' + id.count + '" class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)"></div>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center justify-between mb-3">' +
          '<' + headingTag + ' class="' + headingClass + '" style="color: var(--lex-text-primary)">' + esc(spec.title || '') + '</' + headingTag + '>' +
          '<span id="' + id.sectionCount + '" class="text-sm" style="color: var(--lex-text-secondary)"></span>' +
        '</div>' +
        '<lex-table id="' + id.table + '" class="lex-table--card" column-filters' +
          (spec.serverPaging ? ' server-paging' : '') +
          ' columns="' + esc(columns.map(function (c) { return c.key; }).join(',')) + '"' +
          ' labels="' + esc(columns.map(function (c) { return c.label || ' '; }).join(',')) + '"' +
          ' sortable-columns="' + esc(spec.sortableColumns != null ? spec.sortableColumns : sortable) + '"' +
          (sortBy ? ' sort-by="' + esc(sortBy) + '" sort-dir="' + sortDir + '"' : '') +
          (spec.searchKeys ? ' search-keys="' + esc(spec.searchKeys) + '"' : '') +
          ' limit="' + (Number(spec.limit) || 20) + '"' +
          ' id-key="' + esc(spec.idKey || 'id') + '"' +
          ' empty-text="' + esc(spec.emptyText || 'No records found') + '"' +
          ' aria-label="' + esc(spec.ariaLabel || spec.title || 'Records') + '"' +
        '></lex-table>' +
      '</section>';
  }

  // ---------------------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------------------

  function isFiltered(table) {
    var source = table && table.dataSource;
    if (!source) return false;
    var filters = source._filters;
    return !!((filters && filters.size > 0) || (table.searchText || source._searchQuery));
  }

  /**
   * Renders the table into container and wires it.
   * options:
   *   rows                      -> client-side rows (setData)
   *   load(query) -> Promise<{ rows, pagination }>  -> server mode (spec.serverPaging)
   *   serverFilters             -> setColumnFilterOptions map for a server table
   *   onRowClick(row, event)
   *   onAction(action, row, event)  -> clicks on [data-row-action] inside cells
   *   matterHref                -> default '../workspace-details.html?id='
   *   errorText                 -> server error copy
   * Returns a Promise of { table, setRows(rows), reload(), setError(message), ids }.
   */
  function mount(container, spec, options) {
    var opts = options || {};
    var doc = global.document;
    var id = ids(spec);
    ensureStyles(spec);
    container.innerHTML = markup(spec);
    var table = doc.getElementById(id.table);
    var rowsById = {};
    var loadSequence = 0;
    var searchTimer = null;
    var serverMode = !!spec.serverPaging;

    function node(key) { return doc.getElementById(id[key]); }

    function updateCount() {
      var source = table.dataSource;
      var total = source && source.pagination ? Number(source.pagination.total) || 0 : 0;
      var text = countText(total, spec.noun);
      [node('count'), node('sectionCount')].forEach(function (target) { if (target) target.textContent = text; });
    }

    function updateEmptyText() {
      table.emptyText = isFiltered(table)
        ? (spec.filteredEmptyText || 'No matching records. Try a different search or clear the filters.')
        : (spec.emptyText || 'No records found');
    }

    function syncToolbar() {
      var source = table.dataSource;
      var select = node('sort');
      var order = node('order');
      var sortBy = (source && source._sortBy) || table.sortBy;
      var sortDir = (source && source._sortDir) || table.sortDir;
      if (select && sortBy && select.value !== sortBy) select.value = sortBy;
      if (order) order.dataset.order = sortDir === 'asc' ? 'asc' : 'desc';
      var filterSelect = node('filter');
      if (filterSelect && spec.mainFilter) {
        var filter = source && source._filters && source._filters.get(spec.mainFilter.key);
        var value = filter ? (Array.isArray(filter.value) ? filter.value[0] : filter.value) : 'all';
        if (filterSelect.value !== String(value || 'all')) filterSelect.value = String(value || 'all');
      }
    }

    function applySort(column, direction) {
      table.sortBy = column;
      table.sortDir = direction;
      if (table.dataSource) table.dataSource.setSort(column, direction);
    }

    function currentOrder() {
      var order = node('order');
      return order && order.dataset.order === 'asc' ? 'asc' : 'desc';
    }

    function indexRows(rows) {
      rowsById = {};
      (rows || []).forEach(function (row) {
        if (row && row[spec.idKey || 'id'] != null) rowsById[String(row[spec.idKey || 'id'])] = row;
      });
    }

    function setRows(rows) {
      var list = Array.isArray(rows) ? rows : [];
      indexRows(list);
      table.setColumnFilterOptions(filterOptionsFor(spec, list));
      table.setData(list);
      updateEmptyText();
      updateCount();
    }

    function setError(message) {
      if (serverMode) table.setServerError(message);
      else if (typeof table.setError === 'function') table.setError(message);
    }

    async function load(query) {
      var seq = ++loadSequence;
      try {
        var result = await opts.load(query);
        if (seq !== loadSequence) return;
        var rows = (result && result.rows) || [];
        indexRows(rows);
        table.setServerData(rows, (result && result.pagination) || {});
        updateEmptyText();
      } catch (error) {
        if (seq !== loadSequence) return;
        table.setServerError(opts.errorText || (spec.title || 'Records') + ' could not be loaded. Check your connection and try again.');
      }
    }

    // Toolbar
    var search = node('search');
    if (search) {
      var onSearch = function (event) {
        var value = String((event && event.detail && event.detail.value !== undefined ? event.detail.value : search.value) || '').trim();
        global.clearTimeout(searchTimer);
        var apply = function () { if (table.dataSource) table.dataSource.setSearch(value); updateEmptyText(); };
        if (serverMode) searchTimer = global.setTimeout(apply, 350);
        else apply();
      };
      search.addEventListener('lex-input', onSearch);
      search.addEventListener('lex-change', onSearch);
    }
    var sortSelect = node('sort');
    if (sortSelect) {
      sortSelect.addEventListener('lex-change', function (event) {
        var column = (event && event.detail && event.detail.value) || spec.sortBy;
        if (column) applySort(column, currentOrder());
      });
    }
    var orderButton = node('order');
    if (orderButton) {
      orderButton.addEventListener('click', function () {
        orderButton.dataset.order = currentOrder() === 'asc' ? 'desc' : 'asc';
        var column = (sortSelect && sortSelect.value) || table.sortBy || spec.sortBy;
        if (column) applySort(column, currentOrder());
      });
    }
    var filterSelect = node('filter');
    if (filterSelect && spec.mainFilter) {
      filterSelect.addEventListener('lex-change', function (event) {
        var value = String((event && event.detail && event.detail.value) || '');
        if (value && value !== 'all') table.addFilter(spec.mainFilter.key, 'in', [value]);
        else table.removeFilter(spec.mainFilter.key);
      });
    }

    table.addEventListener('lex-filter-change', function () { updateCount(); syncToolbar(); updateEmptyText(); });
    table.addEventListener('lex-data-loaded', updateCount);
    table.addEventListener('sort-change', syncToolbar);
    table.addEventListener('row-click', function (event) {
      if (typeof opts.onRowClick !== 'function') return;
      var row = event.detail && event.detail.row;
      if (row) opts.onRowClick(row, event);
    });
    table.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target : null;
      if (!target) return;
      var link = target.closest('[data-matter-id]');
      if (link && table.contains(link)) {
        event.preventDefault();
        event.stopPropagation();
        var href = (opts.matterHref || DEFAULT_MATTER_HREF) + encodeURIComponent(link.getAttribute('data-matter-id'));
        if (typeof opts.onMatterClick === 'function') opts.onMatterClick(link.getAttribute('data-matter-id'), href);
        else global.location.href = href;
        return;
      }
      var action = target.closest('[data-row-action]');
      if (action && table.contains(action) && typeof opts.onAction === 'function') {
        event.preventDefault();
        event.stopPropagation();
        var rowId = action.getAttribute('data-row-id');
        opts.onAction(action.getAttribute('data-row-action'), rowsById[rowId] || { id: rowId }, event, action);
      }
    });

    var ready = global.customElements && typeof global.customElements.whenDefined === 'function'
      ? global.customElements.whenDefined('lex-table')
      : Promise.resolve();

    return ready.then(function () {
      table.setCellRenderers(renderersFor(spec));
      var controller = {
        table: table,
        ids: id,
        setRows: setRows,
        setError: setError,
        reload: function () { if (serverMode) table.requestServerQuery(); },
        reloadFromFirstPage: function () { if (serverMode) table.requestServerQuery({ resetPage: true }); }
      };
      if (serverMode) {
        table.setColumnFilterOptions(opts.serverFilters || {});
        table.addEventListener('lex-query-change', function (event) { load(event.detail || {}); });
        table.requestServerQuery();
      } else {
        setRows(opts.rows || []);
      }
      return controller;
    });
  }

  /** Small action button for an actions column. */
  function actionButton(action, rowId, text, extraClass) {
    return '<button type="button" class="rtk-action' + (extraClass ? ' ' + extraClass : '') + '" data-row-action="' + esc(action) + '" data-row-id="' + esc(rowId) + '">' + esc(text) + '</button>';
  }

  var moduleApi = {
    DEFAULT_MATTER_HREF: DEFAULT_MATTER_HREF,
    esc: esc,
    muted: muted,
    label: label,
    capitalize: capitalize,
    isBlank: isBlank,
    cells: cells,
    actionButton: actionButton,
    renderersFor: renderersFor,
    filterOptionsFor: filterOptionsFor,
    sortOptionsFor: sortOptionsFor,
    widthCss: widthCss,
    markup: markup,
    ids: ids,
    countText: countText,
    mount: mount
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaRecordTableKit = moduleApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
