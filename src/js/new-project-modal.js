/**
 * New Project Modal
 * Reusable modal for creating new matter-based conversations.
 * Uses <lex-modal> and <lex-input> from the Lex UI framework.
 * Works on any page — creates the modal element on first open.
 *
 * No regex. String methods only.
 */

const NewProjectModal = {
  /** @type {HTMLElement|null} lex-modal element */
  modal: null,
  /** @type {HTMLElement|null} lex-input search element */
  searchInput: null,
  /** @type {HTMLElement|null} matters list container */
  listContainer: null,
  /** @type {Array} loaded matters */
  allMatters: [],
  /** @type {boolean} */
  isOpen: false,

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Create the <lex-modal> element and wire events.
   * Called once on first open().
   * Returns a Promise that resolves when the modal is ready.
   */
  async init() {
    if (this.modal) return true;

    // Lazy-load lex-modal and lex-input if not already registered.
    // This avoids adding script tags to 40+ standalone HTML pages.
    await this._ensureComponents();

    // Build modal content: search + list + footer
    var contentHtml = '';

    // Search
    contentHtml += '<div style="margin-bottom:16px">';
    contentHtml += '<lex-input id="newProjectMatterSearch" type="search" placeholder="Search matters by name, client, or number..." leading-icon="search" clearable="true"></lex-input>';
    contentHtml += '</div>';

    // Matters list
    contentHtml += '<div id="newProjectMattersList" style="min-height:200px;max-height:400px;overflow-y:auto">';
    contentHtml += '<div style="display:flex;align-items:center;justify-content:center;padding:32px 0"><lex-spinner></lex-spinner></div>';
    contentHtml += '</div>';

    // Footer
    contentHtml += '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px;padding-top:16px;border-top:1px solid var(--lex-border-subtle,rgba(0,0,0,0.06))">';
    contentHtml += '<p style="font-size:var(--lex-body-sm-size,0.8125rem);color:var(--lex-text-secondary);line-height:1.5">';
    contentHtml += 'Select a matter to start a new conversation.';
    contentHtml += '</p>';
    contentHtml += '<lex-btn id="newProjectCreateBtn" variant="primary" size="sm">+ Create Matter</lex-btn>';
    contentHtml += '</div>';

    // Create <lex-modal>
    var modal = document.createElement('lex-modal');
    modal.heading = 'Start New Chat';
    modal.size = 'lg';
    modal.hideActions = true;
    modal.innerHTML = contentHtml;

    document.body.appendChild(modal);

    this.modal = modal;
    this.listContainer = modal.querySelector('#newProjectMattersList');
    this.searchInput = modal.querySelector('#newProjectMatterSearch');

    // Wire search input
    if (this.searchInput) {
      this.searchInput.addEventListener('lex-input', (e) => {
        this.filterMatters(e.detail ? e.detail.value : '');
      });
    }

    // Wire create matter button
    var createBtn = modal.querySelector('#newProjectCreateBtn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        this.createNewMatter();
      });
    }

    // Wire close event — reset search on close
    modal.addEventListener('lex-close', () => {
      this.isOpen = false;
      if (this.searchInput) {
        this.searchInput.value = '';
      }
    });

    return true;
  },

  // ── Open / Close ────────────────────────────────────────────────────────

  async open() {
    await this.init();

    this.modal.open = true;
    this.isOpen = true;

    // Load matters
    await this.loadMatters();
  },

  close() {
    if (this.modal) {
      this.modal.open = false;
      this.isOpen = false;
      if (this.searchInput) {
        this.searchInput.value = '';
      }
    }
  },

  // ── Data loading ────────────────────────────────────────────────────────

  async loadMatters() {
    try {
      var response = await api.getMatters(1, 100, { status: 'active' });
      this.allMatters = response.matters || [];
      this.renderDefaultView();
    } catch (error) {
      console.error('[NewProjectModal] Failed to load matters:', error);
      if (this.listContainer) {
        this.listContainer.innerHTML = '<p style="text-align:center;color:var(--lex-color-danger-500);padding:32px 0">Failed to load matters. Please try again.</p>';
      }
    }
  },

  // ── Filtering ───────────────────────────────────────────────────────────

  filterMatters(query) {
    if (!query) {
      this.renderDefaultView();
      return;
    }

    var lowerQuery = query.toLowerCase();
    var filtered = this.allMatters.filter(function (matter) {
      var matterName = (matter.name || matter.matter_name || '').toLowerCase();
      var clientName = (matter.client_name || (matter.client && matter.client.name) || '').toLowerCase();
      var matterId = (matter.matter_id || '').toLowerCase();

      return matterName.indexOf(lowerQuery) !== -1 ||
             clientName.indexOf(lowerQuery) !== -1 ||
             matterId.indexOf(lowerQuery) !== -1;
    });

    this.renderSearchResults(filtered);
  },

  // ── Rendering ───────────────────────────────────────────────────────────

  renderDefaultView() {
    if (!this.listContainer) return;

    if (this.allMatters.length === 0) {
      this.listContainer.innerHTML = '<p style="color:var(--lex-text-tertiary);text-align:center;padding:32px 0">No matters found</p>';
      return;
    }

    var pinnedMatters = this.allMatters.filter(function (m) { return m.is_pinned || m.pinned; });
    var unpinnedMatters = this.allMatters.filter(function (m) { return !m.is_pinned && !m.pinned; });

    var recentMatters = unpinnedMatters
      .sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); })
      .slice(0, 10);

    var html = '';

    if (pinnedMatters.length > 0) {
      html += '<div style="margin-bottom:20px">';
      html += '<p style="font-size:var(--lex-body-xs-size,0.75rem);font-weight:600;color:var(--lex-text-tertiary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Pinned Matters</p>';
      html += pinnedMatters.map(function (m) { return NewProjectModal.renderMatterItem(m, true); }).join('');
      html += '</div>';
    }

    if (recentMatters.length > 0) {
      html += '<div style="margin-bottom:20px">';
      html += '<p style="font-size:var(--lex-body-xs-size,0.75rem);font-weight:600;color:var(--lex-text-tertiary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Recent Matters</p>';
      html += recentMatters.map(function (m) { return NewProjectModal.renderMatterItem(m, false); }).join('');
      html += '</div>';
    }

    this.listContainer.innerHTML = html;
  },

  renderSearchResults(matters) {
    if (!this.listContainer) return;

    if (matters.length === 0) {
      this.listContainer.innerHTML = '<p style="color:var(--lex-text-tertiary);text-align:center;padding:32px 0">No matters found matching your search</p>';
      return;
    }

    var html = '<p style="font-size:var(--lex-body-sm-size,0.8125rem);color:var(--lex-text-secondary);margin-bottom:12px">' + matters.length + ' result' + (matters.length !== 1 ? 's' : '') + ' found</p>';
    html += matters.map(function (m) { return NewProjectModal.renderMatterItem(m, false); }).join('');

    this.listContainer.innerHTML = html;
  },

  renderMatterItem(matter, isPinned) {
    var clientName = matter.client_name || (matter.client && matter.client.name) || 'Unknown Client';
    var matterIdString = matter.matter_id;
    var matterName = matter.name || matter.matter_name || 'Untitled Matter';
    var status = matter.status || 'Active';

    if (!matterIdString) {
      console.warn('[NewProjectModal] Matter missing matter_id:', matter);
      return '';
    }

    var safeName = this.escapeHtml(matterName);
    var safeNameJs = this.escapeJs(matterName);
    var safeClient = this.escapeHtml(clientName);
    var safeId = this.escapeHtml(matterIdString);

    var statusColor = status === 'Active'
      ? 'background:var(--lex-color-success-100,#dcfce7);color:var(--lex-color-success-700,#15803d)'
      : 'background:var(--lex-color-gray-100);color:var(--lex-color-gray-600)';

    var pinHtml = isPinned
      ? '<svg style="width:14px;height:14px;color:var(--lex-color-warning-500,#eab308);flex-shrink:0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>'
      : '';

    return '<div class="npm-matter-item" style="padding:12px 14px;border-radius:var(--lex-radius-md,8px);border:1px solid var(--lex-border-subtle,rgba(0,0,0,0.08));cursor:pointer;margin-bottom:8px;transition:border-color 0.15s,background 0.15s" '
      + 'onmouseenter="this.style.borderColor=\'var(--lex-border-accent,#6366f1)\';this.style.background=\'var(--lex-bg-secondary)\'" '
      + 'onmouseleave="this.style.borderColor=\'var(--lex-border-subtle,rgba(0,0,0,0.08))\';this.style.background=\'transparent\'" '
      + 'onclick="NewProjectModal.selectMatter(\'' + safeId + '\', \'' + safeNameJs + '\')">'
      + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">'
      + pinHtml
      + '<span style="font-weight:500;color:var(--lex-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + safeName + '</span>'
      + '<span style="font-size:var(--lex-body-xs-size,0.6875rem);padding:1px 8px;border-radius:9999px;white-space:nowrap;' + statusColor + '">' + status + '</span>'
      + '</div>'
      + '<p style="font-size:var(--lex-body-sm-size,0.8125rem);color:var(--lex-text-secondary);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + safeClient + '</p>'
      + '<p style="font-size:var(--lex-body-xs-size,0.75rem);color:var(--lex-text-tertiary);margin:2px 0 0">' + safeId + '</p>'
      + '</div>';
  },

  // ── Matter selection ────────────────────────────────────────────────────

  /**
   * Validate matter ID format.
   * Accepts: MATT-XXXXX (native), AS-XXXXX (ActionStep), numeric (legacy).
   * Uses string methods — no regex.
   */
  validateMatterId(matterId) {
    if (!matterId) return false;
    var s = String(matterId);
    if (s.length === 0) return false;

    var lower = s.toLowerCase();
    if (lower.indexOf('matt-') === 0) return true;
    if (lower.indexOf('as-') === 0) return true;
    if (lower.indexOf('matter_') === 0) return true;

    // Legacy numeric IDs
    var allDigits = true;
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code < 48 || code > 57) { allDigits = false; break; }
    }
    return allDigits;
  },

  async selectMatter(matterId, matterName) {
    try {
      this.close();

      if (!this.validateMatterId(matterId)) {
        console.error('[NewProjectModal] Invalid matter_id format:', matterId);
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.show('Invalid matter ID. Please try again.', 'error');
        }
        return;
      }

      var matterIdString = String(matterId);
      console.log('[NewProjectModal] Matter selected:', { matterId: matterIdString, matterName: matterName });

      var isOnChatPage = NavigationHelpers.isOnChatPage();

      if (isOnChatPage && typeof window.createProjectChat === 'function') {
        await window.createProjectChat(matterIdString, matterName);
      } else {
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.show('Opening chat for ' + matterName + '...', 'success');
        }
        NavigationHelpers.navigateToMatterChat(matterIdString);
      }
    } catch (error) {
      console.error('[NewProjectModal] Failed to select matter:', error);
      if (window.Lex && window.Lex.Toast) {
        window.Lex.Toast.show('Failed to start chat. Please try again.', 'error');
      }
    }
  },

  // ── Actions ─────────────────────────────────────────────────────────────

  createNewMatter() {
    this.close();
    window.location.href = NavigationHelpers.resolvePath('matters.html') + '?action=create';
  },

  // ── Component lazy-loading ───────────────────────────────────────────────

  /**
   * Ensure lex-modal and lex-input custom elements are defined.
   * On standalone pages (not app.html), these may not be loaded yet.
   * Dynamically injects <script> tags and waits for them to register.
   */
  async _ensureComponents() {
    var needed = [];

    if (!customElements.get('lex-modal')) {
      needed.push('js/lex/components/foundation/lex-modal.js');
    }
    if (!customElements.get('lex-input')) {
      needed.push('js/lex/components/form/lex-input.js');
    }

    if (needed.length === 0) return;

    // Resolve paths relative to current page (handles admin/ subfolders)
    var prefix = '';
    if (typeof NavigationHelpers !== 'undefined' && NavigationHelpers.resolvePath) {
      // resolvePath returns e.g. '../js/...' from admin pages
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
          console.warn('[NewProjectModal] Failed to load:', src);
          resolve(); // don't block the modal
        };
        document.head.appendChild(script);
      });
    }));
  },

  // ── Utilities ───────────────────────────────────────────────────────────

  escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  escapeJs(text) {
    if (!text) return '';
    return String(text)
      .split('\\').join('\\\\')
      .split("'").join("\\'")
      .split('"').join('\\"')
      .split('\n').join('\\n')
      .split('\r').join('\\r');
  }
};

// Global function for opening the modal (called from sidebar buttons)
window.openNewProjectModal = function () {
  NewProjectModal.open();
};

// Export for use across the application
if (typeof window !== 'undefined') {
  window.NewProjectModal = NewProjectModal;
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NewProjectModal;
}
