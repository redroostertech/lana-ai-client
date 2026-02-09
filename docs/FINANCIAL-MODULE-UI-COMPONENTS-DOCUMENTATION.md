# Financial Module UI Components - Documentation

**Version:** 1.0.0
**Date:** 2026-01-06
**Status:** ✅ Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Component Architecture](#component-architecture)
3. [Installation & Setup](#installation--setup)
4. [Component Reference](#component-reference)
   - [PaginationComponent](#paginationcomponent)
   - [ExportComponent](#exportcomponent)
   - [SortComponent](#sortcomponent)
   - [FilterPanelComponent](#filterpanelcomponent)
5. [Integration Examples](#integration-examples)
6. [Backend API Requirements](#backend-api-requirements)
7. [Styling & Customization](#styling--customization)
8. [Accessibility](#accessibility)
9. [Performance Considerations](#performance-considerations)
10. [Troubleshooting](#troubleshooting)

---

## Overview

This documentation covers the Phase 2 UX enhancement components for the Financial Performance & Cash Flow module. These components provide:

- ✅ **Pagination**: Client-side page navigation with configurable page sizes
- ✅ **Export**: CSV and Excel export with backend integration
- ✅ **Sort**: Dynamic sort dropdown with config-driven options
- ✅ **Filters**: Collapsible filter panel with multi-select, range, and date range filters

### Key Features

- **Vanilla JavaScript**: No framework dependencies (aligns with LANA architecture)
- **Tailwind CSS**: Utility-first styling (consistent with LANA design system)
- **Responsive**: Mobile-friendly UI components
- **Accessible**: WCAG 2.1 AA compliant
- **Reusable**: Config-driven components work with any metric
- **Extensible**: Easy to add new filter types or customize behavior

---

## Component Architecture

### Design Principles

1. **Separation of Concerns**: Each component handles a single responsibility
2. **Event-Driven**: Components communicate via callbacks
3. **State Management**: Each component manages its own internal state
4. **DOM Manipulation**: Direct DOM updates (no virtual DOM)
5. **Progressive Enhancement**: Works without JavaScript (graceful degradation)

### Component Hierarchy

```
DrilldownRenderer (existing)
  ├── PaginationComponent
  ├── ExportComponent
  ├── SortComponent
  └── FilterPanelComponent
       ├── MultiSelectFilter
       ├── RangeFilter
       └── DateRangeFilter
```

---

## Installation & Setup

### Step 1: Include Script in HTML

Add the script to your HTML page (after Tailwind CSS):

```html
<!-- Tailwind CSS -->
<script src="https://cdn.tailwindcss.com"></script>

<!-- Financial Module UI Components -->
<script src="/js/financial-module-ui-components.js"></script>
```

### Step 2: Initialize Components

```javascript
// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
  // Components are available globally via window.FinancialModuleUI
  const { PaginationComponent, ExportComponent, SortComponent, FilterPanelComponent } = window.FinancialModuleUI;

  // OR use destructuring if using modules
  // import { PaginationComponent } from './financial-module-ui-components.js';
});
```

### Step 3: Create Container Elements

```html
<div id="pagination-container"></div>
<div id="export-container"></div>
<div id="sort-container"></div>
<div id="filter-container"></div>
```

---

## Component Reference

### PaginationComponent

Handles page navigation with configurable page sizes.

#### Constructor

```javascript
const pagination = new PaginationComponent(container, config);
```

**Parameters:**
- `container` (HTMLElement): Container element for pagination UI
- `config` (Object): Configuration object
  - `defaultPageSize` (number): Default items per page (default: 25)
  - `pageSizeOptions` (Array<number>): Available page sizes (default: [10, 25, 50, 100])
  - `onPageChange` (Function): Callback when page/pageSize changes

**Example:**

```javascript
const pagination = new PaginationComponent(
  document.getElementById('pagination-container'),
  {
    defaultPageSize: 25,
    pageSizeOptions: [10, 25, 50, 100],
    onPageChange: ({ page, pageSize }) => {
      console.log(`Page changed to ${page} with ${pageSize} items per page`);
      fetchData(page, pageSize);
    }
  }
);
```

#### Methods

##### `updatePagination(totalItems)`

Update pagination with new total items count.

```javascript
pagination.updatePagination(347); // Updates UI for 347 total items
```

##### `goToPage(page)`

Navigate to a specific page.

```javascript
pagination.goToPage(5); // Navigate to page 5
```

##### `changePageSize(newSize)`

Change page size (resets to page 1).

```javascript
pagination.changePageSize(50); // Change to 50 items per page
```

##### `getState()`

Get current pagination state.

```javascript
const state = pagination.getState();
// Returns: { page: 2, pageSize: 25, totalItems: 347, totalPages: 14 }
```

##### `reset()`

Reset pagination to initial state.

```javascript
pagination.reset();
```

#### UI Elements

The component renders:

- **Page size selector**: Dropdown with configurable options
- **First/Previous/Next/Last buttons**: Navigation buttons with disabled states
- **Current page input**: Direct page number input
- **Results counter**: "Showing 1-25 of 347 results"

---

### ExportComponent

Handles CSV and Excel export with backend integration.

#### Constructor

```javascript
const exportComponent = new ExportComponent(container, config);
```

**Parameters:**
- `container` (HTMLElement): Container element for export buttons
- `config` (Object): Configuration object
  - `metric` (string): Metric key (e.g., 'expected_income')
  - `endpoint` (string): API endpoint for drilldown data
  - `getFilters` (Function): Function to get current active filters
  - `getSort` (Function): Function to get current sort configuration
  - `getPeriod` (Function): Function to get period_start and period_end
  - `getOrgId` (Function): Function to get organization ID

**Example:**

```javascript
const exportComponent = new ExportComponent(
  document.getElementById('export-container'),
  {
    metric: 'expected_income',
    endpoint: '/api/v1/modules/financial-performance/metrics/expected_income/drilldown',
    getFilters: () => filterPanel.getActiveFilters(),
    getSort: () => sortComponent.getSort(),
    getPeriod: () => ({ start: '2026-01-01', end: '2026-01-31' }),
    getOrgId: () => '123'
  }
);
```

#### Methods

##### `exportData(format)`

Trigger export in specified format.

```javascript
exportComponent.exportData('csv');    // Export as CSV
exportComponent.exportData('excel');  // Export as Excel
```

#### Backend Requirements

The backend must implement an `/export` endpoint that:

1. **Accepts query parameters:**
   - `format`: 'csv' or 'excel'
   - `org_id`: Organization ID
   - `period_start`: ISO 8601 date
   - `period_end`: ISO 8601 date
   - `filters`: JSON-encoded filter object (optional)
   - `sort`: JSON-encoded sort object (optional)

2. **Returns:**
   - **CSV**: `text/csv` content type
   - **Excel**: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
   - **Headers**: `Content-Disposition: attachment; filename="expected_income_drilldown_2026-01-06.csv"`

**Example Request:**

```bash
GET /api/v1/modules/financial-performance/metrics/expected_income/drilldown/export?
  format=csv&
  org_id=123&
  period_start=2026-01-01&
  period_end=2026-01-31&
  filters={"status":["overdue"]}&
  sort={"field":"projected_amount","direction":"desc"}
```

#### UI Elements

The component renders:

- **Export CSV button**: With download icon
- **Export Excel button**: With spreadsheet icon
- **Loading states**: Spinner + "Exporting..." text during export

---

### SortComponent

Handles sort dropdown with configurable options.

#### Constructor

```javascript
const sortComponent = new SortComponent(container, config);
```

**Parameters:**
- `container` (HTMLElement): Container element for sort dropdown
- `config` (Object): Configuration object
  - `sortOptions` (Array<Object>): Sort options from metric config
    - `field` (string): Field to sort by
    - `label` (string): Display label
    - `direction` (string): 'asc' or 'desc'
    - `default` (boolean): Default sort option
  - `onSortChange` (Function): Callback when sort changes

**Example:**

```javascript
const sortComponent = new SortComponent(
  document.getElementById('sort-container'),
  {
    sortOptions: [
      { field: 'projected_amount', label: 'Highest Amount First', default: true, direction: 'desc' },
      { field: 'projected_amount', label: 'Lowest Amount First', direction: 'asc' },
      { field: 'expected_date', label: 'Due Soonest', direction: 'asc' },
      { field: 'expected_date', label: 'Due Latest', direction: 'desc' },
      { field: 'client_name', label: 'Client (A-Z)', direction: 'asc' },
      { field: 'client_name', label: 'Client (Z-A)', direction: 'desc' }
    ],
    onSortChange: (sort) => {
      console.log(`Sort changed to ${sort.field} ${sort.direction}`);
      fetchData({ sort });
    }
  }
);
```

#### Methods

##### `getSort()`

Get current sort configuration.

```javascript
const sort = sortComponent.getSort();
// Returns: { field: 'projected_amount', direction: 'desc' }
```

##### `reset()`

Reset to default sort.

```javascript
sortComponent.reset();
```

#### UI Elements

The component renders:

- **Label**: "Sort by:"
- **Dropdown**: Select with all sort options
- **Default selection**: Auto-selects option marked `default: true`

---

### FilterPanelComponent

Manages all filters in a collapsible panel.

#### Constructor

```javascript
const filterPanel = new FilterPanelComponent(container, config);
```

**Parameters:**
- `container` (HTMLElement): Container element for filter panel
- `config` (Object): Configuration object
  - `filterConfig` (Object): Filter configuration from metric
    - `enabled` (boolean): Enable filters
    - `defaultOpen` (boolean): Open panel by default
    - `description` (string): Panel description
    - `filters` (Array<Object>): Individual filter configs
  - `endpoint` (string): API endpoint for dynamic filter options
  - `onFilterApply` (Function): Callback when filters are applied

**Example:**

```javascript
const filterPanel = new FilterPanelComponent(
  document.getElementById('filter-container'),
  {
    filterConfig: {
      enabled: true,
      defaultOpen: false,
      description: 'Filter by income source type and payment status',
      filters: [
        {
          type: 'multiselect',
          field: 'source_type',
          label: 'Source Type',
          dynamic: false,
          options: ['invoice', 'matter'],
          description: 'Filter by whether this is an unpaid invoice or active matter'
        },
        {
          type: 'multiselect',
          field: 'status',
          label: 'Status',
          dynamic: true,
          description: 'Filter by invoice or matter status'
        },
        {
          type: 'range',
          field: 'projected_amount',
          label: 'Amount Range',
          min: 0,
          max: null,
          description: 'Filter by expected income amount'
        },
        {
          type: 'date_range',
          field: 'expected_date',
          label: 'Expected Date Range',
          description: 'Filter by when you expect to receive payment'
        }
      ]
    },
    endpoint: '/api/v1/modules/financial-performance/metrics/expected_income/drilldown',
    onFilterApply: (filters) => {
      console.log('Filters applied:', filters);
      fetchData({ filters });
    }
  }
);
```

#### Methods

##### `getActiveFilters()`

Get all active filters.

```javascript
const filters = filterPanel.getActiveFilters();
// Returns: { source_type: ['invoice'], projected_amount: { min: 5000, max: 50000 } }
```

##### `applyFilters()`

Apply current filters (triggers callback).

```javascript
filterPanel.applyFilters();
```

##### `clearFilters()`

Clear all filters.

```javascript
filterPanel.clearFilters();
```

##### `togglePanel()`

Toggle panel open/closed.

```javascript
filterPanel.togglePanel();
```

##### `openIfDefault()`

Open panel if `defaultOpen: true`.

```javascript
filterPanel.openIfDefault();
```

#### Filter Types

##### Multi-Select Filter

Checkbox-based multi-selection.

```javascript
{
  type: 'multiselect',
  field: 'source_type',
  label: 'Source Type',
  dynamic: false,
  options: ['invoice', 'matter'],
  description: 'Select one or more source types'
}
```

**Dynamic Options:**

```javascript
{
  type: 'multiselect',
  field: 'status',
  label: 'Status',
  dynamic: true,  // Loads options from backend
  description: 'Filter by status'
}
```

**Backend Endpoint for Dynamic Options:**

```
GET /api/v1/modules/financial-performance/metrics/{metric}/drilldown/filter-options/{field}

Response:
{
  "options": ["sent", "overdue", "partial", "active"]
}
```

##### Range Filter

Min/max numeric inputs.

```javascript
{
  type: 'range',
  field: 'projected_amount',
  label: 'Amount Range',
  min: 0,
  max: null,  // No maximum
  description: 'Enter min and max amounts'
}
```

##### Date Range Filter

Start/end date pickers.

```javascript
{
  type: 'date_range',
  field: 'expected_date',
  label: 'Expected Date Range',
  description: 'Select start and end dates'
}
```

#### UI Elements

The component renders:

- **Toggle button**: Collapses/expands panel
- **Active filter count badge**: Shows number of active filters
- **Filter description**: Contextual help text
- **Individual filters**: Rendered based on configuration
- **Apply/Clear buttons**: Action buttons

---

## Integration Examples

### Complete Integration Example

Here's a full example integrating all components with backend API:

```javascript
// Configuration (loaded from backend)
const metricConfig = {
  key: 'expected_income',
  drilldown: {
    endpoint: '/api/v1/modules/financial-performance/metrics/expected_income/drilldown',
    pagination: {
      enabled: true,
      defaultPageSize: 25,
      pageSizeOptions: [10, 25, 50, 100]
    },
    export: {
      enabled: true,
      formats: ['csv', 'excel'],
      filename: 'expected_income_drilldown_{date}'
    },
    sortOptions: [
      { field: 'projected_amount', label: 'Highest Amount First', default: true, direction: 'desc' },
      { field: 'projected_amount', label: 'Lowest Amount First', direction: 'asc' },
      { field: 'expected_date', label: 'Due Soonest', direction: 'asc' }
    ],
    filters: {
      enabled: true,
      defaultOpen: false,
      description: 'Filter by income source type and payment status',
      filters: [
        { type: 'multiselect', field: 'source_type', label: 'Source Type', options: ['invoice', 'matter'] },
        { type: 'range', field: 'projected_amount', label: 'Amount Range', min: 0 }
      ]
    }
  }
};

// State
let currentPage = 1;
let currentPageSize = 25;
let currentFilters = {};
let currentSort = {};

// Initialize components
const pagination = new window.FinancialModuleUI.PaginationComponent(
  document.getElementById('pagination-container'),
  {
    defaultPageSize: metricConfig.drilldown.pagination.defaultPageSize,
    pageSizeOptions: metricConfig.drilldown.pagination.pageSizeOptions,
    onPageChange: ({ page, pageSize }) => {
      currentPage = page;
      currentPageSize = pageSize;
      fetchData();
    }
  }
);

const exportComponent = new window.FinancialModuleUI.ExportComponent(
  document.getElementById('export-container'),
  {
    metric: metricConfig.key,
    endpoint: metricConfig.drilldown.endpoint,
    getFilters: () => currentFilters,
    getSort: () => currentSort,
    getPeriod: () => ({ start: '2026-01-01', end: '2026-01-31' }),
    getOrgId: () => sessionStorage.getItem('organizationId')
  }
);

const sortComponent = new window.FinancialModuleUI.SortComponent(
  document.getElementById('sort-container'),
  {
    sortOptions: metricConfig.drilldown.sortOptions,
    onSortChange: (sort) => {
      currentSort = sort;
      currentPage = 1; // Reset to page 1 when sorting
      fetchData();
    }
  }
);

const filterPanel = new window.FinancialModuleUI.FilterPanelComponent(
  document.getElementById('filter-container'),
  {
    filterConfig: metricConfig.drilldown.filters,
    endpoint: metricConfig.drilldown.endpoint,
    onFilterApply: (filters) => {
      currentFilters = filters;
      currentPage = 1; // Reset to page 1 when filtering
      fetchData();
    }
  }
);

// Fetch data from backend
async function fetchData() {
  try {
    // Build query params
    const params = new URLSearchParams({
      org_id: sessionStorage.getItem('organizationId'),
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      page: currentPage,
      pageSize: currentPageSize
    });

    // Add filters
    if (Object.keys(currentFilters).length > 0) {
      params.append('filters', JSON.stringify(currentFilters));
    }

    // Add sort
    if (currentSort.field) {
      params.append('sort', JSON.stringify(currentSort));
    }

    // Fetch data
    const response = await fetch(`${metricConfig.drilldown.endpoint}?${params}`, {
      headers: {
        'Authorization': `Bearer ${sessionStorage.getItem('token')}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();

    // Update pagination
    pagination.updatePagination(data.pagination.totalItems);

    // Render table (your existing table rendering logic)
    renderTable(data.data);

  } catch (error) {
    console.error('Error fetching data:', error);
    showError(error.message);
  }
}

// Render table (example)
function renderTable(rows) {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = rows.map(row => `
    <tr>
      <td>${row.source_type}</td>
      <td>${row.matter_name}</td>
      <td>${row.client_name}</td>
      <td>$${row.projected_amount.toLocaleString()}</td>
      <td>${new Date(row.expected_date).toLocaleDateString()}</td>
      <td>${row.status}</td>
    </tr>
  `).join('');
}

// Initial load
fetchData();
```

### URL State Management

Store pagination, sort, and filters in URL for shareable links:

```javascript
// Save state to URL
function saveStateToURL() {
  const state = {
    page: currentPage,
    pageSize: currentPageSize,
    sort: currentSort,
    filters: currentFilters
  };

  const url = new URL(window.location.href);
  url.searchParams.set('state', JSON.stringify(state));
  window.history.pushState({}, '', url);
}

// Restore state from URL
function restoreStateFromURL() {
  const url = new URL(window.location.href);
  const stateParam = url.searchParams.get('state');

  if (stateParam) {
    try {
      const state = JSON.parse(stateParam);
      currentPage = state.page || 1;
      currentPageSize = state.pageSize || 25;
      currentSort = state.sort || {};
      currentFilters = state.filters || {};

      // Update UI components
      pagination.goToPage(currentPage);
      pagination.changePageSize(currentPageSize);
      // Apply filters and sort...

      fetchData();
    } catch (error) {
      console.error('Error restoring state from URL:', error);
    }
  }
}

// Restore on page load
document.addEventListener('DOMContentLoaded', () => {
  restoreStateFromURL();
});

// Save after each change
pagination.onPageChange = ({ page, pageSize }) => {
  currentPage = page;
  currentPageSize = pageSize;
  saveStateToURL();
  fetchData();
};
```

---

## Backend API Requirements

### Drilldown Data Endpoint

**Endpoint:** `GET /api/v1/modules/financial-performance/metrics/{metric}/drilldown`

**Query Parameters:**
- `org_id` (required): Organization ID
- `period_start` (required): ISO 8601 date (e.g., '2026-01-01')
- `period_end` (required): ISO 8601 date (e.g., '2026-01-31')
- `page` (optional): Page number (default: 1)
- `pageSize` (optional): Items per page (default: 25)
- `sort` (optional): JSON-encoded sort object: `{"field":"projected_amount","direction":"desc"}`
- `filters` (optional): JSON-encoded filters object: `{"status":["overdue"],"projected_amount":{"min":5000}}`

**Response Format:**

```json
{
  "data": [
    {
      "source_type": "invoice",
      "matter_name": "Smith v. Jones",
      "client_name": "John Smith",
      "projected_amount": 15000,
      "expected_date": "2026-02-15T00:00:00Z",
      "status": "overdue"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "totalItems": 347,
    "totalPages": 14
  }
}
```

### Export Endpoint

**Endpoint:** `GET /api/v1/modules/financial-performance/metrics/{metric}/drilldown/export`

**Query Parameters:** (Same as drilldown endpoint plus:)
- `format` (required): 'csv' or 'excel'

**Response:**
- **Headers:**
  - `Content-Type`: `text/csv` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `Content-Disposition`: `attachment; filename="expected_income_drilldown_2026-01-06.csv"`
- **Body:** File content

### Dynamic Filter Options Endpoint

**Endpoint:** `GET /api/v1/modules/financial-performance/metrics/{metric}/drilldown/filter-options/{field}`

**Response:**

```json
{
  "options": ["sent", "overdue", "partial", "active"]
}
```

---

## Styling & Customization

### Tailwind CSS Classes

All components use Tailwind CSS utility classes. Customize by modifying the classes in the component source:

```javascript
// Example: Change button color
const button = `
  <button class="bg-blue-600 hover:bg-blue-700">
    <!-- Change to: -->
  <button class="bg-green-600 hover:bg-green-700">
`;
```

### Custom CSS

Add custom CSS for fine-grained control:

```css
/* Override pagination button styles */
#pagination-container button {
  border-radius: 8px;
  font-weight: 600;
}

/* Custom filter panel background */
#filterPanel {
  background: linear-gradient(to bottom, #f9fafb, #ffffff);
}
```

### Dark Mode Support

Add dark mode classes:

```javascript
// Example: Dark mode pagination
const container = `
  <div class="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
    <span class="text-gray-700 dark:text-gray-300">Page</span>
  </div>
`;
```

---

## Accessibility

### WCAG 2.1 AA Compliance

All components meet WCAG 2.1 AA standards:

- ✅ **Keyboard Navigation**: Tab, Enter, Esc support
- ✅ **Screen Readers**: ARIA labels and semantic HTML
- ✅ **Focus Indicators**: Visible focus states
- ✅ **Color Contrast**: 4.5:1 minimum ratio
- ✅ **Error Messages**: Clear, actionable feedback

### Keyboard Shortcuts

- **Tab**: Navigate between controls
- **Enter**: Activate button, submit page input
- **Esc**: Close filter panel
- **Arrow Keys**: Navigate dropdown options

### Screen Reader Support

All components include:
- `aria-label` on interactive elements
- `role` attributes for custom widgets
- `sr-only` classes for screen reader-only text

---

## Performance Considerations

### Metrics to Monitor

- **Initial Load**: < 3s (target)
- **Filter Apply**: < 500ms (target)
- **Sort Change**: < 500ms (target)
- **Page Change**: < 500ms (target)
- **Export Trigger**: < 200ms (target, backend handles actual export)

### Optimizations

1. **Debounce Filter Inputs**: 500ms delay

```javascript
let debounceTimer;
filterInput.addEventListener('input', (e) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    applyFilters();
  }, 500);
});
```

2. **Lazy Load Dynamic Filters**: Only fetch options when panel opens

```javascript
if (this.dynamic && !this.optionsLoaded) {
  this.options = await this.loadDynamicOptions();
  this.optionsLoaded = true;
}
```

3. **Cache Filter Options**: 5 minutes

```javascript
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const cache = {
  options: null,
  timestamp: 0
};

async loadDynamicOptions() {
  const now = Date.now();
  if (cache.options && (now - cache.timestamp) < CACHE_DURATION) {
    return cache.options;
  }

  const options = await fetch(...);
  cache.options = options;
  cache.timestamp = now;
  return options;
}
```

4. **Virtual Scrolling**: For large filter lists (100+ options)

---

## Troubleshooting

### Common Issues

#### 1. Components Not Rendering

**Problem:** Components appear but don't render UI.

**Solution:**
- Ensure container element exists in DOM
- Check browser console for JavaScript errors
- Verify Tailwind CSS is loaded

```javascript
// Debug
console.log(document.getElementById('pagination-container')); // Should not be null
console.log(window.FinancialModuleUI); // Should be defined
```

#### 2. Export Not Working

**Problem:** Export button click does nothing.

**Solution:**
- Check backend endpoint is accessible
- Verify authentication token is valid
- Check CORS headers on backend

```javascript
// Debug
console.log(sessionStorage.getItem('token')); // Should have token
console.log(config.endpoint); // Should be valid URL
```

#### 3. Dynamic Filters Not Loading

**Problem:** Dynamic filter options don't appear.

**Solution:**
- Verify backend `/filter-options/{field}` endpoint exists
- Check network tab for API call
- Ensure response format matches expected format

```javascript
// Debug
const response = await fetch(`${endpoint}/filter-options/status`);
const data = await response.json();
console.log(data.options); // Should be array
```

#### 4. Pagination Not Updating

**Problem:** Pagination shows incorrect page count.

**Solution:**
- Call `updatePagination(totalItems)` after fetching data
- Ensure `totalItems` is correct from backend

```javascript
// Debug
const data = await fetch(...);
console.log(data.pagination.totalItems); // Should match actual count
pagination.updatePagination(data.pagination.totalItems);
```

---

## Support & Contribution

### Reporting Issues

File issues on GitHub or contact:
- **Email**: support@redroostertechnologies.com
- **Docs**: https://lana-ai-docs.redroostertec.com

### Contributing

1. Fork repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

---

## Changelog

### v1.0.0 (2026-01-06)

**Initial Release:**
- ✅ PaginationComponent
- ✅ ExportComponent
- ✅ SortComponent
- ✅ FilterPanelComponent (MultiSelect, Range, DateRange filters)
- ✅ Full documentation
- ✅ Integration examples
- ✅ Accessibility support (WCAG 2.1 AA)

---

## License

Copyright © 2026 Red Rooster Technologies. All rights reserved.
