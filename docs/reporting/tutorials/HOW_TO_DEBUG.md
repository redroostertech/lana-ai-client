# How to Debug the Reporting Frontend

**Updated:** 2026-03-05

Troubleshooting guide for frontend-specific issues with charts, drilldowns, API errors, and rendering.

---

## Quick Diagnostic Steps

1. Open DevTools (F12 or Cmd+Option+I)
2. Check Console tab for JavaScript errors
3. Check Network tab for failed API calls
4. Check the API response JSON for unexpected data

---

## Problem: Charts Not Rendering

### Check 1: Chart.js Is Loaded

Open DevTools Console and type:
```javascript
typeof Chart
// Should output: "function"
```

If `undefined`, Chart.js failed to load. Check that `src/js/vendor/chart.js` exists and the script tag is in `reporting.html`.

### Check 2: Renderer Is Available

```javascript
typeof window.TimeSeriesRenderer
// Should output: "function"
```

If `undefined`, the ES6 module import failed. Check:
- The renderer file exists in `src/js/visualizations/renderers/`
- The import in `reporting.html` has the correct path
- No syntax errors in the renderer file

### Check 3: Canvas Element Exists

```javascript
document.getElementById('your-canvas-id')
// Should NOT be null
```

### Check 4: Browser Console Errors

Look for errors like:
- `"Canvas is already in use"` -- Previous chart wasn't destroyed. Call `renderer.destroy()` first.
- `"Cannot read properties of null"` -- Canvas element not found. Check ID.
- `"Chart is not defined"` -- Chart.js not loaded.

### Fix: Force Chart Cleanup

```javascript
// In DevTools console
Object.values(window._reporting?.chartInstances || {}).forEach(c => c?.destroy?.());
```

---

## Problem: Drilldown Not Opening

### Check 1: Metric Has Drilldown Configured

In the execution response, check the metric:
```javascript
// In DevTools console, after running a report
console.log(window._reporting?.currentModuleData?.metrics?.find(m => m.key === 'your_metric')?.hasDrilldown);
// Should be true
```

### Check 2: Drilldown API Returns Data

In the Network tab, look for the drilldown POST request. Check:
- Status code is 200
- Response has `data.rows` array
- No error in response body

### Check 3: Column Mismatch

If the table renders but columns are empty, the drilldown column `field` names don't match the API response row keys.

---

## Problem: API Calls Failing

### Check 1: Network Tab

Open DevTools > Network tab. Filter by "modules". Look for:
- Red entries (failed requests)
- Status codes: 401 (auth), 403 (forbidden), 404 (not found), 500 (server error)

### Check 2: Authentication

```javascript
// Check if JWT is available (browser)
localStorage.getItem('token') || sessionStorage.getItem('token')

// In Electron client, use the preload bridge:
window.electronAPI?.getToken?.()
```

If token is missing or expired, re-login. In Electron, the token is managed by the preload bridge and may not be in `localStorage`.

### Check 3: CORS Issues

If you see CORS errors in console, the backend isn't configured to accept requests from this origin. Check backend CORS config.

### Check 4: Backend Is Running

```bash
curl http://localhost:8080/api/health
# Should return { "status": "ok" }
```

---

## Problem: Module Sidebar Is Empty

### Check 1: Modules API Returns Data

```bash
curl -s http://localhost:8080/api/v1/modules \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Check 2: Console Errors During Load

Check DevTools Console for errors during page load. The `loadModules()` function runs on page init.

### Check 3: Page Init Sequence

The controller initializes after `lex-page-init.js` runs. If Lex components fail to load, the controller may not initialize. Check for Lex-related errors.

---

## Problem: Metric Cards Show Wrong Values

### Check 1: Inspect API Response

In DevTools Network tab, find the execute POST request. Click it and check the Response tab. Look at the `metrics` array for the specific metric's `current`, `prior`, `target` values.

### Check 2: Formatting Issue

If the raw value is correct but displays wrong, it's a formatting issue. Check which formatter is being used (`formatCurrency`, `formatNumber`, `formatPercentage`).

### Check 3: Cache Returning Old Data

Re-execute with fresh data:
```javascript
// In the request body, add:
{ "useCache": false }
```

---

## Problem: Override Panel Won't Save

### Check 1: Form Validation

The override value field is `required` and `type="number"`. Ensure a valid number is entered.

### Check 2: Network Request

Check DevTools Network tab for the POST to `/data-overrides`. Look at:
- Request body (is all data present?)
- Response (success or error?)

### Check 3: Admin Permissions

Some override operations may require admin role. Check the response for 403 errors.

---

## Problem: Period Presets Not Working

### Check 1: Date Inputs Update

After clicking a preset, check if the date input values changed:

```javascript
document.getElementById('periodStart').value
document.getElementById('periodEnd').value
```

### Check 2: Lex Input Component

The `lex-input` component for dates may have a different value-setting API. Check if `.value` setter is working:

```javascript
var el = document.getElementById('periodStart');
console.log(el.value, el.getAttribute('value'));
```

---

## Useful DevTools Commands

`window._reporting` exposes **methods only** (not state variables). The internal state (`allModules`, `selectedModuleKey`, `currentModuleData`, `chartInstances`) is scoped inside the IIFE and not directly accessible from the console.

```javascript
// Available methods on window._reporting:
window._reporting.showModuleInfo()         // Open module info modal
window._reporting.closeModuleInfo()        // Close module info modal
window._reporting.closeDrilldownModal()    // Close drilldown modal
window._reporting.closeDataOverridePanel() // Close override panel
window._reporting.closeDataSourcesModal()  // Close data sources modal
window._reporting.closeMissingEntitiesModal() // Close missing entities modal
```

To inspect state, set breakpoints inside `reporting.js` or add temporary `console.log` statements within the IIFE.

---

## Log Locations

| Source | Where |
|--------|-------|
| Frontend errors | DevTools Console (F12) |
| Network requests | DevTools Network tab |
| Backend API logs | `pm2 logs lana-api` |
| Electron main process | DevTools for main process |

---

**Created:** 2026-03-05 | **Author:** Red Rooster Technologies
