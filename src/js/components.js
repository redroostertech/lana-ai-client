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

// ── Utility functions ──
// Canonical implementations live in Lex.Utils (lex.utils.js).
// These globals delegate there when the SPA shell is loaded, or provide
// inline fallbacks for standalone pages that don't load lex.utils.js.

if (typeof Lex !== 'undefined' && Lex.Utils) {
  // SPA shell — delegate to canonical Lex.Utils
  var escapeHtml       = Lex.Utils.escapeHtml;
  var statusBadge      = Lex.Utils.statusBadge;
  var formatDate       = Lex.Utils.formatDate;
  var formatDateTime   = Lex.Utils.formatDateTime;
  var timeAgo          = Lex.Utils.timeAgo;
  var debounce         = Lex.Utils.debounce;
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

// ── Additional utility delegates ──
// Same pattern: use Lex.Utils when available (SPA shell).

if (typeof Lex !== 'undefined' && Lex.Utils) {
  var formatFileSize   = Lex.Utils.formatFileSize;
  var formatPercentage = Lex.Utils.formatPercentage;
  var truncateText     = Lex.Utils.truncateText;
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
  _boundActionsModal: null,
  // The Rename modal is a <lex-modal> built programmatically on first use.
  // See _ensureRenameModal(). Tracked separately from the actions modal so
  // we don't rebuild it on SPA re-init.
  _renameModal: null,
  _renameInput: null,

  // Wire up modal elements (re-binds on every call to handle SPA navigation
  // where the DOM elements are replaced by the router).
  // Injects modal HTML into document.body if not already present (so it works
  // on any page, not just search-conversations.html).
  init() {
    var actionsModal = document.getElementById('conversationActionsModal');

    // Inject modal DOM if not present on the current page
    if (!actionsModal) {
      this._injectModalHtml();
      actionsModal = document.getElementById('conversationActionsModal');
    }

    if (!actionsModal) return;

    // Skip if already bound to THIS exact element
    if (this._boundActionsModal === actionsModal) return;

    // Close on background click
    actionsModal.onclick = (e) => {
      if (e.target === actionsModal) {
        this.close();
      }
    };

    this._boundActionsModal = actionsModal;
  },

  // Inject the conversation actions + rename modal HTML into document.body.
  // Called by init() when the modal elements are not found on the current page.
  _injectModalHtml() {
    var container = document.createElement('div');
    container.id = 'conversation-modals-injected';
    container.innerHTML =
      '<div id="conversationActionsModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4" style="z-index: 9999;">' +
        '<div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onclick="event.stopPropagation()">' +
          '<div class="flex items-center justify-between p-6 border-b border-gray-200">' +
            '<h2 class="text-xl font-semibold text-gray-900">Conversation Options</h2>' +
            '<button onclick="ConversationActionsModal.close()" class="text-gray-400 hover:text-gray-600 transition-colors">' +
              '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>' +
            '</button>' +
          '</div>' +
          '<div class="p-6">' +
            '<h3 id="modalConversationTitle" class="text-lg font-medium text-gray-900 mb-6"></h3>' +
            '<div class="space-y-3">' +
              '<button onclick="ConversationActionsModal.editConversation()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-all group">' +
                '<div class="flex-shrink-0 w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-200 transition-colors">' +
                  '<svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>' +
                '</div>' +
                '<div class="flex-1"><div class="font-medium text-gray-900">Rename Conversation</div><div class="text-sm text-gray-500">Change the conversation name</div></div>' +
              '</button>' +
              '<button id="togglePinConversationBtn" onclick="ConversationActionsModal.togglePin()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-yellow-300 hover:bg-yellow-50 transition-all group">' +
                '<div class="flex-shrink-0 w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center group-hover:bg-yellow-200 transition-colors">' +
                  '<svg id="togglePinConversationIcon" class="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path></svg>' +
                '</div>' +
                '<div class="flex-1"><div id="togglePinConversationLabel" class="font-medium text-gray-900">Pin Conversation</div><div id="togglePinConversationDescription" class="text-sm text-gray-500">Keep this conversation at the top of the list</div></div>' +
              '</button>' +
              '<button id="viewMatterDetailsBtn" onclick="ConversationActionsModal.viewMatterDetails()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-all group hidden">' +
                '<div class="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">' +
                  '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>' +
                '</div>' +
                '<div class="flex-1"><div class="font-medium text-gray-900">View Matter Details</div><div class="text-sm text-gray-500">Open the associated matter</div></div>' +
              '</button>' +
              '<button onclick="ConversationActionsModal.deleteConversation()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-red-300 hover:bg-red-50 transition-all group">' +
                '<div class="flex-shrink-0 w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center group-hover:bg-red-200 transition-colors">' +
                  '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' +
                '</div>' +
                '<div class="flex-1"><div class="font-medium text-gray-900">Archive Conversation</div><div class="text-sm text-gray-500">Hide from the list — can be restored later</div></div>' +
              '</button>' +
              '<button onclick="ConversationActionsModal.permanentDeleteConversation()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-red-400 hover:bg-red-50 transition-all group">' +
                '<div class="flex-shrink-0 w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center group-hover:bg-red-200 transition-colors">' +
                  '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>' +
                '</div>' +
                '<div class="flex-1"><div class="font-medium text-red-700">Delete Permanently</div><div class="text-sm text-gray-500">Hard delete — cannot be recovered</div></div>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    // NOTE: The Rename modal is no longer injected here. It's built lazily
    // as a <lex-modal> (Lex-styled chrome + buttons) via _ensureRenameModal().
    document.body.appendChild(container);
  },

  // Ensure lex-modal, lex-input, and lex-btn custom elements are defined.
  // On standalone pages (not app.html), they may not be loaded yet — inject
  // <script> tags and wait for them to register. Mirrors NewProjectModal._ensureComponents().
  async _ensureLexComponents() {
    var needed = [];

    if (typeof customElements === 'undefined') return;

    if (!customElements.get('lex-modal')) {
      needed.push('js/lex/components/foundation/lex-modal.js');
    }
    if (!customElements.get('lex-input')) {
      needed.push('js/lex/components/form/lex-input.js');
    }
    if (!customElements.get('lex-btn')) {
      needed.push('js/lex/components/foundation/lex-btn.js');
    }

    if (needed.length === 0) return;

    // Resolve paths relative to the current page (handles admin/ subfolders).
    var prefix = '';
    if (typeof NavigationHelpers !== 'undefined' && NavigationHelpers.resolvePath) {
      var sample = NavigationHelpers.resolvePath('_');
      if (sample.indexOf('../') === 0) {
        prefix = sample.substring(0, sample.lastIndexOf('/') + 1);
        if (prefix.length > 0 && prefix.charAt(prefix.length - 1) !== '/') {
          prefix += '/';
        }
      }
    }

    await Promise.all(needed.map(function (src) {
      return new Promise(function (resolve) {
        var script = document.createElement('script');
        script.src = prefix + src;
        script.onload = resolve;
        script.onerror = function () {
          console.warn('[ConversationActionsModal] Failed to load:', src);
          resolve(); // don't block the modal
        };
        document.head.appendChild(script);
      });
    }));
  },

  // Build the rename <lex-modal> once and cache it. Subsequent opens reuse
  // the same element. Wires lex-confirm/lex-cancel/lex-close + enter-key
  // commit + escape-to-cancel (lex-modal handles Escape natively).
  async _ensureRenameModal() {
    if (this._renameModal) return this._renameModal;

    await this._ensureLexComponents();

    var modal = document.createElement('lex-modal');
    modal.heading = 'Rename Conversation';
    modal.size = 'md';
    modal.hideActions = true; // we render a custom footer with <lex-btn>s
    modal.id = 'renameConversationModal'; // preserved for legacy querySelector calls
    modal.innerHTML =
      '<form id="renameConversationForm" class="rename-conversation-form" novalidate>' +
        '<lex-input ' +
          'id="renameInput" ' +
          'name="title" ' +
          'label="New Conversation Name" ' +
          'placeholder="Enter new name" ' +
          'maxlength="200" ' +
          'required="true"' +
        '></lex-input>' +
      '</form>' +
      '<div class="rename-conversation-footer">' +
        '<lex-btn id="renameCancelBtn" variant="secondary" type="button">Cancel</lex-btn>' +
        '<lex-btn id="renameConfirmBtn" variant="primary" type="button">Rename</lex-btn>' +
      '</div>';

    document.body.appendChild(modal);

    this._renameModal = modal;
    this._renameInput = modal.querySelector('#renameInput');

    var self = this;

    // Footer button wiring.
    var cancelBtn = modal.querySelector('#renameCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () { self.closeRename(); });
    }
    var confirmBtn = modal.querySelector('#renameConfirmBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () { self.confirmRename(); });
    }

    // Enter key submits, Escape cancels (Escape is also handled by lex-modal natively).
    var form = modal.querySelector('#renameConversationForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        self.confirmRename();
      });
    }
    // lex-input emits keydown via its inner <input>; listen on the modal so it
    // catches both Enter (commit) and any stray keys without coupling to internals.
    modal.addEventListener('keydown', function (e) {
      if (!self._renameModal || self._renameModal.open !== true) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        // Only intercept when focus is inside the input — otherwise let
        // lex-modal's own handlers (focus trap) run.
        var active = document.activeElement;
        if (active && self._renameModal.contains(active) && active.tagName === 'INPUT') {
          e.preventDefault();
          self.confirmRename();
        }
      }
    });

    // Treat the modal's own close/cancel events as a cancel — keeps state tidy.
    modal.addEventListener('lex-close', function () { self._onRenameDismissed(); });
    modal.addEventListener('lex-cancel', function () { self._onRenameDismissed(); });

    // Inject minimal styling for the form + footer layout (no inline styles
    // per the client's page-hygiene rule). One-time per page load.
    this._injectRenameStyles();

    return modal;
  },

  _renameStylesInjected: false,

  _injectRenameStyles() {
    if (this._renameStylesInjected) return;
    if (typeof document === 'undefined') return;
    this._renameStylesInjected = true;
    var style = document.createElement('style');
    style.id = 'rename-conversation-modal-styles';
    style.setAttribute('data-source', 'components.js:ConversationActionsModal');
    style.textContent = [
      '.rename-conversation-form { display: block; margin-bottom: 16px; }',
      '.rename-conversation-footer {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: flex-end;',
      '  gap: 8px;',
      '  margin-top: 8px;',
      '  padding-top: 16px;',
      '  border-top: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  },

  // No-op hook called when lex-modal emits lex-close / lex-cancel. We don't
  // need to do anything beyond letting the modal hide — but we keep this
  // explicit in case future callers want to listen.
  _onRenameDismissed() {
    // Intentionally empty: the modal's `open` is set to false by lex-modal
    // itself when the user clicks the X / overlay / presses Escape, and
    // confirmRename() handles the success path explicitly.
  },

  // Open conversation actions modal
  open(conversationId, conversationTitle, matterId, isPinned) {
    this.init(); // Ensure modal is initialized

    this.selectedConversationId = conversationId;
    this.selectedConversationTitle = conversationTitle;
    this.selectedConversationMatterId = matterId;
    this.selectedConversationIsProject = matterId !== null && matterId !== 'null';
    this.selectedConversationIsPinned = !!isPinned;

    // Decode HTML entities in title — string methods only, no regex
    const decodedTitle = conversationTitle
      .split('&apos;').join("'")
      .split('&quot;').join('"')
      .split('&#96;').join('`')
      .split('&amp;').join('&');

    document.getElementById('modalConversationTitle').textContent = decodedTitle;

    // Show/hide matter details button
    const matterBtn = document.getElementById('viewMatterDetailsBtn');
    if (matterId && matterId !== 'null') {
      matterBtn.classList.remove('hidden');
    } else {
      matterBtn.classList.add('hidden');
    }

    // Update Pin/Unpin label + icon based on current state
    const pinLabel = document.getElementById('togglePinConversationLabel');
    const pinDesc = document.getElementById('togglePinConversationDescription');
    const pinIcon = document.getElementById('togglePinConversationIcon');
    if (pinLabel) pinLabel.textContent = this.selectedConversationIsPinned ? 'Unpin Conversation' : 'Pin Conversation';
    if (pinDesc) pinDesc.textContent = this.selectedConversationIsPinned
      ? 'Remove from pinned'
      : 'Keep this conversation at the top of the list';
    if (pinIcon) {
      // Filled pin glyph when pinned, outlined bookmark when not.
      pinIcon.innerHTML = this.selectedConversationIsPinned
        ? '<path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/>'
        : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>';
      pinIcon.setAttribute('fill', this.selectedConversationIsPinned ? 'currentColor' : 'none');
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

  // Edit conversation (open rename modal). Returns a Promise so callers/tests
  // can await modal-ready, but legacy call sites continue to work without await.
  async editConversation() {
    if (!this.selectedConversationId || !this.selectedConversationTitle) {
      Toast.error('No conversation selected');
      this.close();
      return;
    }

    // Hide actions modal
    const actionsModal = document.getElementById('conversationActionsModal');
    if (actionsModal) {
      actionsModal.classList.remove('flex');
      actionsModal.classList.add('hidden');
    }

    // Lazy-build the lex-modal on first use (loads lex components if needed).
    await this._ensureRenameModal();

    const decodedTitle = this.selectedConversationTitle
      .split('&apos;').join("'")
      .split('&quot;').join('"')
      .split('&#96;').join('`')
      .split('&amp;').join('&');

    // Seed the lex-input with the current title. lex-input mirrors `.value`
    // onto its internal <input> on render; setting it before opening is fine.
    if (this._renameInput) {
      this._renameInput.value = decodedTitle;
    }

    // Open the lex-modal — lex-modal handles overlay click, Escape, focus trap.
    this._renameModal.open = true;

    // Focus + select the inner <input> after the modal renders. lex-modal moves
    // initial focus on next microtask; we run after so our select() wins.
    setTimeout(() => {
      if (!this._renameInput) return;
      const innerInput = this._renameInput.querySelector('input');
      if (innerInput) {
        innerInput.focus();
        try { innerInput.select(); } catch (e) { /* noop */ }
      }
    }, 50);
  },

  // Close rename modal
  closeRename() {
    if (this._renameModal) {
      this._renameModal.open = false;
    }
  },

  // Confirm rename
  async confirmRename() {
    if (!this.selectedConversationId) {
      Toast.error('No conversation selected');
      this.closeRename();
      return;
    }

    // Read from the lex-input (preferred) or its inner <input> as a fallback.
    let rawTitle = '';
    if (this._renameInput) {
      rawTitle = this._renameInput.value || '';
      if (!rawTitle) {
        const inner = this._renameInput.querySelector('input');
        if (inner) rawTitle = inner.value || '';
      }
    } else {
      // Legacy DOM fallback (in case the lex-modal hasn't been built yet).
      const legacy = document.getElementById('renameInput');
      rawTitle = legacy ? legacy.value : '';
    }
    const threadId = this.selectedConversationId;

    // Delegate to the shared rename helper. It:
    //   - validates the title (empty / too long),
    //   - PUTs /api/v1/conversation-threads/:id,
    //   - dispatches `conversation:renamed` on window so the chat header,
    //     sidebar, and workspace Conversations tab can self-refresh.
    const helper = (typeof window !== 'undefined') ? window.RenameConversation : null;
    if (!helper || typeof helper.renameConversation !== 'function') {
      console.error('RenameConversation helper not loaded — falling back to inline PUT.');
      try {
        const trimmed = (rawTitle || '').trim();
        if (!trimmed) {
          Toast.error('Conversation name cannot be empty');
          return;
        }
        await api.put(`/api/v1/conversation-threads/${threadId}`, { title: trimmed });
        Toast.success('Conversation renamed successfully');
        this.closeRename();
        if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
          window.dispatchEvent(new CustomEvent('conversation:renamed', {
            detail: { threadId: threadId, title: trimmed }
          }));
        }
        if (typeof window.ConversationMenu !== 'undefined' && window.ConversationMenu.loadConversations) {
          window.ConversationMenu.loadConversations(true);
        }
        if (typeof this.onRefresh === 'function') this.onRefresh();
      } catch (error) {
        console.error('Failed to rename conversation:', error);
        Toast.error(error.message || 'Failed to rename conversation');
      }
      return;
    }

    try {
      await helper.renameConversation({
        api: api,
        threadId: threadId,
        title: rawTitle
      });

      Toast.success('Conversation renamed successfully');
      this.closeRename();

      // Refresh sidebar conversation menu directly (it's a simple call;
      // the `conversation:renamed` event is also dispatched for any other
      // mounted views — chat header, workspace Conversations tab, etc.)
      if (typeof window.ConversationMenu !== 'undefined' && window.ConversationMenu.loadConversations) {
        window.ConversationMenu.loadConversations(true);
      }
      // Refresh page-level content (e.g. search results)
      if (typeof this.onRefresh === 'function') {
        this.onRefresh();
      }
    } catch (error) {
      if (error && error.code === 'INVALID_TITLE') {
        Toast.error(error.message);
        return;
      }
      console.error('Failed to rename conversation:', error);
      Toast.error((error && error.message) || 'Failed to rename conversation');
    }
  },

  // View matter details
  viewMatterDetails() {
    if (!this.selectedConversationMatterId) {
      Toast.error('No matter associated with this conversation');
      return;
    }

    this.close();
    Lex.Nav.go('workspace-details.html', {
      params: { id: this.selectedConversationMatterId },
      context: { matterId: this.selectedConversationMatterId }
    });
  },

  // Delete conversation (soft archive — DELETE /chat/sessions/:id)
  async deleteConversation() {
    if (!this.selectedConversationId || !this.selectedConversationTitle) {
      Toast.error('No conversation selected');
      this.close();
      return;
    }

    // Capture values before close() clears state
    const convId = this.selectedConversationId;
    const convTitle = this.selectedConversationTitle
      .split('&apos;').join("'")
      .split('&quot;').join('"')
      .split('&#96;').join('`')
      .split('&amp;').join('&');

    this.close();

    Modal.confirm(
      'Archive Conversation',
      `Archive "${convTitle}"? It will be hidden from the list but can be restored later.`,
      async () => {
        try {
          await api.delete(`/api/v1/chat/sessions/${convId}`);
          Toast.success('Conversation archived');

          if (typeof window.ConversationMenu !== 'undefined' && window.ConversationMenu.loadConversations) {
            window.ConversationMenu.loadConversations(true);
          }
          if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('conversation:archived', {
              detail: { threadId: convId }
            }));
          }
          if (typeof this.onRefresh === 'function') {
            this.onRefresh();
          }
        } catch (error) {
          console.error('Failed to archive conversation:', error);
          Toast.error(error.message || 'Failed to archive conversation');
        }
      },
      'Archive',
      'danger'
    );
  },

  // Pin / unpin conversation
  async togglePin() {
    if (!this.selectedConversationId) {
      Toast.error('No conversation selected');
      this.close();
      return;
    }

    const convId = this.selectedConversationId;
    const wasPinned = this.selectedConversationIsPinned;
    const onRefresh = this.onRefresh;
    this.close();

    try {
      if (wasPinned) {
        await api.unpinThread(convId);
        Toast.success('Conversation unpinned');
      } else {
        await api.pinThread(convId);
        Toast.success('Conversation pinned');
      }

      if (typeof window.ConversationMenu !== 'undefined' && window.ConversationMenu.loadConversations) {
        window.ConversationMenu.loadConversations(true);
      }
      if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('conversation:pin-changed', {
          detail: { threadId: convId, isPinned: !wasPinned }
        }));
      }
      if (typeof onRefresh === 'function') {
        onRefresh();
      }
    } catch (error) {
      console.error('Failed to toggle pin:', error);
      Toast.error(error.message || 'Failed to update pin');
    }
  },

  // Hard delete (cannot be recovered) — DELETE /conversation-threads/:id/permanent
  async permanentDeleteConversation() {
    if (!this.selectedConversationId || !this.selectedConversationTitle) {
      Toast.error('No conversation selected');
      this.close();
      return;
    }

    const convId = this.selectedConversationId;
    const convTitle = this.selectedConversationTitle
      .split('&apos;').join("'")
      .split('&quot;').join('"')
      .split('&#96;').join('`')
      .split('&amp;').join('&');

    this.close();

    Modal.confirm(
      'Permanently Delete Conversation',
      `Permanently delete "${convTitle}" and all its messages? This cannot be undone.`,
      async () => {
        try {
          const result = await api.hardDeleteThread(convId);
          const deletedMessages = (result && (result.deleted_messages || result.deletedMessages)) || 0;
          Toast.success(deletedMessages > 0
            ? `Conversation and ${deletedMessages} message${deletedMessages === 1 ? '' : 's'} deleted`
            : 'Conversation deleted');

          if (typeof window.ConversationMenu !== 'undefined' && window.ConversationMenu.loadConversations) {
            window.ConversationMenu.loadConversations(true);
          }
          if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('conversation:deleted', {
              detail: { threadId: convId, permanent: true }
            }));
          }
          if (typeof this.onRefresh === 'function') {
            this.onRefresh();
          }
        } catch (error) {
          console.error('Failed to permanently delete conversation:', error);
          Toast.error(error.message || 'Failed to delete conversation');
        }
      },
      'Delete Permanently',
      'danger'
    );
  }
};

// Expose on window so SPA pages can register callbacks
window.ConversationActionsModal = ConversationActionsModal;

// Create global alias for backward compatibility
window.openConversationActionsModal = function(conversationId, conversationTitle, matterId, isPinned) {
  ConversationActionsModal.open(conversationId, conversationTitle, matterId, isPinned);
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
