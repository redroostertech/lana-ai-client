# How to Modify the Reporting Frontend

**Updated:** 2026-03-05

Guide for changing the reporting page layout, metric card rendering, period presets, and UI behavior.

---

## Changing Metric Card Layout

Metric cards are rendered dynamically in `reporting.js` by the `renderMetricCards()` function. To change the card structure:

1. Open `src/js/admin/reporting.js`
2. Find the `renderMetricCards()` function
3. Modify the HTML template string inside

### Card Structure

Each metric card contains:
- Icon + metric name + status badge (header)
- Current value (large, bold)
- Prior period comparison (change amount + percentage)
- Target value
- Action buttons (Details, Override)

### Changing Status Colors

Modify `getStatusColors()`:

```javascript
function getStatusColors(color) {
  var colors = {
    green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
    yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700' },
    red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' },
    gray: { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-700' }
  };
  return colors[color] || colors.gray;
}
```

### Changing Status Thresholds

Modify `getStatusColor()`:

```javascript
function getStatusColor(current, target, inverseLogic) {
  var ratio = current / target;
  if (inverseLogic) {
    if (ratio <= 1.0) return 'green';   // At or below target
    if (ratio <= 1.2) return 'yellow';  // Up to 20% over
    return 'red';                       // More than 20% over
  } else {
    if (ratio >= 1.0) return 'green';   // Meeting target
    if (ratio >= 0.8) return 'yellow';  // Within 80%
    return 'red';                       // Below 80%
  }
}
```

---

## Changing Period Presets

### Modifying Existing Presets

In `reporting.js`, find `selectPeriodPreset()` and update the date calculations:

```javascript
case 'thisMonth':
  startDate = new Date(today.getFullYear(), today.getMonth(), 1);
  endDate = new Date(today);
  break;
```

### Adding/Removing Preset Buttons

In `reporting.html`, modify the `#periodPresets` div:

```html
<div id="periodPresets" style="display:flex;flex-wrap:wrap;gap:0.5rem;">
  <lex-btn data-preset="last7days" variant="secondary" size="sm">Last 7 Days</lex-btn>
  <!-- Add or remove buttons here -->
</div>
```

---

## Changing the Results Header

The results header shows module name, period info, execution time, and data sources. Modify in the results rendering section of `reporting.js`.

### Key Elements

| ID | Content |
|----|---------|
| `moduleTitle` | Module display name |
| `resultPeriodType` | Compare By type |
| `resultCurrentPeriod` | Current period date range |
| `resultPriorPeriod` | Prior period date range |
| `executionTime` | Query execution time |
| `dataSourcesCount` | "X Connectors" button |
| `missingEntitiesCount` | "X Missing" button |

---

## Changing Sidebar Behavior

### Module Categories

Modules are grouped by their `category` field from the API. The category display names are mapped in the controller. To change category labels, update the mapping function.

### Module Search

The `#moduleSearchInput` filters modules by name using string matching. The search logic is in the controller's module search handler.

---

## Changing the Override Panel

The data override panel (`#dataOverridePanel`) is a slide-out drawer. To modify:

1. **HTML structure:** Edit the panel markup in `reporting.html`
2. **Form fields:** Modify the form inside `#overrideForm`
3. **Submit handler:** Update the `overrideForm` submit handler in `reporting.js`

### Override Form Fields

| Field | ID | Purpose |
|-------|-----|---------|
| New Value | `overrideValue` | Target override value (required) |
| Notes | `overrideNotes` | Reason for override (optional) |
| Hidden: Type | `overrideType` | Always "manual" |
| Hidden: Period Start | `overridePeriodStart` | Auto-filled |
| Hidden: Period End | `overridePeriodEnd` | Auto-filled |
| Hidden: Period Type | `overridePeriodType` | Auto-filled |
| Hidden: Module Key | `overrideModuleKey` | Auto-filled |
| Hidden: Metric Key | `overrideMetricKey` | Auto-filled |

---

## Changing Number Formatting

### Currency

```javascript
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}
```

To change locale or currency, update the `Intl.NumberFormat` options.

### Percentages

```javascript
function formatPercentage(value, decimals) {
  if (decimals === undefined) decimals = 1;
  return formatNumber(value, decimals) + '%';
}
```

---

**Created:** 2026-03-05 | **Author:** Red Rooster Technologies
