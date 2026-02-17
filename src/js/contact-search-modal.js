/**
 * Contact Search Modal
 * Search for existing contacts across the organization and link them to a matter.
 * Supports role selection when linking via a custom styled dropdown.
 */

const ContactSearchModal = {
  modal: null,
  searchInput: null,
  resultsContainer: null,
  searchTimeout: null,
  currentMatterId: null,
  roles: [],
  selectedRoles: {},
  isOpen: false,

  /**
   * Initialize the modal (call once on page load)
   */
  init() {
    if (!document.getElementById('contactSearchModal')) {
      this.createModal();
    }

    this.modal = document.getElementById('contactSearchModal');
    this.searchInput = document.getElementById('contactSearchInput');
    this.resultsContainer = document.getElementById('contactSearchResults');

    this.setupEventListeners();
    return true;
  },

  /**
   * Create the modal HTML
   */
  createModal() {
    const modalHTML = `
      <div id="contactSearchModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4 z-50" onclick="if(event.target === this) ContactSearchModal.close()">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onclick="event.stopPropagation()">
          <!-- Modal Header -->
          <div class="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h2 class="text-xl font-semibold text-gray-900">Link Existing Contact</h2>
              <p class="text-sm text-gray-500 mt-0.5">Search contacts in your organization</p>
            </div>
            <button onclick="ContactSearchModal.close()" class="text-gray-400 hover:text-gray-600 transition-colors">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- Search Input -->
          <div class="p-6 border-b border-gray-200">
            <div class="relative">
              <input
                type="text"
                id="contactSearchInput"
                placeholder="Search by name, email, or company..."
                class="w-full pl-10 pr-4 py-3 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                autocomplete="off"
              >
              <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
              </svg>
            </div>
          </div>

          <!-- Search Results -->
          <div id="contactSearchResults" class="flex-1 overflow-y-auto p-6">
            <p class="text-gray-500 text-sm text-center py-8">Type at least 2 characters to search...</p>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  },

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    this.searchInput.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      const query = e.target.value.trim();

      if (query.length === 0) {
        this.renderEmpty('Type at least 2 characters to search...');
        return;
      }

      if (query.length < 2) {
        this.renderEmpty('Type at least 2 characters to search...');
        return;
      }

      this.searchTimeout = setTimeout(() => {
        this.performSearch(query);
      }, 300);
    });

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });

    // Close role dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[id^="role-wrapper-"]')) {
        this.closeAllDropdowns();
      }
    });
  },

  /**
   * Open the modal for a specific matter
   * @param {string} matterId - The matter to link contacts to
   */
  async open(matterId) {
    if (!this.modal) this.init();

    this.currentMatterId = matterId;
    this.selectedRoles = {};
    this.modal.classList.remove('hidden');
    this.modal.classList.add('flex');
    this.isOpen = true;

    // Load roles if not cached
    if (this.roles.length === 0) {
      await this.loadRoles();
    }

    // Clear previous search
    this.searchInput.value = '';
    this.renderEmpty('Type at least 2 characters to search...');

    setTimeout(() => {
      this.searchInput.focus();
    }, 100);
  },

  /**
   * Close the modal
   */
  close() {
    if (!this.modal) return;

    this.modal.classList.add('hidden');
    this.modal.classList.remove('flex');
    this.isOpen = false;
    this.selectedRoles = {};

    this.searchInput.value = '';
    this.renderEmpty('Type at least 2 characters to search...');
  },

  /**
   * Load available contact roles from the API
   */
  async loadRoles() {
    try {
      const response = await api.get('/api/v1/contacts/roles');
      this.roles = response.roles || [];
    } catch (error) {
      console.error('Failed to load contact roles:', error);
      // Fallback roles matching backend defaults
      this.roles = [
        { role_key: 'client', role_label: 'Client' },
        { role_key: 'lead', role_label: 'Lead' },
        { role_key: 'contact', role_label: 'Contact' },
        { role_key: 'participant', role_label: 'Participant' },
        { role_key: 'spouse', role_label: 'Spouse' },
        { role_key: 'executor', role_label: 'Executor' },
        { role_key: 'beneficiary', role_label: 'Beneficiary' },
        { role_key: 'witness', role_label: 'Witness' },
        { role_key: 'opposing_party', role_label: 'Opposing Party' },
        { role_key: 'opposing_counsel', role_label: 'Opposing Counsel' },
        { role_key: 'buyer', role_label: 'Buyer' },
        { role_key: 'seller', role_label: 'Seller' },
        { role_key: 'guarantor', role_label: 'Guarantor' },
        { role_key: 'expert', role_label: 'Expert' },
        { role_key: 'other', role_label: 'Other' }
      ];
    }
  },

  /**
   * Perform search via API
   * @param {string} query - Search query
   */
  async performSearch(query) {
    try {
      this.renderLoading();

      const encodedQuery = encodeURIComponent(query);
      const encodedMatterId = encodeURIComponent(this.currentMatterId);
      const response = await api.get(
        `/api/v1/contacts/search?q=${encodedQuery}&exclude_matter_id=${encodedMatterId}&limit=20`
      );

      const contacts = response.contacts || [];

      if (contacts.length === 0) {
        this.renderEmpty('No contacts found matching your search');
      } else {
        this.renderResults(contacts, query);
      }
    } catch (error) {
      console.error('Contact search failed:', error);
      this.renderError('Failed to search contacts');
    }
  },

  /**
   * Render search results
   * @param {Array} contacts - Array of contact objects
   * @param {string} query - Search query for highlighting
   */
  renderResults(contacts, query) {
    const html = contacts.map(contact => this.renderContactItem(contact, query)).join('');
    this.resultsContainer.innerHTML = `
      <div class="space-y-3">
        <p class="text-xs text-gray-500 mb-2">${contacts.length} contact${contacts.length !== 1 ? 's' : ''} found</p>
        ${html}
      </div>
    `;
  },

  /**
   * Get the display label for a role key
   * @param {string} roleKey - Role key
   * @returns {string} Human-readable label
   */
  getRoleLabel(roleKey) {
    for (let i = 0; i < this.roles.length; i++) {
      if (this.roles[i].role_key === roleKey) return this.roles[i].role_label;
    }
    // Fallback: capitalize and replace underscores
    return roleKey.charAt(0).toUpperCase() + roleKey.slice(1).split('_').join(' ');
  },

  /**
   * Render a single contact search result with custom role dropdown
   * @param {Object} contact - Contact object
   * @param {string} query - Search query for highlighting
   */
  renderContactItem(contact, query) {
    const displayName = contact.display_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';
    const highlightedName = this.highlightText(displayName, query);
    const highlightedEmail = contact.email ? this.highlightText(contact.email, query) : '';
    const highlightedCompany = contact.company_name ? this.highlightText(contact.company_name, query) : '';

    const escapedContactId = this.escapeAttr(contact.id);

    // Type badge
    const typeLabel = this.getTypeLabel(contact.contact_type);
    const typeBadgeColor = this.getTypeBadgeColor(contact.contact_type);

    // Set default selected role if not already chosen
    if (!this.selectedRoles[contact.id]) {
      this.selectedRoles[contact.id] = 'client';
    }
    const currentRole = this.selectedRoles[contact.id];
    const currentRoleLabel = this.getRoleLabel(currentRole);

    // Build custom role dropdown options
    const roleOptions = this.roles.map(r => {
      const isSelected = r.role_key === currentRole;
      return `
        <button
          data-role-key="${this.escapeAttr(r.role_key)}"
          onclick="event.stopPropagation(); ContactSearchModal.selectRole('${escapedContactId}', '${this.escapeAttr(r.role_key)}', '${this.escapeAttr(r.role_label)}')"
          class="w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors hover:bg-indigo-50 hover:text-indigo-700 ${isSelected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700'}"
        >
          <span>${this.escapeHtml(r.role_label)}</span>
          <svg class="w-3.5 h-3.5 role-check ${isSelected ? 'text-indigo-600' : 'hidden'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
        </button>
      `;
    }).join('');

    return `
      <div class="p-4 border border-gray-200 rounded-lg hover:border-indigo-300 transition-colors" data-contact-id="${escapedContactId}">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <p class="text-sm font-medium text-gray-900">${highlightedName}</p>
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${typeBadgeColor}">
                ${typeLabel}
              </span>
            </div>
            ${contact.title && contact.company_name ? `
              <p class="text-xs text-gray-600">${this.escapeHtml(contact.title)} at ${highlightedCompany}</p>
            ` : contact.company_name ? `
              <p class="text-xs text-gray-600">${highlightedCompany}</p>
            ` : contact.title ? `
              <p class="text-xs text-gray-600">${this.escapeHtml(contact.title)}</p>
            ` : ''}
            ${contact.email ? `
              <p class="text-xs text-indigo-600 mt-1">${highlightedEmail}</p>
            ` : ''}
            ${contact.phone_mobile || contact.phone_work ? `
              <p class="text-xs text-gray-500 mt-0.5">${this.escapeHtml(contact.phone_mobile || contact.phone_work)}</p>
            ` : ''}
          </div>
          <div class="flex flex-col items-end gap-2 flex-shrink-0">
            <!-- Custom styled role dropdown -->
            <div class="relative" id="role-wrapper-${escapedContactId}">
              <button
                onclick="event.stopPropagation(); ContactSearchModal.toggleRoleDropdown('${escapedContactId}')"
                class="flex items-center gap-1.5 text-xs font-medium border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50 hover:bg-white hover:border-indigo-300 text-gray-700 transition-all min-w-[140px] justify-between shadow-sm"
                id="role-trigger-${escapedContactId}"
              >
                <span class="flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
                  </svg>
                  <span id="role-label-${escapedContactId}" class="truncate">${this.escapeHtml(currentRoleLabel)}</span>
                </span>
                <svg class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                </svg>
              </button>
              <div id="role-dropdown-${escapedContactId}" class="hidden absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 max-h-56 overflow-y-auto">
                <div class="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 mb-1">Select Role</div>
                ${roleOptions}
              </div>
            </div>
            <button
              onclick="ContactSearchModal.linkContact('${escapedContactId}')"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
              </svg>
              Link
            </button>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Toggle a role dropdown open/closed
   * @param {string} contactId - Contact UUID
   */
  toggleRoleDropdown(contactId) {
    const dropdown = document.getElementById('role-dropdown-' + contactId);
    if (!dropdown) return;

    // Close all other dropdowns first
    this.closeAllDropdowns(contactId);

    if (dropdown.classList.contains('hidden')) {
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
    }
  },

  /**
   * Select a role for a contact
   * @param {string} contactId - Contact UUID
   * @param {string} roleKey - Role key
   * @param {string} roleLabel - Role display label
   */
  selectRole(contactId, roleKey, roleLabel) {
    this.selectedRoles[contactId] = roleKey;

    // Update trigger label
    const label = document.getElementById('role-label-' + contactId);
    if (label) label.textContent = roleLabel;

    // Update visual state in dropdown
    const dropdown = document.getElementById('role-dropdown-' + contactId);
    if (dropdown) {
      const options = dropdown.querySelectorAll('[data-role-key]');
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const optKey = opt.getAttribute('data-role-key');
        const check = opt.querySelector('.role-check');
        if (optKey === roleKey) {
          opt.classList.add('bg-indigo-50', 'text-indigo-700', 'font-medium');
          opt.classList.remove('text-gray-700');
          if (check) { check.classList.remove('hidden'); check.classList.add('text-indigo-600'); }
        } else {
          opt.classList.remove('bg-indigo-50', 'text-indigo-700', 'font-medium');
          opt.classList.add('text-gray-700');
          if (check) { check.classList.add('hidden'); }
        }
      }

      dropdown.classList.add('hidden');
    }
  },

  /**
   * Close all role dropdowns
   * @param {string} exceptId - Contact ID to keep open (optional)
   */
  closeAllDropdowns(exceptId) {
    const dropdowns = document.querySelectorAll('[id^="role-dropdown-"]');
    for (let i = 0; i < dropdowns.length; i++) {
      if (exceptId && dropdowns[i].id === 'role-dropdown-' + exceptId) continue;
      dropdowns[i].classList.add('hidden');
    }
  },

  /**
   * Link a contact to the current matter
   * @param {string} contactId - Contact UUID
   */
  async linkContact(contactId) {
    try {
      const role = this.selectedRoles[contactId] || 'client';

      // Disable the link button to prevent double-clicks
      const card = document.querySelector('[data-contact-id="' + contactId + '"]');
      const linkBtn = card ? card.querySelector('button[onclick*="linkContact"]') : null;
      if (linkBtn) {
        linkBtn.disabled = true;
        linkBtn.innerHTML = '<svg class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Linking...';
        linkBtn.classList.add('opacity-50');
      }

      await api.post('/api/v1/matters/' + this.currentMatterId + '/contacts/link', {
        contact_id: contactId,
        role
      });

      if (typeof Toast !== 'undefined' && Toast.success) {
        Toast.success('Contact linked successfully');
      }

      this.close();

      // Refresh the matter detail to show the new contact
      if (typeof refreshCurrentMatter === 'function') {
        await refreshCurrentMatter();
      }
    } catch (error) {
      console.error('Failed to link contact:', error);

      // Re-enable the button
      const card = document.querySelector('[data-contact-id="' + contactId + '"]');
      const linkBtn = card ? card.querySelector('button[onclick*="linkContact"]') : null;
      if (linkBtn) {
        linkBtn.disabled = false;
        linkBtn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg> Link';
        linkBtn.classList.remove('opacity-50');
      }

      const message = (error && error.message) ? error.message : 'Failed to link contact';
      if (typeof Toast !== 'undefined' && Toast.error) {
        Toast.error(message);
      }
    }
  },

  /**
   * Highlight search term in text using string methods (no regex)
   * @param {string} text - Text to highlight in
   * @param {string} query - Search term to highlight
   * @returns {string} HTML with highlighted matches
   */
  highlightText(text, query) {
    if (!query || !text) return this.escapeHtml(text || '');

    const escaped = this.escapeHtml(text);
    const escapedQuery = this.escapeHtml(query);
    const lowerEscaped = escaped.toLowerCase();
    const lowerQuery = escapedQuery.toLowerCase();

    // Find all occurrences without regex
    const parts = [];
    let lastIndex = 0;
    let searchFrom = 0;

    while (searchFrom < lowerEscaped.length) {
      const idx = lowerEscaped.indexOf(lowerQuery, searchFrom);
      if (idx === -1) break;

      // Add text before match
      if (idx > lastIndex) {
        parts.push(escaped.substring(lastIndex, idx));
      }
      // Add highlighted match (preserving original case)
      parts.push('<mark class="bg-yellow-200 font-medium">' + escaped.substring(idx, idx + escapedQuery.length) + '</mark>');

      lastIndex = idx + escapedQuery.length;
      searchFrom = lastIndex;
    }

    // Add remaining text
    if (lastIndex < escaped.length) {
      parts.push(escaped.substring(lastIndex));
    }

    return parts.length > 0 ? parts.join('') : escaped;
  },

  /**
   * Get human-readable contact type label
   * @param {string} contactType - Contact type string
   * @returns {string} Label
   */
  getTypeLabel(contactType) {
    if (!contactType) return 'Other';
    if (contactType.indexOf('participant') !== -1) return 'Participant';
    if (contactType.indexOf('opportunity') !== -1) return 'Opportunity';
    if (contactType.indexOf('lead') !== -1) return 'Lead';
    return 'Other';
  },

  /**
   * Get badge color classes for contact type
   * @param {string} contactType - Contact type string
   * @returns {string} Tailwind classes
   */
  getTypeBadgeColor(contactType) {
    if (!contactType) return 'bg-gray-100 text-gray-700';
    if (contactType.indexOf('participant') !== -1) return 'bg-blue-100 text-blue-700';
    if (contactType.indexOf('opportunity') !== -1) return 'bg-green-100 text-green-700';
    if (contactType.indexOf('lead') !== -1) return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-700';
  },

  /**
   * Render loading state
   */
  renderLoading() {
    this.resultsContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12">
        <div class="animate-spin rounded-full h-10 w-10 border-4 border-indigo-200 border-t-indigo-600 mb-4"></div>
        <p class="text-gray-500 text-sm">Searching contacts...</p>
      </div>
    `;
  },

  /**
   * Render empty state
   * @param {string} message - Message to display
   */
  renderEmpty(message) {
    this.resultsContainer.innerHTML = `
      <p class="text-gray-500 text-sm text-center py-8">${message}</p>
    `;
  },

  /**
   * Render error state
   * @param {string} message - Error message
   */
  renderError(message) {
    this.resultsContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12">
        <svg class="w-12 h-12 text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <p class="text-red-600 text-sm font-medium">${message}</p>
      </div>
    `;
  },

  /**
   * Escape HTML entities
   * @param {string} text - Raw text
   * @returns {string} Escaped HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Escape a string for use in HTML attributes
   * @param {string} text - Raw text
   * @returns {string} Escaped attribute value
   */
  escapeAttr(text) {
    const div = document.createElement('div');
    div.textContent = String(text);
    const escaped = div.innerHTML;
    // Also escape quotes for attribute context
    return escaped.split('"').join('&quot;').split("'").join('&#39;');
  }
};

// Global access
window.ContactSearchModal = ContactSearchModal;
