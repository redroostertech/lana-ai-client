# Lex UI Framework — Component Rules & Usage Guide

> **Version:** 2.0.0 | **Last Updated:** 2026-02-22 | **Components:** 55+ | **Files:** 89
> **Architecture:** Zero-dependency Light DOM Web Components (no Shadow DOM, no framework)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Core APIs](#2-core-apis)
3. [Foundation Components](#3-foundation-components)
4. [Form Components](#4-form-components)
5. [Data Components](#5-data-components)
6. [Layout Components](#6-layout-components)
7. [Page Structure & Shell Architecture](#7-page-structure--shell-architecture)
8. [Chat System](#8-chat-system)
9. [AI Modules & Chat Blocks](#9-ai-modules--chat-blocks)
10. [Performance Rules](#10-performance-rules)
11. [NEVER Patterns](#11-never-patterns)
12. [Common Violations](#12-common-violations)
13. [Known Issues & Remediation Plan](#13-known-issues--remediation-plan)

---

## 1. Architecture Overview

### Three-Tier Component Model

| Tier | Usage | Data Source | Example |
|------|-------|-------------|---------|
| **Tier 1: Static** | Hardcoded HTML attributes | None | `<lex-card heading="Overview">` |
| **Tier 2: Dynamic** | `endpoint` attribute binds to API | `LexDataSource` → `window.api` | `<lex-table endpoint="/api/v1/matters">` |
| **Tier 3: AI-Native** | `setData()` from AI/SSE stream | `BlockRenderer` + `SchemaRegistry` | `table.setData(aiResponse.data)` |

### File Organization

```
src/js/lex/
├── lex.core.js              # LexElement base class, defineLex(), mixins
├── lex.state.js             # Auth state, property interception, event bus
├── lex.data.js              # LexDataSource, LexDataPipeline, withDataSource
├── lex.forms.js             # withFormField mixin, form base styles
├── lex.icons.js             # 200 Lucide icons with fluent API
├── lex.utils.js             # Utility functions (escapeHtml, formatDate, etc.)
├── lex.nav.js               # Navigation API (Lex.Nav.go)
├── lex-router.js            # SPA page router
├── lex-router.pages.js      # Page descriptor registry
├── lex.ai.js                # SchemaRegistry + BlockRenderer
├── lex.ai.bridge.js         # ActionBridge (block interaction → chat)
├── lex.ai.budget.js         # TokenBudget (intent → block vocabulary)
├── lex.ai.context.js        # ActivityContext (client-side tracking)
├── lex.orchestrator.js      # Orchestrator (ties AI modules together)
├── components/
│   ├── foundation/          # Visual primitives (card, modal, drawer, etc.)
│   ├── form/                # Form fields (input, select, toggle, etc.)
│   ├── data/                # Data display (table, list, chart, etc.)
│   └── layout/              # App shell (sidebar, topbar, app)
├── chat/                    # Chat system (9 files)
└── blocks/                  # AI structured response blocks (18 types)
```

### LexElement Base Class

All components extend `LexElement` (Light DOM, reactive properties):

```javascript
class MyComponent extends LexElement {
  static get properties() {
    return {
      heading: { type: String },
      count:   { type: Number, default: 0 },
      active:  { type: Boolean, default: false, reflect: true }
    };
  }

  render() {
    // Return HTML string or null (for imperative DOM management)
    return `<div>${this.escapeHtml(this.heading)}</div>`;
  }

  updated() {
    // Called after render() — wire up event listeners here
    this.listen(this.querySelector('.btn'), 'click', this._onClick);
    this.delegate('click', '[data-action]', this._onAction);
  }

  connected()    { /* connectedCallback — after first render */ }
  disconnected() { /* cleanup */ }
}

defineLex('my-component', MyComponent);
```

**Lifecycle:** `constructor()` → `render()` → `updated()` → `connected()` → (property changes trigger `render()` → `updated()`) → `disconnected()`

**Key methods:**
- `this.escapeHtml(str)` — HTML entity escape (use on ALL user-provided text in templates)
- `this.emit(name, detail)` — dispatch CustomEvent that bubbles
- `this.listen(el, event, handler)` — auto-cleaned event listener
- `this.delegate(event, selector, handler)` — event delegation
- `this._scheduleUpdate()` — trigger re-render via `queueMicrotask`

---

## 2. Core APIs

### 2.1 Lex.Nav — Navigation

**Every navigation must go through `Lex.Nav.go()`.** Never use `window.location.href`.

```javascript
Lex.Nav.go('matters.html');
Lex.Nav.go('matters.html', { params: { matter_id: 'abc-123' } });
Lex.Nav.go('dashboard.html', { replace: true });

// Reading on destination page
const params = Lex.Nav.getParams();           // URLSearchParams
const ctx = Lex.Nav.consume();                // one-shot transit context
Lex.Nav.updateParams({ tab: 'files' });       // replaceState
```

### 2.2 LexRouter — SPA Page Router

#### Registering a New Page

Add to `lex-router.pages.js` `PAGE_DESCRIPTORS`:

```javascript
'my-page.html': {
  title: 'My Page Title',
  activeNav: 'my-nav-id',
  scripts: ['js/lex/components/foundation/lex-card.js', 'js/my-page.js'],
  stylesheets: ['css/my-page.css']
}
```

#### Page Entry Script Pattern

```javascript
(function () {
  'use strict';

  function init() {
    const params = Lex.Nav.getParams();
    // Build UI, fetch data, set up event handlers
  }

  LexRouter.registerPageInit('my-page.html', init);
  init();
})();
```

**RULE:** Always wrap in IIFE. Always call `registerPageInit` before `init()`. Top-level `const`/`class` outside IIFE will throw on SPA re-navigation.

### 2.3 Lex.Icons — Icon System

```javascript
Lex.Icons.search                    // 20px, currentColor
Lex.Icons.search.small              // 16px
Lex.Icons.search.medium             // 24px
Lex.Icons.search.large              // 32px
Lex.Icons.search.medium.accentIcon  // --lex-icon-accent color
Lex.Icons.has('search')             // boolean — always check before use
Lex.Icons.list()                    // all icon names
Lex.Icons.find('arrow')             // names containing 'arrow'
```

### 2.4 Lex.Utils — Utility Functions

| Function | Returns | Example |
|----------|---------|---------|
| `Lex.Utils.escapeHtml(str)` | Entity-escaped string | `&lt;script&gt;` |
| `Lex.Utils.formatDate(dateStr)` | `"Feb 12, 2025"` | |
| `Lex.Utils.formatDateTime(dateStr)` | `"Feb 12, 2025, 3:30 PM"` | |
| `Lex.Utils.formatRelativeDate(dateStr)` | `"Today"`, `"3 days ago"` | |
| `Lex.Utils.timeAgo(dateStr)` | `"2 hours ago"` | |
| `Lex.Utils.formatFileSize(bytes)` | `"2.4 MB"` | |
| `Lex.Utils.debounce(fn, wait)` | Debounced function | |
| `Lex.Utils.truncateText(text, max)` | Truncated string | |
| `Lex.Utils.statusBadge(status)` | Status `<span>` HTML | |
| `Lex.Scroll.softTo(targetY, opts)` | Hydraulic-damped scroll | |

**RULE:** Never use `new Date().toLocaleDateString()` directly. Use `Lex.Utils.formatDate()`.

### 2.5 Lex.Auth — Role Helpers

```javascript
Lex.Auth.user                     // current user or null
Lex.Auth.hasRole('admin')         // boolean
Lex.Auth.isAdmin()                // system_admin OR org_admin
Lex.Auth.canViewSystemStatus()    // system_admin OR org_admin
```

**RULE:** Use for UI-level gating only. Server enforces actual authorization.

### 2.6 Lex.Redact — Skeleton Shimmer

```javascript
Lex.Redact.on(element);           // shimmer overlay on ANY DOM element
Lex.Redact.off(element);          // remove (1.5s minimum duration)
myCard.redacted = true;           // on Lex components
```

- **Redacted state** = in-page data refresh (existing content shimmers)
- **`Lex.Loader.show('light')`** = full-page navigation transition

### 2.7 ScrollLock & FocusTrap

```javascript
Lex.ScrollLock.lock();            // reference-counted body overflow: hidden
Lex.ScrollLock.unlock();          // restores at count 0

const cleanup = Lex.FocusTrap.activate(panelEl);
cleanup();                        // release trap
```

**RULE:** Never set `document.body.style.overflow = 'hidden'` directly. Use `ScrollLock`.

### 2.8 Lex.state — Auth State

```javascript
Lex.state.setAuth(token, user);   // stores + fires auth:changed
Lex.state.clearAuth();            // clears + fires auth:changed
Lex.state.onAuthChange(callback); // subscribe
```

**RULE:** Never write auth data directly to `localStorage`. Use `Lex.state.setAuth()`.

---

## 3. Foundation Components

### `<lex-btn>`

**Purpose:** Primary interactive button with icon support, loading state, and variants.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | String | — | Button text |
| `variant` | String | `'primary'` | `primary`, `secondary`, `danger`, `ghost`, `link` |
| `size` | String | `'md'` | `sm`, `md`, `lg` |
| `icon` | String | — | Lucide icon name (left position) |
| `iconRight` | String | — | Icon on right side |
| `iconOnly` | Boolean | `false` | Icon-only circular button |
| `loading` | Boolean | `false` | Shows spinner, disables click |
| `disabled` | Boolean | `false` | Disabled state |
| `type` | String | `'button'` | `button`, `submit`, `reset` |
| `href` | String | — | If set, renders as `<a>` tag |

**Events:** Standard click (no custom events).

**Rules:**
- Use `variant="primary"` for the main CTA on a page (one per section)
- Use `variant="secondary"` for non-primary actions
- Use `variant="danger"` only for destructive actions (delete, remove)
- Use `variant="ghost"` for toolbar/inline actions
- Icon-only buttons **must** have an explicit `aria-label` property

### `<lex-card>`

**Purpose:** Content container with optional heading, subtitle, actions menu, and expandable/collapsible body.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `heading` | String | — | Card title |
| `subtitle` | String | — | Subtitle below heading |
| `variant` | String | `'default'` | `default`, `elevated`, `outlined`, `flat` |
| `padding` | String | `'normal'` | `normal`, `compact`, `none` |
| `bg` | String | `'light'` | `light`, `dark` |
| `actions` | Array | `[]` | `[{ icon, action, label }]` — max 3 visible, overflow menu |
| `expandable` | Boolean | `false` | Collapsible body with chevron |
| `expanded` | Boolean | `false` | Initial expand state |

**Events:** `card-action { action, label }`, `card-toggle { expanded }`

**Rules:**
- Use `<slot-content>` for card body, `data-slot="footer"` for footer children
- Use `bg="dark"` for hero/featured cards only
- Use `expandable` for progressive disclosure of detail content
- Prefer `variant="flat"` inside other cards to avoid nested shadows

### `<lex-modal>`

**Purpose:** Centered overlay dialog with backdrop, focus trap, scroll lock, and confirm/cancel actions.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `heading` | String | — | Modal title |
| `open` | Boolean | `false` | Controls visibility |
| `size` | String | `'md'` | `sm`, `md`, `lg`, `xl`, `full` |
| `confirmText` | String | `'Confirm'` | Primary button label |
| `cancelText` | String | `'Cancel'` | Secondary button label |
| `variant` | String | `'default'` | `default`, `danger` |
| `hideActions` | Boolean | `false` | Hide footer buttons |
| `closeOnOverlay` | Boolean | `true` | Close when clicking backdrop |

**Events:** `lex-confirm`, `lex-cancel`, `lex-close`

**Static API:**
```javascript
Lex.Modal.confirm({ heading: 'Delete?', body: '...', variant: 'danger' })
  .then(confirmed => { if (confirmed) { ... } });
```

**Rules:**
- Modal confirm auto-closes the modal (`this.open = false`)
- Use `variant="danger"` + `confirmText="Delete"` for destructive confirmations
- Use `hideActions` when the modal body contains its own form with submit button

### `<lex-drawer>`

**Purpose:** Slide-in side panel from left or right edge with same overlay infrastructure as modal.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `heading` | String | — | Drawer title |
| `open` | Boolean | `false` | Controls visibility |
| `side` | String | `'right'` | `left`, `right` |
| `width` | String | `'400px'` | Panel width |
| `confirmText` | String | `'Save'` | Footer confirm button |
| `cancelText` | String | `'Cancel'` | Footer cancel button |
| `showFooter` | Boolean | `false` | Show footer with actions |

**Events:** `lex-confirm`, `lex-cancel`, `lex-close`

**Rules:**
- **IMPORTANT:** Drawer confirm does NOT auto-close (unlike modal). You must manually set `drawer.open = false` after handling `lex-confirm`.
- Use drawers for editing forms, detail panels, settings panels
- Use modals for confirmations, alerts, focused decisions

### `<lex-toast>` (Static API Only)

```javascript
Lex.Toast.success('Document saved');
Lex.Toast.error('Upload failed');
Lex.Toast.info('Processing...');
Lex.Toast.warning('Token expires in 5 minutes');
```

**Rules:**
- Use for transient feedback (auto-dismisses after 4s)
- Use `<lex-banner>` for persistent page-level status instead

### `<lex-banner>`

**Purpose:** Hero section header with brand icon, status indicator, corner bracket decoration, and an actions slot. Used for page headers, integration dashboards, and hero sections.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `heading` | String | — | Main title text (renders as `<h1>`) |
| `subtitle` | String | — | Secondary description below heading |
| `icon` | String | — | Single letter for the brand circle |
| `iconSrc` | String | — | Image URL for brand icon (overrides `icon` letter) |
| `status` | String | `'none'` | `connected`, `warning`, `error`, `offline`, `none` |
| `variant` | String | `'dark'` | `dark` (brand-950 bg) or `light` (primary bg) |
| `size` | String | `'default'` | `default` or `compact` (reduced padding) |
| `corners` | Boolean | `true` | Show decorative corner brackets |
| `align` | String | `'left'` | `left` or `center` |
| `lana` | Boolean | `false` | Show the standard banner action that opens the global LANA dock |
| `lanaContextType` | String | — | Context type passed to `lex-lana-dock.openWith()` |
| `lanaMatterId` | String | — | Matter scope passed to `lex-lana-dock.openWith()` |
| `lanaMatterName` | String | — | Matter label passed to `lex-lana-dock.openWith()` |
| `lanaDocumentId` | String | — | Document scope passed to `lex-lana-dock.openWith()` |
| `lanaDocumentName` | String | — | Document label passed to `lex-lana-dock.openWith()` |

**Slot:** Place child elements (e.g. `<lex-btn>`) inside for the actions area.

**Events:** `banner-action`, `lex-banner-lana-open`

**Rules:**
- Use `variant="light"` + `size="compact"` for in-page section headers (e.g. admin landing, workspace header)
- Use `variant="dark"` (default) for hero/dashboard banners with brand identity
- Use `status` for connection/integration status indicators (not for alerts)
- Use `Lex.Toast.*` for transient action results instead of banners
- Use `lana` on page-level banners when the page hosts the global LANA dock; do not mount page-specific LANA drawers for ordinary page chat
- The `heading` renders as `<h1>` — ensure only one banner per page for accessibility

### `<lex-accordion>`

**Purpose:** Multiple collapsible sections with independent expand/collapse state.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `sections` | Array | `[]` | `[{ id, title, content, expanded?, badge? }]` |
| `multiple` | Boolean | `true` | Allow multiple open at once |

**Events:** `section-toggle { id, expanded }`

### `<lex-tabs>`

**Purpose:** Horizontal tab strip for switching between peer content sections.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `tabs` | Array | `[]` | `[{ id, label, icon?, badge?, disabled? }]` |
| `active` | String | — | Active tab ID |
| `variant` | String | `'default'` | `default`, `pills`, `underline` |

**Events:** `tab-change { id, label }`

**Rules:**
- `lex-tabs` renders only the tab strip, not the panels
- Page code must show/hide panel content based on `tab-change` events
- Max 7 tabs. For more, use a `<lex-select>` dropdown

### Other Foundation Components

| Component | Purpose | Key Properties |
|-----------|---------|----------------|
| `<lex-badge>` | Status/label pill | `label`, `color`, `size`, `dot` |
| `<lex-divider>` | Horizontal separator | `label`, `variant` |
| `<lex-empty>` | Empty state placeholder | `message`, `icon`, `description` |
| `<lex-kv>` | Key-value display pair | `label`, `value`, `variant` |
| `<lex-loader>` | Full-page loading overlay | `theme` (`light`/`dark`) |
| `<lex-metric>` | Single KPI display | `label`, `value`, `trend`, `unit`, `period` |
| `<lex-spinner>` | Inline loading indicator | `size`, `label` |
| `<lex-stack>` | Flex layout helper | `gap`, `direction` |
| `<lex-text>` | Typography wrapper | `content`, `variant` |
| `<lex-detail-panel>` | Expandable detail below KPI | `open`, `heading`, `actionLabel` |
| `<lex-action-menu>` | Full-screen action sheet | `actions`, `open` |

### Foundation Decision Guides

#### Modal vs Drawer

| Use Modal | Use Drawer |
|-----------|-----------|
| Confirmation dialogs | Editing forms |
| Alert/warning messages | Detail panels |
| Focused single decision | Settings/configuration |
| Content < 400px height | Content needs scrolling |
| Centered, blocks all else | Side panel, partial visibility |

#### Toast vs Banner

| Use Toast | Use Banner |
|-----------|-----------|
| Action result feedback | Persistent system status |
| Auto-dismisses (4s) | Stays until state changes |
| "Document saved" | "Connection offline" |

#### Spinner vs Loader

| Use Spinner | Use Loader |
|-------------|-----------|
| Inline/section loading | Full-page navigation |
| Table fetching data | Initial boot, page transition |
| Small (16-32px) | Full-screen overlay |

---

## 4. Form Components

All form components use the `withFormField` mixin, providing: `name`, `label`, `help`, `error`, `success`, `tooltip`, `required`, `disabled`, `readonly`, `size` (sm/md/lg), `value`.

### `<lex-input>`

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `type` | String | `'text'` | `text`, `email`, `password`, `number`, `date`, `tel`, `url`, `search` |
| `placeholder` | String | — | Placeholder text |
| `leadingIcon` | String | — | Lucide icon name |
| `trailingIcon` | String | — | Right-side icon |
| `clearable` | Boolean | `false` | Show clear button when filled |
| `maxlength` | Number | — | Character limit |
| `showCount` | Boolean | `false` | Show character count |

**Events:** `lex-change { name, value }`, `lex-input { name, value }`

### `<lex-textarea>`

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `rows` | Number | `3` | Initial row count |
| `autoResize` | Boolean | `false` | Grow with content |
| `maxlength` | Number | — | Character limit |
| `showCount` | Boolean | `false` | Character count |

**Events:** `lex-change`, `lex-input`

### `<lex-select>`

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `options` | Array | `[]` | `[{ value, label, icon?, disabled? }]` or `['string']` |
| `multiple` | Boolean | `false` | Multi-select mode |
| `searchable` | Boolean | `false` | Filterable dropdown |
| `placeholder` | String | — | Placeholder text |
| `clearable` | Boolean | `false` | Allow clearing selection |

**Events:** `lex-change { name, value }`

### `<lex-toggle>`

Boolean on/off switch for immediate-effect settings.

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `checked` | Boolean | `false` | Toggle state |

**Events:** `lex-change { name, value: boolean }`

### `<lex-checkbox>`

Checkbox for opt-in/agreement or multi-select groups.

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `checked` | Boolean | `false` | Check state |

**Events:** `lex-change { name, value: boolean }`

### `<lex-radio>`

Radio group for mutually exclusive options (2-6 choices).

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `options` | Array | `[]` | `[{ value, label, description? }]` |

**Events:** `lex-change { name, value }`

### `<lex-segmented>`

Horizontal pill toggle group (2-5 options always visible).

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `options` | Array | `[]` | `[{ value, label }]` |

**Events:** `lex-change { name, value }`

### `<lex-format-input>`

Auto-formatting input with masks for phone, date, currency, credit card.

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `format` | String | — | `date`, `phone`, `currency`, `credit-card`, `custom` |
| `mask` | String | — | Custom mask (for `format="custom"`) |
| `prefix` | String | — | Display prefix (e.g., `$`) |

**Events:** `lex-change { name, value, rawValue }`, `lex-input { name, value, rawValue }`

Access raw value: `input.rawValue` (e.g., `'6125551234'` for phone showing `'(612) 555-1234'`).

### `<lex-mention-input>`

Contenteditable input with `#`-triggered entity pill insertion.

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `trigger` | String | `'#'` | Character to open picker |
| `items` | Array | `[]` | `[{ id, label, icon? }]` |

**Events:** `lex-mention { id, label }`, `lex-change`, `lex-input`

### `<lex-editor>`

Rich text editor with formatting toolbar. Produces HTML or Markdown.

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `toolbar` | Array | all | `['bold','italic','heading','bulletList','orderedList','code','blockquote','link']` |
| `format` | String | `'html'` | Output: `html` or `markdown` |
| `minHeight` | String | `'120px'` | Min height |
| `maxHeight` | String | `'400px'` | Max height before scroll |

**Events:** `lex-change`, `lex-input`

### `<lex-dropdown-btn>`

Button that opens a dropdown action menu (not a value selector).

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `label` | String | — | Button label |
| `items` | Array | `[]` | `[{ value, label, icon?, variant? }]` |

**Events:** `item-click { value, label }`

### `<lex-form>`

Form container that orchestrates validation and value collection.

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `novalidate` | Boolean | `false` | Skip validation on submit |

**Events:** `lex-submit { values, valid, errors }`

```javascript
const form = document.querySelector('lex-form');
form.getValues();    // { name: 'value', ... }
form.validate();     // { valid, errors: [{name, message}] }
form.reset();        // Clear validation, reset values
```

### Form Decision Guide

#### Text Input Selection

```
Multi-line?
  YES → Needs formatting (bold, headings)? → YES: lex-editor
                                            → NO: Needs #mention pills? → YES: lex-mention-input
                                                                         → NO: lex-textarea
  NO  → Needs format mask (phone, $, date)? → YES: lex-format-input
                                              → NO: lex-input
```

#### Option Selection

```
Mutually exclusive (pick one)?
  YES → How many options?
        2-4, always visible, tab-style  → lex-segmented
        2-4, need descriptions          → lex-radio
        5+                              → lex-select
  NO  → Independent selections
        Single on/off setting           → lex-toggle
        Multi-select from list          → lex-checkbox (group) or lex-select multiple
```

#### Dropdown Type

```
Does the button label reflect the current selection?
  YES → lex-select (it's a value selector)
  NO  → lex-dropdown-btn (it's an action menu)
```

#### Toggle vs Checkbox

| Use Toggle | Use Checkbox |
|-----------|-------------|
| Immediate-effect settings | Form opt-in/agreement |
| "Enable notifications" | "I agree to terms" |
| Binary state persisted on change | Value collected on form submit |

---

## 5. Data Components

### `<lex-table>`

Sortable, searchable, filterable, paginated data table with selection and bulk actions.

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `columns` | String | auto | Comma-separated column keys |
| `labels` | String | auto | Comma-separated header labels |
| `sortBy` | String | — | Default sort column |
| `sortDir` | String | `'asc'` | Default sort direction |
| `compact` | Boolean | `false` | Reduced padding |
| `columnFilters` | Boolean | `false` | Per-column filter dropdowns |
| `emptyText` | String | `'No data found'` | Empty state message |
| `bulkActions` | Array | `[]` | `[{ label, action, variant?, icon? }]` |

Plus `withDataSource` properties: `endpoint`, `limit`, `autoFetch`, `searchable`, `filterable`, `selectable`, `linkedTo`, `idKey`.

**Events:** `row-click`, `sort-change`, `selection-change`, `bulk-action`, `lex-filter-change`, `lex-data-loaded`

**Selection API:**
```javascript
table.select('id');  table.deselect('id');
table.selectAll();   table.deselectAll();
table.selectedItems; table.selectedIds;
```

**Auto-detection:** Status badges for `active/inactive/pending/completed/failed/error/success/open/closed/draft/archived`. Column filter types: `enum` (<=10 unique), `date`, `number`, `string`.

### `<lex-list>`

Scrollable list with title, subtitle, badge, avatar for each item.

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `displayKey` | String | `'name'` | Primary label field |
| `secondaryKey` | String | — | Subtitle field |
| `badgeKey` | String | — | Badge field |
| `avatarKey` | String | — | Avatar initial field |
| `emptyText` | String | `'No items found'` | Empty state |
| `maxHeight` | String | — | Scroll container height |

Plus `withDataSource` properties + `searchable`, `filterable`, `sortable`, `sortKeys`, `bulkActions`.

**Events:** `item-click`, `sort-change`, `lex-search`, `lex-filter-change`, `selection-change`, `bulk-action`

### `<lex-chart>`

Chart.js wrapper for bar, line, doughnut, pie, polarArea charts.

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `type` | String | `'bar'` | Chart type |
| `chartData` | Object | — | Chart.js data object |
| `height` | String | `'300px'` | Container height |
| `title` | String | — | Optional heading |

Plus `withDataSource` properties. Supports `linkedTo` for cross-filtering with table/list.

### `<lex-filter-bar>`

Interactive chip-based filter builder.

| Own Property | Type | Default | Description |
|-------------|------|---------|-------------|
| `columns` | Array | `[]` | `[{ key, label, type, options? }]` |

**Events:** `lex-filter-change { filters, filterMap }`

**RULE:** Do NOT add standalone `lex-filter-bar` when using `filterable` on `lex-table`/`lex-list` — they embed it automatically.

### `<lex-pagination>`

Page controls. **RULE:** `lex-table`/`lex-list` include pagination automatically. Use standalone only for custom displays.

### `<lex-search>`

Debounced search with optional endpoint dropdown. **RULE:** Use `searchable` attribute on table/list instead of a separate `lex-search` for the same dataset.

### Data Decision Guide

#### Table vs List

| Question | Table | List |
|----------|-------|------|
| Compare multiple attributes side by side? | Yes | No |
| Primary action = click row to navigate? | Sometimes | Yes |
| Column headers need sortable click? | Yes | Sort via dropdown |
| Items have avatar/initials? | No | Yes |
| Admin data grid or navigation list? | Grid | Navigation |

#### Chart Types

| Data shape | Chart |
|-----------|-------|
| Part-to-whole | `doughnut` or `pie` |
| Trend over time | `line` |
| Compare quantities across categories | `bar` |
| Single KPI with trend | `<lex-metric>` (not chart) |

### Data Integration Patterns

```html
<!-- Table with integrated search + filter + pagination -->
<lex-table endpoint="/api/v1/matters" searchable filterable selectable
  bulk-actions='[{"label":"Archive","action":"archive"}]'>
</lex-table>

<!-- Chart cross-filtered with table -->
<lex-table id="t" endpoint="/api/v1/matters" filterable></lex-table>
<lex-chart linked-to="#t" type="doughnut" endpoint="/api/v1/analytics/by-status"></lex-chart>

<!-- AI-native data injection -->
<script>
  table.setData(aiResponse.data); // Client-side pipeline takes over
</script>
```

---

## 6. Layout Components

### `<lex-app>`

Root shell. Renders `<lex-sidebar>`, `<lex-topbar>`, `<lex-content>`. Manages auth hydration, notification polling, conversation menu initialization.

**Key methods:**
```javascript
app.setSections(sections);          // Sidebar nav items
app.setUserMenuItems(menuItems);    // User dropdown items
app.setTopbarMenuItems(items);      // Topbar action items
```

**RULE:** Never call `setSections()` or `setUserMenuItems()` in polling callbacks or reactive loops — they destroy the conversation list container on every call.

### `<lex-sidebar>`

Collapsible navigation sidebar with sections, items, conversation list, and version footer.

**Fast-path rendering:** Uses generation counters (`_sectionsGen`, `_menuItemsGen`) to skip full re-render when data hasn't changed. If all counters match, `render()` returns `null` to preserve external DOM content (ConversationMenu).

### `<lex-topbar>`

Top navigation bar with title, user info, notification bell, breadcrumb.

### `<lex-notification-panel>`

Slide-in notification panel opened from topbar bell icon.

---

## 7. Page Structure & Shell Architecture

### V1 vs V2 Architecture

The codebase has two parallel UI architectures:

| Aspect | **V1 (Legacy)** | **V2 (Lex)** |
|--------|-----------------|--------------|
| **Entry point** | `index.html` (and other standalone `.html`) | `app.html` |
| **Shell** | Hardcoded `<aside>` sidebar + `<header>` per page | `<lex-app>` (renders `<lex-sidebar>`, `<lex-topbar>`, `<lex-content>`) |
| **Navigation** | Full page reload (`window.location.href`) | SPA router (`LexRouter` / `Lex.Nav.go()`) |
| **Content area** | `<main>` inside each page's `<body>` | `<lex-content id="lex-main-content" role="main">` inside `<lex-app>` |
| **Scripts** | `<script>` tags in `<head>` per page | Page descriptor registry (`lex-router.pages.js`) loads scripts on demand |
| **Menu** | `renderMenu('#mainNav')` per page | `<lex-app>` calls `setSections()` with nav structure |
| **Auth** | Per-page `checkAuthWithRetry()` | `lex.auth.js` + router auth guard |

**Rule: All new pages MUST use the V2 architecture.** V1 pages (`index.html`, `matters.html`, `storage.html`, etc.) are legacy and listed in `FULL_RELOAD_PAGES`.

### V2 Shell Hierarchy

```
app.html                          ← SPA entry point (loaded once)
└── <lex-app>                     ← Shell component (renders once, never re-rendered)
    ├── <a class="lex-app-skip-link">  ← Accessibility skip link
    ├── <lex-sidebar>             ← Persistent sidebar navigation
    │   ├── Logo area
    │   ├── Nav sections (static top + tools + scrollable chats)
    │   ├── Conversation list     ← #lexConversationListContainer
    │   └── User profile + menu
    ├── <lex-body>                ← Right-side container (margin-left: sidebar width)
    │   ├── <lex-header>          ← Sticky header wrapper
    │   │   └── <lex-topbar>      ← Page title, notifications, user menu
    │   └── <lex-content>         ← Router content swap area
    │       └── [page content]    ← Injected by LexRouter on navigation
    ├── <lex-notification-panel>  ← Slide-in notifications
    └── .lex-app-offline-banner   ← Reachability warning
```

### Custom Element Roles

| Element | HTML Role | Purpose |
|---------|-----------|---------|
| `<lex-app>` | Shell container | Composes sidebar + topbar + content. Renders once, property changes patch children. |
| `<lex-body>` | `display: flex; flex-direction: column` | Right-side layout (topbar + content). Tracks sidebar width via `--lex-sidebar-current-width`. |
| `<lex-header>` | `role="banner"` | Sticky topbar wrapper. |
| `<lex-content>` | `role="main"`, `id="lex-main-content"` | **The content swap target.** Router injects page HTML here. Has `overflow-y: auto`. |

**CRITICAL:** `<lex-content>` creates a new stacking context due to `overflow-y: auto`. Modals (`<lex-modal>`) rendered inside it are clipped. The router auto-hoists modals to `document.body` after content injection. If you create modals dynamically in page scripts, either use `Lex.Modal.open()` / `Lex.Modal.confirm()` (which mount on `document.body`) or add `data-hoist` to the element.

### Creating a New V2 Page

#### Step 1: Create the page fragment HTML

Page fragments are **not** full HTML documents. They are content-only files:

```html
<!-- my-page.html -->
<!-- Page description comment -->

<div id="lex-page-content">

  <main>
    <!-- Your page content here -->
    <lex-banner heading="My Page Title" subtitle="Description"></lex-banner>

    <div class="cc-pipeline">
      <lex-metric label="Total" value="-" status="blue"></lex-metric>
    </div>

    <!-- Modals: add data-hoist so the router moves them to document.body -->
    <lex-modal id="myModal" heading="Confirm" data-hoist>
      <p>Are you sure?</p>
    </lex-modal>
  </main>

</div>
```

**Content extraction priority** (in `lex-router.js extractContent()`):
1. **`#lex-page-content`** — Strategy 1 (preferred for migrated/new pages). Returns `innerHTML`.
2. **`<main>`** — Strategy 2 (fallback). Returns `outerHTML`.
3. **`#app-content`** — Strategy 3 (legacy v1 pages). Strips sidebar/header/preloader, returns remainder.
4. **`<body>`** — Strategy 4 (last resort). Returns entire body.

**Rule: Always wrap new pages in `<div id="lex-page-content"><main>...</main></div>`.**

#### Step 2: Register the page descriptor

In `lex-router.pages.js`, add an entry to `PAGE_DESCRIPTORS`:

```javascript
'my-page.html': {
  title: 'My Page',              // Sets document.title and topbar heading
  activeNav: 'my-section',       // Highlights this sidebar nav item
  scripts: [
    // Lex components NOT in the shell (loaded on demand)
    'js/lex/components/foundation/lex-banner.js',
    'js/lex/components/foundation/lex-metric.js',
    'js/lex/components/foundation/lex-modal.js',
    // Page controller (MUST be last)
    'js/my-page.js'
  ],
  stylesheets: [
    'css/my-page.css'
  ]
}
```

**Script loading rules:**
- Scripts load **sequentially** in array order (dependency order matters).
- Once loaded, scripts are **cached** — they will NOT re-execute on re-navigation. Use `registerPageInit()` for re-initialization.
- CDN scripts (`cdn.*`, `cdnjs.*`) are kept in place and never removed.
- Page controller script MUST be last in the array.

**Stylesheets** load in **parallel** before content injection (prevents FOUC).

#### Step 3: Write the page controller script

```javascript
// js/my-page.js
(function () {
  'use strict';

  function init() {
    // This runs on EVERY navigation to this page (including SPA re-navigation)
    var content = document.getElementById('lex-main-content');
    if (!content) return;

    // DOM queries, event listeners, API calls, etc.
    loadData();
  }

  async function loadData() {
    // Fetch data and populate the page
  }

  // Register with router for SPA re-navigation support
  LexRouter.registerPageInit('my-page.html', init);

  // Run init on first load
  init();

})();
```

**Key pattern:** `registerPageInit()` stores the init function. On SPA re-navigation, cached scripts skip (avoiding `const` redeclaration errors), but the router calls the registered init. This is how every page controller must work.

#### Step 4: Add navigation link (optional)

If the page should appear in the sidebar, add it to `<lex-app>`'s `_hydrateUser()` sections in `lex-app.js`:

```javascript
{ id: 'my-section', label: 'My Page', icon: 'layout', href: 'my-page.html' }
```

### Router Navigation API

```javascript
// Preferred — single entry point for all navigation
Lex.Nav.go('workspaces.html');
Lex.Nav.go('workspace_details.html?id=abc-123');

// Direct router call (lower level)
LexRouter.navigate('/workspaces.html');
LexRouter.navigate('/workspaces.html', { force: true });  // Force reload
LexRouter.refresh();  // Re-fetch and re-render current page

// Get current route
LexRouter.getCurrentPath();  // e.g. '/dashboard.html'

// Get query params from the current route
Lex.Nav.getParams();  // URLSearchParams from history.state.path
```

**Navigation flow (16 steps):**
1. Auth guard (check token validity, attempt refresh if expired)
2. Tear down previous view (`onLeave`, unload scripts/stylesheets, unhoist modals)
3. Show content loading state (opacity fade on `<lex-content>`)
4. Fetch page HTML
5. Extract content (`#lex-page-content` → `<main>` → `#app-content` → `<body>`)
6. Load page stylesheets (parallel, before content injection)
7. Inject content into `<lex-content>`, hoist modals to `document.body`
8. Load page scripts (sequential)
9. Update shell state (title, active nav)
10. Push history state (route stored in `state.path`, URL stays at `app.html`)
11. Call registered `pageInit` function
12. Scroll to top
13. Hide loading state
14. Focus content area (accessibility)
15. Dispatch `lex-page-ready` event
16. Call view's `onEnter` hook

### Full Reload Pages

Pages listed in `FULL_RELOAD_PAGES` bypass the SPA router entirely — clicking a link to them triggers a normal `window.location.href` redirect:

```javascript
// These pages have their own shell or no shell at all:
'login.html', 'activate.html', 'password-reset.html',
'error.html', 'auth_error.html', 'logged_out.html',
'onboarding.html', 'demo.html', 'update-dialog.html',
'app.html',     // The SPA entry point itself
'index.html',   // V1 legacy dashboard
'matters.html', 'storage.html', 'connectors.html'  // V1 legacy pages
```

**Rule:** When migrating a V1 page to V2, remove it from `FULL_RELOAD_PAGES` and add a page descriptor.

### View Lifecycle Hooks

For pages that need setup/teardown beyond `registerPageInit()`:

```javascript
LexRouter.registerView({
  onEnter(ctx) {
    // ctx.path, ctx.contentEl, ctx.descriptor
    // Set up intervals, WebSocket connections, etc.
  },
  onLeave() {
    // Clean up intervals, connections, listeners
    // Called automatically when navigating away
  }
});
```

### V1 Page Structure (Legacy — DO NOT replicate)

`index.html` is a V1 page. It uses:
- Full HTML document with `<head>`, `<body>`, inline `<script>` tags
- Hardcoded sidebar (`<aside id="sidebar">`) with `renderMenu('#mainNav')`
- Hardcoded topbar (`<header>`) with notification panel HTML
- `<main>` with all content inside
- Per-page auth check (`checkAuthWithRetry()`)
- Manual DOM manipulation for everything (no Lex components)

**DO NOT** create new pages following this pattern. It duplicates the shell in every page, requires per-page auth logic, and cannot participate in SPA navigation.

### When to Use `<main>` vs `<lex-content>`

| Context | Element | Notes |
|---------|---------|-------|
| **Inside a V2 page fragment** | `<main>` | Semantic HTML inside `#lex-page-content`. The router injects this into `<lex-content>`. |
| **The app shell's content area** | `<lex-content>` | Created by `<lex-app>`. You never create this manually. |
| **V1 standalone page** | `<main>` | Legacy. The page provides its own shell. |

**Rule:** In V2 page fragments, always include `<main>` inside `#lex-page-content` for semantic HTML. The `<main>` element gives screen readers a landmark and is the Strategy 2 fallback if `#lex-page-content` is missing.

---

## 8. Chat System

### Architecture (9 Files)

| Order | File | Role |
|-------|------|------|
| 1 | `lex-chat.format.js` | `ChatFormat` — markdown-to-HTML pipeline |
| 2 | `lex-chat.source.js` | `ChatSource` abstract + `SSEChatSource` + `DemoChatSource` + registry |
| 3 | `lex-chat.message.js` | `<lex-chat-message>` — single message bubble |
| 4 | `lex-chat.activity.js` | `<lex-chat-activity>` — agentic progress |
| 5 | `lex-chat.documents.js` | `<lex-chat-documents>` — attached docs |
| 6 | `lex-chat.composer.js` | `<lex-chat-composer>` — text input bar |
| 7 | `lex-chat.thread.js` | `<lex-chat-thread>` — scrollable message list |
| 8 | `lex-chat.js` | `<lex-chat>` — root orchestrator |
| 9 | `lex-chat.index.js` | Barrel — registers elements and sources |

### Usage

```html
<lex-chat source="sse" endpoint="/api/v1/chat"
  conversation-id="abc-123" matter-id="matter-456"
  placeholder="Message Lana AI...">
</lex-chat>
```

### Registered Sources

| Name | Class | Description |
|------|-------|-------------|
| `sse` / `lana` | `SSEChatSource` | LANA AI backend streaming |
| `demo` | `DemoChatSource` | Mock responses for demos |
| `llama` | `LlamaChatSource` | Local llama.cpp endpoint |

### ChatSource Protocol

```javascript
class MyChatSource extends ChatSource {
  async connect(conversationId) { ... }
  async *send(content, options) {
    yield { type: 'start', conversationId };
    yield { type: 'token', text: 'Hello' };
    yield { type: 'citation', source: { ... } };
    yield { type: 'done', conversationId, messageId };
  }
  async loadHistory(page, limit) { ... }
  async stop() { ... }
}
Lex.Chat.registerSource('my-source', MyChatSource);
```

### Streaming

```javascript
message.appendContent(tokenText);  // Accumulates + re-renders via ChatFormat
message.finalize();                // Runs BlockRenderer, appends citations
```

**RULE:** Never write streaming content to DOM directly. Always use `message.appendContent()`.

---

## 9. AI Modules & Chat Blocks

### SchemaRegistry

```javascript
Lex.SchemaRegistry.register('my_block', {
  description: 'A custom block.',
  fields: { title: { type: 'string', required: true } },
  example: { type: 'my_block', title: 'Hello' }
}, (container, block) => {
  container.innerHTML = `<div>${escapeHtml(block.title)}</div>`;
});

Lex.SchemaRegistry.has('my_block');          // true
Lex.SchemaRegistry.validate(blockObj);       // { valid, errors }
Lex.SchemaRegistry.toCompactPrompt(types);   // compact schema for LLM
```

### BlockRenderer

```javascript
Lex.BlockRenderer.render(container, blocksArray);
const blocks = Lex.BlockRenderer.parseResponse(fullAIText); // Extract JSON blocks
```

### ActionBridge

Catches block interaction events and feeds them back into the chat as follow-up messages.

### TokenBudget

Maps backend intent classifications to minimal block type sets:
```javascript
Lex.TokenBudget.getBlocksForIntent('matter_query');
// → ['text', 'metric_card', 'metric_grid', 'table', 'timeline', 'suggestion']
```

### ActivityContext

```javascript
Lex.ActivityContext.setMatterId('matter-abc');
Lex.ActivityContext.track('document_view', { docId: 'doc-456' });
const ctx = Lex.ActivityContext.capture(); // Enriches outgoing chat
```

### Chat Blocks Reference

#### Content Blocks

| Block Type | Purpose | Key Fields |
|-----------|---------|------------|
| `text` | Markdown narrative | `content` |
| `code_block` | Code with copy button | `code`, `language`, `filename` |
| `citation` | Blockquote legal citation | `text`, `source`, `page`, `docId` |
| `document_ref` | Document reference card | `filename`, `docId`, `page`, `relevance` |

#### Data Blocks

| Block Type | Purpose | Key Fields |
|-----------|---------|------------|
| `metric_card` | Single KPI | `label`, `value`, `change`, `direction`, `status` |
| `metric_grid` | 2-6 KPIs in grid | `title`, `metrics[]` |
| `table` | Tabular data | `title`, `columns`, `labels`, `rows` |
| `progress_metric` | Progress bars | `header`, `value`, `metrics[].percent` |
| `compare` | Multi-column diff table | `columns`, `rows[].cells`, `rows[].changed`, `rows[].deleted` |
| `redline` | Inline text diff | `title`, `segments[].text`, `segments[].type` |
| `timeline` | Chronological events | `title`, `events[].title`, `events[].status` |

#### Interactive Blocks

| Block Type | Purpose | Key Fields | Event |
|-----------|---------|------------|-------|
| `action_list` | Clickable action cards | `items[].label`, `items[].action` | `lex-action` |
| `suggestion` | Follow-up pill chips | `items[].label`, `items[].value` | `lex-suggestion` |
| `decision` | Selection cards + continue | `prompt`, `options[]`, `allow_custom` | `lex-decision` |
| `form_collect` | Multi-field mini-form | `fields[]`, `submit_label` | `lex-form-submit` |
| `input_request` | Single-field input | `prompt`, `field`, `input_type` | `lex-input-response` |

#### Layout Blocks

| Block Type | Purpose | Key Fields |
|-----------|---------|------------|
| `section` | Titled container with children | `title`, `subtitle`, `children[]` |
| `layout` | Side-by-side column grid | `columns` (2-4), `children[]` |

#### AI Status Blocks

| Block Type | Purpose | Key Fields |
|-----------|---------|------------|
| `reasoning_steps` | Multi-step plan timeline | `steps[].number`, `steps[].title`, `steps[].status` |
| `reasoning_terminal` | Collapsible log terminal | `header`, `lines[]`, `status`, `collapsed` |

### Block Selection Rules

- **Multiple metrics?** Use `metric_grid`, never multiple consecutive `metric_card` blocks
- **Tabular data?** Use `table` block. Use `compare` block when highlighting differences matters
- **Inline text diff?** Use `redline`. Use `compare` for column-level diff
- **AI needs user input?** 1 field → `input_request`. 2+ fields → `form_collect`
- **Suggest follow-ups?** Optional → `suggestion`. Required choice → `decision`
- **Show AI plan?** Use `reasoning_steps` for steps + `reasoning_terminal` for logs
- **Group related blocks?** Use `section` for titled groups. Use `layout` for side-by-side

---

## 10. Performance Rules

### 9.1 Generation Counters

Guard against stale async operations:

```javascript
constructor() {
  super();
  this._gen = 0;
}

async _doAsyncRender() {
  const gen = ++this._gen;
  const data = await fetchSomething();
  if (gen !== this._gen) return; // stale — discard
  this._applyToDOM(data);
}
```

### 9.2 Fast-Path Patching

When only a subset of properties change, patch DOM in place:

```javascript
render() {
  const root = this.querySelector('.my-root');
  if (root) {
    root.querySelector('.heading').textContent = this.heading;
    return null; // skip innerHTML rebuild
  }
  return `<div class="my-root"><h2 class="heading">${this.escapeHtml(this.heading)}</h2></div>`;
}
```

### 9.3 innerHTML Pitfalls

- Setting `innerHTML` destroys all child elements, firing `disconnectedCallback`/`connectedCallback`
- For components with many children, prefer `textContent`, attribute patches, or `classList` manipulation
- Style injection guards (`let stylesInjected = false`) prevent repeated `<style>` appends — always use this pattern

### 9.4 Event Listener Cleanup

- Always use `this.listen()` or `this.delegate()` — they auto-clean on re-render and disconnect
- Never use raw `addEventListener` in `render()` or `updated()` — listeners leak on every re-render

---

## 11. NEVER Patterns

These are absolute prohibitions:

- **NEVER use regex** anywhere in LANA AI code. Use: `includes()`, `indexOf()`, `split()`, `startsWith()`, `endsWith()`, `substring()`, `charAt()`, `charCodeAt()`
- **NEVER** call `new LexElement()` directly. Use `document.createElement()` or HTML markup
- **NEVER** access `this.shadowRoot` — no Shadow DOM exists
- **NEVER** use `addEventListener` in `render()`/`updated()` without `this.listen()`/`this.delegate()`
- **NEVER** store mutable state in `connected()` — initialize in `constructor()`
- **NEVER** use `window.location.href` for SPA navigation — use `Lex.Nav.go()`
- **NEVER** write auth data directly to `localStorage` — use `Lex.state.setAuth()`
- **NEVER** set `document.body.style.overflow = 'hidden'` — use `Lex.ScrollLock.lock()`
- **NEVER** inject raw user content into `innerHTML` without `this.escapeHtml()`
- **NEVER** call `LexRouter.navigate()` from page code — use `Lex.Nav.go()`
- **NEVER** read `window.location.search` for SPA params — use `Lex.Nav.getParams()`
- **NEVER** push URLs to `history.state` — the URL stays at `app.html`, routes live in `state.path`
- **NEVER** render a page without registering in `lex-router.pages.js`
- **NEVER** call `setSections()`/`setUserMenuItems()` in polling or reactive loops — destroys conversation list
- **NEVER** put `const`/`class` at top level in page scripts using `registerPageInit` — wrap in IIFE

---

## 12. Common Violations

### Using `lex-select` as an action menu

```html
<!-- WRONG -->
<lex-select options='[{"value":"delete","label":"Delete"}]' label="Actions"></lex-select>
<!-- CORRECT -->
<lex-dropdown-btn label="Actions" items='[{"value":"delete","label":"Delete"}]'></lex-dropdown-btn>
```

### Adding standalone `lex-search` next to `lex-table`

```html
<!-- WRONG: Two separate components, search doesn't filter the table -->
<lex-search placeholder="Search matters..."></lex-search>
<lex-table endpoint="/api/v1/matters"></lex-table>
<!-- CORRECT: Integrated search -->
<lex-table endpoint="/api/v1/matters" searchable></lex-table>
```

### Using checkbox where toggle is correct

```html
<!-- WRONG: Immediate-effect setting should use toggle -->
<lex-checkbox label="Notifications enabled"></lex-checkbox>
<!-- CORRECT -->
<lex-toggle label="Notifications enabled"></lex-toggle>
```

### Adding standalone `lex-filter-bar` alongside `<lex-table filterable>`

```html
<!-- WRONG: filterable already embeds a filter bar -->
<lex-filter-bar columns="..."></lex-filter-bar>
<lex-table endpoint="/api/matters" filterable></lex-table>
<!-- CORRECT -->
<lex-table endpoint="/api/matters" filterable></lex-table>
```

### Using `lex-radio` for 8+ options

```html
<!-- WRONG -->
<lex-radio options='[...20 items...]'></lex-radio>
<!-- CORRECT -->
<lex-select options='[...20 items...]' searchable></lex-select>
```

### Using `lex-segmented` for 6+ options

```html
<!-- WRONG: Labels too small -->
<lex-segmented options='[...6+ items...]'></lex-segmented>
<!-- CORRECT -->
<lex-radio options='[...]'></lex-radio>
<!-- or -->
<lex-select options='[...]'></lex-select>
```

### Multiple `metric_card` blocks instead of `metric_grid`

```json
// WRONG: 3 separate metric_card blocks
[{ "type": "metric_card", ... }, { "type": "metric_card", ... }, { "type": "metric_card", ... }]
// CORRECT: One metric_grid
{ "type": "metric_grid", "metrics": [{ ... }, { ... }, { ... }] }
```

---

## 13. Known Issues & Remediation Plan

### Critical

| ID | Issue | Files | Impact |
|----|-------|-------|--------|
| C-1 | Regex in `_propToAttr`/`_attrToProp` | `lex.core.js:229,234` | Every component's attribute observation |
| C-2 | Regex in `escapeCode`/`escapeJsString`/`syntaxHighlight` | `lex-chat.format.js:36-77` | All chat message rendering |
| C-3 | Unsafe `innerHTML` from LLM output (no sanitization) | `lex-chat.message.js:352,392` | XSS risk via prompt injection |
| C-4 | Regex in format engines (date/phone/currency/card) | `lex-format-input.js:66-121` | All formatted inputs |
| C-5 | Regex in HTML-to-Markdown converter | `lex-editor.js:408-425` | Editor Markdown export |

### High

| ID | Issue | Files |
|----|-------|-------|
| H-1 | Regex in column label auto-generation | `lex-table.js:426,471` |
| H-2 | Regex in chart/composer | `lex-chart.js:95`, `lex-chat.composer.js` |
| H-3 | Form fields missing `aria-describedby` for help/error | All form components |
| H-4 | Badge/Card use Tailwind utilities bypassing tokens | `lex-badge.js`, `lex-card.js` |
| H-5 | Select dropdown doesn't close on Tab-out | `lex-select.js` |
| H-6 | Drawer confirm doesn't auto-close (modal does) | `lex-drawer.js:454-456` |
| H-7 | Accordion/Card `max-height: 9999px` animation | `lex-accordion.js:172`, `lex-card.js:242` |

### Remediation Priority

1. **Immediate:** Fix `lex.core.js` regex (C-1) — affects every component
2. **Immediate:** Add HTML sanitization to chat message `innerHTML` (C-3)
3. **Sprint 1:** Fix `lex-chat.format.js` regex (C-2)
4. **Sprint 1:** Fix `lex-format-input.js` regex (C-4)
5. **Sprint 1:** Fix `lex-editor.js` regex (C-5) — use DOMParser + TreeWalker
6. **Sprint 2:** Add `aria-describedby` to `withFormField` mixin (H-3)
7. **Sprint 2:** Fix drawer confirm auto-close (H-6)
8. **Sprint 2:** Fix accordion/card animation (H-7)
9. **Sprint 2:** Fix remaining regex in table/chart (H-1, H-2)
10. **Sprint 3:** Standardize event naming (`lex-` prefix consistently)

### Framework Maturity Score: 7.2/10

| Dimension | Score |
|-----------|-------|
| Architecture | 9/10 |
| Token compliance | 7/10 |
| Accessibility | 6/10 |
| Security (XSS) | 6/10 |
| Regex compliance | 4/10 |
| Pattern consistency | 7/10 |
| Performance | 8/10 |
| Completeness | 8/10 |
