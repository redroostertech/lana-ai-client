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
// Legacy facade over Lex.Modal (docs/TABLE-STANDARD.md section 11). Keeps the
// original signatures: show({ title, content, onConfirm, onCancel,
// confirmText, cancelText, type }) returns the dialog element, and string
// content is trusted HTML exactly as before. Pages that call it must load
// lex.core.js and components/foundation/lex-modal.js.
const Modal = {
  _variant(type) {
    return ['danger', 'success', 'info'].indexOf(type) >= 0 ? type : 'default';
  },

  show(options) {
    const { title, content, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', type = 'default' } = options;
    let body = content;
    if (typeof content === 'string') body = `<p class="lex-modal-body-text">${content}</p>`;
    else if (!(window.Node && content instanceof window.Node)) body = '';

    let settled = false;
    const modal = window.Lex.Modal.open({
      heading: title,
      content: body,
      variant: this._variant(type),
      confirmText,
      cancelText,
      hideActions: false,
      onConfirm: () => {
        settled = true;
        onConfirm?.();
      }
    });
    const cancel = () => {
      if (settled) return;
      settled = true;
      onCancel?.();
    };
    modal.addEventListener('lex-cancel', cancel);
    modal.addEventListener('lex-close', cancel);
    return modal;
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

// The hand-built DataTable class that lived here had no callers; record
// lists use <lex-table> (docs/TABLE-STANDARD.md).

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

  // Build the actions <lex-modal> on first use (it owns the backdrop, header
  // close button, Escape, focus trap and scroll lock). Safe to call on every
  // SPA init; it no-ops once the modal exists on the page.
  init() {
    this._ensureActionsModal();
  },

  // Resolves the actions <lex-modal>, loading lex components if the page
  // has not. The element keeps the legacy #conversationActionsModal id.
  async _ensureActionsModal() {
    var existing = document.getElementById('conversationActionsModal');
    if (existing && existing === this._boundActionsModal) return existing;
    if (this._actionsModalPending) return this._actionsModalPending;

    var self = this;
    this._actionsModalPending = this._ensureLexComponents().then(function () {
      self._actionsModalPending = null;
      var current = document.getElementById('conversationActionsModal');
      if (current && current === self._boundActionsModal) return current;
      if (current) current.remove();

      var modal = document.createElement('lex-modal');
      modal.id = 'conversationActionsModal';
      modal.heading = 'Conversation Options';
      modal.size = 'md';
      modal.hideActions = true;
      modal.innerHTML =
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
        '</div>';
      // Escape, the header close button and the backdrop dismiss the modal
      // on their own; clear the selection the same way close() does.
      modal.addEventListener('lex-close', function () { self._clearSelection(); });
      document.body.appendChild(modal);
      self._boundActionsModal = modal;
      return modal;
    });
    return this._actionsModalPending;
  },

  // Ensure lex-modal, lex-input, and lex-btn custom elements are defined.
  // On standalone pages (not app.html), they may not be loaded yet — inject
  // <script> tags and wait for them to register. Mirrors MatterPickerModal._ensureComponents().
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
    // Footer: data-slot="footer" lex-btns replace the built-in confirm/cancel;
    // Rename submits the form from the footer (lex-btn form="id").
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
      '<lex-btn data-slot="footer" id="renameCancelBtn" variant="secondary" type="button">Cancel</lex-btn>' +
      '<lex-btn data-slot="footer" id="renameConfirmBtn" variant="primary" type="submit" form="renameConversationForm">Rename</lex-btn>';

    document.body.appendChild(modal);

    this._renameModal = modal;
    this._renameInput = modal.querySelector('#renameInput');

    var self = this;

    // Footer button wiring.
    var cancelBtn = modal.querySelector('#renameCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () { self.closeRename(); });
    }
    // Rename is type="submit" form="renameConversationForm": the submit
    // listener below handles it.

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

    // Inject minimal styling for the form layout (no inline styles
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
      '.rename-conversation-form { display: block; }'
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
  // Resolves once the modal is showing (it may first load lex components).
  async open(conversationId, conversationTitle, matterId, isPinned, options) {
    options = options || {};

    this.selectedConversationId = options.registryId || conversationId;
    this.selectedConversationRegistryId = options.registryId || conversationId;
    this.selectedConversationThreadId = options.threadId || conversationId;
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

    const modal = await this._ensureActionsModal();
    if (!modal) return;

    modal.querySelector('#modalConversationTitle').textContent = decodedTitle;

    // Show/hide matter details button
    const matterBtn = modal.querySelector('#viewMatterDetailsBtn');
    if (matterId && matterId !== 'null') {
      matterBtn.classList.remove('hidden');
    } else {
      matterBtn.classList.add('hidden');
    }

    // Update Pin/Unpin label + icon based on current state
    const pinLabel = modal.querySelector('#togglePinConversationLabel');
    const pinDesc = modal.querySelector('#togglePinConversationDescription');
    const pinIcon = modal.querySelector('#togglePinConversationIcon');
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
    modal.open = true;
  },

  // Close conversation actions modal
  close() {
    const modal = document.getElementById('conversationActionsModal');
    if (modal) modal.open = false;
    this._clearSelection();
  },

  _clearSelection() {
    this.selectedConversationId = null;
    this.selectedConversationTitle = null;
    this.selectedConversationIsProject = false;
    this.selectedConversationMatterId = null;
    this.selectedConversationRegistryId = null;
    this.selectedConversationThreadId = null;
  },

  // Edit conversation (open rename modal). Returns a Promise so callers/tests
  // can await modal-ready, but legacy call sites continue to work without await.
  async editConversation() {
    if (!this.selectedConversationId || !this.selectedConversationTitle) {
      Toast.error('No conversation selected');
      this.close();
      return;
    }

    // Hide actions modal (keeps the selection for the rename)
    const actionsModal = document.getElementById('conversationActionsModal');
    if (actionsModal) actionsModal.open = false;

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
    const threadId = this.selectedConversationRegistryId || this.selectedConversationId;
    const streamThreadId = this.selectedConversationThreadId || threadId;

    // Delegate to the shared rename helper. It validates the title, updates
    // /api/v1/conversations/:id, and dispatches `conversation:renamed` so
    // mounted views can self-refresh.
    const helper = (typeof window !== 'undefined') ? window.RenameConversation : null;
    if (!helper || typeof helper.renameConversation !== 'function') {
      console.error('RenameConversation helper not loaded — falling back to inline canonical update.');
      try {
        const trimmed = (rawTitle || '').trim();
        if (!trimmed) {
          Toast.error('Conversation name cannot be empty');
          return;
        }
        await api.updateConversation(threadId, { title: trimmed });
        Toast.success('Conversation renamed successfully');
        this.closeRename();
        if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
          window.dispatchEvent(new CustomEvent('conversation:renamed', {
            detail: { threadId: streamThreadId, registryId: threadId, title: trimmed }
          }));
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
        eventThreadId: streamThreadId,
        registryId: threadId,
        title: rawTitle
      });

      Toast.success('Conversation renamed successfully');
      this.closeRename();

      // Refresh page-level content (e.g. search results). Other mounted views
      // observe the `conversation:renamed` event dispatched by the helper.
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

  // Delete conversation (soft archive)
  async deleteConversation() {
    if (!this.selectedConversationId || !this.selectedConversationTitle) {
      Toast.error('No conversation selected');
      this.close();
      return;
    }

    // Capture values before close() clears state
    const convId = this.selectedConversationThreadId || this.selectedConversationId;
    const registryId = this.selectedConversationRegistryId || this.selectedConversationId;
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
          await api.deleteConversation(convId);
          Toast.success('Conversation archived');

          if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('conversation:archived', {
              detail: { threadId: convId, registryId: registryId }
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

    const convId = this.selectedConversationRegistryId || this.selectedConversationId;
    const streamThreadId = this.selectedConversationThreadId || convId;
    const wasPinned = this.selectedConversationIsPinned;
    const onRefresh = this.onRefresh;
    this.close();

    try {
      if (wasPinned) {
        await api.unpinConversation(convId);
        Toast.success('Conversation unpinned');
      } else {
        await api.pinConversation(convId);
        Toast.success('Conversation pinned');
      }

      if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('conversation:pin-changed', {
          detail: { threadId: streamThreadId, registryId: convId, isPinned: !wasPinned }
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

  // Hard delete (cannot be recovered)
  async permanentDeleteConversation() {
    if (!this.selectedConversationId || !this.selectedConversationTitle) {
      Toast.error('No conversation selected');
      this.close();
      return;
    }

    const convId = this.selectedConversationRegistryId || this.selectedConversationId;
    const streamThreadId = this.selectedConversationThreadId || convId;
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
          const result = await api.deleteConversation(convId, { permanent: true });
          const payload = (result && (result.data || result)) || {};
          const deletedMessages = payload.deleted_messages || payload.deletedMessages || 0;
          Toast.success(deletedMessages > 0
            ? `Conversation and ${deletedMessages} message${deletedMessages === 1 ? '' : 's'} deleted`
            : 'Conversation deleted');

          if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('conversation:deleted', {
              detail: { threadId: streamThreadId, registryId: convId, permanent: true }
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
window.openConversationActionsModal = function(conversationId, conversationTitle, matterId, isPinned, options) {
  ConversationActionsModal.open(conversationId, conversationTitle, matterId, isPinned, options);
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
