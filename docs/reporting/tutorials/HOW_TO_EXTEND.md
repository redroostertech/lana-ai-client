# How to Extend the Reporting Frontend

**Updated:** 2026-03-05

Guide for adding new visualization renderers, UI features, and modals to the reporting frontend.

---

## Adding a New Visualization Renderer

### Step 1: Create the Renderer File

Create `src/js/visualizations/renderers/your-chart-renderer.js`:

```javascript
/**
 * YourChartRenderer - Description of what this renders
 * Requires Chart.js to be loaded globally.
 */
export class YourChartRenderer {
  constructor(canvasId, data, metricKeys, config = {}) {
    this.canvasId = canvasId;
    this.data = data;
    this.metricKeys = metricKeys;
    this.config = config;
    this.chart = null;
  }

  render() {
    const canvas = document.getElementById(this.canvasId);
    if (!canvas) {
      console.warn('[YourChartRenderer] Canvas not found:', this.canvasId);
      return;
    }

    const ctx = canvas.getContext('2d');

    this.chart = new Chart(ctx, {
      type: 'bar', // or 'line', 'pie', 'doughnut', etc.
      data: this._buildChartData(),
      options: this._buildChartOptions()
    });
  }

  update(newData) {
    if (!this.chart) return;
    this.data = newData;
    this.chart.data = this._buildChartData();
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

  _buildChartData() {
    // Transform this.data into Chart.js data format
    return {
      labels: [],
      datasets: []
    };
  }

  _buildChartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: this.config.showLegend !== false }
      }
    };
  }
}
```

### Step 2: Add the ES6 Import Bridge

In `src/admin/reporting.html`, add your import to the module script block:

```html
<script type="module">
  import { TimeSeriesRenderer } from '../js/visualizations/renderers/time-series-renderer.js';
  import { YourChartRenderer } from '../js/visualizations/renderers/your-chart-renderer.js';
  window.TimeSeriesRenderer = TimeSeriesRenderer;
  window.YourChartRenderer = YourChartRenderer;
</script>
```

### Step 3: Handle in Controller

In `src/js/admin/reporting.js`, add a case for your visualization type in the rendering logic:

```javascript
// In renderVisualizations() or equivalent
if (viz.type === 'your_chart_type') {
  var renderer = new window.YourChartRenderer(canvasId, viz.data, viz.metrics, viz.config);
  renderer.render();
  chartInstances[canvasId] = renderer;
}
```

### Step 4: Test

1. Create a module config with a visualization using your type
2. Execute the module and verify the chart renders
3. Test `destroy()` by switching modules

---

## Adding a New Modal

### Step 1: Add HTML Template

In `reporting.html`, inside `<template id="page-content">`, add your modal:

```html
<div id="yourModal" class="hidden fixed inset-0 bg-gray-900 bg-opacity-75 overflow-y-auto h-full w-full z-50">
  <div class="relative top-20 mx-auto p-6 w-full max-w-lg">
    <div class="bg-white rounded-lg shadow-xl">
      <div class="flex items-start justify-between p-5 border-b border-gray-200">
        <h3 class="text-xl font-semibold text-gray-900">Modal Title</h3>
        <button onclick="window._reporting.closeYourModal()" class="text-gray-400 hover:text-gray-600">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div id="yourModalContent" class="p-5">
        <!-- Dynamic content goes here -->
      </div>
      <div class="flex justify-end p-5 border-t border-gray-200">
        <button onclick="window._reporting.closeYourModal()" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Close</button>
      </div>
    </div>
  </div>
</div>
```

### Step 2: Add Controller Methods

In `reporting.js`, add open/close functions and expose via `window._reporting`:

```javascript
function showYourModal(data) {
  var content = document.getElementById('yourModalContent');
  content.innerHTML = '...'; // Render content
  document.getElementById('yourModal').classList.remove('hidden');
}

function closeYourModal() {
  document.getElementById('yourModal').classList.add('hidden');
}

// Expose globally
window._reporting.showYourModal = showYourModal;
window._reporting.closeYourModal = closeYourModal;
```

---

## Adding a New Period Preset

### Step 1: Add Button to HTML

In `reporting.html`, inside `#periodPresets`:

```html
<lex-btn data-preset="last90days" variant="secondary" size="sm">Last 90 Days</lex-btn>
```

### Step 2: Add Case to Controller

In `reporting.js`, in the `selectPeriodPreset()` function:

```javascript
case 'last90days':
  endDate = new Date(today);
  startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 89);
  break;
```

---

## Adding New Report Modules (Backend)

No frontend changes needed. See `LANA-AI/docs/reporting/tutorials/HOW_TO_EXTEND.md`.

---

**Created:** 2026-03-05 | **Author:** Red Rooster Technologies
