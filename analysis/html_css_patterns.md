# Matter Details View - HTML & CSS Patterns Reference

## TITLE POSITIONING PATTERNS

### Pattern 1: Title INSIDE Card (Most Common)
Used for: Description, Matter Information, Matter Profile Intelligence, Custom Fields

```html
<div class="bg-gray-50 rounded-lg p-4">
  <h5 class="text-sm font-medium text-gray-700 mb-2">Section Title</h5>
  <!-- Content here -->
</div>
```

**Line Examples:**
- Description: Lines 3009-3012
- Matter Information: Lines 3017-3045
- Custom Fields: Line 2775-2815
- Unassigned Documents: Lines 3368-3370

---

### Pattern 2: Title OUTSIDE Card + Header Row with Buttons
Used for: Shared With, Linked Matters

```html
<!-- Header outside container -->
<div class="flex items-center justify-between mb-3">
  <h5 class="text-sm font-medium text-gray-700">Section Title</h5>
  <button class="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700">
    Action Button
  </button>
</div>

<!-- Content container below -->
<div class="space-y-2">
  <!-- Items here -->
</div>
```

**Line Examples:**
- Shared With: Lines 3049-3079
- Linked Matters: Lines 7515-7541
- Custom Fields (variant): Lines 2776-2786


## CARD WRAPPER VARIATIONS

### Standard Info Card
```html
<div class="bg-gray-50 rounded-lg p-4">
  <h5 class="text-sm font-medium text-gray-700 mb-2">Title</h5>
  <p class="text-sm text-gray-600">Content</p>
</div>
```
- Classes: `bg-gray-50 rounded-lg p-4`
- Used for: Description, Matter Info, Custom Fields
- Line examples: 3009, 3017, 2775

### Gradient Card (Matter Profile)
```html
<div class="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-4">
  <h5 class="text-sm font-medium text-gray-700 flex items-center">
    <svg>...</svg>
    Matter Profile Intelligence
  </h5>
  <!-- Sub-sections -->
</div>
```
- Classes: `bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-4`
- Used for: Matter Profile Intelligence
- Line: 2920

### User/Item Card
```html
<div class="flex items-center justify-between bg-gray-50 rounded-lg p-3">
  <!-- Avatar -->
  <div class="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
    <span class="text-xs font-medium text-indigo-600">Initials</span>
  </div>
  <!-- Info -->
  <div>
    <p class="text-sm font-medium text-gray-900">Name</p>
    <p class="text-xs text-gray-500">email@example.com</p>
  </div>
  <!-- Action -->
  <button>Remove</button>
</div>
```
- Classes: `bg-gray-50 rounded-lg p-3`
- Used for: Shared With users, Document items, Conversation items
- Line examples: 3063, 3267, 4560

### Warning/Alert Card (Orphaned Files)
```html
<div class="bg-yellow-50 border border-yellow-200 hover:border-yellow-300 rounded-lg p-3">
  <!-- Content -->
</div>
```
- Classes: `bg-yellow-50 border border-yellow-200 rounded-lg p-3`
- Used for: Unassigned Documents section
- Line: 3376


## DEFINITION LIST PATTERN

```html
<dl class="space-y-2 text-sm">
  <div class="flex justify-between">
    <dt class="text-gray-500">Label</dt>
    <dd class="text-gray-900">Value</dd>
  </div>
  <!-- More items -->
</dl>
```

**Used for:**
- Matter Information (lines 3019-3044)
- Custom Fields (lines 2791-2812)

**Spacing:** `space-y-2` between items
**Label Color:** `text-gray-500`
**Value Color:** `text-gray-900`


## BUTTON PATTERNS

### Primary Action Button (Header Level)
```html
<button 
  onclick="openModal(...)"
  class="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
>
  <svg class="w-3 h-3 inline">...</svg>
  Button Text
</button>
```
- Classes: `px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700`
- Used for: New Chat, Create New Matter, Link Existing Matter
- Line examples: 4550, 7531, 7523

### Secondary Action Button (Icon Only)
```html
<button 
  onclick="editFields(...)"
  class="text-indigo-600 hover:text-indigo-800 p-1 rounded hover:bg-indigo-50 transition-colors"
  title="Edit"
>
  <svg class="w-4 h-4">...</svg>
</button>
```
- Classes: `text-indigo-600 hover:text-indigo-800 p-1 rounded hover:bg-indigo-50`
- Used for: Edit Custom Fields, Manage Share
- Line examples: 2780, 3053

### Item-Level Action Button (Text + Icon)
```html
<button 
  onclick="downloadDocument(...)"
  class="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
>
  <svg class="w-3.5 h-3.5">...</svg>
  Action Label
</button>
```
- Classes: `text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1`
- Used for: Download, View, Delete, Share on documents
- Line examples: 3508, 3400, 3404

### Pagination Button
```html
<button
  onclick="loadPage(...)"
  ${disabled ? 'disabled' : ''}
  class="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
>
  Previous / Next
</button>
```
- Classes: `px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50`
- Used for: Pagination controls in Conversations tab
- Line examples: 4589, 4599


## BADGE/TAG PATTERNS

### Source Badge (Document Source)
```html
<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded">
  <svg class="w-3 h-3">...</svg>
  From Workspace
</span>
```
- Workspace: `bg-purple-100 text-purple-700`
- Inherited/Shared: `bg-blue-100 text-blue-700`
- Line examples: 3282-3287, 3290-3295

### Status Badge (Document Processing)
```html
<!-- Referenced as [data-status-badge] -->
<!-- Populated by docStatusBadge(status) function -->
```
- Element: `<span data-status-badge>`
- Referenced at: Line 3487, 3298

### Count Badge (Documents/Conversations)
```html
<span class="text-xs text-gray-500 bg-yellow-50 px-2 py-1 rounded">
  5 files found in storage
</span>
```
- Classes: `text-xs bg-yellow-50 px-2 py-1 rounded`
- Line: 3371


## ICON BOXES

### Document Icon Box
```html
<div class="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
  ${getFileIcon(doc.content_type)}
</div>
```
- Size: 10x10 (w-10 h-10)
- Background: `bg-gray-100`
- Classes: `rounded-lg flex items-center justify-center flex-shrink-0`
- Line: 3269-3270

### Avatar Circle
```html
<div class="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
  <span class="text-xs font-medium text-indigo-600">Initials</span>
</div>
```
- Size: 8x8 (w-8 h-8)
- Shape: `rounded-full`
- Line: 3065-3066

### Conversation Icon
```html
<div class="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
  <svg class="w-5 h-5 text-white">...</svg>
</div>
```
- Size: 10x10 (w-10 h-10)
- Gradient: `bg-gradient-to-br from-indigo-500 to-purple-600`
- Icon Color: `text-white`
- Line: 4562-4565


## SPACING PATTERNS

### Section Spacing
- Between sections: `space-y-6` (Details tab) or `space-y-4` (other containers)
- Line: 3005, 3239, 4547

### Item Spacing
- List items: `space-y-2` (Documents, Conversations, Users)
- Line examples: 3265, 4558, 3061

### Internal Spacing
- Card padding: `p-4` or `p-3`
- Title bottom margin: `mb-2` or `mb-3`
- Item gaps: `gap-3` or `gap-4`


## RESPONSIVE & HOVER PATTERNS

### Item Hover Effect
```html
<div class="bg-white border border-gray-200 hover:border-indigo-300 rounded-lg p-3 transition-all group">
  <!-- Content -->
  <!-- Elements can use group-hover: -->
  <h6 class="text-sm font-semibold text-gray-900 group-hover:text-indigo-600">Title</h6>
  <svg class="transform group-hover:translate-x-1 transition-transform">...</svg>
</div>
```
- Classes: `hover:border-indigo-300 hover:shadow-sm transition-all group`
- Used for: Documents, Conversations
- Line examples: 3267, 4560

### Truncation Pattern
```html
<h6 class="text-sm font-medium text-gray-900 truncate" title="${fullName}">
  ${displayName}
</h6>
```
- Classes: `truncate` with `title` attribute for full text on hover
- Line examples: 3275, 3384, 4568

### Flexbox Layout for Lists
```html
<div class="flex items-start gap-3">
  <!-- Icon/Avatar -->
  <div class="w-10 h-10 flex-shrink-0">...</div>
  <!-- Content -->
  <div class="flex-1 min-w-0">
    <!-- Flex-1 for growth, min-w-0 to allow truncation -->
  </div>
  <!-- Actions (optional) -->
  <div class="flex-shrink-0">...</div>
</div>
```
- Line examples: 3268-3272, 4561-4576

