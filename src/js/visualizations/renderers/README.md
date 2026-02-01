# Visualization Renderers

Reusable ES6 modules for rendering data visualizations in the LANA AI platform.

## TimeSeriesRenderer

A reusable, configuration-driven time-series chart renderer built on Chart.js.

### Features

- Clean ES6 class architecture
- Multiple metric series support
- Customizable styling and configuration
- Responsive behavior out of the box
- Memory-safe cleanup with `destroy()` method
- Update without re-rendering for performance
- Export chart as base64 image

### Installation

The renderer requires Chart.js to be loaded:

```html
<script src="../js/vendor/chart.js"></script>
```

### Basic Usage

```javascript
import { TimeSeriesRenderer } from './visualizations/renderers/time-series-renderer.js';

// Prepare time-series data
const timeSeries = [
  {
    date: '2024-01-01',
    metrics: [
      { key: 'revenue', value: 1000 },
      { key: 'expenses', value: 500 }
    ]
  },
  {
    date: '2024-01-02',
    metrics: [
      { key: 'revenue', value: 1200 },
      { key: 'expenses', value: 600 }
    ]
  }
];

// Create renderer instance
const renderer = new TimeSeriesRenderer(
  'my-canvas-id',           // Canvas element ID
  timeSeries,               // Time-series data
  ['revenue', 'expenses']   // Metric keys to display
);

// Render the chart
renderer.render();

// Later, clean up
renderer.destroy();
```

### Advanced Configuration

```javascript
const config = {
  chartType: 'line',      // Chart type (line, bar, etc.)
  fill: true,             // Fill area under line
  tension: 0.4,           // Line curvature (0 = straight, 1 = very curved)
  responsive: true,       // Responsive sizing
  maintainAspectRatio: false,  // Allow flexible height

  // Custom color palette
  colors: ['#6366f1', '#10b981', '#f59e0b', '#ef4444'],

  // Legend configuration
  legend: {
    position: 'bottom',
    labels: {
      padding: 15,
      font: { size: 11 }
    }
  },

  // Tooltip configuration
  tooltip: {
    mode: 'index',
    intersect: false
  },

  // Axes configuration
  scales: {
    y: {
      beginAtZero: true,
      grid: {
        color: '#f3f4f6'
      }
    },
    x: {
      grid: {
        display: false
      }
    }
  }
};

const renderer = new TimeSeriesRenderer('chart-canvas', timeSeries, metricKeys, config);
renderer.render();
```

### API Reference

#### Constructor

```javascript
new TimeSeriesRenderer(containerId, timeSeries, metricKeys, config)
```

**Parameters:**
- `containerId` (string) - DOM element ID for the canvas
- `timeSeries` (Array) - Array of time-series data points
- `metricKeys` (Array) - Array of metric keys to display
- `config` (Object, optional) - Configuration options

**Data Format:**

```javascript
const timeSeries = [
  {
    date: '2024-01-01',  // ISO date string or parseable date
    metrics: [
      { key: 'metric_name', value: 100 },
      { key: 'another_metric', value: 200 }
    ]
  }
];
```

#### Methods

##### `render()`

Render the chart to the canvas element.

```javascript
const chart = renderer.render();
```

**Returns:** Chart.js instance or null if data is invalid

**Throws:** Error if canvas element is not found

---

##### `update(newTimeSeries, newMetricKeys)`

Update chart data without re-creating the chart instance (performance optimization).

```javascript
renderer.update(newTimeSeriesData, ['metric1', 'metric2']);
```

**Parameters:**
- `newTimeSeries` (Array) - New time-series data
- `newMetricKeys` (Array, optional) - New metric keys

---

##### `destroy()`

Destroy the chart instance and clean up resources. **Important for preventing memory leaks.**

```javascript
renderer.destroy();
```

---

##### `getChartInstance()`

Get the underlying Chart.js instance for advanced customization.

```javascript
const chartInstance = renderer.getChartInstance();
chartInstance.options.plugins.legend.position = 'top';
chartInstance.update();
```

**Returns:** Chart.js instance or null if not rendered

---

##### `toBase64Image(format)`

Export chart as base64 encoded image.

```javascript
const imageDataUrl = renderer.toBase64Image('image/png');
```

**Parameters:**
- `format` (string, optional) - Image format (default: 'image/png')

**Returns:** Base64 encoded data URL or null if chart not rendered

---

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `chartType` | string | `'line'` | Chart type (line, bar, etc.) |
| `fill` | boolean | `true` | Fill area under the line |
| `tension` | number | `0.4` | Line tension (0-1, higher = more curved) |
| `responsive` | boolean | `true` | Responsive sizing |
| `maintainAspectRatio` | boolean | `false` | Maintain aspect ratio |
| `colors` | Array | See source | Color palette for metric series |
| `legend` | Object | See source | Legend configuration |
| `tooltip` | Object | See source | Tooltip configuration |
| `scales` | Object | See source | Axes configuration |

---

### Integration with Existing Code

#### Before (module-execution.html)

```javascript
function renderTimeSeriesChartForVisualization(canvasId, timeSeries, metricKeys) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const datasets = metricKeys.map((metricKey, index) => {
    // ... build datasets
  });

  const chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: { ... }
  });

  chartInstances[canvasId] = chart;
}
```

#### After (using TimeSeriesRenderer)

```javascript
import { TimeSeriesRenderer } from '../js/visualizations/renderers/time-series-renderer.js';

function renderTimeSeriesChartForVisualization(canvasId, timeSeries, metricKeys) {
  const renderer = new TimeSeriesRenderer(canvasId, timeSeries, metricKeys);
  const chart = renderer.render();

  chartInstances[canvasId] = renderer; // Store renderer for cleanup
}
```

---

### Memory Management

**Always destroy chart instances when no longer needed:**

```javascript
// Store renderer reference
chartInstances[canvasId] = renderer;

// Later, when cleaning up
if (chartInstances[canvasId]) {
  chartInstances[canvasId].destroy();
  delete chartInstances[canvasId];
}
```

---

### Error Handling

The renderer includes built-in error handling:

- Validates canvas element exists (throws error if not found)
- Warns if no data provided
- Warns if invalid date formats
- Safely handles missing metric values (defaults to 0)

---

### Best Practices

1. **Always destroy charts when done:**
   ```javascript
   renderer.destroy();
   ```

2. **Use `update()` for performance when data changes:**
   ```javascript
   // Good (efficient)
   renderer.update(newData);

   // Avoid (inefficient)
   renderer.destroy();
   renderer.render();
   ```

3. **Store renderer instances for cleanup:**
   ```javascript
   const renderers = {};
   renderers['chart-1'] = new TimeSeriesRenderer(...);

   // Later
   Object.values(renderers).forEach(r => r.destroy());
   ```

4. **Validate data format before rendering:**
   ```javascript
   if (!timeSeries || timeSeries.length === 0) {
     console.warn('No time series data');
     return;
   }
   ```

---

### Examples

#### Example 1: Simple Revenue Chart

```javascript
const timeSeries = [
  { date: '2024-01-01', metrics: [{ key: 'revenue', value: 5000 }] },
  { date: '2024-01-02', metrics: [{ key: 'revenue', value: 5500 }] },
  { date: '2024-01-03', metrics: [{ key: 'revenue', value: 6000 }] }
];

const renderer = new TimeSeriesRenderer('revenue-chart', timeSeries, ['revenue']);
renderer.render();
```

#### Example 2: Multiple Metrics with Custom Colors

```javascript
const config = {
  colors: ['#10b981', '#ef4444'],  // Green for revenue, red for expenses
  legend: {
    position: 'top'
  }
};

const renderer = new TimeSeriesRenderer(
  'financial-chart',
  timeSeries,
  ['revenue', 'expenses'],
  config
);
renderer.render();
```

#### Example 3: Dynamic Updates

```javascript
const renderer = new TimeSeriesRenderer('live-chart', initialData, ['metric1']);
renderer.render();

// Update every 5 seconds
setInterval(() => {
  const newData = fetchLatestData();
  renderer.update(newData);
}, 5000);

// Clean up when done
window.addEventListener('beforeunload', () => {
  renderer.destroy();
});
```

#### Example 4: Export Chart as Image

```javascript
const renderer = new TimeSeriesRenderer('export-chart', timeSeries, ['metric1']);
renderer.render();

// Export as PNG
const imageDataUrl = renderer.toBase64Image('image/png');

// Download image
const link = document.createElement('a');
link.download = 'chart.png';
link.href = imageDataUrl;
link.click();
```

---

### Troubleshooting

**Chart not rendering:**
- Verify canvas element ID matches `containerId`
- Check that Chart.js is loaded before using renderer
- Validate time-series data format

**Memory leaks:**
- Always call `destroy()` when removing charts from DOM
- Store renderer instances for later cleanup

**Date formatting issues:**
- Ensure dates are ISO 8601 format or valid Date-parseable strings
- Check browser console for date parsing warnings

---

### Migration Guide

#### From inline Chart.js code

**Before:**
```javascript
const chart = new Chart(ctx, {
  type: 'line',
  data: { labels, datasets },
  options: { ... }
});
```

**After:**
```javascript
import { TimeSeriesRenderer } from './visualizations/renderers/time-series-renderer.js';

const renderer = new TimeSeriesRenderer(canvasId, timeSeries, metricKeys);
renderer.render();
```

**Benefits:**
- Cleaner, more maintainable code
- Consistent chart styling across platform
- Built-in memory management
- Easier testing and reuse

---

## BarChartRenderer

A reusable, configuration-driven horizontal/vertical bar chart renderer built on Chart.js.

### Features

- Clean ES6 class architecture
- Horizontal or vertical bar orientation
- Conditional coloring based on value rules
- Interactive click handlers for drill-down navigation
- Support for percentages, percent changes, and custom units
- Responsive behavior out of the box
- Memory-safe cleanup with `destroy()` method
- Update without re-rendering for performance
- Help text modal support

### Installation

The renderer requires Chart.js to be loaded:

```html
<script src="../js/vendor/chart.js"></script>
```

### Basic Usage

```javascript
import { BarChartRenderer, createBarChart } from './visualizations/renderers/bar-chart-renderer.js';

// Class-based API
const renderer = new BarChartRenderer('chart-container', {
  labels: ['Stage 1', 'Stage 2', 'Stage 3'],
  values: [45, 32, 23]
}, {
  orientation: 'horizontal',
  title: 'Pipeline Distribution',
  metricName: 'Count',
  unit: 'matters'
});

renderer.render();

// Later, clean up
renderer.destroy();

// Factory function alternative
const chart = createBarChart('chart-container', {
  labels: ['Stage 1', 'Stage 2', 'Stage 3'],
  values: [45, 32, 23]
}, {
  orientation: 'horizontal',
  title: 'Pipeline Distribution'
});
```

### API Reference

#### Constructor

```javascript
new BarChartRenderer(container, data, config)
```

**Parameters:**
- `container` (string|HTMLElement) - Container element ID or element reference
- `data` (Object) - Chart data object
  - `labels` (Array) - Array of label strings for each bar
  - `values` (Array) - Array of numeric values for each bar
- `config` (Object, optional) - Configuration options

#### Methods

##### `render()`

Renders the chart to the container.

```javascript
renderer.render();
```

---

##### `destroy()`

Destroys the chart instance and cleans up resources. **Important for preventing memory leaks.**

```javascript
renderer.destroy();
```

---

##### `update(newData)`

Updates chart data without re-creating the chart instance (performance optimization).

```javascript
renderer.update({
  labels: ['New Stage 1', 'New Stage 2'],
  values: [60, 40]
});
```

**Parameters:**
- `newData` (Object) - New chart data
  - `labels` (Array) - Array of label strings
  - `values` (Array) - Array of numeric values

---

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `orientation` | string | `'horizontal'` | Chart orientation: `'horizontal'` or `'vertical'` |
| `title` | string | `'Chart'` | Chart title |
| `description` | string | `null` | Optional description text |
| `metricName` | string | `'Value'` | Name of the metric being displayed |
| `unit` | string | `null` | Unit of measurement (e.g., `'count'`, `'percent'`, `'percent_change'`) |
| `isPercentage` | boolean | `false` | Whether values are percentages |
| `colors.positive` | string | `'#10b981'` | Color for positive values |
| `colors.negative` | string | `'#ef4444'` | Color for negative values |
| `colors.neutral` | string | `'#6b7280'` | Color for neutral values |
| `colors.default` | string | `'#6366f1'` | Default bar color (indigo) |
| `colorRule` | string | `null` | JavaScript expression to evaluate color for each value |
| `onBarClick` | function | `null` | Callback when a bar is clicked: `(index, label, value) => {}` |
| `helpText.content` | string | `null` | Help text content (displayed in modal) |
| `uniqueId` | string | auto-generated | Unique identifier for this chart instance |

---

### Examples

#### Example 1: Simple Horizontal Bar Chart

```javascript
const chart = createBarChart('chart-container', {
  labels: ['Active', 'Closed', 'On Hold'],
  values: [120, 45, 8]
}, {
  title: 'Matter Status Distribution',
  description: 'Current distribution of matters by status',
  orientation: 'horizontal'
});
```

#### Example 2: Conditional Coloring (Growth Metrics)

```javascript
const chart = createBarChart('chart-container', {
  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
  values: [5, -3, 8, -2]
}, {
  title: 'Quarterly Growth',
  unit: 'percent_change',
  colors: {
    positive: '#10b981',
    negative: '#ef4444',
    neutral: '#6b7280'
  },
  colorRule: "value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'"
});
```

#### Example 3: Interactive Drill-down

```javascript
const chart = createBarChart('chart-container', {
  labels: ['Intake', 'Discovery', 'Negotiation', 'Closing'],
  values: [45, 32, 18, 12]
}, {
  title: 'Matter Pipeline',
  onBarClick: (index, label, value) => {
    console.log(`Clicked: ${label} (${value} matters)`);
    // Navigate to drill-down view
    window.openDrilldown('pipeline_distribution', { stage: label });
  }
});
```

#### Example 4: With Help Text

```javascript
const chart = createBarChart('chart-container', {
  labels: ['Active', 'Closed', 'On Hold'],
  values: [120, 45, 8]
}, {
  title: 'Matter Status Distribution',
  description: 'Current distribution of matters by status',
  helpText: {
    content: `
      <p>This chart shows the distribution of matters across different statuses.</p>
      <ul>
        <li><strong>Active</strong>: Matters currently being worked on</li>
        <li><strong>Closed</strong>: Completed matters</li>
        <li><strong>On Hold</strong>: Matters temporarily paused</li>
      </ul>
    `
  }
});
```

#### Example 5: Vertical Bar Chart

```javascript
const chart = createBarChart('chart-container', {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
  values: [12, 19, 15, 25, 22]
}, {
  title: 'Monthly Revenue',
  orientation: 'vertical',
  unit: 'count',
  metricName: 'New Clients'
});
```

---

### Integration with Existing Code

#### Before (module-execution.html)

```javascript
function renderHorizontalBarChart(viz, data, uniqueId) {
  // ... 180 lines of chart rendering code ...
}
```

#### After (using BarChartRenderer)

```javascript
import { createBarChart } from './visualizations/renderers/bar-chart-renderer.js';

function renderHorizontalBarChart(viz, data, uniqueId) {
  const metricKey = viz.metrics?.[0];
  const metric = data.metrics?.find(m => m.key === metricKey);
  const chartData = Array.isArray(metric.current) ? metric.current : metric.result;

  return createBarChart(`chart-${uniqueId}`, {
    labels: chartData.map(d => d.label || 'Unknown'),
    values: chartData.map(d => d.value || 0)
  }, {
    orientation: 'horizontal',
    title: viz.title,
    description: viz.description,
    metricName: metric.name,
    unit: metric.unit,
    isPercentage: metric.format?.suffix === '%',
    colors: viz.barColors,
    colorRule: viz.colorRule,
    helpText: viz.helpText ? { content: viz.helpText } : null,
    uniqueId: uniqueId,
    onBarClick: (index, label) => {
      if (metric.drilldown?.enabled && window.openDrilldown) {
        window.openDrilldown(metricKey, { drill_source: label });
      }
    }
  });
}
```

---

### Memory Management

**Always destroy chart instances when no longer needed:**

```javascript
// Store renderer reference
chartInstances[chartId] = renderer;

// Later, when cleaning up
if (chartInstances[chartId]) {
  chartInstances[chartId].destroy();
  delete chartInstances[chartId];
}
```

---

### Error Handling

The renderer includes built-in error handling:

- Validates container element exists (throws error if not found)
- Validates Chart.js is loaded (throws error if not found)
- Displays error message for invalid data format
- Displays "No data available" for empty datasets
- Displays error for data mismatch (labels/values length mismatch)

---

### Best Practices

1. **Always destroy charts when done:**
   ```javascript
   renderer.destroy();
   ```

2. **Use `update()` for performance when data changes:**
   ```javascript
   // Good (efficient)
   renderer.update(newData);

   // Avoid (inefficient)
   renderer.destroy();
   renderer.render();
   ```

3. **Store renderer instances for cleanup:**
   ```javascript
   const renderers = {};
   renderers['chart-1'] = new BarChartRenderer(...);

   // Later
   Object.values(renderers).forEach(r => r.destroy());
   ```

4. **Validate data format before rendering:**
   ```javascript
   if (!data.labels || !data.values || data.labels.length === 0) {
     console.warn('No bar chart data');
     return;
   }
   ```

---

### Troubleshooting

**Chart not rendering:**
- Verify container element ID or reference is valid
- Check that Chart.js is loaded before using renderer
- Validate data format (labels and values arrays)

**Memory leaks:**
- Always call `destroy()` when removing charts from DOM
- Store renderer instances for later cleanup

**Colors not applying:**
- Ensure `colorRule` expression is valid JavaScript
- Check that color keys match defined colors in config
- Verify values are numeric for color rule evaluation

---

## MetricGridRenderer

A reusable, configuration-driven metric card grid renderer for displaying KPI dashboards with status indicators, comparisons, and drilldown integration.

### Features

- Clean ES6 class architecture
- Responsive grid layout with configurable columns
- Standard metric cards (current/prior/target values)
- Distribution metric cards (with Chart.js pie charts)
- Status indicators (green/yellow/red/gray badges)
- Change arrows with trend indicators
- Target override capabilities
- Interactive drilldown navigation
- Memory-safe cleanup with `destroy()` method
- Dynamic updates without full re-render

### Installation

The renderer requires Chart.js for distribution metrics:

```html
<script src="../js/vendor/chart.js"></script>
```

### Basic Usage

```javascript
import { MetricGridRenderer } from './visualizations/renderers/metric-grid-renderer.js';

const metrics = [
  {
    key: 'revenue',
    name: 'Total Revenue',
    description: 'Current period revenue vs target',
    current: 125000,
    prior: 110000,
    target: 120000,
    change: 15000,
    changePercent: 13.6,
    changeDirection: 'up',
    status: 'green',
    type: 'currency',
    invertTrend: false,
    hasDrilldown: true
  },
  {
    key: 'matters',
    name: 'Active Matters',
    description: 'Number of active client matters',
    current: 45,
    prior: 42,
    target: 50,
    change: 3,
    changePercent: 7.1,
    changeDirection: 'up',
    status: 'yellow',
    type: 'count',
    hasDrilldown: true
  }
];

const renderer = new MetricGridRenderer('metrics-container', metrics, {
  showComparison: true,
  gridColumns: 'md:grid-cols-2 lg:grid-cols-3',
  onMetricClick: (metricKey, metricName) => {
    console.log(`Viewing details for: ${metricName}`);
  },
  onOverrideClick: (metricKey, metricName, description, targetValue, overrideType) => {
    console.log(`Override target for ${metricName}: ${targetValue}`);
  }
});

renderer.render();

// Later, clean up
renderer.destroy();
```

### API Reference

#### Constructor

```javascript
new MetricGridRenderer(container, metrics, config)
```

**Parameters:**
- `container` (string|HTMLElement) - Container element ID or element reference
- `metrics` (Array<Object>) - Array of metric objects
- `config` (Object, optional) - Configuration options

**Metric Object Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `key` | string | Yes | Unique metric identifier |
| `name` | string | Yes | Metric display name |
| `description` | string | No | Optional metric description |
| `current` | number\|Array | Yes | Current period value (number or array for distributions) |
| `prior` | number | No | Prior period value |
| `target` | number | No | Target value |
| `formattedCurrent` | string | No | Pre-formatted current value |
| `formattedPrior` | string | No | Pre-formatted prior value |
| `formattedTarget` | string | No | Pre-formatted target value |
| `formattedChange` | string | No | Pre-formatted change value |
| `change` | number | No | Absolute change from prior period |
| `changePercent` | number | No | Percentage change from prior period |
| `changeDirection` | string | No | Change direction: 'up', 'down', 'flat' |
| `status` | string | No | Status color: 'green', 'yellow', 'red', 'gray' |
| `type` | string | No | Metric type: 'currency', 'count', 'percentage' |
| `unit` | string | No | Unit of measurement: 'dollars', 'count', 'percent' |
| `invertTrend` | boolean | No | Whether to invert trend colors (true = down is good) |
| `hasDrilldown` | boolean | No | Whether metric has drilldown capability |

#### Methods

##### `render()`

Renders the metric grid to the container.

```javascript
renderer.render();
```

---

##### `destroy()`

Destroys the renderer and cleans up all chart instances. **Important for preventing memory leaks.**

```javascript
renderer.destroy();
```

---

##### `update(newMetrics)`

Updates metrics and re-renders the entire grid.

```javascript
renderer.update([
  { key: 'revenue', name: 'Total Revenue', current: 130000, ... },
  { key: 'matters', name: 'Active Matters', current: 48, ... }
]);
```

**Parameters:**
- `newMetrics` (Array<Object>) - Updated metrics array

---

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `showComparison` | boolean | `true` | Whether to show prior period comparison |
| `gridColumns` | string | `'md:grid-cols-2 lg:grid-cols-3'` | Tailwind grid column classes |
| `onMetricClick` | function | `null` | Callback when metric details button clicked: `(metricKey, metricName) => {}` |
| `onOverrideClick` | function | `null` | Callback when override button clicked: `(metricKey, metricName, description, targetValue, overrideType) => {}` |
| `onGenericDrilldownClick` | function | `null` | Callback for generic drilldown: `(metricKey, metricName) => {}` |
| `onDistributionSegmentClick` | function | `null` | Callback when distribution chart segment clicked: `(metricKey, segmentLabel) => {}` |
| `uniqueId` | string | auto-generated | Unique identifier for this grid instance |

---

### Examples

#### Example 1: Standard Metric Grid

```javascript
const metrics = [
  {
    key: 'revenue',
    name: 'Monthly Revenue',
    current: 125000,
    prior: 110000,
    target: 120000,
    status: 'green',
    type: 'currency',
    changeDirection: 'up',
    change: 15000
  },
  {
    key: 'conversion_rate',
    name: 'Lead Conversion Rate',
    current: 23.5,
    prior: 21.2,
    target: 25.0,
    status: 'yellow',
    type: 'percentage',
    unit: 'percent',
    changeDirection: 'up',
    change: 2.3
  }
];

const renderer = new MetricGridRenderer('dashboard', metrics);
renderer.render();
```

#### Example 2: Distribution Metrics (with Pie Charts)

```javascript
const metrics = [
  {
    key: 'source_distribution',
    name: 'Lead Source Distribution',
    description: 'Distribution of leads by source',
    current: [
      { label: 'Referrals', count: 45, value: 45.0 },
      { label: 'Website', count: 30, value: 30.0 },
      { label: 'Paid Ads', count: 15, value: 15.0 },
      { label: 'Other', count: 10, value: 10.0 }
    ],
    status: 'green',
    hasDrilldown: true
  }
];

const renderer = new MetricGridRenderer('distribution-dashboard', metrics, {
  onDistributionSegmentClick: (metricKey, segmentLabel) => {
    console.log(`Clicked segment: ${segmentLabel}`);
    // Navigate to filtered view
  }
});

renderer.render();
```

#### Example 3: Interactive Drilldown

```javascript
const renderer = new MetricGridRenderer('metrics-grid', metrics, {
  onMetricClick: (metricKey, metricName) => {
    // Show metric calculation details
    window.showMetricDrilldown(metricKey, metricName);
  },
  onGenericDrilldownClick: (metricKey, metricName) => {
    // Navigate to detailed data view
    window.openGenericDrilldown(metricKey, metricName);
  },
  onOverrideClick: (metricKey, metricName, description, targetValue, overrideType) => {
    // Open target override panel
    window.openDataOverridePanel(metricKey, metricName, description, targetValue, overrideType);
  }
});

renderer.render();
```

#### Example 4: Inverted Trend (Lower is Better)

```javascript
const metrics = [
  {
    key: 'case_duration',
    name: 'Average Case Duration',
    description: 'Days to close a case',
    current: 45,
    prior: 52,
    target: 40,
    status: 'yellow',
    type: 'count',
    unit: 'days',
    invertTrend: true,  // Lower is better
    changeDirection: 'down',
    change: -7
  }
];

const renderer = new MetricGridRenderer('metrics-container', metrics);
renderer.render();
```

#### Example 5: Dynamic Updates (Live Dashboard)

```javascript
const renderer = new MetricGridRenderer('live-dashboard', initialMetrics);
renderer.render();

// Update every 30 seconds
setInterval(async () => {
  const updatedMetrics = await fetchLatestMetrics();
  renderer.update(updatedMetrics);
}, 30000);

// Clean up when navigating away
window.addEventListener('beforeunload', () => {
  renderer.destroy();
});
```

---

### Integration with Existing Code

#### Before (module-execution.html)

```javascript
function renderMetricGrid(viz, uniqueId) {
  const div = document.createElement('div');
  div.className = 'mb-6';

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6';
  grid.id = `grid-${uniqueId}`;

  const metricsHTML = viz.metrics.map(metric => createMetricCard(metric)).join('');
  grid.innerHTML = metricsHTML;

  div.appendChild(grid);

  // ... additional chart rendering logic ...

  return div;
}
```

#### After (using MetricGridRenderer)

```javascript
import { MetricGridRenderer } from '../js/visualizations/renderers/metric-grid-renderer.js';

function renderMetricGrid(viz, uniqueId) {
  const renderer = new MetricGridRenderer(`grid-container-${uniqueId}`, viz.metrics, {
    showComparison: currentModuleConfig?.ui?.showComparison !== false,
    onMetricClick: (metricKey, metricName) => {
      showMetricDrilldown(metricKey, metricName);
    },
    onGenericDrilldownClick: (metricKey, metricName) => {
      openGenericDrilldown(metricKey, metricName);
    },
    onOverrideClick: (metricKey, metricName, description, targetValue, overrideType) => {
      openDataOverridePanel(metricKey, metricName, description, targetValue, overrideType);
    },
    uniqueId: uniqueId
  });

  const container = document.createElement('div');
  container.id = `grid-container-${uniqueId}`;

  renderer.render();

  return container;
}
```

---

### Memory Management

**Always destroy renderer instances when no longer needed:**

```javascript
// Store renderer reference
rendererInstances[gridId] = renderer;

// Later, when cleaning up
if (rendererInstances[gridId]) {
  rendererInstances[gridId].destroy();
  delete rendererInstances[gridId];
}
```

---

### Error Handling

The renderer includes built-in error handling:

- Validates container element exists (throws error if not found)
- Gracefully handles missing metric properties (defaults to 'N/A')
- Warns if Chart.js not available for distribution metrics
- Handles null/undefined values safely
- Validates metric data format before rendering

---

### Best Practices

1. **Always destroy renderers when done:**
   ```javascript
   renderer.destroy();
   ```

2. **Use `update()` for dynamic dashboards:**
   ```javascript
   // Good (efficient)
   renderer.update(newMetrics);

   // Avoid (inefficient)
   renderer.destroy();
   new MetricGridRenderer(...).render();
   ```

3. **Store renderer instances for cleanup:**
   ```javascript
   const renderers = {};
   renderers['dashboard-1'] = new MetricGridRenderer(...);

   // Later
   Object.values(renderers).forEach(r => r.destroy());
   ```

4. **Validate metric data before rendering:**
   ```javascript
   if (!metrics || metrics.length === 0) {
     console.warn('No metrics to display');
     return;
   }
   ```

5. **Use callbacks for interactivity:**
   ```javascript
   const config = {
     onMetricClick: (key, name) => navigateToDetails(key),
     onOverrideClick: (key, name, desc, target, type) => openOverrideModal(key, target)
   };
   ```

---

### Troubleshooting

**Metrics not rendering:**
- Verify container element ID or reference is valid
- Check that metrics array is properly formatted
- Validate required properties (key, name, current) are present

**Distribution charts not showing:**
- Ensure Chart.js is loaded before using renderer
- Verify `metric.current` is an array with proper structure
- Check browser console for Chart.js errors

**Memory leaks:**
- Always call `destroy()` when removing grid from DOM
- Store renderer instances for later cleanup
- Clean up event listeners attached to metric cards

**Formatting issues:**
- Use `type: 'currency'` for currency metrics
- Pre-format values using `formattedCurrent`, `formattedPrior`, etc.
- Check that `unit` property matches expected format

---

## GroupedBarChartRenderer

A reusable, configuration-driven grouped (multi-series) bar chart renderer built on Chart.js.

### Features

- Clean ES6 class architecture
- Multiple data series support (grouped bars)
- Configurable group labels and axis configuration
- Custom color schemes per series
- Interactive click handlers for drill-down navigation
- Annotation support for additional data labels
- Responsive behavior out of the box
- Memory-safe cleanup with `destroy()` method
- Update without re-rendering for performance
- Help text modal support
- Configurable legend position

### Installation

The renderer requires Chart.js to be loaded:

```html
<script src="../js/vendor/chart.js"></script>
```

### Basic Usage

```javascript
import { GroupedBarChartRenderer, createGroupedBarChart } from './visualizations/renderers/grouped-bar-chart-renderer.js';

// Sample data: lead source performance
const data = [
  {
    source_name: 'Referrals',
    contact_rate: 85.2,
    qualified_rate: 62.5,
    lead_count: 120
  },
  {
    source_name: 'Website',
    contact_rate: 72.4,
    qualified_rate: 45.8,
    lead_count: 85
  },
  {
    source_name: 'Paid Ads',
    contact_rate: 65.0,
    qualified_rate: 38.2,
    lead_count: 45
  }
];

// Class-based API
const renderer = new GroupedBarChartRenderer('chart-container', data, {
  title: 'Lead Source Performance',
  description: 'Contact and qualification rates by source',
  xAxis: {
    field: 'source_name',
    label: 'Lead Source'
  },
  yAxis: {
    label: 'Conversion Rate (%)',
    min: 0,
    max: 100
  },
  series: [
    {
      label: 'Contact Rate',
      field: 'contact_rate',
      color: '#3b82f6'  // Blue
    },
    {
      label: 'Qualified Rate',
      field: 'qualified_rate',
      color: '#10b981'  // Green
    }
  ],
  annotations: {
    field: 'lead_count',
    label: 'Leads: {value}'
  }
});

renderer.render();

// Later, clean up
renderer.destroy();

// Factory function alternative
const chart = createGroupedBarChart('chart-container', data, {
  title: 'Lead Source Performance',
  series: [
    { label: 'Contact Rate', field: 'contact_rate', color: '#3b82f6' },
    { label: 'Qualified Rate', field: 'qualified_rate', color: '#10b981' }
  ]
});
```

### API Reference

#### Constructor

```javascript
new GroupedBarChartRenderer(container, data, config)
```

**Parameters:**
- `container` (string|HTMLElement) - Container element ID or element reference
- `data` (Array<Object>) - Array of data objects with fields matching series configuration
- `config` (Object, optional) - Configuration options

**Data Format:**

```javascript
const data = [
  {
    category_field: 'Category 1',  // X-axis value (field name from config.xAxis.field)
    series1_field: 45.5,            // Value for first series (field name from config.series[0].field)
    series2_field: 32.8,            // Value for second series (field name from config.series[1].field)
    annotation_field: 100           // Optional annotation value
  },
  {
    category_field: 'Category 2',
    series1_field: 52.3,
    series2_field: 41.2,
    annotation_field: 85
  }
];
```

#### Methods

##### `render()`

Renders the chart to the container.

```javascript
renderer.render();
```

---

##### `destroy()`

Destroys the chart instance and cleans up resources. **Important for preventing memory leaks.**

```javascript
renderer.destroy();
```

---

##### `update(newData)`

Updates chart data without re-creating the chart instance (performance optimization).

```javascript
renderer.update([
  { source_name: 'Referrals', contact_rate: 87.5, qualified_rate: 65.2, lead_count: 130 },
  { source_name: 'Website', contact_rate: 74.1, qualified_rate: 48.3, lead_count: 92 }
]);
```

**Parameters:**
- `newData` (Array<Object>) - New chart data array

---

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | `'Grouped Bar Chart'` | Chart title |
| `description` | string | `null` | Optional description text |
| `xAxis.field` | string | `'category'` | Field name for x-axis labels |
| `xAxis.label` | string | `'Categories'` | X-axis label text |
| `yAxis.label` | string | `'Value'` | Y-axis label text |
| `yAxis.min` | number | `0` | Y-axis minimum value |
| `yAxis.max` | number | `null` | Y-axis maximum value (auto if not specified) |
| `yAxis.beginAtZero` | boolean | `true` | Whether y-axis should begin at zero |
| `series` | Array<Object> | `[]` | Array of series configurations (required) |
| `series[].label` | string | - | Series display label |
| `series[].field` | string | - | Data field name for this series |
| `series[].color` | string | - | Color for this series (hex or rgb) |
| `annotations.field` | string | `null` | Field containing annotation values |
| `annotations.label` | string | `null` | Annotation label template (use `{value}` placeholder) |
| `legend.position` | string | `'bottom'` | Legend position: `'top'`, `'bottom'`, `'left'`, `'right'` |
| `legend.display` | boolean | `true` | Whether to show legend |
| `helpText.content` | string | `null` | Help text content (displayed in modal) |
| `onBarClick` | function | `null` | Callback when a bar is clicked: `(dataIndex, seriesIndex, value, label, series) => {}` |
| `uniqueId` | string | auto-generated | Unique identifier for this chart instance |

---

### Examples

#### Example 1: Sales Performance by Region

```javascript
const data = [
  { region: 'North', q1: 125000, q2: 145000, q3: 162000, q4: 178000 },
  { region: 'South', q1: 98000, q2: 112000, q3: 128000, q4: 135000 },
  { region: 'East', q1: 110000, q2: 128000, q3: 142000, q4: 158000 },
  { region: 'West', q1: 88000, q2: 95000, q3: 108000, q4: 122000 }
];

const chart = createGroupedBarChart('sales-chart', data, {
  title: 'Quarterly Sales by Region',
  description: 'Sales performance across all regions for current year',
  xAxis: { field: 'region', label: 'Region' },
  yAxis: { label: 'Revenue ($)', min: 0 },
  series: [
    { label: 'Q1', field: 'q1', color: '#3b82f6' },
    { label: 'Q2', field: 'q2', color: '#10b981' },
    { label: 'Q3', field: 'q3', color: '#f59e0b' },
    { label: 'Q4', field: 'q4', color: '#ef4444' }
  ],
  legend: { position: 'top' }
});
```

#### Example 2: Matter Type Comparison

```javascript
const data = [
  { matter_type: 'Litigation', active: 45, closed: 32, on_hold: 8 },
  { matter_type: 'Corporate', active: 28, closed: 56, on_hold: 3 },
  { matter_type: 'Real Estate', active: 19, closed: 24, on_hold: 2 },
  { matter_type: 'Immigration', active: 34, closed: 18, on_hold: 6 }
];

const chart = createGroupedBarChart('matter-chart', data, {
  title: 'Matter Status by Type',
  xAxis: { field: 'matter_type', label: 'Matter Type' },
  yAxis: { label: 'Count', min: 0 },
  series: [
    { label: 'Active', field: 'active', color: '#10b981' },
    { label: 'Closed', field: 'closed', color: '#6b7280' },
    { label: 'On Hold', field: 'on_hold', color: '#f59e0b' }
  ]
});
```

#### Example 3: With Annotations (Lead Count)

```javascript
const data = [
  {
    source_name: 'Referrals',
    contact_rate: 85.2,
    qualified_rate: 62.5,
    lead_count: 120
  },
  {
    source_name: 'Website',
    contact_rate: 72.4,
    qualified_rate: 45.8,
    lead_count: 85
  },
  {
    source_name: 'Paid Ads',
    contact_rate: 65.0,
    qualified_rate: 38.2,
    lead_count: 45
  }
];

const chart = createGroupedBarChart('lead-performance-chart', data, {
  title: 'Lead Source Performance',
  description: 'Contact and qualification rates with lead volume',
  xAxis: { field: 'source_name', label: 'Lead Source' },
  yAxis: { label: 'Conversion Rate (%)', min: 0, max: 100 },
  series: [
    { label: 'Contact Rate', field: 'contact_rate', color: '#3b82f6' },
    { label: 'Qualified Rate', field: 'qualified_rate', color: '#10b981' }
  ],
  annotations: {
    field: 'lead_count',
    label: 'Leads: {value}'  // Shows "Leads: 120" in tooltip
  }
});
```

#### Example 4: Interactive Drill-down

```javascript
const chart = createGroupedBarChart('interactive-chart', data, {
  title: 'Matter Pipeline by Source',
  xAxis: { field: 'source', label: 'Source' },
  yAxis: { label: 'Count', min: 0 },
  series: [
    { label: 'New', field: 'new_count', color: '#3b82f6' },
    { label: 'In Progress', field: 'in_progress_count', color: '#f59e0b' },
    { label: 'Completed', field: 'completed_count', color: '#10b981' }
  ],
  onBarClick: (dataIndex, seriesIndex, value, label, series) => {
    console.log(`Clicked: ${series.label} for ${label} = ${value}`);
    // Navigate to drill-down view
    window.openDrilldown('pipeline_by_source', {
      source: label,
      stage: series.label,
      count: value
    });
  }
});
```

#### Example 5: With Help Text

```javascript
const chart = createGroupedBarChart('help-chart', data, {
  title: 'Staff Productivity Metrics',
  xAxis: { field: 'staff_member', label: 'Staff Member' },
  yAxis: { label: 'Hours', min: 0 },
  series: [
    { label: 'Billable', field: 'billable_hours', color: '#10b981' },
    { label: 'Non-Billable', field: 'non_billable_hours', color: '#6b7280' }
  ],
  helpText: {
    content: `
      <p>This chart shows billable vs non-billable hours for each staff member.</p>
      <ul>
        <li><strong>Billable</strong>: Time spent on client matters</li>
        <li><strong>Non-Billable</strong>: Administrative and internal work</li>
      </ul>
      <p>Target: 80% billable utilization</p>
    `
  }
});
```

---

### Integration with Existing Code

#### Before (module-execution.html)

```javascript
function renderGroupedBarChart(viz, data, uniqueId) {
  const div = document.createElement('div');
  // ... 100+ lines of chart rendering code ...

  const xField = viz.xAxis?.field || 'source_name';
  const labels = viz.data.map(row => row[xField] || 'Unknown');

  const datasets = (viz.series || []).map(serie => {
    return {
      label: serie.label,
      data: viz.data.map(row => parseFloat(row[serie.field]) || 0),
      backgroundColor: serie.color,
      borderColor: serie.color,
      borderWidth: 1
    };
  });

  const chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: { ... }
  });

  return div;
}
```

#### After (using GroupedBarChartRenderer)

```javascript
import { GroupedBarChartRenderer } from '../js/visualizations/renderers/grouped-bar-chart-renderer.js';

function renderGroupedBarChart(viz, data, uniqueId) {
  const container = document.createElement('div');
  container.id = `grouped-bar-container-${uniqueId}`;

  const renderer = new GroupedBarChartRenderer(container, viz.data, {
    title: viz.title,
    description: viz.description,
    xAxis: viz.xAxis,
    yAxis: viz.yAxis,
    series: viz.series,
    annotations: viz.annotations,
    helpText: viz.helpText ? { content: viz.helpText } : null,
    uniqueId: uniqueId,
    onBarClick: (dataIndex, seriesIndex, value, label, series) => {
      // Handle drill-down if configured
      if (window.openDrilldown) {
        window.openDrilldown(viz.drilldownKey, {
          category: label,
          series: series.label,
          value: value
        });
      }
    }
  });

  renderer.render();

  return container;
}
```

---

### Memory Management

**Always destroy chart instances when no longer needed:**

```javascript
// Store renderer reference
chartInstances[chartId] = renderer;

// Later, when cleaning up
if (chartInstances[chartId]) {
  chartInstances[chartId].destroy();
  delete chartInstances[chartId];
}
```

---

### Error Handling

The renderer includes built-in error handling:

- Validates container element exists (throws error if not found)
- Validates Chart.js is loaded (throws error if not found)
- Displays error message for invalid data format
- Displays "No data available" for empty datasets
- Displays error if no series configured
- Validates series configuration before rendering

---

### Best Practices

1. **Always destroy charts when done:**
   ```javascript
   renderer.destroy();
   ```

2. **Use `update()` for performance when data changes:**
   ```javascript
   // Good (efficient)
   renderer.update(newData);

   // Avoid (inefficient)
   renderer.destroy();
   new GroupedBarChartRenderer(...).render();
   ```

3. **Store renderer instances for cleanup:**
   ```javascript
   const renderers = {};
   renderers['chart-1'] = new GroupedBarChartRenderer(...);

   // Later
   Object.values(renderers).forEach(r => r.destroy());
   ```

4. **Validate data format before rendering:**
   ```javascript
   if (!data || data.length === 0) {
     console.warn('No grouped bar chart data');
     return;
   }
   ```

5. **Configure series properly:**
   ```javascript
   const series = [
     { label: 'Series 1', field: 'value1', color: '#3b82f6' },
     { label: 'Series 2', field: 'value2', color: '#10b981' }
   ];
   ```

---

### Troubleshooting

**Chart not rendering:**
- Verify container element ID or reference is valid
- Check that Chart.js is loaded before using renderer
- Validate data format (array of objects)
- Ensure at least one series is configured

**Series not displaying:**
- Check that `series[].field` matches data object keys
- Verify `series[].color` is a valid hex or rgb color
- Ensure data values are numeric

**Memory leaks:**
- Always call `destroy()` when removing charts from DOM
- Store renderer instances for later cleanup

**Tooltips not showing annotations:**
- Verify `annotations.field` exists in data objects
- Check `annotations.label` uses `{value}` placeholder correctly

---

## Contributing

When adding new renderers:

1. Follow ES6 class structure
2. Include comprehensive JSDoc comments
3. Provide `render()`, `update()`, and `destroy()` methods
4. Add usage examples to README
5. Write unit tests (≥70% coverage)

---

## License

Proprietary - Red Rooster Technologies
