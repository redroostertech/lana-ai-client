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

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    overlay.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 transform transition-all">
        <div class="px-6 py-4 border-b border-gray-200">
          <h3 class="text-lg font-semibold text-gray-900">${title}</h3>
        </div>
        <div class="px-6 py-4">
          ${typeof content === 'string' ? `<p class="text-gray-600">${content}</p>` : ''}
        </div>
        <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button class="btn-cancel px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">${cancelText}</button>
          <button class="btn-confirm px-4 py-2 text-white ${type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'} rounded-lg transition-colors">${confirmText}</button>
        </div>
      </div>
    `;

    const contentDiv = overlay.querySelector('.px-6.py-4:not(.border-b):not(.border-t)');
    if (typeof content !== 'string') {
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

  confirm(title, message, onConfirm) {
    return this.show({ title, content: message, onConfirm, type: 'danger', confirmText: 'Delete' });
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
  return `<span class="px-2 py-1 text-xs font-medium rounded-full ${styles[status] || 'bg-gray-100 text-gray-800'}">${status}</span>`;
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
