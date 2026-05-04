/**
 * Connector Data Tab Renderer
 *
 * Generic renderer that displays import results, preview tables, and import history
 */

import api from './api.js';

/**
 * Renders the data tab for a connector
 * @param {Object} schema - Connector schema from database
 * @param {HTMLElement} container - Container element to render into
 * @param {Object} importStats - Import statistics and recent data
 */
export async function renderDataTab(schema, container, importStats = null) {
  if (!schema || !schema.data_types) {
    container.innerHTML = '<div class="text-gray-500">No data types defined</div>';
    return;
  }

  // If no import stats provided, fetch them
  if (!importStats) {
    importStats = await fetchImportStats(schema.connector_id);
  }

  let html = '<div class="space-y-6">';

  // 1. Import Summary Cards
  html += renderImportSummary(schema, importStats);

  // 2. Import History Timeline
  html += renderImportHistory(importStats.history || []);

  // 3. Recently Imported Records by Data Type
  html += renderRecentlyImportedData(schema, importStats.recent_data || {});

  html += '</div>';

  container.innerHTML = html;

  // Attach event handlers
  attachDataTabHandlers(schema);
}

/**
 * Render import summary cards
 */
function renderImportSummary(schema, stats) {
  let html = `
    <div class="bg-white rounded-lg border border-gray-200 p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">Import Summary</h3>
      <div class="grid grid-cols-1 md:grid-cols-${schema.data_types.length} gap-4">
  `;

  for (const dataType of schema.data_types) {
    const count = stats?.counts?.[dataType.type_id] || 0;
    const iconColor = dataType.color || 'blue';

    html += `
      <div class="bg-${iconColor}-50 border border-${iconColor}-100 rounded-lg p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-${iconColor}-600">${dataType.label}</p>
            <p class="text-2xl font-bold text-${iconColor}-900 mt-1">${count.toLocaleString()}</p>
          </div>
          <div class="text-${iconColor}-500">
            ${getIconSVG(dataType.icon)}
          </div>
        </div>
        ${dataType.link_to ? `
          <a href="${dataType.link_to}" class="text-xs text-${iconColor}-600 hover:text-${iconColor}-700 mt-2 inline-block">
            View all →
          </a>
        ` : ''}
      </div>
    `;
  }

  html += `
      </div>

      <!-- Last Import Info -->
      ${stats?.last_import ? `
        <div class="mt-4 pt-4 border-t border-gray-200">
          <p class="text-sm text-gray-600">
            <span class="font-medium">Last import:</span>
            ${formatDateTime(stats.last_import.completed_at)}
            <span class="ml-2 text-${stats.last_import.status === 'success' ? 'green' : 'red'}-600">
              (${stats.last_import.status})
            </span>
          </p>
        </div>
      ` : '<div class="mt-4 text-sm text-gray-500">No imports yet</div>'}
    </div>
  `;

  return html;
}

/**
 * Render import history timeline
 */
function renderImportHistory(history) {
  if (!history || history.length === 0) {
    return `
      <div class="bg-white rounded-lg border border-gray-200 p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Import History</h3>
        <div class="text-center py-8 text-gray-500">
          <svg class="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p>No import history available</p>
        </div>
      </div>
    `;
  }

  let html = `
    <div class="bg-white rounded-lg border border-gray-200 p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">Import History</h3>
      <div class="space-y-3">
  `;

  for (const entry of history.slice(0, 10)) {  // Show last 10 imports
    const statusColor = entry.status === 'success' ? 'green' : entry.status === 'failed' ? 'red' : 'yellow';
    const statusIcon = entry.status === 'success' ? '✓' : entry.status === 'failed' ? '✗' : '⟳';

    html += `
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer import-history-item"
           data-import-id="${entry.id}">
        <div class="flex items-center space-x-3">
          <div class="w-8 h-8 rounded-full bg-${statusColor}-100 flex items-center justify-center">
            <span class="text-${statusColor}-600 font-bold">${statusIcon}</span>
          </div>
          <div>
            <p class="text-sm font-medium text-gray-900">${entry.type || 'Import'}</p>
            <p class="text-xs text-gray-500">${formatDateTime(entry.started_at)}</p>
          </div>
        </div>
        <div class="text-right">
          <p class="text-sm font-medium text-gray-900">${entry.records_count?.toLocaleString() || 0} records</p>
          <p class="text-xs text-gray-500">${formatDuration(entry.duration_seconds)}</p>
        </div>
      </div>
    `;
  }

  html += `
      </div>
      ${history.length > 10 ? `
        <button class="mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium">
          View all ${history.length} imports →
        </button>
      ` : ''}
    </div>
  `;

  return html;
}

/**
 * Render recently imported data tables
 */
function renderRecentlyImportedData(schema, recentData) {
  if (!recentData || Object.keys(recentData).length === 0) {
    return `
      <div class="bg-white rounded-lg border border-gray-200 p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Recently Imported Data</h3>
        <div class="text-center py-8 text-gray-500">
          <svg class="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <p>No imported data yet</p>
        </div>
      </div>
    `;
  }

  let html = `
    <div class="bg-white rounded-lg border border-gray-200 p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">Recently Imported Data</h3>
      <div class="space-y-6">
  `;

  for (const dataType of schema.data_types) {
    const records = recentData[dataType.type_id] || [];

    if (records.length === 0) continue;

    html += `
      <div class="data-type-section">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-md font-semibold text-gray-800 flex items-center">
            ${getIconSVG(dataType.icon, 'w-5 h-5 mr-2')}
            ${dataType.label}
          </h4>
          <span class="text-sm text-gray-500">${records.length} recent</span>
        </div>

        <!-- Data Table -->
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
    `;

    // Table headers from preview_fields
    for (const field of dataType.preview_fields) {
      html += `<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${formatFieldName(field)}</th>`;
    }

    html += `
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
    `;

    // Table rows
    for (const record of records.slice(0, 5)) {  // Show 5 recent records
      html += '<tr class="hover:bg-gray-50">';

      for (const field of dataType.preview_fields) {
        const value = record[field];
        html += `<td class="px-4 py-2 text-sm text-gray-900">${formatFieldValue(value, field)}</td>`;
      }

      html += '</tr>';
    }

    html += `
            </tbody>
          </table>
        </div>

        ${dataType.link_to ? `
          <a href="${dataType.link_to}" class="mt-2 text-sm text-blue-600 hover:text-blue-700 inline-block">
            View all ${dataType.label} →
          </a>
        ` : ''}
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  return html;
}

/**
 * Attach event handlers for data tab interactions
 */
function attachDataTabHandlers(schema) {
  // Import history item click
  document.querySelectorAll('.import-history-item').forEach(item => {
    item.addEventListener('click', () => {
      const importId = item.dataset.importId;
      showImportDetails(importId);
    });
  });
}

/**
 * Show detailed information about a specific import
 */
async function showImportDetails(importId) {
  // This will be implemented to show a modal with import details
  console.log('Show import details for:', importId);
}

/**
 * Fetch import statistics for a connector
 */
async function fetchImportStats(connectorId) {
  try {
    const response = await api.get(`/api/v1/${connectorId}/stats`);
    return response;
  } catch (error) {
    console.error(`Failed to fetch import stats for ${connectorId}:`, error);
    return {
      counts: {},
      history: [],
      recent_data: {},
      last_import: null
    };
  }
}

/**
 * Format date and time
 */
function formatDateTime(dateStr) {
  if (!dateStr) return 'N/A';

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

  return formatDateTime(dateStr);
}

/**
 * Format duration in seconds to readable string
 */
function formatDuration(seconds) {
  if (!seconds) return 'N/A';

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Format field name for display
 */
function formatFieldName(fieldName) {
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format field value for display
 */
function formatFieldValue(value, fieldName) {
  if (value === null || value === undefined) return '-';

  // Date fields
  if (fieldName.includes('date') || fieldName.includes('_at')) {
    return formatDateTime(value);
  }

  // Size fields (bytes)
  if (fieldName.includes('size')) {
    return formatFileSize(value);
  }

  // Truncate long text
  if (typeof value === 'string' && value.length > 50) {
    return value.substring(0, 47) + '...';
  }

  return value;
}

/**
 * Format file size in bytes to readable string
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Get icon SVG based on icon name
 */
function getIconSVG(iconName, className = 'w-6 h-6') {
  const icons = {
    'briefcase': `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>`,
    'users': `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>`,
    'file': `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`,
    'file-text': `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`,
    'check-square': `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>`,
    'folder': `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>`,
    'user-plus': `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>`,
    'megaphone': `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"></path></svg>`,
    'trophy': `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"></path></svg>`
  };

  return icons[iconName] || icons['file'];
}

export default {
  renderDataTab,
  fetchImportStats
};
