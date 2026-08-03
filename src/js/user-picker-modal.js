/**
 * User Picker Modal
 *
 * Reusable modal for picking a user (assignee, target). Mirrors the
 * pattern in `matter-picker-modal.js` so the affordance (Browse trigger +
 * full modal with search + grouped list + back chevron) is consistent
 * across "Matter / Workspace" and "User" fields throughout the app.
 *
 * Data source: GET /api/v1/mentions/search via `api.searchMentions`. When
 * a `matterId` is supplied, results are split into "Shared with this
 * matter" / "Rest of organization" sections so the user can see
 * matter-eligible assignees first. Without a matterId, a single
 * "Organization users" section is shown.
 *
 * Usage:
 *   UserPickerModal.open({
 *     heading: 'Pick a user to assign',
 *     footerHint: 'Select a user to receive this task.',
 *     matterId: 'MATT-12345',    // optional — scopes the picker
 *     onSelect: function (userId, label, userRow) { ... }
 *   });
 *
 * No regex. String methods only.
 */

const UserPickerModal = {
  modal: null,
  searchInput: null,
  listContainer: null,
  allUsers: [],           // flat list cache from the most recent open()
  matterId: null,         // current matter scope (drives section grouping)
  isOpen: false,

  _onSelect: null,
  _renderOverrides: null,
  _stylesInjected: false,

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async init() {
    if (this.modal) return true;

    await this._ensureComponents();

    var contentHtml = '';
    contentHtml += '<div style="margin-bottom:16px">';
    contentHtml += '<lex-input id="userPickerSearch" type="search" placeholder="Search users by name or email..." leading-icon="search" clearable="true"></lex-input>';
    contentHtml += '</div>';
    contentHtml += '<div id="userPickerList" style="min-height:200px;max-height:400px;overflow-y:auto">';
    contentHtml += '<div style="display:flex;align-items:center;justify-content:center;padding:32px 0"><lex-spinner></lex-spinner></div>';
    contentHtml += '</div>';
    contentHtml += '<div style="display:flex;align-items:center;justify-content:flex-start;gap:16px;margin-top:16px;padding-top:16px;border-top:1px solid var(--lex-border-subtle,rgba(0,0,0,0.06))">';
    contentHtml += '<p class="upm-footer-hint" style="font-size:var(--lex-body-sm-size,0.8125rem);color:var(--lex-text-secondary);line-height:1.5">';
    contentHtml += 'Select a user.';
    contentHtml += '</p>';
    contentHtml += '</div>';

    var modal = document.createElement('lex-modal');
    modal.heading = 'Pick a user';
    modal.size = 'lg';
    modal.hideActions = true;
    modal.innerHTML = contentHtml;

    document.body.appendChild(modal);

    this.modal = modal;
    this.listContainer = modal.querySelector('#userPickerList');
    this.searchInput = modal.querySelector('#userPickerSearch');

    if (this.searchInput) {
      // Use a small debounce — server-side search via /mentions/search is
      // cheap but every keystroke shouldn't fire its own request.
      var self = this;
      var debounceTimer = null;
      this.searchInput.addEventListener('lex-input', function (e) {
        clearTimeout(debounceTimer);
        var value = (e.detail && e.detail.value !== undefined) ? e.detail.value : '';
        debounceTimer = setTimeout(function () {
          self.loadUsers(value);
        }, 180);
      });
    }

    modal.addEventListener('lex-close', () => {
      this.isOpen = false;
      if (this.searchInput) this.searchInput.value = '';
    });

    return true;
  },

  // ── Open / Close ────────────────────────────────────────────────────────

  /**
   * @param {Object} [options]
   * @param {Function} [options.onSelect] - Callback(userId, label, userRow)
   * @param {string}   [options.matterId] - Matter scope (UUID or matter_id)
   * @param {string}   [options.heading]
   * @param {string}   [options.footerHint]
   */
  async open(options) {
    await this.init();
    var opts = options || {};
    this._onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;
    this._renderOverrides = {
      heading:    opts.heading    || null,
      footerHint: opts.footerHint || null
    };
    this.matterId = opts.matterId || null;

    if (this._renderOverrides.heading) {
      this.modal.heading = this._renderOverrides.heading;
    } else {
      this.modal.heading = 'Pick a user';
    }
    var footer = this.modal.querySelector('.upm-footer-hint');
    if (footer) {
      footer.textContent = this._renderOverrides.footerHint
        || (this.matterId
            ? 'Pick someone who has access to this matter.'
            : 'Pick a user in your organization.');
    }

    // Picker-mode chrome: left chevron, no X close. The user-picker is
    // always opened from another modal, so it's always in picker mode —
    // no need for a "default" non-picker mode.
    this.modal.classList.add('upm-picker-mode');
    setTimeout(this._ensurePickerChrome.bind(this), 0);

    this.modal.open = true;
    this.isOpen = true;

    if (this.searchInput) this.searchInput.value = '';
    await this.loadUsers('');
  },

  close() {
    if (this.modal) {
      this.modal.open = false;
      this.isOpen = false;
      if (this.searchInput) this.searchInput.value = '';
    }
    this._onSelect = null;
    this._renderOverrides = null;
    this.matterId = null;
  },

  // ── Data loading ────────────────────────────────────────────────────────

  async loadUsers(query) {
    if (!this.listContainer) return;
    try {
      var response = await api.searchMentions({
        q: query || '',
        matter_id: this.matterId || undefined,
        limit: 40
      });
      this.renderResults(response, query);
    } catch (error) {
      console.error('[UserPickerModal] Failed to load users:', error);
      this.listContainer.innerHTML = '<p style="text-align:center;color:var(--lex-color-danger-500);padding:32px 0">Failed to load users. Please try again.</p>';
    }
  },

  // ── Rendering ───────────────────────────────────────────────────────────

  renderResults(payload, query) {
    if (!this.listContainer) return;
    var groups = (payload && Array.isArray(payload.groups)) ? payload.groups : null;
    var flat = (payload && Array.isArray(payload.matches)) ? payload.matches : [];

    // Only show share-eligible rows (real users), not synced contacts or
    // agent rows — the picker's purpose is task assignment.
    function isAssignable(row) {
      return row && row.share_eligible !== false && row.kind !== 'agent' && row.kind !== 'contact';
    }

    var html = '';
    if (groups && groups.length > 0) {
      groups.forEach(function (group) {
        var rows = (group.matches || []).filter(isAssignable);
        if (!rows.length) return;
        // Don't bother showing "Matter participants & contacts" / "Agents"
        // sections — those aren't assignable. The remaining sections
        // (shared, org) are exactly what we want for picking an assignee.
        if (group.key !== 'shared' && group.key !== 'org') return;
        html += '<p style="font-size:var(--lex-body-xs-size,0.75rem);font-weight:600;color:var(--lex-text-tertiary);text-transform:uppercase;letter-spacing:0.05em;margin:0 0 10px">' + UserPickerModal.escapeHtml(group.label || group.key) + '</p>';
        html += rows.map(UserPickerModal.renderUserItem).join('');
      });
    } else if (flat.length > 0) {
      html += flat.filter(isAssignable).map(UserPickerModal.renderUserItem).join('');
    }

    if (!html) {
      var msg = query
        ? 'No users match your search.'
        : 'No users found in this scope.';
      this.listContainer.innerHTML = '<p style="color:var(--lex-text-tertiary);text-align:center;padding:32px 0">' + msg + '</p>';
      return;
    }
    this.listContainer.innerHTML = html;
  },

  renderUserItem(user) {
    var id = user.share_target_user_id || user.id || '';
    if (!id) return '';
    var label = user.label || user.username || user.email || 'User';
    var sub = user.email || user.username || '';
    var safeId = UserPickerModal.escapeHtml(id);
    var safeLabel = UserPickerModal.escapeHtml(label);
    var safeLabelJs = UserPickerModal.escapeJs(label);
    var safeSub = UserPickerModal.escapeHtml(sub);

    return '<div class="upm-user-item" style="padding:12px 14px;border-radius:var(--lex-radius-md,8px);border:1px solid var(--lex-border-subtle,rgba(0,0,0,0.08));cursor:pointer;margin-bottom:8px;transition:border-color 0.15s,background 0.15s" '
      + 'onmouseenter="this.style.borderColor=\'var(--lex-border-accent,#6366f1)\';this.style.background=\'var(--lex-bg-secondary)\'" '
      + 'onmouseleave="this.style.borderColor=\'var(--lex-border-subtle,rgba(0,0,0,0.08))\';this.style.background=\'transparent\'" '
      + 'onclick="UserPickerModal.selectUser(\'' + safeId + '\', \'' + safeLabelJs + '\')">'
      + '<div style="font-weight:500;color:var(--lex-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + safeLabel + '</div>'
      + (sub ? '<p style="font-size:var(--lex-body-sm-size,0.8125rem);color:var(--lex-text-secondary);margin:2px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + safeSub + '</p>' : '')
      + '</div>';
  },

  // ── Selection ───────────────────────────────────────────────────────────

  selectUser(userId, label) {
    if (typeof this._onSelect === 'function') {
      var cb = this._onSelect;
      this.close();
      try {
        cb(userId, label, null);
      } catch (cbErr) {
        console.error('[UserPickerModal] onSelect callback threw:', cbErr);
      }
      return;
    }
    this.close();
  },

  // ── Picker chrome ───────────────────────────────────────────────────────

  _ensurePickerChrome() {
    if (!this.modal) return;
    var header = this.modal.querySelector('.lex-modal-header');
    if (!header) return;

    this._injectPickerStyles();

    if (header.querySelector('.upm-back-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'upm-back-btn';
    btn.setAttribute('aria-label', 'Go back');
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    btn.addEventListener('click', function () { UserPickerModal.close(); });
    header.insertBefore(btn, header.firstChild);
  },

  _injectPickerStyles() {
    if (this._stylesInjected) return;
    this._stylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-source', 'user-picker-modal');
    style.textContent = [
      'lex-modal.upm-picker-mode .lex-modal-close { display: none !important; }',
      'lex-modal.upm-picker-mode .lex-modal-header {',
      '  justify-content: flex-start !important;',
      '  gap: 8px;',
      '}',
      'lex-modal.upm-picker-mode .lex-modal-title {',
      '  flex: 0 1 auto;',
      '  margin-right: auto;',
      '}',
      '.upm-back-btn {',
      '  display: inline-flex; align-items: center; justify-content: center;',
      '  width: 32px; height: 32px;',
      '  background: transparent; border: none; padding: 0;',
      '  margin: 0 4px 0 -6px;',
      '  color: var(--lex-text-secondary, #555);',
      '  border-radius: var(--lex-radius-md, 8px);',
      '  cursor: pointer;',
      '  transition: background 0.15s, color 0.15s;',
      '  flex-shrink: 0;',
      '}',
      '.upm-back-btn:hover, .upm-back-btn:focus-visible {',
      '  background: var(--lex-bg-secondary, rgba(0,0,0,0.05));',
      '  color: var(--lex-text-primary);',
      '  outline: none;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  },

  // ── Component lazy-loading ───────────────────────────────────────────────

  async _ensureComponents() {
    var needed = [];
    if (!customElements.get('lex-modal')) needed.push('js/lex/components/foundation/lex-modal.js');
    if (!customElements.get('lex-input')) needed.push('js/lex/components/form/lex-input.js');
    if (needed.length === 0) return;

    var prefix = '';
    if (typeof NavigationHelpers !== 'undefined' && NavigationHelpers.resolvePath) {
      prefix = NavigationHelpers.resolvePath('');
    }
    await Promise.all(needed.map(function (src) {
      return new Promise(function (resolve) {
        var script = document.createElement('script');
        script.src = prefix + src;
        script.onload = resolve;
        script.onerror = resolve;
        document.head.appendChild(script);
      });
    }));
    // Yield once so customElements has a chance to register.
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
  },

  // ── Utils ───────────────────────────────────────────────────────────────

  escapeHtml(value) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '&')      out += '&amp;';
      else if (c === '<') out += '&lt;';
      else if (c === '>') out += '&gt;';
      else if (c === '"') out += '&quot;';
      else if (c === "'") out += '&#39;';
      else                out += c;
    }
    return out;
  },

  escapeJs(value) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\')      out += '\\\\';
      else if (c === "'")  out += "\\'";
      else if (c === '"')  out += '\\"';
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else                 out += c;
    }
    return out;
  }
};

// Expose globally so inline onclick handlers in renderUserItem can find it.
if (typeof window !== 'undefined') {
  window.UserPickerModal = UserPickerModal;
}
