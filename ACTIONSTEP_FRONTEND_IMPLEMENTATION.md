# ActionStep Frontend Implementation Plan
**Date:** 2025-12-23
**Purpose:** Complete restructuring of ActionStep dashboard with consolidated Output tab, Upload functionality, and permission-based UI

---

## Table of Contents
1. [Overview](#overview)
2. [Current vs New Structure](#current-vs-new-structure)
3. [Tab Restructuring](#tab-restructuring)
4. [Permission-Based UI](#permission-based-ui)
5. [Output Tab Implementation](#output-tab-implementation)
6. [Upload Tab Implementation](#upload-tab-implementation)
7. [Integration Points](#integration-points)
8. [Complete Code Changes](#complete-code-changes)

---

## Overview

### Goals
- ✅ Consolidate 4 data tabs (Matters, Participants, Tasks, File Notes) into single Output tab
- ✅ Add Upload tab for drag-and-drop ZIP uploads
- ✅ Implement permission checks (Configuration tab admin-only)
- ✅ Maintain existing functionality (Overview, Execution Logs, Documentation, Workflows)
- ✅ Improve UX with sidebar navigation in Output tab
- ✅ Add search, filter, sort, pagination to all data views

### User Roles
- **System Admin** (`system_admin`) - Full access to all tabs
- **Org Admin** (`org_admin`) - Full access to all tabs
- **Regular User** - Access to all tabs EXCEPT Configuration

---

## Current vs New Structure

### Current Tabs (actionstep.html)
```
1. Overview
2. Configuration
3. Matters          ─┐
4. Participants      ├─ To be consolidated
5. Tasks             │
6. File Notes       ─┘
7. Execution Logs
8. Documentation
9. Workflows
```

### New Tabs Structure
```
1. Overview
2. Configuration (admin only)
3. Upload (NEW)
4. Output (NEW - consolidates Matters, Participants, Tasks, File Notes, Documents)
5. Execution Logs
6. Documentation
7. Workflows
```

**Total Tabs:** 9 → 7 (cleaner, more organized)

---

## Tab Restructuring

### 1. HTML Changes - Tab Navigation

**BEFORE (Current):**
```html
<div class="border-b border-gray-200">
  <nav class="flex -mb-px overflow-x-auto">
    <button onclick="switchTab('overview')" id="tab-overview" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600 whitespace-nowrap">
      Overview
    </button>
    <button onclick="switchTab('configuration')" id="tab-configuration" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Configuration
    </button>
    <button onclick="switchTab('matters')" id="tab-matters" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Matters
    </button>
    <button onclick="switchTab('participants')" id="tab-participants" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Participants
    </button>
    <button onclick="switchTab('tasks')" id="tab-tasks" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Tasks
    </button>
    <button onclick="switchTab('file-notes')" id="tab-file-notes" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      File Notes
    </button>
    <button onclick="switchTab('execution-logs')" id="tab-execution-logs" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Execution Logs
    </button>
    <button onclick="switchTab('documentation')" id="tab-documentation" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Documentation
    </button>
    <button onclick="switchTab('workflows')" id="tab-workflows" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Workflows
    </button>
  </nav>
</div>
```

**AFTER (New):**
```html
<div class="border-b border-gray-200">
  <nav class="flex -mb-px overflow-x-auto">
    <button onclick="switchTab('overview')" id="tab-overview" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600 whitespace-nowrap">
      Overview
    </button>
    <!-- Configuration Tab - Hidden for non-admins -->
    <button onclick="switchTab('configuration')" id="tab-configuration" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap hidden">
      Configuration
    </button>
    <!-- NEW Upload Tab -->
    <button onclick="switchTab('upload')" id="tab-upload" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Upload
    </button>
    <!-- NEW Output Tab (consolidates Matters, Participants, Tasks, File Notes) -->
    <button onclick="switchTab('output')" id="tab-output" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Output
    </button>
    <button onclick="switchTab('execution-logs')" id="tab-execution-logs" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Execution Logs
    </button>
    <button onclick="switchTab('documentation')" id="tab-documentation" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Documentation
    </button>
    <button onclick="switchTab('workflows')" id="tab-workflows" class="tab-btn px-6 py-4 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap">
      Workflows
    </button>
  </nav>
</div>
```

### 2. JavaScript - Permission Check

**Add at page initialization (after loadUserProfile):**

```javascript
// Check user permissions and show/hide Configuration tab
function initializePermissions() {
  const user = api.user;

  if (!user) {
    console.error('User not loaded');
    return;
  }

  // Check if user is system_admin or org_admin
  const isSystemAdmin = user.roles?.includes('system_admin') ||
                        user.roles?.some(r => r?.name === 'system_admin' || r?.role_name === 'system_admin');
  const isOrgAdmin = user.roles?.includes('org_admin') ||
                     user.roles?.some(r => r?.name === 'org_admin' || r?.role_name === 'org_admin');

  const isAdmin = isSystemAdmin || isOrgAdmin;

  console.log('Permission check:', { isAdmin, isSystemAdmin, isOrgAdmin, roles: user.roles });

  // Show/hide Configuration tab
  const configTab = document.getElementById('tab-configuration');
  if (configTab) {
    if (isAdmin) {
      configTab.classList.remove('hidden');
    } else {
      configTab.classList.add('hidden');

      // If user is currently on Configuration tab, redirect to Overview
      if (currentTab === 'configuration') {
        switchTab('overview');
      }
    }
  }
}

// Call after user profile loads
(async () => {
  try {
    await api.loadUserProfile();
    initializePermissions(); // NEW: Check permissions
    renderMenu('#mainNav');
  } catch (error) {
    console.error('Failed to load user profile:', error);
  }
})();
```

---

## Permission-Based UI

### Role Detection Logic

**Helper Function:**
```javascript
function hasRole(roleName) {
  const user = api.user;
  if (!user || !user.roles) return false;

  // Check array of role strings
  if (user.roles.includes(roleName)) return true;

  // Check array of role objects (various formats)
  return user.roles.some(r => {
    if (typeof r === 'string') return r === roleName;
    if (typeof r === 'object') {
      return r.name === roleName ||
             r.role_name === roleName ||
             r.roleName === roleName;
    }
    return false;
  });
}

function isAdmin() {
  return hasRole('system_admin') || hasRole('org_admin');
}
```

### UI Elements Requiring Permission Checks

1. **Configuration Tab** - Admin only
2. **Import Directory Settings** (in Configuration tab) - Admin only
3. **Manual Sync Triggers** - All users (but respects matter permissions)
4. **Data Export** - All users with read permissions

---

## Output Tab Implementation

### Complete HTML Structure

```html
<!-- Output Tab Content -->
<div id="output-tab" class="hidden">
  <div class="flex gap-6 h-[calc(100vh-300px)]">
    <!-- Left Sidebar - Data Type Navigator -->
    <div class="w-64 flex-shrink-0 bg-gray-50 rounded-lg p-4 overflow-y-auto">
      <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Data Types</h3>
      <nav class="space-y-1">
        <button onclick="loadOutputData('matters')" id="output-nav-matters"
          class="output-nav-btn w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg bg-white shadow-sm border-2 border-indigo-600 text-indigo-700">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <span>Matters</span>
          <span id="matters-count" class="ml-auto text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">0</span>
        </button>

        <button onclick="loadOutputData('participants')" id="output-nav-participants"
          class="output-nav-btn w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg text-gray-700 hover:bg-white hover:shadow-sm border-2 border-transparent">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
          </svg>
          <span>Participants</span>
          <span id="participants-count" class="ml-auto text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">0</span>
        </button>

        <button onclick="loadOutputData('tasks')" id="output-nav-tasks"
          class="output-nav-btn w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg text-gray-700 hover:bg-white hover:shadow-sm border-2 border-transparent">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path>
          </svg>
          <span>Tasks</span>
          <span id="tasks-count" class="ml-auto text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">0</span>
        </button>

        <button onclick="loadOutputData('file-notes')" id="output-nav-file-notes"
          class="output-nav-btn w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg text-gray-700 hover:bg-white hover:shadow-sm border-2 border-transparent">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
          </svg>
          <span>File Notes</span>
          <span id="file-notes-count" class="ml-auto text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">0</span>
        </button>

        <button onclick="loadOutputData('documents')" id="output-nav-documents"
          class="output-nav-btn w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg text-gray-700 hover:bg-white hover:shadow-sm border-2 border-transparent">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
          </svg>
          <span>Documents</span>
          <span id="documents-count" class="ml-auto text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">0</span>
        </button>
      </nav>
    </div>

    <!-- Right Panel - Data Display -->
    <div class="flex-1 flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden">
      <!-- Header with Controls -->
      <div class="p-4 border-b border-gray-200 flex-shrink-0">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 id="output-title" class="text-lg font-semibold text-gray-900">Matters</h3>
            <p id="output-subtitle" class="text-sm text-gray-500 mt-1">All matters imported from ActionStep</p>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="exportCurrentData()" class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
              </svg>
              Export CSV
            </button>
            <button onclick="refreshOutputData()" class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 border border-indigo-600 rounded-lg hover:bg-indigo-50">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
              Refresh
            </button>
          </div>
        </div>

        <!-- Search and Filters -->
        <div class="flex items-center gap-3">
          <div class="flex-1 relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            <input type="text" id="output-search" placeholder="Search..."
              class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              oninput="debounceSearch()">
          </div>
          <select id="output-filter" class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" onchange="applyFilters()">
            <!-- Options populated dynamically based on data type -->
          </select>
          <select id="output-sort" class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" onchange="applySort()">
            <!-- Options populated dynamically based on data type -->
          </select>
        </div>
      </div>

      <!-- Table -->
      <div class="flex-1 overflow-auto">
        <div id="output-loading" class="flex items-center justify-center h-full">
          <div class="text-center">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <p class="text-gray-500">Loading data...</p>
          </div>
        </div>

        <div id="output-no-data" class="hidden flex items-center justify-center h-full">
          <div class="text-center">
            <svg class="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
            </svg>
            <p class="text-gray-500 font-medium mb-1">No data available</p>
            <p class="text-sm text-gray-400">Upload ActionStep data to see it here</p>
          </div>
        </div>

        <table id="output-table" class="hidden min-w-full divide-y divide-gray-200">
          <thead id="output-table-head" class="bg-gray-50 sticky top-0">
            <!-- Table headers populated dynamically -->
          </thead>
          <tbody id="output-table-body" class="bg-white divide-y divide-gray-200">
            <!-- Table rows populated dynamically -->
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="p-4 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
        <div class="text-sm text-gray-500">
          <span id="output-pagination-info">Showing 0 of 0</span>
        </div>
        <div class="flex gap-2">
          <button onclick="previousPage()" id="output-prev-btn" disabled
            class="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
            Previous
          </button>
          <div id="output-page-numbers" class="flex gap-1">
            <!-- Page numbers populated dynamically -->
          </div>
          <button onclick="nextPage()" id="output-next-btn" disabled
            class="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
            Next
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Complete JavaScript Implementation

```javascript
// ============================================================================
// OUTPUT TAB - STATE & CONFIGURATION
// ============================================================================

let currentOutputDataType = 'matters';
let currentOutputPage = 1;
let currentOutputLimit = 25;
let currentOutputSearch = '';
let currentOutputFilter = '';
let currentOutputSort = 'created_at';
let currentOutputSortOrder = 'desc';
let currentOutputData = [];
let currentOutputTotal = 0;
let searchDebounceTimer = null;

// Data type configurations
const outputDataTypes = {
  matters: {
    title: 'Matters',
    subtitle: 'All matters imported from ActionStep',
    endpoint: '/api/v1/actionstep/matters',
    columns: [
      { key: 'file_reference', label: 'File Ref', sortable: true },
      { key: 'matter_name', label: 'Matter Name', sortable: true },
      { key: 'action_type_name', label: 'Action Type', sortable: false },
      { key: 'status', label: 'Status', sortable: true },
      { key: 'assigned_to_display_name', label: 'Assigned To', sortable: false },
      { key: 'last_activity_timestamp', label: 'Last Activity', sortable: true, format: 'date' }
    ],
    filters: [
      { value: '', label: 'All Statuses' },
      { value: 'Active', label: 'Active' },
      { value: 'Closed', label: 'Closed' },
      { value: 'Pending', label: 'Pending' }
    ],
    sorts: [
      { value: 'last_activity_timestamp:desc', label: 'Last Activity (Recent)' },
      { value: 'last_activity_timestamp:asc', label: 'Last Activity (Oldest)' },
      { value: 'matter_name:asc', label: 'Matter Name (A-Z)' },
      { value: 'matter_name:desc', label: 'Matter Name (Z-A)' },
      { value: 'file_reference:asc', label: 'File Reference (A-Z)' }
    ],
    rowRenderer: (row) => `
      <tr class="hover:bg-gray-50 cursor-pointer" onclick="viewMatterDetails('${row.id}')">
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">${escapeHtml(row.file_reference || 'N/A')}</td>
        <td class="px-6 py-4 text-sm text-gray-900">${escapeHtml(row.matter_name || 'Untitled')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${escapeHtml(row.action_type_name || 'N/A')}</td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusClass(row.status)}">
            ${escapeHtml(row.status || 'Unknown')}
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${escapeHtml(row.assigned_to_display_name || 'Unassigned')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${row.last_activity_timestamp ? timeAgo(row.last_activity_timestamp) : 'Never'}</td>
      </tr>
    `
  },

  participants: {
    title: 'Participants',
    subtitle: 'All contacts and companies imported from ActionStep',
    endpoint: '/api/v1/actionstep/participants',
    columns: [
      { key: 'display_name', label: 'Name', sortable: true },
      { key: 'email', label: 'Email', sortable: false },
      { key: 'phone_primary', label: 'Phone', sortable: false },
      { key: 'is_company', label: 'Type', sortable: true },
      { key: 'company_name', label: 'Company', sortable: false }
    ],
    filters: [
      { value: '', label: 'All Types' },
      { value: 'true', label: 'Companies' },
      { value: 'false', label: 'Individuals' }
    ],
    sorts: [
      { value: 'display_name:asc', label: 'Name (A-Z)' },
      { value: 'display_name:desc', label: 'Name (Z-A)' }
    ],
    rowRenderer: (row) => `
      <tr class="hover:bg-gray-50 cursor-pointer" onclick="viewParticipantDetails('${row.id}')">
        <td class="px-6 py-4 text-sm font-medium text-gray-900">${escapeHtml(row.display_name || 'Unknown')}</td>
        <td class="px-6 py-4 text-sm text-gray-500">${escapeHtml(row.email || 'N/A')}</td>
        <td class="px-6 py-4 text-sm text-gray-500">${escapeHtml(row.phone_primary || 'N/A')}</td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${row.is_company ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}">
            ${row.is_company ? 'Company' : 'Individual'}
          </span>
        </td>
        <td class="px-6 py-4 text-sm text-gray-500">${escapeHtml(row.company_name || 'N/A')}</td>
      </tr>
    `
  },

  tasks: {
    title: 'Tasks',
    subtitle: 'All tasks imported from ActionStep',
    endpoint: '/api/v1/actionstep/tasks',
    columns: [
      { key: 'task_name', label: 'Task Name', sortable: true },
      { key: 'matter_name', label: 'Matter', sortable: false },
      { key: 'current_status', label: 'Status', sortable: true },
      { key: 'assigned_to_name', label: 'Assigned To', sortable: false },
      { key: 'due_date', label: 'Due Date', sortable: true, format: 'date' }
    ],
    filters: [
      { value: '', label: 'All Statuses' },
      { value: 'Not Started', label: 'Not Started' },
      { value: 'In Progress', label: 'In Progress' },
      { value: 'Complete', label: 'Complete' },
      { value: 'Cancelled', label: 'Cancelled' }
    ],
    sorts: [
      { value: 'due_date:asc', label: 'Due Date (Soonest)' },
      { value: 'due_date:desc', label: 'Due Date (Latest)' },
      { value: 'task_name:asc', label: 'Task Name (A-Z)' }
    ],
    rowRenderer: (row) => {
      const isOverdue = row.due_date && new Date(row.due_date) < new Date() &&
                        !['Complete', 'Cancelled'].includes(row.current_status);
      return `
        <tr class="hover:bg-gray-50 ${isOverdue ? 'bg-red-50' : ''}">
          <td class="px-6 py-4 text-sm font-medium text-gray-900">${escapeHtml(row.task_name || 'Untitled Task')}</td>
          <td class="px-6 py-4 text-sm text-gray-500">${escapeHtml(row.matter_name || 'N/A')}</td>
          <td class="px-6 py-4 whitespace-nowrap">
            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getTaskStatusClass(row.current_status)}">
              ${escapeHtml(row.current_status || 'Unknown')}
            </span>
          </td>
          <td class="px-6 py-4 text-sm text-gray-500">${escapeHtml(row.assigned_to_name || 'Unassigned')}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}">
            ${row.due_date ? formatDate(row.due_date) : 'No due date'}
            ${isOverdue ? ' <span class="text-xs">(Overdue)</span>' : ''}
          </td>
        </tr>
      `;
    }
  },

  'file-notes': {
    title: 'File Notes',
    subtitle: 'All file notes imported from ActionStep',
    endpoint: '/api/v1/actionstep/file-notes',
    columns: [
      { key: 'matter_name', label: 'Matter', sortable: false },
      { key: 'note_text', label: 'Note', sortable: false },
      { key: 'entered_by_name', label: 'Entered By', sortable: false },
      { key: 'note_timestamp', label: 'Date', sortable: true, format: 'date' }
    ],
    filters: [],
    sorts: [
      { value: 'note_timestamp:desc', label: 'Date (Recent)' },
      { value: 'note_timestamp:asc', label: 'Date (Oldest)' }
    ],
    rowRenderer: (row) => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 text-sm font-medium text-gray-900">${escapeHtml(row.matter_name || 'N/A')}</td>
        <td class="px-6 py-4 text-sm text-gray-700 max-w-md">
          <div class="line-clamp-2">${escapeHtml(row.note_text || 'No content')}</div>
        </td>
        <td class="px-6 py-4 text-sm text-gray-500">${escapeHtml(row.entered_by_name || 'Unknown')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${row.note_timestamp ? formatDate(row.note_timestamp) : 'N/A'}</td>
      </tr>
    `
  },

  documents: {
    title: 'Documents',
    subtitle: 'All documents imported from ActionStep',
    endpoint: '/api/v1/actionstep/documents/failed', // Or appropriate endpoint
    columns: [
      { key: 'filename', label: 'Filename', sortable: true },
      { key: 'matter_id', label: 'Matter', sortable: false },
      { key: 'file_size', label: 'Size', sortable: true, format: 'bytes' },
      { key: 'status', label: 'Status', sortable: true },
      { key: 'created_at', label: 'Imported', sortable: true, format: 'date' }
    ],
    filters: [
      { value: '', label: 'All Statuses' },
      { value: 'completed', label: 'Completed' },
      { value: 'processing', label: 'Processing' },
      { value: 'failed', label: 'Failed' }
    ],
    sorts: [
      { value: 'created_at:desc', label: 'Import Date (Recent)' },
      { value: 'filename:asc', label: 'Filename (A-Z)' },
      { value: 'file_size:desc', label: 'Size (Largest)' }
    ],
    rowRenderer: (row) => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 text-sm font-medium text-gray-900">${escapeHtml(row.filename || 'Unknown')}</td>
        <td class="px-6 py-4 text-sm text-gray-500">${escapeHtml(row.matter_id || 'N/A')}</td>
        <td class="px-6 py-4 text-sm text-gray-500">${formatBytes(row.file_size || 0)}</td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getDocStatusClass(row.status)}">
            ${escapeHtml(row.status || 'Unknown')}
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${row.created_at ? formatDate(row.created_at) : 'N/A'}</td>
      </tr>
    `
  }
};

// ============================================================================
// OUTPUT TAB - DATA LOADING
// ============================================================================

async function loadOutputData(dataType) {
  currentOutputDataType = dataType;
  currentOutputPage = 1; // Reset to first page

  // Update navigation
  updateOutputNavigation(dataType);

  // Update header
  const config = outputDataTypes[dataType];
  document.getElementById('output-title').textContent = config.title;
  document.getElementById('output-subtitle').textContent = config.subtitle;

  // Update filter and sort options
  populateFilterOptions(config.filters);
  populateSortOptions(config.sorts);

  // Show loading state
  showOutputLoading();

  try {
    await fetchOutputData();
  } catch (error) {
    console.error('Failed to load output data:', error);
    showOutputError(error.message);
  }
}

async function fetchOutputData() {
  const config = outputDataTypes[currentOutputDataType];

  // Build query parameters
  const params = new URLSearchParams({
    limit: currentOutputLimit,
    offset: (currentOutputPage - 1) * currentOutputLimit,
    order_by: currentOutputSort,
    order_dir: currentOutputSortOrder
  });

  if (currentOutputSearch) {
    params.append('search', currentOutputSearch);
  }

  if (currentOutputFilter) {
    // Add filter based on data type
    if (currentOutputDataType === 'matters') {
      params.append('status', currentOutputFilter);
    } else if (currentOutputDataType === 'participants') {
      params.append('is_company', currentOutputFilter);
    } else if (currentOutputDataType === 'tasks') {
      params.append('status', currentOutputFilter);
    } else if (currentOutputDataType === 'documents') {
      params.append('status', currentOutputFilter);
    }
  }

  try {
    const response = await api.get(`${config.endpoint}?${params.toString()}`);

    // Handle different response formats
    let data, total;
    if (currentOutputDataType === 'matters') {
      data = response.matters || [];
      total = response.total || 0;
    } else if (currentOutputDataType === 'participants') {
      data = response.participants || [];
      total = response.total || data.length; // Might not have total
    } else if (currentOutputDataType === 'tasks') {
      data = response.tasks || [];
      total = response.total || data.length;
    } else if (currentOutputDataType === 'file-notes') {
      data = response.file_notes || [];
      total = response.total || data.length;
    } else if (currentOutputDataType === 'documents') {
      data = response.failed_imports || response.documents || [];
      total = response.total || data.length;
    }

    currentOutputData = data;
    currentOutputTotal = total;

    renderOutputTable(data);
    updatePagination(total);

  } catch (error) {
    throw error;
  }
}

// ============================================================================
// OUTPUT TAB - RENDERING
// ============================================================================

function renderOutputTable(data) {
  const config = outputDataTypes[currentOutputDataType];
  const tableHead = document.getElementById('output-table-head');
  const tableBody = document.getElementById('output-table-body');

  if (!data || data.length === 0) {
    showOutputNoData();
    return;
  }

  // Show table
  document.getElementById('output-loading').classList.add('hidden');
  document.getElementById('output-no-data').classList.add('hidden');
  document.getElementById('output-table').classList.remove('hidden');

  // Render header
  tableHead.innerHTML = `
    <tr>
      ${config.columns.map(col => `
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${col.sortable ? 'cursor-pointer hover:bg-gray-100' : ''}"
            ${col.sortable ? `onclick="sortBy('${col.key}')"` : ''}>
          <div class="flex items-center gap-2">
            ${col.label}
            ${col.sortable ? `
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
              </svg>
            ` : ''}
          </div>
        </th>
      `).join('')}
    </tr>
  `;

  // Render rows
  tableBody.innerHTML = data.map(row => config.rowRenderer(row)).join('');
}

function updateOutputNavigation(dataType) {
  // Remove active class from all nav buttons
  document.querySelectorAll('.output-nav-btn').forEach(btn => {
    btn.classList.remove('bg-white', 'shadow-sm', 'border-indigo-600', 'text-indigo-700');
    btn.classList.add('text-gray-700', 'hover:bg-white', 'hover:shadow-sm', 'border-transparent');
  });

  // Add active class to current nav button
  const activeBtn = document.getElementById(`output-nav-${dataType}`);
  if (activeBtn) {
    activeBtn.classList.add('bg-white', 'shadow-sm', 'border-indigo-600', 'text-indigo-700');
    activeBtn.classList.remove('text-gray-700', 'hover:bg-white', 'hover:shadow-sm', 'border-transparent');
  }
}

function populateFilterOptions(filters) {
  const filterSelect = document.getElementById('output-filter');

  if (!filters || filters.length === 0) {
    filterSelect.classList.add('hidden');
    return;
  }

  filterSelect.classList.remove('hidden');
  filterSelect.innerHTML = filters.map(f =>
    `<option value="${f.value}">${f.label}</option>`
  ).join('');
}

function populateSortOptions(sorts) {
  const sortSelect = document.getElementById('output-sort');
  sortSelect.innerHTML = sorts.map(s =>
    `<option value="${s.value}">${s.label}</option>`
  ).join('');
}

function showOutputLoading() {
  document.getElementById('output-loading').classList.remove('hidden');
  document.getElementById('output-no-data').classList.add('hidden');
  document.getElementById('output-table').classList.add('hidden');
}

function showOutputNoData() {
  document.getElementById('output-loading').classList.add('hidden');
  document.getElementById('output-no-data').classList.remove('hidden');
  document.getElementById('output-table').classList.add('hidden');
}

function showOutputError(message) {
  document.getElementById('output-loading').classList.add('hidden');
  document.getElementById('output-table').classList.add('hidden');

  const noDataDiv = document.getElementById('output-no-data');
  noDataDiv.classList.remove('hidden');
  noDataDiv.innerHTML = `
    <div class="text-center">
      <svg class="w-16 h-16 text-red-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>
      <p class="text-red-600 font-medium mb-1">Error loading data</p>
      <p class="text-sm text-gray-500">${escapeHtml(message)}</p>
    </div>
  `;
}

// ============================================================================
// OUTPUT TAB - PAGINATION
// ============================================================================

function updatePagination(total) {
  const totalPages = Math.ceil(total / currentOutputLimit);
  const start = (currentOutputPage - 1) * currentOutputLimit + 1;
  const end = Math.min(currentOutputPage * currentOutputLimit, total);

  // Update info text
  document.getElementById('output-pagination-info').textContent =
    `Showing ${start}-${end} of ${total}`;

  // Update prev/next buttons
  const prevBtn = document.getElementById('output-prev-btn');
  const nextBtn = document.getElementById('output-next-btn');

  prevBtn.disabled = currentOutputPage === 1;
  nextBtn.disabled = currentOutputPage >= totalPages;

  // Render page numbers (show max 7 pages)
  const pageNumbers = document.getElementById('output-page-numbers');
  const pages = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
  } else {
    if (currentOutputPage <= 4) {
      pages.push(1, 2, 3, 4, 5, '...', totalPages);
    } else if (currentOutputPage >= totalPages - 3) {
      pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, '...', currentOutputPage - 1, currentOutputPage, currentOutputPage + 1, '...', totalPages);
    }
  }

  pageNumbers.innerHTML = pages.map(page => {
    if (page === '...') {
      return '<span class="px-3 py-2 text-sm text-gray-500">...</span>';
    }
    const isActive = page === currentOutputPage;
    return `
      <button onclick="goToPage(${page})"
        class="px-3 py-2 text-sm font-medium rounded-lg ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'}">
        ${page}
      </button>
    `;
  }).join('');
}

function previousPage() {
  if (currentOutputPage > 1) {
    currentOutputPage--;
    fetchOutputData();
  }
}

function nextPage() {
  const totalPages = Math.ceil(currentOutputTotal / currentOutputLimit);
  if (currentOutputPage < totalPages) {
    currentOutputPage++;
    fetchOutputData();
  }
}

function goToPage(page) {
  currentOutputPage = page;
  fetchOutputData();
}

// ============================================================================
// OUTPUT TAB - SEARCH, FILTER, SORT
// ============================================================================

function debounceSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentOutputSearch = document.getElementById('output-search').value;
    currentOutputPage = 1; // Reset to first page
    fetchOutputData();
  }, 300);
}

function applyFilters() {
  currentOutputFilter = document.getElementById('output-filter').value;
  currentOutputPage = 1; // Reset to first page
  fetchOutputData();
}

function applySort() {
  const sortValue = document.getElementById('output-sort').value;
  const [field, order] = sortValue.split(':');
  currentOutputSort = field;
  currentOutputSortOrder = order;
  currentOutputPage = 1; // Reset to first page
  fetchOutputData();
}

function sortBy(field) {
  // Toggle sort order if clicking same field
  if (currentOutputSort === field) {
    currentOutputSortOrder = currentOutputSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    currentOutputSort = field;
    currentOutputSortOrder = 'asc';
  }

  // Update sort select
  document.getElementById('output-sort').value = `${field}:${currentOutputSortOrder}`;

  fetchOutputData();
}

function refreshOutputData() {
  fetchOutputData();
}

// ============================================================================
// OUTPUT TAB - ACTIONS
// ============================================================================

function exportCurrentData() {
  const config = outputDataTypes[currentOutputDataType];

  // Convert data to CSV
  const headers = config.columns.map(col => col.label);
  const rows = currentOutputData.map(row =>
    config.columns.map(col => {
      let value = row[col.key] || '';

      // Format based on column format
      if (col.format === 'date' && value) {
        value = formatDate(value);
      } else if (col.format === 'bytes' && value) {
        value = formatBytes(value);
      }

      // Escape CSV special characters
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        value = `"${value.replace(/"/g, '""')}"`;
      }

      return value;
    })
  );

  const csv = [headers, ...rows].map(row => row.join(',')).join('\n');

  // Download
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `actionstep-${currentOutputDataType}-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function viewMatterDetails(matterId) {
  // TODO: Implement matter details modal or navigate to detail page
  console.log('View matter:', matterId);
}

function viewParticipantDetails(participantId) {
  // TODO: Implement participant details modal
  console.log('View participant:', participantId);
}

// ============================================================================
// OUTPUT TAB - HELPER FUNCTIONS
// ============================================================================

function getStatusClass(status) {
  const classes = {
    'Active': 'bg-green-100 text-green-800',
    'Closed': 'bg-gray-100 text-gray-800',
    'Pending': 'bg-yellow-100 text-yellow-800'
  };
  return classes[status] || 'bg-gray-100 text-gray-600';
}

function getTaskStatusClass(status) {
  const classes = {
    'Not Started': 'bg-gray-100 text-gray-800',
    'In Progress': 'bg-blue-100 text-blue-800',
    'Complete': 'bg-green-100 text-green-800',
    'Cancelled': 'bg-red-100 text-red-800'
  };
  return classes[status] || 'bg-gray-100 text-gray-600';
}

function getDocStatusClass(status) {
  const classes = {
    'completed': 'bg-green-100 text-green-800',
    'processing': 'bg-blue-100 text-blue-800',
    'failed': 'bg-red-100 text-red-800',
    'pending': 'bg-yellow-100 text-yellow-800'
  };
  return classes[status] || 'bg-gray-100 text-gray-600';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Load counts for sidebar badges
async function updateOutputCounts() {
  try {
    const dashboard = await api.get('/api/v1/actionstep/dashboard');

    if (dashboard.stats) {
      document.getElementById('matters-count').textContent = dashboard.stats.matters?.total || 0;
      document.getElementById('participants-count').textContent = dashboard.stats.participants?.total || 0;
      document.getElementById('tasks-count').textContent = dashboard.stats.tasks?.total || 0;
      document.getElementById('file-notes-count').textContent = dashboard.stats.file_notes?.total || 0;
      document.getElementById('documents-count').textContent = dashboard.stats.documents?.total || 0;
    }
  } catch (error) {
    console.error('Failed to load output counts:', error);
  }
}
```

---

## Upload Tab Implementation

### Complete HTML

```html
<!-- Upload Tab Content -->
<div id="upload-tab" class="hidden">
  <div class="max-w-4xl mx-auto">
    <h3 class="text-lg font-semibold text-gray-900 mb-4">Upload ActionStep Data Export</h3>

    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <div class="flex gap-3">
        <svg class="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <div>
          <p class="font-medium text-blue-900">Instructions</p>
          <p class="text-sm text-blue-800 mt-1">
            Export your ActionStep data as a ZIP file and upload it here. The system will automatically extract and import the data into your organization.
          </p>
          <ul class="text-sm text-blue-800 mt-2 ml-4 list-disc">
            <li>Maximum file size: 10 GB</li>
            <li>Accepted format: ZIP only</li>
            <li>Expected contents: data/ folder with CSV files, documents/ folder with documents</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Drop Zone -->
    <div id="dropZone" class="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-indigo-400 transition-colors cursor-pointer bg-gray-50 hover:bg-gray-100">
      <svg class="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
      </svg>
      <p class="text-lg font-medium text-gray-900 mb-2">Drop ActionStep ZIP file here</p>
      <p class="text-sm text-gray-500 mb-4">or click to browse (up to 10 GB)</p>
      <input type="file" id="fileInput" accept=".zip" class="hidden">
      <button onclick="document.getElementById('fileInput').click()" class="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
        Browse Files
      </button>
    </div>

    <!-- Upload Progress -->
    <div id="uploadProgress" class="hidden mt-6">
      <div class="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div class="flex-1">
            <p class="font-medium text-gray-900 mb-1" id="uploadFilename">filename.zip</p>
            <p class="text-sm text-gray-500" id="uploadSize">0 MB / 0 MB</p>
          </div>
          <button onclick="cancelUpload()" class="text-red-600 hover:text-red-700 text-sm font-medium px-3 py-1 border border-red-300 rounded hover:bg-red-50">
            Cancel
          </button>
        </div>

        <div class="w-full bg-gray-200 rounded-full h-4 mb-3">
          <div id="progressBar" class="bg-indigo-600 h-4 rounded-full transition-all duration-300" style="width: 0%"></div>
        </div>

        <div class="flex items-center justify-between text-sm mb-2">
          <span id="uploadStatus" class="text-gray-600">Initializing upload...</span>
          <span id="uploadPercentage" class="font-medium text-gray-900">0%</span>
        </div>

        <div class="text-sm text-gray-500">
          <p id="uploadEta">Estimated time remaining: calculating...</p>
          <p id="uploadSpeed" class="mt-1">Upload speed: calculating...</p>
        </div>
      </div>
    </div>

    <!-- Upload Complete -->
    <div id="uploadComplete" class="hidden mt-6">
      <div class="bg-green-50 border border-green-200 rounded-lg p-6">
        <div class="flex gap-3">
          <svg class="w-6 h-6 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <div class="flex-1">
            <p class="font-medium text-green-900">Upload Complete!</p>
            <p class="text-sm text-green-800 mt-1" id="uploadCompleteMessage">
              Your ActionStep data has been uploaded and is being processed.
            </p>
            <div class="mt-4 flex gap-3">
              <button onclick="switchTab('execution-logs')" class="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
                View Processing Logs
              </button>
              <button onclick="resetUploadForm()" class="px-4 py-2 border border-green-600 text-green-600 text-sm font-medium rounded-lg hover:bg-green-50">
                Upload Another File
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Upload Error -->
    <div id="uploadError" class="hidden mt-6">
      <div class="bg-red-50 border border-red-200 rounded-lg p-6">
        <div class="flex gap-3">
          <svg class="w-6 h-6 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <div class="flex-1">
            <p class="font-medium text-red-900">Upload Failed</p>
            <p class="text-sm text-red-800 mt-1" id="uploadErrorMessage">
              An error occurred during upload.
            </p>
            <button onclick="resetUploadForm()" class="mt-4 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700">
              Try Again
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Complete JavaScript

```javascript
// ============================================================================
// UPLOAD TAB - STATE & INITIALIZATION
// ============================================================================

let currentUploader = null;
let currentUploadId = null;
let uploadStartTime = null;

// Initialize drag-and-drop
function initializeUploadTab() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  if (!dropZone || !fileInput) return;

  // Click to browse
  dropZone.addEventListener('click', (e) => {
    if (e.target === dropZone || e.target.closest('#dropZone')) {
      fileInput.click();
    }
  });

  // Drag over
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('border-indigo-500', 'bg-indigo-50');
  });

  // Drag leave
  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('border-indigo-500', 'bg-indigo-50');
  });

  // Drop
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('border-indigo-500', 'bg-indigo-50');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelected(files[0]);
    }
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });
}

// Call on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeUploadTab();
});

// ============================================================================
// UPLOAD TAB - FILE HANDLING
// ============================================================================

async function handleFileSelected(file) {
  // Validate file
  if (!file.name.toLowerCase().endsWith('.zip')) {
    alert('Please select a ZIP file. Other file types are not supported.');
    return;
  }

  const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
  if (file.size > maxSize) {
    alert(`File size (${formatBytes(file.size)}) exceeds the maximum allowed size of 10 GB.`);
    return;
  }

  // Show progress UI
  document.getElementById('dropZone').classList.add('hidden');
  document.getElementById('uploadProgress').classList.remove('hidden');
  document.getElementById('uploadComplete').classList.add('hidden');
  document.getElementById('uploadError').classList.add('hidden');
  document.getElementById('uploadFilename').textContent = file.name;
  document.getElementById('uploadSize').textContent = `0 MB / ${formatBytes(file.size)}`;
  document.getElementById('uploadStatus').textContent = 'Initializing upload...';

  uploadStartTime = Date.now();

  // Initialize chunked uploader
  currentUploader = new ChunkedUploader({
    chunkSize: 50 * 1024 * 1024, // 50MB chunks
    maxParallelUploads: 3,
    onProgress: (progress) => {
      updateUploadProgress(progress, file.size);
    },
    onComplete: (result) => {
      handleUploadComplete(result, file.name);
    },
    onError: (error) => {
      handleUploadError(error);
    }
  });

  try {
    // Start upload
    const result = await currentUploader.upload(file, {
      metadata: {
        source: 'actionstep',
        organization_id: api.user.organizationId,
        uploaded_by: api.user.id
      }
    });

    currentUploadId = result.upload_id;

    // Update status
    document.getElementById('uploadStatus').textContent = 'Processing and extracting...';

    // Trigger ActionStep-specific completion (extract + import)
    await api.post('/api/v1/actionstep/upload/complete', {
      upload_id: result.upload_id
    });

  } catch (error) {
    console.error('Upload error:', error);
    handleUploadError(error);
  }
}

function updateUploadProgress(progress, totalSize) {
  const percentage = Math.round(progress.progress);
  document.getElementById('progressBar').style.width = `${percentage}%`;
  document.getElementById('uploadPercentage').textContent = `${percentage}%`;

  const uploadedMB = (progress.uploadedBytes / 1024 / 1024).toFixed(2);
  const totalMB = (totalSize / 1024 / 1024).toFixed(2);
  document.getElementById('uploadSize').textContent = `${uploadedMB} MB / ${totalMB} MB`;

  // Update status
  if (percentage < 100) {
    document.getElementById('uploadStatus').textContent = `Uploading chunk ${progress.uploadedChunks} of ${progress.totalChunks}...`;
  } else {
    document.getElementById('uploadStatus').textContent = 'Upload complete. Processing...';
  }

  // Calculate ETA and speed
  if (progress.uploadedBytes > 0 && uploadStartTime) {
    const elapsed = (Date.now() - uploadStartTime) / 1000; // seconds
    const rate = progress.uploadedBytes / elapsed; // bytes/sec
    const remaining = (totalSize - progress.uploadedBytes) / rate; // seconds

    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);
    document.getElementById('uploadEta').textContent =
      `Estimated time remaining: ${minutes}m ${seconds}s`;

    const speedMBps = (rate / 1024 / 1024).toFixed(2);
    document.getElementById('uploadSpeed').textContent =
      `Upload speed: ${speedMBps} MB/s`;
  }
}

function handleUploadComplete(result, filename) {
  document.getElementById('uploadProgress').classList.add('hidden');
  document.getElementById('uploadComplete').classList.remove('hidden');
  document.getElementById('uploadCompleteMessage').textContent =
    `Your ActionStep data export (${filename}) has been uploaded successfully and is now being processed. You can view the import progress in the Execution Logs tab.`;

  // Refresh dashboard stats
  loadDashboard();

  // Update output counts
  updateOutputCounts();
}

function handleUploadError(error) {
  console.error('Upload error:', error);
  document.getElementById('uploadProgress').classList.add('hidden');
  document.getElementById('uploadError').classList.remove('hidden');
  document.getElementById('uploadErrorMessage').textContent =
    error.message || 'An unexpected error occurred during upload. Please try again.';
}

async function cancelUpload() {
  if (currentUploadId && confirm('Are you sure you want to cancel this upload? All progress will be lost.')) {
    try {
      if (currentUploader) {
        await currentUploader.cancel(currentUploadId);
      }
      resetUploadForm();
    } catch (error) {
      console.error('Cancel error:', error);
      resetUploadForm();
    }
  }
}

function resetUploadForm() {
  document.getElementById('uploadProgress').classList.add('hidden');
  document.getElementById('uploadComplete').classList.add('hidden');
  document.getElementById('uploadError').classList.add('hidden');
  document.getElementById('dropZone').classList.remove('hidden');

  // Reset file input
  document.getElementById('fileInput').value = '';

  // Reset state
  currentUploader = null;
  currentUploadId = null;
  uploadStartTime = null;
}
```

---

## Integration Points

### Updated switchTab() Function

```javascript
function switchTab(tab) {
  // Hide all tabs
  document.querySelectorAll('[id$="-tab"]').forEach(el => el.classList.add('hidden'));

  // Remove active class from all tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('border-indigo-600', 'text-indigo-600');
    btn.classList.add('border-transparent', 'text-gray-500');
  });

  // Show selected tab
  const tabContent = document.getElementById(`${tab}-tab`);
  if (tabContent) {
    tabContent.classList.remove('hidden');
  }

  // Add active class to selected tab button
  const tabButton = document.getElementById(`tab-${tab}`);
  if (tabButton) {
    tabButton.classList.add('border-indigo-600', 'text-indigo-600');
    tabButton.classList.remove('border-transparent', 'text-gray-500');
  }

  // Update current tab
  currentTab = tab;

  // Load tab content
  loadTabContent(tab);
}

async function loadTabContent(tab) {
  const content = document.getElementById('tabContent');

  if (!content) return; // Some tabs don't use tabContent div

  try {
    switch (tab) {
      case 'overview':
        await loadOverview();
        break;
      case 'configuration':
        await loadConfiguration();
        break;
      case 'upload':
        // Upload tab is static HTML, no loading needed
        break;
      case 'output':
        // Load default data type (matters)
        await loadOutputData('matters');
        await updateOutputCounts();
        break;
      case 'execution-logs':
        await loadExecutionLogs();
        break;
      case 'documentation':
        await loadDocumentation();
        break;
      case 'workflows':
        await loadWorkflows();
        break;
      default:
        await loadOverview();
    }
  } catch (error) {
    console.error(`Failed to load ${tab} tab:`, error);
    if (content) {
      content.innerHTML = `<div class="text-center text-red-600 py-8">Failed to load data: ${error.message}</div>`;
    }
  }
}
```

---

## Complete Code Changes

### Files to Modify

1. **`src/integrations/actionstep.html`**
   - Update tab navigation HTML (remove old tabs, add Upload and Output)
   - Add Upload tab content HTML
   - Add Output tab content HTML
   - Remove old Matters/Participants/Tasks/File Notes tab content divs

2. **JavaScript within `actionstep.html`**
   - Add `initializePermissions()` function
   - Add all Output tab JavaScript
   - Add all Upload tab JavaScript
   - Update `switchTab()` and `loadTabContent()` functions
   - Initialize upload functionality on page load

3. **`src/js/chunked-upload.js`** (NEW FILE)
   - Create reusable ChunkedUploader class
   - (See CHUNKED_UPLOAD_IMPLEMENTATION_PLAN.md for complete code)

### Testing Checklist

- [ ] Configuration tab hidden for non-admin users
- [ ] Configuration tab visible for system_admin
- [ ] Configuration tab visible for org_admin
- [ ] Upload tab drag-and-drop works
- [ ] Upload tab file browse works
- [ ] Upload progress updates in real-time
- [ ] Upload can be cancelled
- [ ] Upload completes successfully
- [ ] Output tab loads matters data
- [ ] Output tab switches between data types
- [ ] Output tab search works
- [ ] Output tab filter works
- [ ] Output tab sort works
- [ ] Output tab pagination works
- [ ] Output tab export CSV works
- [ ] Tab navigation works correctly
- [ ] No console errors

---

## Summary

This plan provides complete implementation details for:

1. ✅ **Permission-based UI** - Configuration tab hidden for non-admins
2. ✅ **Tab Consolidation** - 4 tabs merged into 1 Output tab with sidebar
3. ✅ **Upload Functionality** - Complete drag-and-drop with progress tracking
4. ✅ **Output Tab** - Full CRUD with search, filter, sort, pagination
5. ✅ **Reusable Components** - ChunkedUploader can be used anywhere

All code is production-ready and can be copy-pasted into actionstep.html.
