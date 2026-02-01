# PeriodSelector Component - Usage Examples

## Installation

The PeriodSelector is an ES6 module located at:
```
lana-client/src/js/components/period-selector.js
```

## Basic Usage

### 1. HTML Container

First, create a container element in your HTML:

```html
<div id="period-selector-container"></div>
```

### 2. Import and Initialize

```javascript
import { PeriodSelector } from './js/components/period-selector.js';

// Create instance with configuration
const selector = new PeriodSelector({
  containerId: 'period-selector-container',
  defaultPreset: 'last30days',
  defaultPeriodType: 'monthly',
  onChange: (period) => {
    console.log('Period changed:', period);
    // { start: '2026-01-01', end: '2026-01-31', type: 'monthly' }
  }
});

// Render the component
selector.render();
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `containerId` | string | **required** | ID of the container element to render into |
| `defaultPreset` | string | `'last7days'` | Default period preset to apply on initialization |
| `defaultPeriodType` | string | `'daily'` | Default period type (daily, weekly, monthly, quarterly, yearly) |
| `onChange` | function | `() => {}` | Callback function when period changes |
| `presets` | array | all presets | Array of preset keys to show (filters available presets) |
| `periodTypes` | array | all types | Array of period type values to show (filters available types) |

## Available Presets

- `last7days` - Last 7 Days (today + 6 prior days)
- `last30days` - Last 30 Days (today + 29 prior days)
- `thisMonth` - This Month (month start → today)
- `lastMonth` - Last Month (previous month start → end)
- `thisQuarter` - This Quarter (quarter start → today)
- `thisYear` - This Year (year start → today)
- `lastYear` - Last Year (last year Jan 1 → Dec 31)

## Available Period Types

- `daily` - Daily comparison
- `weekly` - Weekly comparison
- `monthly` - Monthly comparison
- `quarterly` - Quarterly comparison
- `yearly` - Yearly comparison

## API Methods

### `render()`

Renders the period selector UI into the container.

```javascript
selector.render();
```

### `getPeriod()`

Returns the current period selection.

```javascript
const period = selector.getPeriod();
// { start: '2026-01-01', end: '2026-01-31', type: 'monthly' }
```

### `setPeriod(start, end, type)`

Sets the period selection programmatically.

```javascript
selector.setPeriod('2026-01-01', '2026-01-31', 'monthly');
```

### `validate()`

Validates the current period selection.

```javascript
const validation = selector.validate();
if (!validation.valid) {
  console.error(validation.error);
  // "Start date must be before or equal to end date"
}
```

### `destroy()`

Destroys the period selector and removes event listeners.

```javascript
selector.destroy();
```

## Advanced Examples

### Custom Presets and Period Types

Filter which presets and period types are shown:

```javascript
const selector = new PeriodSelector({
  containerId: 'period-selector-container',
  presets: ['last7days', 'last30days', 'thisMonth'], // Only show these
  periodTypes: ['daily', 'weekly', 'monthly'], // Only show these
  onChange: (period) => {
    console.log('Period changed:', period);
  }
});

selector.render();
```

### Integration with Module Execution

Example usage in module-execution.html:

```javascript
import { PeriodSelector } from '../js/components/period-selector.js';

// Initialize period selector
const periodSelector = new PeriodSelector({
  containerId: 'period-selector-container',
  defaultPreset: 'last30days',
  defaultPeriodType: 'monthly',
  onChange: (period) => {
    // Validate and enable/disable execute button
    const validation = periodSelector.validate();
    const executeBtn = document.getElementById('executeBtn');
    executeBtn.disabled = !validation.valid;
    
    if (!validation.valid) {
      showError(validation.error);
    }
  }
});

periodSelector.render();

// On execute button click
document.getElementById('executeBtn').addEventListener('click', async () => {
  const period = periodSelector.getPeriod();
  const validation = periodSelector.validate();
  
  if (!validation.valid) {
    showError(validation.error);
    return;
  }
  
  // Execute module with period
  await executeModule(period.start, period.end, period.type);
});
```

### Multiple Instances

You can create multiple period selectors on the same page:

```javascript
// Primary period selector
const primarySelector = new PeriodSelector({
  containerId: 'primary-period-selector',
  defaultPreset: 'thisMonth',
  onChange: (period) => console.log('Primary:', period)
});
primarySelector.render();

// Comparison period selector
const comparisonSelector = new PeriodSelector({
  containerId: 'comparison-period-selector',
  defaultPreset: 'lastMonth',
  onChange: (period) => console.log('Comparison:', period)
});
comparisonSelector.render();
```

## Styling

The component uses Tailwind CSS classes. Ensure Tailwind is loaded in your page:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

Or customize the styling by overriding the classes in the `render()` method.

## Browser Support

- Modern browsers with ES6 module support
- Chrome 61+
- Firefox 60+
- Safari 11+
- Edge 16+

## Notes

- All dates are in `YYYY-MM-DD` format
- Dates are inclusive (start and end dates are both included in the period)
- The component uses the browser's native date picker
- Period calculations account for timezone differences
