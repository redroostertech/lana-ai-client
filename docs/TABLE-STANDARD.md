# LANA Table Standard

This standard covers every page and app in lana-client. Every list of records is one `lex-table` laid out the same way, with the same search, sort, filter, pagination and formatting rules. This document is the spec. The reference pages are My Tasks (`src/my-tasks.html`, `src/js/pages/my-tasks.js`), Document Library (`src/document-library.html`, `src/js/document-library.js`) and Template Library (`src/document-library-templates.html`, `src/js/document-library-templates.js`).

Component API details live in `src/js/lex/LEX-COMPONENT-RULES.md` (the `lex-table` section) and in the header comment of `src/js/lex/components/data/lex-table.js`.

---

## 1. Page layout

Top to bottom:

1. **Banner**: `lex-banner` with the page title, subtitle and primary action (for example "New Document").
2. **Toolbar card**: search, sort and the main filter, described in section 2.
3. **Section heading row**: the list name on the left and the item count on the right.
4. **The table**: `lex-table` with the `lex-table--card` class.

```html
<!-- Section heading -->
<div class="flex items-center justify-between mb-3">
  <h2 class="text-lg font-semibold" style="color: var(--lex-text-primary)">All Tasks</h2>
  <span id="myTasksSectionCount" class="text-sm" style="color: var(--lex-text-secondary)"></span>
</div>
```

There is no shared toolbar or heading component yet (decided 2026-10-20), because pages need different toolbar controls. Copy the markup from a reference page and change the ids and options.

## 2. Toolbar

```html
<div class="bg-white rounded-lg shadow-sm border mb-4 mt-4 p-4" style="border-color: var(--lex-border-default)" role="search" aria-label="Search and filter …">
  <div class="flex items-center gap-4 flex-wrap">
    <div class="flex-1 min-w-[200px]">
      <lex-input id="…Search" placeholder="Search …" clearable="true" leading-icon="search"></lex-input>
    </div>
    <div class="flex items-center gap-2">
      <label class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">Sort by:</label>
      <lex-select id="…Sort" options='[{"value":"updated_at","label":"Last Edited"}, …]' value="updated_at"></lex-select>
    </div>
    <lex-btn id="…SortOrder" variant="ghost" icon="true" title="Toggle sort order" data-order="desc"><!-- sort icon svg --></lex-btn>
    <div class="flex items-center gap-2"><!-- optional: one main filter, e.g. Status / Type -->
      <label class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">Status:</label>
      <lex-select id="…StatusFilter" options='[{"value":"all","label":"All"}, …]' value="all"></lex-select>
    </div>
    <div id="…Count" class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)"></div>
  </div>
</div>
```

Rules:
- **Search** always sits in the toolbar. Never use the table's own `searchable` box or the `filterable` "Add filter" bar.
- **Sort by** lists the sortable columns, using the column labels (for example "Created", not "Created Date"). The order button toggles `data-order` between `asc` and `desc`.
  - Header sorting and the toolbar stay in sync both ways. A header click updates the select and the order button (`syncToolbarSort` in document-library.js).
- **The main toolbar filter** is optional. It writes into the table's own filter state with `table.addFilter(key, 'in', [value])` or `table.removeFilter(key)`, so "Clear filters" also resets it.
  - When it isn't one of the columns, use a key that isn't a column name. Document Library's family select uses `file_family`, and its Type column filters by extension.
  - Re-sync the select from the query on every load.
- **The count** reads "N items", or "N files", "N templates" and so on. It is the total from the server, or the filtered total on a client-side table. It updates on `lex-filter-change` and `lex-data-loaded`.
- On a server-side table, wait 350 ms after typing stops, then reload from page 1 with `table.requestServerQuery({ resetPage: true })`.

## 3. The `lex-table` element

```html
<lex-table
  id="documentLibraryTable"
  class="document-library-table lex-table--card"
  column-filters
  server-paging                       <!-- only when the API pages (section 4) -->
  columns="name,type,size,workspace,created_at,updated_at"
  labels="File,Type,Size,Workspace,Created,Last edited"
  sortable-columns="name,size,created_at,updated_at"   <!-- server mode: only what the API sorts -->
  sort-by="updated_at" sort-dir="desc"
  limit="20"
  id-key="id"
  empty-text="No edited files yet"
  empty-action-label="New Document"   <!-- only where the page can create one -->
  aria-label="Documents"
></lex-table>
```

- **Always** use `lex-table--card`, `column-filters`, `limit="20"`, `id-key`, `aria-label` and `empty-text`.
- **Never** use `searchable`, `filterable`, `compact`, or the non-standard `sortable`, `paginated` or `page-size`.
- **Default sort:** newest first, by `updated_at` or `created_at` descending, unless the list has a natural order (for example due date).
- **No keyboard row navigation.** Rows open on click only (decided 2026-10-20).

## 4. Data mode: client or server

| Situation | Mode |
|---|---|
| The whole set is loaded in one request and is small (under about 500 rows) | Client: `table.setData(rows)` |
| Anything paged by the API, or that could grow | Server: `server-paging` plus `lex-query-change` |

- **Never** load a capped page (`limit=100`, `page_size=200`) and then sort, filter or page it in the browser as if it were the whole set. The user sees wrong totals and missing rows.
- **Never** wrap a client-paged table with your own Prev/Next buttons. The table's pager is the only pager.

**Server mode** (see the Document Library page):

```js
table.addEventListener('lex-query-change', (e) => load(e.detail));   // { page, limit, sortBy, sortDir, search, filters }
async function load(query) {
  const seq = ++loadSequence;                       // drop stale answers
  try {
    const res = await api.get('/api/…?' + toApiParams(query));
    if (seq !== loadSequence) return;
    table.setServerData(rows.map(mapRow), res.pagination);   // { page, limit|page_size, total, total_pages }
  } catch (err) {
    if (seq !== loadSequence) return;
    table.setServerError('… could not be loaded. Check your connection and try again.');
  }
}
table.requestServerQuery();                          // first load
```

- Map table columns to the API's sort names in one table, for example `SORT_BY_COLUMN = { size: 'file_size', … }`.
- If an API can't page, sort or filter properly, fix the API rather than working around it in the client (section 10).

## 5. Rows and cells

- **Rows keep raw values.** ISO timestamps, enum codes, byte counts and ids stay as they are, so sorting and filtering work. Keep the original record as `_raw`.
  - Never put formatted strings in row data, such as `formatDateTime(...)`, a title-cased label, or a description cut to 97 characters.
- **Formatting happens in cell renderers** (`table.setCellRenderers({...})`), registered before the first `setData` or `setServerData`.
- **The primary name column is first.** It uses semibold primary text, wraps between words, and never breaks mid-word (`overflow-wrap: break-word`, not `anywhere`).
  - In fixed-layout tables it truncates with "…" and the full name in `title`.
- **Workspace or matter names are links** to `workspace-details.html?id=<matter_id>`. Use accent colour, underline and semibold, matching `.my-task-workspace-link` and `.document-library-workspace-link`.
  - Render a `<button data-matter-id>` and handle the click with one delegated listener on the table, because lex-table's row-click ignores buttons.
- **Status and priority use `lex-badge`**, each with a colour map. Never show raw enum text (`in_progress`, `lead-management`). Humanize it, or use a label map.
- **Empty cells** show a muted em dash: `<span class="…muted">—</span>`.
- **Capital first letter.** Every label-style value in a cell or filter option starts with a capital letter: types, categories, statuses, priorities, sources, triggers, scopes and visibility. Use `Lex.Utils.humanizeLabel(value)` for enums and slugs (`lead-management` → "Lead management", `automation_execution` → "Automation execution") or `Lex.Utils.capitalizeFirst(value)` for words. Header labels are uppercased by CSS.
  - Exception: content stored exactly as written displays as stored. That covers file names, user-entered titles and names, emails, IDs and codes.

## 6. Dates

- **All dates go through `Lex.Utils`.** It reads API timestamps as UTC and shows them in the user's timezone: their profile setting, then the organization's, then the browser's.
  - Don't format dates with `toLocaleString`, a page-local helper, or an app-specific timezone lookup. The automation app currently has its own, which checks the organization before the user and falls back to UTC.
- **Every table has a "Created" column** showing the record's `created_at`. It is sortable, has the date-range filter, and is never truncated. For event logs (audit, traces), the event timestamp is the Created column.
- **"Created"** column: `Lex.Utils.formatDateTime`, which gives `1/20/2026 3:16 PM`. This is the default format for any date column holding a timestamp.
- **"Last edited" or "Updated"** column: relative time (`Lex.Utils.timeAgo`), with the full `formatDateTime` value in `title`.
- **Due dates and other date-only values:** `Lex.Utils.formatDate`.
- **Labels:** always "Created". Never "Created On", "Date Created", "Created At" or "Created Date", including in Sort by options.

## 7. Column filters: every column filters

Every visible column gets a header filter. On a client-side table, lex-table builds the value list from the rows. On a server-side table, a column shows a filter only when the page supplies one with `table.setColumnFilterOptions(map)`:

| Column kind | Filter | Config |
|---|---|---|
| Name or title | Text box, "contains" | `{ text: true, placeholder: 'File name contains...' }` |
| Enum (type, status, category, kind) | Checkboxes of values with readable labels | `{ options: [{ value, label }] }`, loaded from a facet endpoint where the set is open-ended, with a built-in fallback |
| Workspace or matter | Checkboxes of workspaces; long lists get a search box | `LanaLibraryColumnFilters.loadWorkspaceOptions(api)` |
| Date | Today / Last 7 days / Last 30 days / Older than 30 days, single choice | `{ single: true, options: LanaLibraryColumnFilters.EDITED_RANGE_OPTIONS }`. Server: `editedRangeBounds()` gives `*_after` / `*_before`. Client: add `match: (cell, v) => LanaLibraryColumnFilters.inEditedRange(cell, v[0])` |
| Number (size, count, duration) | Ranges, single choice | `{ single: true, options: [...] }`, mapped to `min_*` / `max_*` (min inclusive, max exclusive) |

- **Server filter shapes:** `filters[col] = { operator: 'in', value: [...] }`, or `{ operator: 'contains', value }` for text columns. Map them to API parameters in the page's query builder.
- **Clear filters:** when filters leave the table empty, or the server returns an error while filtered, the table offers "Clear filters" instead of the create button. Make the page's empty text say so: "No matching documents. Try a different search…".
- **Menu behaviour** (built in): the menu stays fully visible while open. One click outside or Escape closes it. Columns in the right half of the table open it aligned right.

## 8. Column widths

Each table sets its widths in the page CSS by id:

```css
#documentLibraryTable table { min-width: 920px; }          /* narrow windows scroll sideways */
#documentLibraryTable th { white-space: nowrap; }           /* label + sort arrow + filter icon on one line */
#documentLibraryTable th:nth-child(2) { width: 96px; }      /* short columns: fixed px */
#documentLibraryTable th:nth-child(4) { width: 22%; }       /* workspace-like text: % */
#documentLibraryTable th:nth-child(5) { width: 176px; }     /* Created: full date + time never truncates */
#documentLibraryTable th:nth-child(6) { width: 150px; }     /* Last edited */
/* the name column has no width: it takes the rest */
```

- Long text cells truncate with "…" plus a `title` (`td { overflow: hidden }` and `max-width: 0` on fixed-layout tables). The primary name column wraps instead.
- Date cells use `white-space: nowrap` and are never cut off.

## 9. Pagination

- Use the table's own pager: "Page X of Y (N total)", a page-size select (20 by default) and Prev/Next. The page builds no pager of its own.
- Changing a filter, the search or the sort returns to page 1.

## 10. Backend requirements for server tables

A list API behind a server table must support:
- **Paging:** `page`/`page_size` or `limit`/`offset`, a capped maximum, and a `total` in the response.
- **Sorting** for every sortable column, using an allow-list of sort names.
- **Search** across the visible text columns.
- **A filter for every column:** value lists, a name "contains", date ranges (`*_after` / `*_before`) and numeric ranges (`min_*` / `max_*`).
- **Facet endpoints** that list the values of open-ended columns, such as `GET /library/files/extensions` and `GET /document-studio/templates/document-types`. Each returns `{ <name>: [{ value, count }] }`.
- **400 errors with a readable message** for invalid parameters.

## 11. Dropdowns and overlays (all pages)

- **Dropdowns:** use only `lex-select`, in toolbars, forms, drawers and modals.
  - No native `<select>`, whether in HTML or built in JS.
  - No hand-built dropdown or popover menus.
  - Option labels follow the capital-first-letter rule.
- **Dialogs:** use `lex-modal`, with its own title, close button and footer slot.
- **Side panels:** use `lex-drawer`, with its own header, close button and footer.
- **No hand-built overlays.** That means no custom backdrop divs, `fixed inset-0` modals, or slide-overs. Never use `window.alert`, `confirm` or `prompt`; use `lex-modal` or a toast instead.
- **A lex-table row click** opens the record's `lex-drawer` or detail page. It never opens a hand-built panel.

## 12. API architecture (chef endpoints behind these tables)

- **Layers:** routes → controllers → services → repositories.
  - No SQL, and no database reads or writes, outside repositories.
  - A route or service that runs a query gets that query moved into the owning repository.
- **One repository method per table and criteria.** The list query, its count query and its facet queries share one WHERE builder, including the access or visibility predicate.
  - Duplicate queries found while working on an endpoint are merged onto that method, and callers are updated. Near-duplicates that can't be merged safely are flagged.
- **Validation:** zod at the route, with readable 400 messages, parameterized SQL and allow-listed sort fields.

## 13. Checklist for a page

- [ ] Banner, toolbar card, section heading with count, and `lex-table.lex-table--card`
- [ ] No `searchable` / `filterable` / `compact`; search in the toolbar
- [ ] Sort by select lists the sortable columns with matching labels, and stays in sync with header sorting both ways
- [ ] Correct data mode: no capped client-side lists, no outside pager
- [ ] Rows hold raw values; all formatting in renderers
- [ ] Name column first and semibold; workspace links; status/priority badges; muted "—" for empty cells
- [ ] A Created column; dates through `Lex.Utils`; "Created" label; full date-time never truncated
- [ ] Only `lex-select` dropdowns; only `lex-modal` / `lex-drawer` overlays; no native select, custom menus or `alert` / `confirm`
- [ ] Every column has a filter; Clear filters works; empty text reflects filtering
- [ ] Column widths set; narrow window scrolls sideways
- [ ] Unit tests for the query mapping; checked live: sort, each filter, search, paging, and the empty and error states

---

## 14. Inventory and migration order (2026-10-21)

Status: ✓ meets the standard. ~ close. ✗ needs migration.

### Wave 1: lex-table pages

| Page | Table | Status | What's needed |
|---|---|---|---|
| My Tasks | myTasksTable | ~ | Name filter as text; lists over 500 tasks are cut off (`TASK_FETCH_MAX`), so it needs server paging, or the cap removed |
| Document Library | documentLibraryTable | ✓ | Chef branch `fix/library-file-family` must merge before the new filters (name, extensions, size) take effect |
| Template Library | dstTable | ✓ | Same chef branch |
| Library (drive) | listView / filesListView | ~ / ✗ | Some scopes feed the whole set as one page plus an outside pager; the search-results table has no sort or filters |
| Workspaces | mattersListView | ✗ | Sorts and filters one server page in the browser, outside pager, `compact`, raw status; "Created Date" label |
| Automation: Library | libraryAutomationsTable | ✗ | Capped at `limit=100` with client sort; pre-formatted dates; raw slugs; no toolbar. Chef: the automations list ignores `page`, drops `automation_type`/`is_active`, and has no sort |
| Automation: Run History | automationRunsTable | ✗ | Server-paged API wrapped in a client-paged table plus outside Prev/Next; pre-formatted dates; plain-text status; matter isn't a link. The chef endpoint already pages, sorts and searches |
| Automation: Approvals | automationApprovalsTable | ✗ | Capped at `limit=100`; priority sorts alphabetically; no badges; no Created column. Chef: the inbox has no search or sort |
| Automation shared helper | `automation/js/shared/ui.js` `lexDataTable` | ✗ | Forces `searchable filterable compact` on every automation table |
| Skills | skillsListView | ✗ | Filter bar plus `compact`; title-cased and truncated values in row data |
| Workspace Data | wsDataTable | ✗ | Two search boxes, outside pager, sorts by a hidden column |
| Admin: Users / Sessions / Audit / Traces / User details | various | ✗ | Outside pagers, pre-formatted dates, cells patched by MutationObserver instead of renderers, `searchable`, no column filters |
| Admin: Data Visualization | dataVizTable | ✗ | Outside pager, pre-formatted dates, links use `?matter_id=` instead of `?id=` |
| Admin: Metric Catalog / Metric Detail / Dashboard Library | various | ✗ | Native `<select>` toolbar, non-standard attributes |
| BrainChild | bcOrgTable / bcMyTable | ✗ | Hidden 200/100 caps; matter isn't a link |
| Doc Studio library | docStudioLibraryTable | ✗ | Filter bar plus `compact` |
| Workspace details: connected data and activity | cdModalTable / activityDrawerTable | ~ | Modal and drawer tables: apply the rows, dates and filters rules; the toolbar can be lighter |
| Settings modals (sessions, memory) | sv2-* | ~ | Lower priority: rows and dates rules only |

### Wave 2: hand-built `<table>` lists to convert to lex-table

- Connector tables: `data-connectors.html` and `automation/js/views/connectors.js`. They are duplicates, each with its own sort and pager.
- `folder.html` file list and the document types table in `workspace-details.js`.
- Insights: `dashboard.html` and `module-execution.html` (about 24 tables).
- Integrations: leadly, actionstep, connector-viewer, sync-status and connector-crm.
- Workflows: dashboard, execution-logs and retargeting.
- Admin: reporting, search-analytics, settings, dashboard and integrations.

Report-card tables inside generated documents and chat blocks are exempt.

### Wave 2b: card or div record lists to convert to lex-table (inventory 2026-10-21)

| Page | Renders in | Records |
|---|---|---|
| admin/billable-hours.html | js/admin/billable-hours-reporting.js:209, ~255, 341 | By attorney, by matter, approval queue (each fetched with a `limit=50` cap) |
| admin/communications.html | js/admin/admin-communications.js:448, 500 | Providers, routes |
| admin/roles.html | js/admin/roles.js:147 | Roles (no paging) |
| admin/management-boards.html | js/pages/management-boards-main.js:158, 274 | Boards, submissions (no paging) |
| admin/plugins.html (Installed) | inline :236 | Installed plugins |
| admin/task-plans.html | js/admin/task-plans.js:291 | Task plans (`limit=50`) |
| approvals.html | js/approvals.js:542 | Approvals inbox |
| recordings.html | js/recordings.js:277 | Recordings |
| matters.html | inline :1411 | Matters (copy the grid/table switch from workspaces) |
| workflows/active.html | inline :288 | Workflows (the API call in js/workflows.js:227 is commented out) |
| workspace-details billable drafts | js/workspace-billable-hours.js:220 | Billable drafts |

Kept as cards, because they're launchers or galleries:
- admin/analytics.html shortcuts (most used, recent, shared). The full catalog is the Dashboard Library table. Michael to confirm.
- Dashboard builder metric picker
- Health service tiles
- Plugin marketplace
- Connectors catalog
- Skills marketplace
- Automation starter templates

### Wave 3: dropdowns and overlays (inventory 2026-10-21)

**Size:**
- About 204 native `<select>` in 57 files.
- 12 hand-built menus, plus the `#userMenu` header dropdown copied into 11 pages (`js/menu.js:977`).
- About 110 hand-built overlays in about 50 files.
- About 63 `alert`/`confirm`/`prompt` calls in 33 files.

**Component notes:**
- `lex-select` takes `options` JSON and fires `lex-change`, not `<option>` children and `change`.
- `lex-modal` has no `subtitle` and no footer slot. Use `footer-content`, or `Lex.Modal.confirm/alert/open`.
- `lex-drawer` supports `subtitle` and `[data-slot="footer"]`.

**Order:**
1. Replace `alert`/`confirm`/`prompt` with `Lex.Modal`. Route the legacy `js/components.js` confirm and alert through `Lex.Modal`.
2. Fix misuse of lex-modal:
   - About 70 `hide-actions` modals that put their footers in the body (21 in workspace-details.html).
   - `subtitle` on lex-modal (workspace-details.html:421/471/607, workspaces.html:301).
   - `*Drawer` lex-modals that should be lex-drawer (workspace-details.html:550-594).
   - Header and close CSS hacks in the user and matter pickers, my-tasks.js:1067, data_connectors.js:1012.
   - Global `.lex-drawer-body` queries (metric-catalog.js, data-visualization.js).
3. Shared JS:
   - The notifications, activity and data-override slide-overs become lex-drawer.
   - The `#userMenu` header.
   - The help, contact, conversation and note modals.
   - The widget-config modal.
4. Workflows, admin and integrations connector pages: simple modals and selects.
5. Doc Studio (including `prompt` for rename and share), voice, agents and BrainChild (which writes into `.lex-modal-body`).
6. Automation: `template-modal` x5, library-detail modals, and the builder's 16 selects plus its publish modal.
7. Hardest, last:
   - matters.html: 18 selects and about 17 modals.
   - insights/module-execution.html and insights/dashboard.html: duplicated code, to convert together.
   - connector-viewer, actionstep and leadly.
   - drilldown-renderer.
   - The kebab and status menus: matter-documents-view, dashboard, folder and drive.
   - First check whether a lex menu component exists, or add one.
