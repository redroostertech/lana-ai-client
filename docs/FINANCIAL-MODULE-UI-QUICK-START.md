# Financial Module UI Components - Quick Start Guide

**Version:** 1.0.0
**Last Updated:** 2026-01-06

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Include Script

Add to your HTML:

```html
<script src="/js/financial-module-ui-components.js"></script>
```

### Step 2: Create Containers

Add container elements:

```html
<div id="pagination-container"></div>
<div id="export-container"></div>
<div id="sort-container"></div>
<div id="filter-container"></div>
```

### Step 3: Initialize Components

```javascript
const { PaginationComponent, ExportComponent, SortComponent, FilterPanelComponent } = window.FinancialModuleUI;

// Pagination
const pagination = new PaginationComponent(
  document.getElementById('pagination-container'),
  {
    defaultPageSize: 25,
    onPageChange: ({ page, pageSize }) => {
      fetchData(page, pageSize);
    }
  }
);

// Export
const exportComponent = new ExportComponent(
  document.getElementById('export-container'),
  {
    metric: 'expected_income',
    endpoint: '/api/v1/modules/financial-performance/metrics/expected_income/drilldown',
    getFilters: () => ({}),
    getSort: () => ({}),
    getPeriod: () => ({ start: '2026-01-01', end: '2026-01-31' }),
    getOrgId: () => '123'
  }
);

// Sort
const sortComponent = new SortComponent(
  document.getElementById('sort-container'),
  {
    sortOptions: [
      { field: 'amount', label: 'Highest Amount', default: true, direction: 'desc' },
      { field: 'date', label: 'Due Soonest', direction: 'asc' }
    ],
    onSortChange: (sort) => {
      fetchData({ sort });
    }
  }
);

// Filters
const filterPanel = new FilterPanelComponent(
  document.getElementById('filter-container'),
  {
    filterConfig: {
      filters: [
        { type: 'multiselect', field: 'status', label: 'Status', options: ['active', 'overdue'] },
        { type: 'range', field: 'amount', label: 'Amount', min: 0 }
      ]
    },
    endpoint: '/api/v1/modules/financial-performance/metrics/expected_income/drilldown',
    onFilterApply: (filters) => {
      fetchData({ filters });
    }
  }
);
```

### Step 4: Fetch Data

```javascript
async function fetchData({ page = 1, pageSize = 25, sort = {}, filters = {} } = {}) {
  const params = new URLSearchParams({
    org_id: '123',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    page,
    pageSize
  });

  if (sort.field) params.append('sort', JSON.stringify(sort));
  if (Object.keys(filters).length > 0) params.append('filters', JSON.stringify(filters));

  const response = await fetch(`/api/v1/.../drilldown?${params}`);
  const data = await response.json();

  // Update pagination
  pagination.updatePagination(data.pagination.totalItems);

  // Render table
  renderTable(data.data);
}
```

---

## 📚 Component Reference

### PaginationComponent

**Constructor:**
```javascript
new PaginationComponent(container, {
  defaultPageSize: 25,
  pageSizeOptions: [10, 25, 50, 100],
  onPageChange: ({ page, pageSize }) => {}
})
```

**Methods:**
- `updatePagination(totalItems)` - Update with total count
- `goToPage(page)` - Navigate to specific page
- `changePageSize(newSize)` - Change items per page
- `getState()` - Get current state
- `reset()` - Reset to initial state

---

### ExportComponent

**Constructor:**
```javascript
new ExportComponent(container, {
  metric: 'expected_income',
  endpoint: '/api/v1/.../drilldown',
  getFilters: () => ({}),
  getSort: () => ({}),
  getPeriod: () => ({ start: '...', end: '...' }),
  getOrgId: () => '123'
})
```

**Methods:**
- `exportData(format)` - Trigger export ('csv' or 'excel')

---

### SortComponent

**Constructor:**
```javascript
new SortComponent(container, {
  sortOptions: [
    { field: 'amount', label: 'Highest First', default: true, direction: 'desc' }
  ],
  onSortChange: (sort) => {}
})
```

**Methods:**
- `getSort()` - Get current sort
- `reset()` - Reset to default

---

### FilterPanelComponent

**Constructor:**
```javascript
new FilterPanelComponent(container, {
  filterConfig: {
    filters: [
      { type: 'multiselect', field: 'status', label: 'Status', options: ['active'] },
      { type: 'range', field: 'amount', label: 'Amount', min: 0 },
      { type: 'date_range', field: 'date', label: 'Date' }
    ]
  },
  endpoint: '/api/v1/.../drilldown',
  onFilterApply: (filters) => {}
})
```

**Methods:**
- `getActiveFilters()` - Get current filters
- `applyFilters()` - Apply and trigger callback
- `clearFilters()` - Clear all filters
- `togglePanel()` - Open/close panel

---

## 🔌 Backend API Requirements

### 1. Drilldown Endpoint

**Request:**
```
GET /api/v1/modules/{module}/metrics/{metric}/drilldown?
  org_id=123&
  period_start=2026-01-01&
  period_end=2026-01-31&
  page=1&
  pageSize=25&
  sort={"field":"amount","direction":"desc"}&
  filters={"status":["overdue"]}
```

**Response:**
```json
{
  "data": [{ "amount": 1000, "status": "overdue" }],
  "pagination": { "page": 1, "pageSize": 25, "totalItems": 347, "totalPages": 14 }
}
```

### 2. Export Endpoint

**Request:**
```
GET /api/v1/modules/{module}/metrics/{metric}/drilldown/export?
  format=csv&
  org_id=123&
  period_start=2026-01-01&
  period_end=2026-01-31&
  filters={"status":["overdue"]}
```

**Response:**
- Headers: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="export_2026-01-06.csv"`
- Body: CSV file

### 3. Dynamic Filter Options

**Request:**
```
GET /api/v1/modules/{module}/metrics/{metric}/drilldown/filter-options/status
```

**Response:**
```json
{
  "options": ["active", "overdue", "partial"]
}
```

---

## 🎨 Styling

All components use Tailwind CSS. Customize by modifying classes:

```javascript
// Example: Change button color from blue to green
container.innerHTML = `
  <button class="bg-blue-600 hover:bg-blue-700">
    <!-- Change to: -->
  <button class="bg-green-600 hover:bg-green-700">
`;
```

---

## 🐛 Troubleshooting

### Components not rendering?

**Check:**
1. Script is loaded: `console.log(window.FinancialModuleUI)`
2. Container exists: `console.log(document.getElementById('pagination-container'))`
3. Tailwind CSS is loaded

### Export not working?

**Check:**
1. Backend endpoint exists and returns file
2. Auth token is valid: `sessionStorage.getItem('token')`
3. CORS headers are set on backend

### Filters not loading?

**Check:**
1. Dynamic filter endpoint exists: `/filter-options/{field}`
2. Response format is correct: `{ options: [...] }`

---

## 📖 Full Documentation

See comprehensive documentation:
- **File:** `FINANCIAL-MODULE-UI-COMPONENTS-DOCUMENTATION.md`
- **Sections:** 10 chapters covering all aspects

---

## 🧪 Testing

### Test in Browser

Open integration example:
```
file:///path/to/lana-client/FINANCIAL-MODULE-INTEGRATION-EXAMPLE.html
```

### Test with Backend

1. Start backend server
2. Update endpoint URLs in config
3. Test all components:
   - Apply filters → Check network tab for correct params
   - Change sort → Verify data re-fetches
   - Navigate pages → Confirm pagination works
   - Export CSV/Excel → Verify file downloads

---

## 📞 Support

- **Docs:** `/FINANCIAL-MODULE-UI-COMPONENTS-DOCUMENTATION.md`
- **Example:** `/FINANCIAL-MODULE-INTEGRATION-EXAMPLE.html`
- **Email:** support@redroostertechnologies.com

---

**Version:** 1.0.0
**Last Updated:** 2026-01-06
