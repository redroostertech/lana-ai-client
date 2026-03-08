# Reporting Frontend Coding Style Guide

**Status:** Active | **Version:** 1.0.0 | **Updated:** 2026-03-05

Patterns, conventions, and rules for the reporting frontend code.

---

## Controller Pattern

The reporting page uses a single IIFE controller (`reporting.js`) that manages all state and DOM interactions. This is consistent with other LANA AI admin pages.

### State Management

All state is module-scoped `var` declarations at the top of the IIFE:

```javascript
var allModules = [];
var selectedModuleKey = null;
var currentModuleData = null;
var chartInstances = {};
```

Do NOT use global variables outside the IIFE. Expose only what's needed via `window._reporting`.

### DOM Access

Use `document.getElementById()` for element access. DOM IDs are defined in `reporting.html` and should not be changed without updating the controller.

### Event Handling

- Lex UI components: Use component event APIs
- Inline handlers: Use `onclick="window._reporting.methodName()"` for modal close buttons
- Dynamic elements: Attach handlers after rendering in `renderMetricCards()` etc.

---

## Visualization Renderer Pattern

All renderers follow the same ES6 class pattern:

```javascript
export class YourRenderer {
  constructor(canvasId, data, metricKeys, config = {}) {
    this.canvasId = canvasId;
    this.data = data;
    this.metricKeys = metricKeys;
    this.config = config;
    this.chart = null;
  }

  render() {
    const canvas = document.getElementById(this.canvasId);
    if (!canvas) return;
    this.chart = new Chart(canvas, { /* chart config */ });
  }

  update(newData) {
    if (!this.chart) return;
    this.data = newData;
    this.chart.data = /* updated data */;
    this.chart.update();
  }

  toBase64Image() {
    return this.chart ? this.chart.toBase64Image() : null;
  }

  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}
```

### Rules

1. **Always implement `destroy()`** -- Chart.js instances leak memory if not destroyed
2. **Check canvas exists** before creating chart
3. **Export as named export** -- `export class YourRenderer`
4. **Accept config object** for customization
5. **Store chart reference** in `this.chart` for cleanup

---

## Naming Conventions

### Files
- Renderers: `{type}-renderer.js` (kebab-case)
- Page controllers: `{page-name}.js` in `js/admin/`

### CSS Classes
- Status colors: `bg-green-50`, `bg-yellow-50`, `bg-red-50` (Tailwind)
- Text colors: `text-green-700`, `text-yellow-700`, `text-red-700`
- Lex components: `lex-*` classes from the Lex UI framework

### DOM IDs
- Containers: `camelCase` (e.g., `moduleResults`, `controlsCard`)
- Modals: `camelCaseModal` (e.g., `drilldownModal`, `moduleInfoModal`)
- Buttons: `camelCaseBtn` (e.g., `executeBtn`, `askLanaBtn`)

---

## Formatting Functions

Use the controller's built-in formatters. Do NOT create new formatting logic:

| Function | Input | Output |
|----------|-------|--------|
| `formatCurrency(value)` | `12500` | `$12,500.00` |
| `formatNumber(value, decimals)` | `1234.5, 1` | `1,234.5` |
| `formatPercentage(value, decimals)` | `62.5, 1` | `62.5%` |
| `formatDateRange(start, end)` | ISO strings | `Jan 1, 2026 - Jan 31, 2026` |

---

## Status Color Pattern

```javascript
function getStatusColor(current, target, inverseLogic) {
  if (current == null || target == null) return 'gray';
  var ratio = current / target;
  if (inverseLogic) {
    // Lower is better (e.g., days to close)
    if (ratio <= 1.0) return 'green';
    if (ratio <= 1.2) return 'yellow';
    return 'red';
  } else {
    // Higher is better (e.g., lead count)
    if (ratio >= 1.0) return 'green';
    if (ratio >= 0.8) return 'yellow';
    return 'red';
  }
}
```

---

## Chart Memory Management

Always clean up charts before creating new ones:

```javascript
// Before rendering new charts
Object.values(chartInstances).forEach(function(chart) {
  if (chart && chart.destroy) chart.destroy();
});
chartInstances = {};

// When creating a new chart
var renderer = new TimeSeriesRenderer(canvasId, data, keys);
renderer.render();
chartInstances[canvasId] = renderer;
```

---

## ES6 Module Bridge

Visualization renderers are ES6 modules but the controller is an IIFE (not a module). The bridge in `reporting.html` handles this:

```html
<script type="module">
  import { TimeSeriesRenderer } from '../js/visualizations/renderers/time-series-renderer.js';
  window.TimeSeriesRenderer = TimeSeriesRenderer;
</script>
```

When adding a new renderer:
1. Create the ES6 class in `src/js/visualizations/renderers/`
2. Add the import + window assignment in `reporting.html`
3. Use `window.YourRenderer` in the controller

---

## Error Display Pattern

```javascript
// Show info (blue)
function showInfo(message) {
  document.getElementById('executionInfo').style.display = 'block';
  document.getElementById('executionInfoText').textContent = message;
  document.getElementById('executionError').style.display = 'none';
}

// Show error (red)
function showError(message) {
  document.getElementById('executionError').style.display = 'block';
  document.getElementById('executionErrorText').textContent = message;
  document.getElementById('executionInfo').style.display = 'none';
}
```

---

## Adding New Report Modules

No frontend code changes required. New modules are created entirely on the backend. See `LANA-AI/docs/reporting/tutorials/HOW_TO_EXTEND.md`.

The frontend auto-discovers new modules via `GET /api/v1/modules` and renders them based on the API response structure.

---

**Created:** 2026-03-05 | **Author:** Red Rooster Technologies
