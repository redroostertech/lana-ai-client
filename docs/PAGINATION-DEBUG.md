# Pagination Debug Guide
**Date:** 2026-02-01
**Issue:** User reports pagination still not working

---

## Debugging Steps

### Step 1: Hard Refresh the Page

The browser may have cached the old version of the file. Please:

**On Mac:**
- Press `Cmd + Shift + R`

**On Windows/Linux:**
- Press `Ctrl + Shift + R`

**Or:**
- Open DevTools (F12)
- Right-click the refresh button
- Select "Empty Cache and Hard Reload"

---

### Step 2: Check for JavaScript Errors

1. Open the browser console:
   - **Mac:** `Cmd + Option + J`
   - **Windows/Linux:** `Ctrl + Shift + J`

2. Look for any error messages (red text)

3. If you see errors, please share them

---

### Step 3: Verify Which Table Has the Issue

Please tell me **exactly which table** has the pagination problem:

#### A. Drilldown Modal Tables (Modal that pops up when clicking "Details")
These use: `window.drilldownRenderer.goToPage()`
- Expected to work WITHOUT the fix (already had unique handlers)

#### B. Inline Tables on the Page
These were just fixed:
1. **Contacts Table** - Uses `window.goToPage_contacts()`
2. **Opportunities Table** - Uses `window.goToPage_opportunities()`
3. **Contact Opportunities Table** - Uses `window.goToPage_contactOpportunities()`
4. **Unique Contact IDs Table** - Uses `window.goToPage_uniqueContactIds()`

Other inline tables (already had unique pagination):
5. **Consultation Booking Table** - Uses `window.goToConsultationPage()`
6. **Response Time Table** - Uses `window.goToResponseTimePage()`
7. **Lead Quality Table** - Uses `window.goToLeadQualityPage()`
8. **Show Rate Table** - Uses `window.goToShowRatePage()`
9. **Case Value Table** - Uses `window.goToCaseValuePage()`
10. **Consultations Held Table** - Uses `window.goToConsultationsHeldPage()`
11. **Engagement Table** - **NO PAGINATION** (shows all records)

---

### Step 4: Test Pagination Functions in Console

Open the browser console and test if the functions are defined:

```javascript
// Test drilldown renderer (for modal tables)
console.log('drilldownRenderer:', typeof window.drilldownRenderer);
console.log('goToPage method:', typeof window.drilldownRenderer?.goToPage);

// Test inline table pagination
console.log('goToPage_contacts:', typeof window.goToPage_contacts);
console.log('goToPage_opportunities:', typeof window.goToPage_opportunities);
console.log('goToConsultationPage:', typeof window.goToConsultationPage);
```

**Expected output:**
```
drilldownRenderer: object
goToPage method: function
goToPage_contacts: function
goToPage_opportunities: function
goToConsultationPage: function
```

If any show as `undefined`, that function isn't loaded.

---

### Step 5: Manually Test a Pagination Function

In the console, try calling a pagination function directly:

```javascript
// If you're on a page with the Contacts table visible:
window.goToPage_contacts(2);  // Should jump to page 2

// If you have a drilldown modal open:
window.drilldownRenderer.goToPage(2);  // Should jump to page 2 in modal
```

---

## Common Issues & Solutions

### Issue 1: Functions are `undefined`
**Solution:** Hard refresh the page to reload the JavaScript files

### Issue 2: "Cannot read properties of undefined"
**Cause:** The table hasn't been rendered yet, so the state doesn't exist
**Solution:** Navigate to the correct report/section first, then test

### Issue 3: Page doesn't refresh the cache
**Solution:**
1. Open DevTools (F12)
2. Go to Application tab → Clear Storage
3. Click "Clear site data"
4. Refresh the page

### Issue 4: Pagination buttons appear but don't do anything
**Possible causes:**
- JavaScript error (check console)
- onclick handlers not properly set (inspect element and check onclick attribute)
- Function name mismatch (compare onclick value with function name in console)

---

## Verification Checklist

Please test and confirm:

- [ ] I have hard refreshed the page (Cmd/Ctrl + Shift + R)
- [ ] I have checked the browser console for errors
- [ ] I can see pagination buttons (1, 2, 3, 4, Previous, Next)
- [ ] The buttons are enabled (not grayed out)
- [ ] I have more than 25 records (otherwise pagination won't show multiple pages)
- [ ] I am testing the correct table type (modal vs inline)

---

## Provide This Information

Please provide:

1. **Which table specifically?** (e.g., "Contacts table", "Drilldown modal after clicking Details on Expected Income")
2. **Any console errors?** (copy/paste the error text)
3. **Screenshot** of the pagination controls you're trying to click
4. **Test results** from Step 4 above (function typeof results)

---

## Next Steps Based on Findings

### If functions are `undefined`:
→ JavaScript file not loading - check network tab in DevTools

### If functions exist but clicks do nothing:
→ Check onclick attribute in element inspector
→ Look for JavaScript errors in console
→ Test manually calling the function in console

### If manual call works but button doesn't:
→ onclick handler not properly set
→ Need to inspect the actual HTML of the button

---

## Technical Details

### Fixed in This Session

**File:** `src/insights/module-execution.html`

**Changes:**
- Line 2108: Renamed `window.goToPage` → `window.goToPage_contacts`
- Line 2349: Renamed `window.goToPage` → `window.goToPage_opportunities`
- Line 2525: Renamed `window.goToPage` → `window.goToPage_contactOpportunities`
- Line 2717: Renamed `window.goToPage` → `window.goToPage_uniqueContactIds`
- Updated ~40 onclick handlers to use the new function names

**Commit:** bf19e4f - "fix: pagination in drilldown and inline tables by creating unique handlers per table"

### Files Involved

1. **`src/insights/module-execution.html`** - Main reporting page (MODIFIED)
2. **`src/js/drilldown-renderer.js`** - Drilldown modal renderer (NOT MODIFIED - already working)

---

## Still Not Working?

If after following all steps above the pagination still doesn't work, we need to dig deeper. Please provide:

1. Full console output (copy all text from console)
2. Network tab showing the JS files loaded
3. Screenshot of element inspector showing the onclick attribute of a pagination button
4. Tell me the exact steps to reproduce (e.g., "Go to Reports → Financial Performance → Click Details on Expected Income → Try to click page 2")
