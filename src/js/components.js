// components.js - Reusable UI Components

// Toast Notifications
const Toast = {
  container: null,

  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2';
      document.body.appendChild(this.container);
    }
  },

  show(message, type = 'info', duration = 3000) {
    this.init();
    const toast = document.createElement('div');
    const colors = {
      success: 'bg-green-500',
      error: 'bg-red-500',
      warning: 'bg-yellow-500',
      info: 'bg-blue-500'
    };
    const icons = {
      success: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
      error: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
      warning: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
      info: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };

    toast.className = `${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 transform transition-all duration-300 translate-x-full`;
    toast.innerHTML = `${icons[type]}<span>${message}</span>`;
    this.container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.remove('translate-x-full'));

    setTimeout(() => {
      toast.classList.add('translate-x-full', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  success(message) { this.show(message, 'success'); },
  error(message) { this.show(message, 'error', 5000); },
  warning(message) { this.show(message, 'warning'); },
  info(message) { this.show(message, 'info'); }
};

// Modal Component
const Modal = {
  show(options) {
    const { title, content, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', type = 'default' } = options;

    // Icon based on type
    const iconMap = {
      danger: `
        <svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
      `,
      success: `
        <svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      `,
      info: `
        <svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      `,
      default: `
        <svg class="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      `
    };

    const iconBgMap = {
      danger: 'bg-red-100',
      success: 'bg-green-100',
      info: 'bg-blue-100',
      default: 'bg-gray-100'
    };

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl max-w-md w-full transform transition-all animate-fade-in-up">
        <div class="p-6">
          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 w-12 h-12 ${iconBgMap[type] || iconBgMap.default} rounded-full flex items-center justify-center">
              ${iconMap[type] || iconMap.default}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-xl font-semibold text-gray-900 mb-2">${title}</h3>
              <div class="text-gray-600 text-sm leading-relaxed">
                ${typeof content === 'string' ? `<p>${content}</p>` : ''}
              </div>
            </div>
          </div>
        </div>
        <div class="px-6 pb-6 flex justify-end gap-3">
          <button class="btn-cancel px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300">${cancelText}</button>
          <button class="btn-confirm px-5 py-2.5 text-sm font-medium text-white ${
            type === 'danger' ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' :
            type === 'success' ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500' :
            type === 'primary' ? 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500' :
            'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500'
          } rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 shadow-sm">${confirmText}</button>
        </div>
      </div>
    `;

    const contentDiv = overlay.querySelector('.text-gray-600');
    if (typeof content !== 'string' && contentDiv) {
      contentDiv.innerHTML = '';
      contentDiv.appendChild(content);
    }

    overlay.querySelector('.btn-cancel').onclick = () => {
      overlay.remove();
      onCancel?.();
    };

    overlay.querySelector('.btn-confirm').onclick = () => {
      overlay.remove();
      onConfirm?.();
    };

    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        onCancel?.();
      }
    };

    document.body.appendChild(overlay);
    return overlay;
  },

  confirm(title, message, onConfirm, confirmText = 'Delete', type = 'danger') {
    return this.show({ title, content: message, onConfirm, type, confirmText });
  },

  alert(title, message) {
    return this.show({ title, content: message, cancelText: 'Close', confirmText: 'OK' });
  }
};

// Loading Spinner
const Spinner = {
  show(container = document.body, message = 'Loading...') {
    const spinner = document.createElement('div');
    spinner.className = 'spinner-overlay fixed inset-0 bg-white bg-opacity-75 flex items-center justify-center z-40';
    spinner.innerHTML = `
      <div class="text-center">
        <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
        <p class="mt-4 text-gray-600">${message}</p>
      </div>
    `;
    container.appendChild(spinner);
    return spinner;
  },

  hide(spinner) {
    spinner?.remove();
  }
};

// Data Table Component
class DataTable {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.options = {
      columns: [],
      data: [],
      pageSize: 20,
      currentPage: 1,
      totalItems: 0,
      onPageChange: null,
      onRowClick: null,
      emptyMessage: 'No data available',
      ...options
    };
    this.render();
  }

  setData(data, totalItems = data.length) {
    this.options.data = data;
    this.options.totalItems = totalItems;
    this.render();
  }

  setPage(page) {
    this.options.currentPage = page;
    this.options.onPageChange?.(page);
  }

  render() {
    const { columns, data, pageSize, currentPage, totalItems, emptyMessage, onRowClick } = this.options;
    const totalPages = Math.ceil(totalItems / pageSize);

    this.container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              ${columns.map(col => `
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${col.class || ''}">${col.label}</th>
              `).join('')}
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${data.length === 0 ? `
              <tr>
                <td colspan="${columns.length}" class="px-6 py-12 text-center text-gray-500">${emptyMessage}</td>
              </tr>
            ` : data.map((row, idx) => `
              <tr class="${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''}" data-index="${idx}">
                ${columns.map(col => `
                  <td class="px-6 py-4 whitespace-nowrap ${col.cellClass || ''}">
                    ${col.render ? col.render(row[col.key], row) : (row[col.key] ?? '-')}
                  </td>
                `).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${totalPages > 1 ? `
        <div class="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
          <div class="text-sm text-gray-700">
            Showing <span class="font-medium">${(currentPage - 1) * pageSize + 1}</span> to
            <span class="font-medium">${Math.min(currentPage * pageSize, totalItems)}</span> of
            <span class="font-medium">${totalItems}</span> results
          </div>
          <div class="flex gap-2">
            <button class="btn-prev px-3 py-1 border rounded ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
            <button class="btn-next px-3 py-1 border rounded ${currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
          </div>
        </div>
      ` : ''}
    `;

    // Event listeners
    if (onRowClick) {
      this.container.querySelectorAll('tbody tr[data-index]').forEach(row => {
        row.addEventListener('click', () => onRowClick(data[parseInt(row.dataset.index)]));
      });
    }

    this.container.querySelector('.btn-prev')?.addEventListener('click', () => {
      if (currentPage > 1) this.setPage(currentPage - 1);
    });

    this.container.querySelector('.btn-next')?.addEventListener('click', () => {
      if (currentPage < totalPages) this.setPage(currentPage + 1);
    });
  }
}

// Form Helpers
const Form = {
  serialize(form) {
    const data = {};
    new FormData(form).forEach((value, key) => {
      if (data[key]) {
        if (!Array.isArray(data[key])) data[key] = [data[key]];
        data[key].push(value);
      } else {
        data[key] = value;
      }
    });
    return data;
  },

  validate(form) {
    const inputs = form.querySelectorAll('[required], [pattern], [minlength], [maxlength]');
    let valid = true;
    inputs.forEach(input => {
      if (!input.checkValidity()) {
        valid = false;
        input.classList.add('border-red-500');
        const error = input.parentElement.querySelector('.error-message') || document.createElement('p');
        error.className = 'error-message text-red-500 text-sm mt-1';
        error.textContent = input.validationMessage;
        if (!input.parentElement.querySelector('.error-message')) {
          input.parentElement.appendChild(error);
        }
      } else {
        input.classList.remove('border-red-500');
        input.parentElement.querySelector('.error-message')?.remove();
      }
    });
    return valid;
  },

  reset(form) {
    form.reset();
    form.querySelectorAll('.border-red-500').forEach(el => el.classList.remove('border-red-500'));
    form.querySelectorAll('.error-message').forEach(el => el.remove());
  }
};

// Security: HTML escaping helper
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Status Badge Helper
function statusBadge(status) {
  const styles = {
    active: 'bg-green-100 text-green-800',
    inactive: 'bg-gray-100 text-gray-800',
    pending: 'bg-yellow-100 text-yellow-800',
    disabled: 'bg-red-100 text-red-800',
    healthy: 'bg-green-100 text-green-800',
    unhealthy: 'bg-red-100 text-red-800',
    degraded: 'bg-yellow-100 text-yellow-800',
    installed: 'bg-blue-100 text-blue-800',
    running: 'bg-green-100 text-green-800',
    stopped: 'bg-gray-100 text-gray-800'
  };
  // Security: Escape status value to prevent XSS
  const escapedStatus = escapeHtml(status);
  return `<span class="px-2 py-1 text-xs font-medium rounded-full ${styles[status] || 'bg-gray-100 text-gray-800'}">${escapedStatus}</span>`;
}

// Date Formatter
function formatDate(dateString, options = {}) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options
  });
}

function formatDateTime(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function timeAgo(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const seconds = Math.floor((new Date() - date) / 1000);

  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return `${count} ${interval.label}${count !== 1 ? 's' : ''} ago`;
    }
  }
  return 'Just now';
}

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ============================================================
// DEMO MODE BANNER
// ============================================================
const DemoBanner = {
  isShown: false,

  show() {
    // Only show if demo mode is enabled and banner not already shown
    if (!window.LanaConfig?.DEMO_MODE || this.isShown) return;

    this.isShown = true;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.className = 'fixed top-0 left-0 right-0 bg-gradient-to-r from-yellow-500 to-amber-500 text-white py-2.5 px-4 text-center text-sm font-medium z-[9999] shadow-md';
    banner.innerHTML = `
      <div class="max-w-7xl mx-auto flex items-center justify-center gap-3">
        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span>
          <strong>DEMO MODE</strong> — No server connection. Showing sample data for demonstration purposes.
        </span>
        <button onclick="DemoBanner.hide()" class="ml-2 p-1 hover:bg-white/20 rounded transition-colors" title="Dismiss">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
    `;

    // Insert at the very beginning of body
    document.body.insertBefore(banner, document.body.firstChild);

    // Add padding to body to account for fixed banner
    document.body.style.paddingTop = '44px';

    // Store original padding to restore on hide
    this.originalPadding = document.body.style.paddingTop;
  },

  hide() {
    const banner = document.getElementById('demo-banner');
    if (banner) {
      banner.style.transform = 'translateY(-100%)';
      banner.style.transition = 'transform 0.3s ease-out';
      setTimeout(() => {
        banner.remove();
        document.body.style.paddingTop = '0';
      }, 300);
    }
    this.isShown = false;
  },

  // Check if demo mode is active
  isActive() {
    return window.LanaConfig?.DEMO_MODE || false;
  }
};

// Auto-show demo banner on page load
document.addEventListener('DOMContentLoaded', () => {
  DemoBanner.show();
});

// Also try to show immediately if DOM is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(() => DemoBanner.show(), 0);
}

// ============================================================
// FILE SIZE FORMATTER
// ============================================================
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================================
// PERCENTAGE FORMATTER
// ============================================================
function formatPercentage(value, decimals = 1) {
  if (value === null || value === undefined) return '-';
  return value.toFixed(decimals) + '%';
}

// ============================================================
// TRUNCATE TEXT
// ============================================================
function truncateText(text, maxLength = 50) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// ============================================================
// CONVERSATION ACTIONS MODAL
// ============================================================
const ConversationActionsModal = {
  // State
  selectedConversationId: null,
  selectedConversationTitle: null,
  selectedConversationMatterId: null,
  selectedConversationIsProject: false,
  modalInitialized: false,

  // Initialize the modal HTML (called once on first use)
  init() {
    if (this.modalInitialized) return;

    // Create conversation actions modal
    const actionsModal = document.createElement('div');
    actionsModal.id = 'conversationActionsModal';
    actionsModal.className = 'fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4';
    actionsModal.style.zIndex = '9999';
    actionsModal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 class="text-xl font-semibold text-gray-900">Conversation Options</h2>
          <button onclick="ConversationActionsModal.close()" class="text-gray-400 hover:text-gray-600 transition-colors">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="p-6">
          <h3 id="modalConversationTitle" class="text-lg font-medium text-gray-900 mb-6"></h3>
          <div class="space-y-3">
            <button onclick="ConversationActionsModal.editConversation()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-all group">
              <div class="flex-shrink-0 w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-200 transition-colors">
                <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                </svg>
              </div>
              <div class="flex-1">
                <div class="font-medium text-gray-900">Rename Conversation</div>
                <div class="text-sm text-gray-500">Change the conversation name</div>
              </div>
            </button>
            <button id="viewMatterDetailsBtn" onclick="ConversationActionsModal.viewMatterDetails()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-all group hidden">
              <div class="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
              </div>
              <div class="flex-1">
                <div class="font-medium text-gray-900">View Matter Details</div>
                <div class="text-sm text-gray-500">Open the associated matter</div>
              </div>
            </button>
            <button onclick="ConversationActionsModal.deleteConversation()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-red-300 hover:bg-red-50 transition-all group">
              <div class="flex-shrink-0 w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center group-hover:bg-red-200 transition-colors">
                <svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
              </div>
              <div class="flex-1">
                <div class="font-medium text-gray-900">Delete Conversation</div>
                <div class="text-sm text-gray-500">Permanently remove this conversation</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    `;

    // Close on background click
    actionsModal.onclick = (e) => {
      if (e.target === actionsModal) {
        this.close();
      }
    };

    // Create rename conversation modal
    const renameModal = document.createElement('div');
    renameModal.id = 'renameConversationModal';
    renameModal.className = 'fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4';
    renameModal.style.zIndex = '10000';
    renameModal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 class="text-xl font-semibold text-gray-900">Rename Conversation</h2>
          <button onclick="ConversationActionsModal.closeRename()" class="text-gray-400 hover:text-gray-600 transition-colors">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="p-6">
          <label class="block text-sm font-medium text-gray-700 mb-2">New Conversation Name</label>
          <input type="text" id="renameInput" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent" placeholder="Enter new name">
        </div>
        <div class="flex justify-end gap-3 p-6 border-t border-gray-200">
          <button onclick="ConversationActionsModal.closeRename()" class="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Cancel</button>
          <button onclick="ConversationActionsModal.confirmRename()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Rename</button>
        </div>
      </div>
    `;

    // Close on background click
    renameModal.onclick = (e) => {
      if (e.target === renameModal) {
        this.closeRename();
      }
    };

    // Append to body
    document.body.appendChild(actionsModal);
    document.body.appendChild(renameModal);

    this.modalInitialized = true;
  },

  // Open conversation actions modal
  open(conversationId, conversationTitle, matterId) {
    this.init(); // Ensure modal is initialized

    this.selectedConversationId = conversationId;
    this.selectedConversationTitle = conversationTitle;
    this.selectedConversationMatterId = matterId;
    this.selectedConversationIsProject = matterId !== null && matterId !== 'null';

    // Decode HTML entities in title
    const decodedTitle = conversationTitle
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&#96;/g, '`')
      .replace(/&amp;/g, '&');

    document.getElementById('modalConversationTitle').textContent = decodedTitle;

    // Show/hide matter details button
    const matterBtn = document.getElementById('viewMatterDetailsBtn');
    if (matterId && matterId !== 'null') {
      matterBtn.classList.remove('hidden');
    } else {
      matterBtn.classList.add('hidden');
    }

    // Show modal
    const modal = document.getElementById('conversationActionsModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  },

  // Close conversation actions modal
  close() {
    const modal = document.getElementById('conversationActionsModal');
    if (modal) {
      modal.classList.remove('flex');
      modal.classList.add('hidden');
    }
    this.selectedConversationId = null;
    this.selectedConversationTitle = null;
    this.selectedConversationIsProject = false;
    this.selectedConversationMatterId = null;
  },

  // Edit conversation (open rename modal)
  editConversation() {
    if (!this.selectedConversationId || !this.selectedConversationTitle) {
      Toast.error('No conversation selected');
      this.close();
      return;
    }

    // Hide actions modal
    const actionsModal = document.getElementById('conversationActionsModal');
    actionsModal.classList.remove('flex');
    actionsModal.classList.add('hidden');

    // Show rename modal
    const renameModal = document.getElementById('renameConversationModal');
    const renameInput = document.getElementById('renameInput');

    const decodedTitle = this.selectedConversationTitle
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&#96;/g, '`')
      .replace(/&amp;/g, '&');

    renameInput.value = decodedTitle;
    renameModal.classList.remove('hidden');
    renameModal.classList.add('flex');

    setTimeout(() => {
      renameInput.focus();
      renameInput.select();
    }, 100);
  },

  // Close rename modal
  closeRename() {
    const modal = document.getElementById('renameConversationModal');
    if (modal) {
      modal.classList.remove('flex');
      modal.classList.add('hidden');
    }
  },

  // Confirm rename
  async confirmRename() {
    if (!this.selectedConversationId) {
      Toast.error('No conversation selected');
      this.closeRename();
      return;
    }

    const renameInput = document.getElementById('renameInput');
    const newTitle = renameInput.value.trim();

    if (!newTitle) {
      Toast.error('Conversation name cannot be empty');
      return;
    }

    try {
      await api.put(`/api/v1/chat/sessions/${this.selectedConversationId}`, {
        title: newTitle
      });

      Toast.success('Conversation renamed successfully');
      this.closeRename();

      // Reload conversation menu
      if (typeof window.conversationMenu !== 'undefined' && window.conversationMenu.loadConversations) {
        window.conversationMenu.loadConversations();
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
      Toast.error(error.message || 'Failed to rename conversation');
    }
  },

  // View matter details
  viewMatterDetails() {
    if (!this.selectedConversationMatterId) {
      Toast.error('No matter associated with this conversation');
      return;
    }

    this.close();
    window.location.href = `/matters.html?matter_id=${this.selectedConversationMatterId}`;
  },

  // Delete conversation
  async deleteConversation() {
    if (!this.selectedConversationId || !this.selectedConversationTitle) {
      Toast.error('No conversation selected');
      this.close();
      return;
    }

    this.close();

    // Show confirmation modal
    Modal.confirm(
      'Delete Conversation',
      `Are you sure you want to delete "${this.selectedConversationTitle.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#96;/g, '`').replace(/&amp;/g, '&')}"? This action cannot be undone.`,
      async () => {
        try {
          await api.delete(`/api/v1/chat/sessions/${this.selectedConversationId}`);
          Toast.success('Conversation deleted successfully');

          // Reload conversation menu
          if (typeof window.conversationMenu !== 'undefined' && window.conversationMenu.loadConversations) {
            window.conversationMenu.loadConversations();
          } else {
            window.location.reload();
          }
        } catch (error) {
          console.error('Failed to delete conversation:', error);
          Toast.error(error.message || 'Failed to delete conversation');
        }
      },
      'Delete',
      'danger'
    );
  }
};

// Create global alias for backward compatibility
window.openConversationActionsModal = function(conversationId, conversationTitle, matterId) {
  ConversationActionsModal.open(conversationId, conversationTitle, matterId);
};
window.closeConversationActionsModal = function() {
  ConversationActionsModal.close();
};
window.editConversationFromModal = function() {
  ConversationActionsModal.editConversation();
};
window.closeRenameModal = function() {
  ConversationActionsModal.closeRename();
};
window.confirmRename = function() {
  ConversationActionsModal.confirmRename();
};
window.viewMatterDetailsFromModal = function() {
  ConversationActionsModal.viewMatterDetails();
};
window.deleteConversationFromModal = function() {
  ConversationActionsModal.deleteConversation();
};
