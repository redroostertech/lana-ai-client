# Matter Details View - Complete Analysis
**File:** `/Users/redroostertechnologies/Desktop/lana-client/src/matters.html`
**File Size:** ~11,630 lines
**Analysis Date:** 2026-02-12

---

## EXECUTIVE SUMMARY

The matter details view in matters.html is organized into **multiple tabs** with **7 distinct sections in the Details tab**. The structure uses a consistent pattern where most section titles are INSIDE cards with `bg-gray-50 rounded-lg p-4` styling, while only Shared With and Linked Matters sections position titles OUTSIDE cards in a flex header row pattern.

**Key Finding:** Two distinct title positioning patterns are used:
1. **INSIDE Card (Standard):** Description, Matter Information, Matter Profile, Custom Fields, Unassigned Documents
2. **OUTSIDE Card (Header Pattern):** Shared With, Linked Matters

---

## DETAILS TAB SECTIONS (Lines 3002-3121)

### Section 1: Matter Profile Notification
- **Lines:** 3006-3007
- **Container ID:** `#matterProfileNotification`
- **Type:** Dynamic placeholder (rendered by `renderMatterProfileSection()`)
- **Display:** At top of tab, only when profile is generating
- **Content:** Notification message with gradient background

### Section 2: Description
- **Lines:** 3009-3012
- **Title:** "Description"
- **Title Position:** INSIDE card
- **Card Classes:** `bg-gray-50 rounded-lg p-4`
- **Title Classes:** `text-sm font-medium text-gray-700 mb-2`
- **Content:** Single paragraph with `text-sm text-gray-600`

### Section 3: Matter Profile Intelligence
- **Lines:** 3014-3015 (container), 2818-2965 (render function)
- **Container ID:** `#matterProfileSection`
- **Title:** "Matter Profile Intelligence"
- **Title Position:** INSIDE card (Line 2927)
- **Card Classes:** `bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-4`
- **Icon:** SVG icon before title
- **Content:**
  - Brand Voice section (Lines 2931-2943)
    - Sub-title: "Brand Voice" (Line 2933)
    - Item format: Key-value pairs
  - Document Themes section (Lines 2945-2956)
    - Sub-title: "Document Themes" (Line 2947)
    - Item format: Badge tags with `bg-purple-100 text-purple-800`
- **Lazy Loading:** Triggers profile initialization if 404 response

### Section 4: Matter Information
- **Lines:** 3017-3045
- **Title:** "Matter Information"
- **Title Position:** INSIDE card (Line 3018)
- **Card Classes:** `bg-gray-50 rounded-lg p-4`
- **Title Classes:** `text-sm font-medium text-gray-700 mb-2`
- **Content Structure:** Definition list (`<dl class="space-y-2 text-sm">`)
- **Fields Displayed:**
  - Matter ID (Line 3021)
  - Client (Line 3025)
  - Status (Line 3029) - uses `statusBadge()` function
  - Visibility (Line 3033) - emoji icons
  - Created (Line 3037) - formatted date
  - Last Updated (Line 3041) - formatted date
- **Field Format:** `<dt>` for labels (gray-500), `<dd>` for values (gray-900)

### Section 5: Shared With
- **Lines:** 3047-3079
- **Title:** "Shared With"
- **Title Position:** OUTSIDE card (Line 3050)
- **Header Structure:** Flex row `flex items-center justify-between mb-3`
- **Header Children:**
  - Left: `<h5 class="text-sm font-medium text-gray-700">Shared With</h5>`
  - Right: "Manage Sharing" button (Lines 3051-3059)
    - Classes: `px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700`
    - Icon: + (plus) SVG
- **Content Container:** `<div class="space-y-2">`
- **Item Classes:** `bg-gray-50 rounded-lg p-3`
- **Item Structure:**
  - Avatar: `w-8 h-8 bg-indigo-100 rounded-full` with initials
  - Name: `text-sm font-medium text-gray-900`
  - Email: `text-xs text-gray-500`
  - Remove button: Right-aligned with X icon
- **Empty State:** Message (Line 3077) - varies by visibility

### Section 6: Linked Matters
- **Lines:** 3081-3084 (container), 7436-7600+ (render functions)
- **Container ID:** `#linkedMattersSection`
- **Render Functions:**
  - `renderLinkedMattersInDetails(matter)` - Lines 7436-7479
  - `renderLinkedMattersInlineContent(matter, links, totalLinks)` - Lines 7481-7600+
- **Title:** "Linked Matters" (Line 7516)
- **Title Position:** INSIDE section content wrapper
- **Header Structure:** Flex row `flex items-center justify-between`
- **Header Children:**
  - Left: `<h5 class="text-sm font-medium text-gray-700">Linked Matters</h5>`
  - Right: Buttons (for workspaces only)
    - "Link Existing Matter" (Lines 7523-7530)
      - Classes: `px-2 py-1 text-xs bg-indigo-600 text-white rounded`
      - Icon: Link SVG
    - "Create New Matter" (Lines 7531-7539)
      - Classes: `px-2 py-1 text-xs bg-purple-600 text-white rounded`
      - Icon: Plus SVG
- **Section Wrapper:** `<div class="space-y-4">`
- **Empty State:** Centered message with action buttons (Lines 7487-7510)
  - Classes: `bg-gray-50 rounded-lg p-4 text-center`
  - Shows buttons only for workspaces

### Section 7: Custom Fields
- **Lines:** 3086-3087 (container), 2704-2816 (render function)
- **Container ID:** `#customFieldsSection`
- **Render Function:** `window.renderCustomFieldsSection(matter)` - Lines 2704-2816
- **Title:** "Custom Fields"
- **Title Position:** INSIDE card (Line 2777)
- **Card Classes:** `bg-gray-50 rounded-lg p-4 mt-6`
- **Header Structure:** Flex row `flex items-center justify-between mb-3`
- **Header Children:**
  - Left: `<h5 class="text-sm font-medium text-gray-700">Custom Fields</h5>`
  - Right: Edit button (Lines 2778-2786)
    - Classes: `text-indigo-600 hover:text-indigo-800 p-1 rounded hover:bg-indigo-50`
    - Icon: Pencil SVG
- **Content Structure:** Definition list or empty state
  - Definition list: `<dl class="space-y-2 text-sm">`
  - Items: `<div class="flex justify-between">`
- **Field Formatting:**
  - Currency fields: `$` prefix with 2 decimals (Lines 2796-2800)
  - Other fields: `formatFieldValue(field.value)` (Line 2802)
- **Empty State:** "No custom fields yet" (Line 2789)
- **Data Structure:**
  - Uses: `matter.metadata?.custom_field_definitions`
  - Uses: `matter.metadata?.custom_fields`
  - Fallback: `matter.shadow_table` (legacy)

---

## DOCUMENTS TAB (Lines 3179-3419)

### Function Signature
```javascript
renderDocumentsTab(matter, documents, orphanedFiles = [])
```

### Container
- **ID:** `#tabContentDocuments`
- **Main Wrapper:** `<div class="space-y-4">`

### Empty State (Lines 3211-3237)
- **Display:** When `documents.length === 0 && orphanedFiles.length === 0`
- **Content:**
  - Centered gradient icon box
  - Heading: "No documents yet"
  - Description text
  - Upload drop zone: `#drawerEmptyDropZone`
  - File input: `#drawerEmptyFileInput`
- **Setup:** `setupDrawerUpload(matter.matter_id, 'drawerEmptyDropZone', 'drawerEmptyFileInput')`

### Upload Area (Lines 3241-3256)
- **Container ID:** `#drawerDocDropZone`
- **File Input ID:** `#drawerDocFileInput`
- **Classes:** `border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-indigo-400`
- **Content Div ID:** `#drawerDocDropContent`
- **Progress Div ID:** `#drawerDocUploadProgress` (hidden initially)
- **Accepted Types:** `.pdf,.doc,.docx,.txt,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.pptx,.ppt`

### Document Count Header (Lines 3259-3262)
- **Format:** `"${documents.length} document(s)"`
- **Classes:** Simple text with `text-sm text-gray-500`

### Document List (Lines 3264-3363)
- **Container:** `<div class="space-y-2">`
- **Item Wrapper Classes:** `bg-white border border-gray-200 hover:border-indigo-300 rounded-lg p-3 transition-all group`
- **Data Attribute:** `data-doc-id="${doc.id}"`
- **Item Structure:**
  - Icon box: `w-10 h-10 bg-gray-100 rounded-lg`
  - Filename: `text-sm font-medium text-gray-900 truncate`
  - Metadata: File size, timestamp, source badge
  - Source Badges:
    - "From Workspace": `bg-purple-100 text-purple-700` (Line 3286)
    - "Shared": `bg-blue-100 text-blue-700` (Line 3294)
  - Status badge: Element with `[data-status-badge]` attribute
  - Action buttons: Element with `[data-doc-actions]` attribute
- **Action Buttons Classes:** `text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1`
- **File Icon Function:** `getFileIcon(contentType)` - Lines 3184-3200

### Unassigned Documents Section (Lines 3366-3415)
- **Condition:** Only displayed if `orphanedFiles && orphanedFiles.length > 0`
- **Title:** "Unassigned Documents"
- **Title Position:** INSIDE section (Line 3370)
- **Title Row:** Contains title (left) and count badge (right)
- **Count Badge:** `text-xs text-gray-500 bg-yellow-50 px-2 py-1 rounded`
- **Description Text:** Explains orphaned files
- **Item Classes:** `bg-yellow-50 border border-yellow-200 hover:border-yellow-300 rounded-lg p-3`
- **Data Attribute:** `data-orphan-key="${file.storage_key}"`
- **Item Structure:** Similar to document list
- **Actions Per File:**
  - "Assign to Matter" button
  - "View" button
  - "Delete" button

---

## CONVERSATIONS TAB (Lines 4514-4612)

### Function Signature
```javascript
renderConversationsTab(matter, chats, pagination)
```

### Container
- **ID:** `#tabContentConversations`
- **Main Wrapper:** `<div class="space-y-4">`

### Empty State (Lines 4518-4537)
- **Display:** When `chats.length === 0`
- **Content:**
  - Centered gradient icon box
  - Heading: "No conversations yet"
  - Description text
  - Button: "Start First Conversation"

### Header Row (Lines 4548-4556)
- **Layout:** Flex with space-between
- **Left:** Conversation count `"${total} conversation(s)"`
- **Right:** "New Chat" button
  - Classes: `inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg font-medium`
  - Icon: Plus SVG

### Conversation List (Lines 4558-4580)
- **Container:** `<div class="space-y-2">`
- **Item Wrapper:** Clickable div with onclick handler
- **Item Classes:** `block bg-white border border-gray-200 hover:border-indigo-300 hover:shadow-sm rounded-lg p-4 transition-all group cursor-pointer`
- **Item Structure:**
  - Icon: `w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg`
  - Title: `metadata?.title || 'Untitled Conversation'`
    - Classes: `text-sm font-semibold text-gray-900 group-hover:text-indigo-600 mb-1 truncate`
  - Timestamp: "Started ${timeAgo(chat.created_at)}"
  - Message count: "• ${chat.metadata?.messageCount} messages" (if present)
  - Right arrow: `text-gray-400 group-hover:text-indigo-600 transform group-hover:translate-x-1`
- **Onclick Handler:** `NavigationHelpers.navigateToConversation(chat.thread_id, matter.matter_id)`

### Pagination Controls (Lines 4582-4609)
- **Display:** Only if `total > 0`
- **Container:** `border-t pt-4 mt-6`
- **Layout:** Flex with space-between
- **Left:** "Showing X-Y of Z conversations"
- **Right:**
  - Previous button (Line 4589-4595)
    - Classes: `px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50`
    - Disabled when `currentOffset === 0`
  - Page indicator: `Page X of Y`
  - Next button (Line 4599-4605)
    - Classes: `px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50`
    - Disabled when `!hasMore`

---

## ENTRY POINT & FLOW

### Main Function
```javascript
viewMatter(matterId, tab)  // Lines 2468-2650
```

### Flow:
1. `viewMatter(matterId, tab)` called with matter ID
2. Fetches matter data, permissions, documents, conversations
3. Calls appropriate render function:
   - Details: `renderDetailsTab(matter, permissions)` (Line 3002)
   - Documents: `renderDocumentsTab(matter, documents)` (Line 3179)
   - Conversations: `renderConversationsTab(matter, chats)` (Line 4514)
4. Details tab also calls:
   - `renderMatterProfileSection(matter)` (Line 3095)
   - `renderLinkedMattersInDetails(matter)` (Line 3098)
   - `window.renderCustomFieldsSection(matter)` (Line 3101)

### Tab Switching
```javascript
switchMatterTab(tabName)  // Referenced at lines 631-635
```

---

## HELPER FUNCTIONS

| Function | Lines | Purpose |
|----------|-------|---------|
| `formatDate(dateString)` | 2968-2982 | Format dates with time |
| `formatFieldName(fieldName)` | 2985-2990 | Convert snake_case to Title Case |
| `formatFieldValue(value)` | 2993-2999 | Format values for display |
| `formatSize(bytes)` | 3203-3209 | Format file sizes to KB/MB/GB |
| `getFileIcon(contentType)` | 3184-3200 | Return SVG icon based on file type |
| `timeAgo(dateString)` | Referenced | Format timestamp as "X ago" |
| `statusBadge(status)` | Referenced at 3030 | Return status badge HTML |

---

## TITLE POSITIONING SUMMARY

### INSIDE Card (Most Common Pattern)
1. Description (3010)
2. Matter Information (3018)
3. Matter Profile Intelligence (2927)
4. Custom Fields (2777)
5. Unassigned Documents (3370)

### OUTSIDE Card (Header Row Pattern)
1. Shared With (3050) - Header row with title + "Manage Sharing" button
2. Linked Matters (7516) - Header row with title + Link/Create buttons
3. Custom Fields (2776-2786) - Variant: header row with title + Edit button

### Key Pattern:
- INSIDE: Title as first child of card container
- OUTSIDE: Title in flex header row above content container

---

## CSS CLASSES REFERENCE

### Card Wrappers
- Standard: `bg-gray-50 rounded-lg p-4`
- Gradient: `bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-4`
- Warning: `bg-yellow-50 border border-yellow-200 rounded-lg p-3`
- List items: `bg-white border border-gray-200 rounded-lg p-3`

### Titles
- All: `text-sm font-medium text-gray-700`
- With icon: Add `flex items-center`

### Buttons
- Primary: `px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700`
- Secondary: `text-indigo-600 hover:text-indigo-800 p-1 rounded hover:bg-indigo-50`
- Item action: `text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1`
- Pagination: `px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50`

### Spacing
- Sections: `space-y-6` (Details) or `space-y-4` (Docs/Convos)
- Items: `space-y-2`
- Title margin: `mb-2` or `mb-3`

---

## ABSOLUTE FILE PATH
```
/Users/redroostertechnologies/Desktop/lana-client/src/matters.html
```

