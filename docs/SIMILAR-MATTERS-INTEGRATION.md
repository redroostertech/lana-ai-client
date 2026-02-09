# Similar Matters Widget - Integration Guide

**Status:** ✅ **Integration Complete**
**Date:** 2026-01-27

---

## Overview

The Similar Matters Widget displays semantically related legal matters on the matter detail page. It uses vector similarity, document overlap, party overlap, and temporal factors to find and rank similar cases.

---

## Integration Points

### 1. Script Include ✅

**File:** `src/matters.html` (line 25)

```html
<script src="js/similar-matters-widget.js"></script>
```

**Purpose:** Loads the SimilarMattersWidget class

---

### 2. Widget Container ✅

**File:** `src/matters.html` (line 2033)

**Location:** Inside the Overview/Details tab, after "Shared With" section

```html
<!-- Similar Matters Widget -->
<div id="similarMattersWidgetContainer" class="mt-6"></div>
```

**Purpose:** Container where the widget renders its UI

---

### 3. Widget Initialization ✅

**File:** `src/matters.html` (lines 2037-2052)

**Location:** End of `renderDetailsTab()` function

```javascript
// Global similar matters widget instance
let similarMattersWidget = null;

// Inside renderDetailsTab() function:

// Initialize Similar Matters Widget
if (!similarMattersWidget) {
  similarMattersWidget = new SimilarMattersWidget(api);
}
similarMattersWidget.initialize('similarMattersWidgetContainer');
similarMattersWidget.loadSimilarMatters(matter.id, {
  limit: 10,
  threshold: 0.3
});

// Listen for matter navigation events
document.addEventListener('similar-matter-selected', (event) => {
  const { matterId } = event.detail;
  // Navigate to the selected matter
  viewMatter(matterId, 'details');
}, { once: true });
```

**Purpose:**
- Creates widget instance (singleton)
- Initializes in container
- Loads similar matters for current matter
- Handles click navigation to similar matters

---

## Widget Features

### UI Components

1. **Header**
   - Title: "Related Matters"
   - Count: "Found X similar matters"
   - Refresh button

2. **Matter Cards**
   - Matter ID and name
   - Client name
   - Status badge
   - Similarity score (circular progress)
   - Matching reasons (chips)
   - Document count
   - Last updated (relative time)

3. **Show More/Less**
   - Initially shows 5 matters
   - Expands to show all results
   - Collapsible

4. **Loading State**
   - Skeleton screens
   - Spinner indicator

5. **Error State**
   - Error message
   - Retry button

6. **Empty State**
   - "No similar matters found"
   - Helpful message

### Scoring Display

The widget displays a combined similarity score (0-100%) with color coding:

- **80-100% (Green)**: Very similar matters
- **60-79% (Blue)**: Similar matters
- **40-59% (Yellow)**: Moderately similar
- **0-39% (Gray)**: Loosely related

### Matching Reasons

The widget shows human-readable reasons for similarity:

- "Very similar matter descriptions and content"
- "Similar matter descriptions"
- "Common document types"
- "Shared parties or contacts"
- "Recently active matter"

---

## API Endpoints Used

### 1. Find Similar Matters

```
GET /api/v1/similar-matters/{matterId}?limit=10&threshold=0.3
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "source_matter": {...},
    "similar_matters": [
      {
        "id": "uuid",
        "matter_id": "MATT-00456",
        "name": "Similar Matter",
        "client_name": "Client Name",
        "combined_score": 0.75,
        "vector_similarity": 0.85,
        "document_overlap_score": 0.32,
        "party_overlap_score": 0.25,
        "temporal_score": 0.98,
        "matching_reasons": ["Very similar matter descriptions"]
      }
    ],
    "total_count": 10,
    "search_time_ms": 4
  }
}
```

---

## Widget Options

### Initialization Options

```javascript
similarMattersWidget.loadSimilarMatters(matterId, {
  limit: 10,          // Max results (default: 10, max: 50)
  threshold: 0.3      // Min similarity score (default: 0.3, range: 0.0-1.0)
});
```

### Methods

```javascript
// Initialize widget
widget.initialize('containerId');

// Load similar matters
widget.loadSimilarMatters(matterId, options);

// Refresh results
widget.refresh();

// Reset widget
widget.reset();

// Toggle show all/less
widget.toggleShowAll();
```

### Events

```javascript
// Emitted when user clicks on a similar matter card
document.addEventListener('similar-matter-selected', (event) => {
  const { matterId } = event.detail;
  // Handle navigation
});
```

---

## Styling

The widget uses Tailwind CSS classes matching the existing matters page design:

- **Primary Color:** Indigo (indigo-600)
- **Success:** Green (green-500)
- **Warning:** Yellow (yellow-500)
- **Error:** Red (red-500)
- **Layout:** Responsive grid with cards

### Custom Styles

No custom CSS required - all styling is inline Tailwind utility classes.

---

## Browser Testing Checklist

### Basic Functionality

- [ ] Widget loads on matter detail view
- [ ] Loading state shows skeleton screens
- [ ] Similar matters display correctly
- [ ] Similarity scores show accurate percentages
- [ ] Matching reasons display as chips
- [ ] Click on matter card navigates to that matter

### Interactions

- [ ] Refresh button reloads similar matters
- [ ] Show More expands to all results
- [ ] Show Less collapses to 5 results
- [ ] Navigation to similar matter works
- [ ] Back button returns to previous matter

### States

- [ ] Loading state: Spinner and skeletons
- [ ] Success state: Matters displayed
- [ ] Empty state: "No similar matters found"
- [ ] Error state: Error message and retry button
- [ ] Retry button works after error

### Responsive Design

- [ ] Mobile (< 768px): Cards stack vertically
- [ ] Tablet (768px - 1024px): Proper spacing
- [ ] Desktop (> 1024px): Optimal layout
- [ ] No horizontal scroll

### Performance

- [ ] Widget loads within 2 seconds
- [ ] API calls complete < 100ms
- [ ] No console errors
- [ ] No memory leaks on repeated navigation

---

## Troubleshooting

### Widget Not Showing

1. **Check script loaded:**
   - Open DevTools Console
   - Type: `typeof SimilarMattersWidget`
   - Should return: `"function"`

2. **Check container exists:**
   - Type: `document.getElementById('similarMattersWidgetContainer')`
   - Should return: `<div>` element

3. **Check API token:**
   - Type: `api.token`
   - Should return: JWT string

### No Similar Matters Found

1. **Check embedding coverage:**
   - Call: `GET /api/v1/similar-matters/health`
   - Should return: `coverage_percentage: 100`

2. **Lower threshold:**
   - Change from `0.3` to `0.1`
   - Re-test

3. **Check matter has description:**
   - Matters need content for similarity matching
   - Add description to test matter

### API Errors

1. **401 Unauthorized:**
   - Token expired
   - Refresh page to get new token

2. **500 Server Error:**
   - Check backend logs: `pm2 logs lana-api`
   - Ensure embeddings generated

3. **Network Error:**
   - Check backend running: `pm2 status`
   - Check URL: `http://localhost:8080`

---

## Future Enhancements

1. **Caching:** Cache similar matters for 5 minutes
2. **Filtering:** Filter by matter status, client, date range
3. **Sorting:** Sort by score, date, relevance
4. **Export:** Export similar matters list to PDF/CSV
5. **Comparison:** Side-by-side matter comparison view
6. **Recommendations:** "You might also be interested in..."

---

## Architecture Notes

### Widget Pattern

- **Singleton:** One widget instance per page load
- **Self-contained:** No external dependencies (except api)
- **Event-driven:** Uses CustomEvents for navigation
- **Responsive:** Works on all screen sizes

### Performance

- **Lazy loading:** Widget initializes only when Details tab shown
- **Debouncing:** Refresh button debounced to prevent spam
- **Caching:** Browser caches API responses (future)

### Security

- **XSS Protection:** All user input HTML-escaped
- **Authentication:** All API calls use JWT Bearer token
- **Authorization:** Backend enforces organization scoping

---

## Summary

**Integration Status:** ✅ Complete

**Files Modified:**
1. `src/matters.html` - Added script, container, initialization

**Files Created:**
1. `src/js/similar-matters-widget.js` - Widget component

**Next Steps:**
1. Test in browser (open matter detail page)
2. Verify similar matters display
3. Test navigation between matters
4. Check error states
5. Validate responsive design

The Similar Matters Widget is ready for testing! 🎉
