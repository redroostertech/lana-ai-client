# Reporting Frontend System Design

**Status:** Active | **Version:** 2.0.0 | **Updated:** 2026-03-05

---

## Architecture

```
src/admin/reporting.html              -- Page template (Lex UI components)
  |
  +-- src/js/admin/reporting.js       -- Page controller (~117 KB IIFE)
  |     +-- Module sidebar logic
  |     +-- Period preset/selection
  |     +-- Report execution
  |     +-- Metric card rendering
  |     +-- Chart rendering orchestration
  |     +-- Drilldown modal logic
  |     +-- Override panel logic
  |     +-- Ask LANA integration
  |
  +-- src/js/visualizations/renderers/   -- 7 ES6 Chart.js wrappers
  |     +-- time-series-renderer.js      -- Line/area trends
  |     +-- bar-chart-renderer.js        -- Vertical bars
  |     +-- pie-chart-renderer.js        -- Pie/donut
  |     +-- funnel-chart-renderer.js     -- Conversion funnels
  |     +-- grouped-bar-chart-renderer.js -- Multi-series comparison
  |     +-- bubble-chart-renderer.js     -- Multi-dimensional
  |     +-- metric-grid-renderer.js      -- KPI card grid
  |
  +-- src/js/drilldown-renderer.js       -- Paginated table modal
  +-- src/js/vendor/chart.js             -- Chart.js library
  +-- src/js/vendor/jspdf.umd.min.js    -- PDF export
  +-- src/js/vendor/marked.min.js       -- Markdown rendering
```

---

## Page Layout

Two-column grid layout using Lex UI components:

```
+------------------+----------------------------------------+
|  Module Sidebar  |  Main Content                          |
|  (260px)         |  (1fr)                                 |
|                  |                                        |
|  External Links  |  Controls Card                         |
|  - NuVu Advisory |    Period Presets (7 buttons)           |
|  - AMABCM        |    Date Range (start + end pickers)    |
|                  |    Compare By (daily...yearly)          |
|  Module Search   |    Run Report Button                    |
|  Module List     |                                        |
|  (by category)   |  Results (after execution)              |
|                  |    Results Header                      |
|                  |    Metric Cards Grid                    |
|                  |    Visualization Charts                 |
+------------------+----------------------------------------+
```

---

## Key DOM Element IDs

| ID | Purpose |
|----|---------|
| `reportingBanner` | Page header |
| `reportingLayout` | Two-column grid |
| `moduleSidebarColumn` | Left sidebar |
| `moduleSearchInput` | Module search filter |
| `moduleMenu` | Module list container |
| `reportingMainColumn` | Right content area |
| `controlsCard` | Period/execution controls |
| `periodPresets` | Quick select buttons |
| `periodStart` / `periodEnd` | Date pickers |
| `periodType` | Compare By selector |
| `executeBtn` | Run Report button |
| `reportingPlaceholder` | Empty state |
| `moduleResults` | Results container |
| `moduleTitle` | Active module name |
| `visualizationsContainer` | Chart target |
| `drilldownModal` | Detail table modal |
| `dataOverridePanel` | Override drawer |
| `dataSourcesModal` | Data sources info |
| `missingEntitiesModal` | Missing data warning |
| `moduleInfoModal` | Module metadata |

---

## Controller: `reporting.js`

Self-contained IIFE (~117 KB). Key internal state:

```javascript
var allModules = [];              // All available modules from API
var moduleCategories = {};        // Modules grouped by category
var selectedModuleKey = null;     // Currently selected module
var currentModuleData = null;     // Last execution results
var currentModuleConfig = null;   // Current module config
var chartInstances = {};          // Active Chart.js instances (for cleanup)
var drilldownRenderer = null;     // Active drilldown renderer
```

### Global API (`window._reporting`)

Methods callable from inline `onclick` handlers:

| Method | Purpose |
|--------|---------|
| `showModuleInfo()` | Open module info modal |
| `closeModuleInfo()` | Close module info modal |
| `closeDrilldownModal()` | Close drilldown modal |
| `closeDataOverridePanel()` | Close override panel |
| `closeDataSourcesModal()` | Close data sources modal |
| `closeMissingEntitiesModal()` | Close missing entities modal |

### Key Internal Functions

| Function | Purpose |
|----------|---------|
| `loadModules()` | GET /api/v1/modules -> populate sidebar |
| `selectModule(key)` | Highlight module, prepare execution |
| `selectPeriodPreset(preset)` | Apply date range preset |
| `executeReport()` | POST execute -> render results |
| `renderMetricCards(metrics)` | Build metric card grid |
| `renderVisualizations(visualizations)` | Instantiate chart renderers |
| `openDrilldown(metricKey)` | Open drilldown modal |
| `openDataOverride(metricKey)` | Open override panel |
| `formatCurrency(value)` | `$X,XXX.XX` |
| `formatNumber(value, decimals)` | Locale-formatted number |
| `formatPercentage(value, decimals)` | `XX.X%` |
| `getStatusColor(current, target, inverse)` | `green`/`yellow`/`red`/`gray` |

---

## Data Flow

```
1. Page load -> GET /api/v1/modules -> Render sidebar

2. User clicks module -> selectedModuleKey set

3. User selects date range (preset or custom)

4. User clicks "Run Report"
     |
     v
5. POST /api/v1/modules/{key}/execute
     |
     v
6. Response: { metrics, visualizations, insights, timeSeries, dataSources }
     |
     v
7. Render:
   a. Hide placeholder, show results
   b. Results header (name, period, execution time)
   c. Metric cards (value, prior, target, status, change%)
   d. Charts (via ES6 renderers)
   e. Insight cards
   f. Wire drilldown/override buttons
```

---

## Metric Card Anatomy

```
+--------------------------------------------------+
|  [Icon]  Metric Name                    [Status]  |
|                                                    |
|  Current Value        (large, bold)               |
|                                                    |
|  Prior: XX  (+/- change, % change)               |
|  Target: XX                                       |
|                                                    |
|  [Details]  [Override]                            |
+--------------------------------------------------+
```

Status colors determined by `getStatusColor()`:

| Status | Condition (standard) | Card Color |
|--------|---------------------|------------|
| Green | current >= target | `bg-green-50` |
| Yellow | current >= target * 0.8 | `bg-yellow-50` |
| Red | current < target * 0.8 | `bg-red-50` |
| Gray | No target or null data | `bg-white` |

---

## Visualization Renderers

7 renderer files exist in `src/js/visualizations/renderers/`, but only **4 are imported** in `reporting.html`:

```html
<script type="module">
  import { TimeSeriesRenderer } from '../js/visualizations/renderers/time-series-renderer.js';
  import { PieChartRenderer } from '../js/visualizations/renderers/pie-chart-renderer.js';
  import { FunnelChartRenderer } from '../js/visualizations/renderers/funnel-chart-renderer.js';
  import { BarChartRenderer } from '../js/visualizations/renderers/bar-chart-renderer.js';
  window.TimeSeriesRenderer = TimeSeriesRenderer;
  window.PieChartRenderer = PieChartRenderer;
  window.FunnelChartRenderer = FunnelChartRenderer;
  window.BarChartRenderer = BarChartRenderer;
</script>
```

**Not yet imported:** `GroupedBarChartRenderer`, `BubbleChartRenderer`, `MetricGridRenderer` (files exist but need import + window assignment to use).

### Common API

```javascript
const renderer = new RendererClass(canvasId, data, metricKeys, config);
renderer.render();          // Initial render
renderer.update(newData);   // Update without re-creating
renderer.toBase64Image();   // Export as image
renderer.destroy();         // Clean up (IMPORTANT for memory)
```

### Memory Management

Always `destroy()` before creating a new chart on the same canvas. The controller tracks instances in `chartInstances` and cleans up on module switch.

---

## Drilldown Renderer

**File:** `src/js/drilldown-renderer.js`

Modal-based paginated table for metric detail data.

### Features
- Pagination (10/25/50/100 per page)
- Column sorting (click headers)
- Full-text search
- View filters (from summary card clicks)
- Summary statistics row
- Insight cards within drilldown
- Export to CSV/PDF

---

## Period Presets

| Preset Key | Label | Calculation |
|-----------|-------|-------------|
| `last7days` | Last 7 Days | Today - 6 to Today |
| `last30days` | Last 30 Days | Today - 29 to Today |
| `thisMonth` | This Month | 1st of month to Today |
| `lastMonth` | Last Month | Full previous month |
| `thisQuarter` | This Quarter | 1st of quarter to Today |
| `thisYear` | This Year | Jan 1 to Today |
| `lastYear` | Last Year | Jan 1 to Dec 31 previous year |

---

## Modals

| Modal | Trigger | Purpose |
|-------|---------|---------|
| `#drilldownModal` | "Details" button on metric card | Paginated detail table |
| `#dataOverridePanel` | "Override" button on metric card | Slide-out target override form |
| `#dataSourcesModal` | "X Connectors" button in header | Lists data sources used |
| `#missingEntitiesModal` | "X Missing" button in header | Missing data entity warnings |
| `#moduleInfoModal` | "Learn More" button in header | Module metadata (version, tier, status) |

---

## Migration: V1 to V2

| Aspect | V1 (`insights/module-execution.html`) | V2 (`admin/reporting.html`) |
|--------|----------------------------------------|------------------------------|
| Size | ~356 KB / ~7,900 lines | ~27 KB HTML + ~117 KB JS |
| UI Framework | Custom/Tailwind | Lex UI components |
| Module nav | Flat list | Category groups + search |
| Date selection | Manual only | Presets + manual |
| Viz imports | Inline | ES6 modules |
| AI integration | None | Ask LANA button |
| Status | Maintained, superseded | **Active** |

---

**Created:** 2026-03-05 | **Author:** Red Rooster Technologies
