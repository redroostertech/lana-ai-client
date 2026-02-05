// src/js/conflict-detection.js
// Conflict Detection UI Module
// Handles party management and conflict checking for legal matters

class ConflictDetection {
  constructor(apiClient) {
    this.api = apiClient;
    this.parties = [];
    this.conflicts = [];
    this.conflictsCleared = false;
  }

  /**
   * Initialize the conflict detection UI in a container
   * @param {string} containerId - ID of the container element
   */
  initialize(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Conflict detection container not found: ${containerId}`);
      return;
    }

    container.innerHTML = this.render();
    this.attachEventListeners();
  }

  /**
   * Render the parties and conflict detection UI
   */
  render() {
    return `
      <div id="conflictDetectionSection" class="space-y-4">
        <!-- Parties section removed - entity extraction will be handled via matter description analysis -->
      </div>
    `;
  }

  /**
   * Render the list of parties
   */
  renderPartiesList() {
    if (this.parties.length === 0) {
      return `
        <div class="text-sm text-gray-500 italic text-center py-4 border border-dashed border-gray-300 rounded-lg">
          No parties added yet. Click "Add Party" to begin.
        </div>
      `;
    }

    return this.parties.map((party, index) => this.renderPartyCard(party, index)).join('');
  }

  /**
   * Render a single party card
   */
  renderPartyCard(party, index) {
    const typeColors = {
      client: 'bg-blue-100 text-blue-800',
      opposing_party: 'bg-red-100 text-red-800',
      opposing_counsel: 'bg-purple-100 text-purple-800',
      witness: 'bg-green-100 text-green-800',
      expert: 'bg-yellow-100 text-yellow-800',
      judge: 'bg-gray-100 text-gray-800',
      arbitrator: 'bg-indigo-100 text-indigo-800',
      mediator: 'bg-teal-100 text-teal-800',
      other: 'bg-gray-100 text-gray-800'
    };

    const typeLabel = party.party_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const typeClass = typeColors[party.party_type] || typeColors.other;

    return `
      <div class="border border-gray-200 rounded-lg p-3 bg-white hover:shadow-sm transition-shadow">
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h4 class="text-sm font-medium text-gray-900">${this.escapeHtml(party.party_name)}</h4>
              <span class="px-2 py-0.5 text-xs font-medium rounded-full ${typeClass}">${typeLabel}</span>
            </div>
            <div class="space-y-0.5 text-xs text-gray-600">
              ${party.party_email ? `<div class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg><span>${this.escapeHtml(party.party_email)}</span></div>` : ''}
              ${party.party_phone ? `<div class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg><span>${this.escapeHtml(party.party_phone)}</span></div>` : ''}
              ${party.party_organization ? `<div class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg><span>${this.escapeHtml(party.party_organization)}</span></div>` : ''}
              ${party.party_role ? `<div class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg><span>${this.escapeHtml(party.party_role)}</span></div>` : ''}
            </div>
          </div>
          <button type="button" onclick="conflictDetection.removeParty(${index})" class="text-gray-400 hover:text-red-600 p-1 flex-shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    const addPartyBtn = document.getElementById('addPartyBtn');
    const savePartyBtn = document.getElementById('savePartyBtn');
    const cancelPartyBtn = document.getElementById('cancelPartyBtn');

    if (addPartyBtn) {
      addPartyBtn.addEventListener('click', () => this.showAddPartyForm());
    }

    if (savePartyBtn) {
      savePartyBtn.addEventListener('click', () => this.saveParty());
    }

    if (cancelPartyBtn) {
      cancelPartyBtn.addEventListener('click', () => this.hideAddPartyForm());
    }
  }

  /**
   * Show the add party form
   */
  showAddPartyForm() {
    const form = document.getElementById('addPartyForm');
    if (form) {
      form.classList.remove('hidden');
      document.getElementById('partyName')?.focus();
    }
  }

  /**
   * Hide the add party form and reset fields
   */
  hideAddPartyForm() {
    const form = document.getElementById('addPartyForm');
    if (form) {
      form.classList.add('hidden');
      this.resetPartyForm();
    }
  }

  /**
   * Reset the party form fields
   */
  resetPartyForm() {
    document.getElementById('partyName').value = '';
    document.getElementById('partyType').value = '';
    document.getElementById('partyEmail').value = '';
    document.getElementById('partyPhone').value = '';
    document.getElementById('partyOrganization').value = '';
    document.getElementById('partyRole').value = '';
  }

  /**
   * Save a new party and check for conflicts
   */
  async saveParty() {
    const party = {
      party_name: document.getElementById('partyName').value.trim(),
      party_type: document.getElementById('partyType').value,
      party_email: document.getElementById('partyEmail').value.trim() || null,
      party_phone: document.getElementById('partyPhone').value.trim() || null,
      party_organization: document.getElementById('partyOrganization').value.trim() || null,
      party_role: document.getElementById('partyRole').value.trim() || null
    };

    // Validation
    if (!party.party_name) {
      this.showError('Party name is required');
      return;
    }

    if (!party.party_type) {
      this.showError('Party type is required');
      return;
    }

    // Add party to list
    this.parties.push(party);

    // Check for conflicts
    await this.checkConflicts();

    // Update UI
    this.refreshPartiesList();
    this.hideAddPartyForm();
  }

  /**
   * Remove a party from the list
   */
  async removeParty(index) {
    this.parties.splice(index, 1);

    // Re-check conflicts after removal
    await this.checkConflicts();

    // Update UI
    this.refreshPartiesList();
  }

  /**
   * Refresh the parties list display
   */
  refreshPartiesList() {
    const partiesList = document.getElementById('partiesList');
    if (partiesList) {
      partiesList.innerHTML = this.renderPartiesList();
    }
  }

  /**
   * Check for conflicts with all current parties
   */
  async checkConflicts(excludeMatterId = null) {
    if (this.parties.length === 0) {
      this.conflicts = [];
      this.hideConflictWarning();
      return;
    }

    try {
      const baseUrl = this.api.baseUrl || this.api.config?.API_BASE_URL || '';
      const response = await fetch(`${baseUrl}/api/v1/conflicts/check`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.api.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          parties: this.parties,
          exclude_matter_id: excludeMatterId
        })
      });

      if (!response.ok) {
        throw new Error(`Conflict check failed: ${response.statusText}`);
      }

      const result = await response.json();
      this.conflicts = result.data.conflicts || [];

      if (this.conflicts.length > 0) {
        this.showConflictWarning();
      } else {
        this.hideConflictWarning();
      }

      return result.data;
    } catch (error) {
      console.error('Error checking conflicts:', error);
      this.showError('Failed to check for conflicts. Please try again.');
      return null;
    }
  }

  /**
   * Show conflict warning alert
   */
  showConflictWarning() {
    const warningContainer = document.getElementById('conflictWarning');
    if (!warningContainer) return;

    const conflictCount = this.conflicts.length;
    const criticalCount = this.conflicts.filter(c =>
      c.conflicts.some(conf => conf.conflict_severity === 'critical')
    ).length;

    const alertClass = criticalCount > 0 ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200';
    const iconClass = criticalCount > 0 ? 'text-red-600' : 'text-yellow-600';
    const titleClass = criticalCount > 0 ? 'text-red-800' : 'text-yellow-800';
    const textClass = criticalCount > 0 ? 'text-red-700' : 'text-yellow-700';

    warningContainer.innerHTML = `
      <div class="border ${alertClass} rounded-lg p-4">
        <div class="flex items-start gap-3">
          <svg class="w-6 h-6 ${iconClass} flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
          </svg>
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-semibold ${titleClass} mb-1">
              ${criticalCount > 0 ? '⚠️ Critical Conflict Detected' : '⚠️ Potential Conflicts Detected'}
            </h4>
            <p class="text-sm ${textClass} mb-3">
              ${conflictCount} ${conflictCount === 1 ? 'party has' : 'parties have'} potential conflicts with existing matters.
              ${criticalCount > 0 ? 'Critical conflicts require immediate review.' : 'Please review before proceeding.'}
            </p>

            <!-- Conflicts List -->
            <div class="space-y-3 mb-3">
              ${this.renderConflictsList()}
            </div>

            <!-- Action Buttons -->
            <div class="flex items-center gap-3 pt-2 border-t ${criticalCount > 0 ? 'border-red-200' : 'border-yellow-200'}">
              <label class="flex items-center gap-2 text-sm ${textClass}">
                <input
                  type="checkbox"
                  id="acknowledgeConflict"
                  ${this.conflictsCleared ? 'checked' : ''}
                  onchange="conflictDetection.toggleConflictAcknowledgment(this.checked)"
                  class="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="font-medium">
                  I acknowledge these conflicts and wish to proceed
                </span>
              </label>
              <button
                type="button"
                onclick="conflictDetection.showConflictDetails()"
                class="ml-auto text-sm font-medium ${criticalCount > 0 ? 'text-red-700 hover:text-red-800' : 'text-yellow-700 hover:text-yellow-800'} underline">
                View Details
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    warningContainer.classList.remove('hidden');
  }

  /**
   * Render the conflicts list
   */
  renderConflictsList() {
    return this.conflicts.map(conflict => {
      const party = conflict.party;
      const conflicts = conflict.conflicts;

      return `
        <div class="bg-white border border-gray-200 rounded-lg p-3 text-sm">
          <div class="font-medium text-gray-900 mb-1">
            ${this.escapeHtml(party.name)} (${party.type.replace(/_/g, ' ')})
          </div>
          <div class="space-y-1">
            ${conflicts.slice(0, 2).map(c => this.renderConflictItem(c)).join('')}
            ${conflicts.length > 2 ? `<div class="text-xs text-gray-500 italic">+ ${conflicts.length - 2} more conflicts</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Render a single conflict item
   */
  renderConflictItem(conflict) {
    const severityColors = {
      critical: 'text-red-700 bg-red-100',
      high: 'text-orange-700 bg-orange-100',
      medium: 'text-yellow-700 bg-yellow-100',
      low: 'text-gray-700 bg-gray-100'
    };

    const severityClass = severityColors[conflict.conflict_severity] || severityColors.low;

    return `
      <div class="flex items-start gap-2 text-xs text-gray-600">
        <span class="px-1.5 py-0.5 rounded text-xs font-medium ${severityClass} uppercase flex-shrink-0">
          ${conflict.conflict_severity}
        </span>
        <span>
          ${conflict.conflict_type.replace(/_/g, ' ')} on <strong>${this.escapeHtml(conflict.matter_number)}</strong>
          ${conflict.matter_name ? ` - ${this.escapeHtml(conflict.matter_name)}` : ''}
        </span>
      </div>
    `;
  }

  /**
   * Hide conflict warning
   */
  hideConflictWarning() {
    const warningContainer = document.getElementById('conflictWarning');
    if (warningContainer) {
      warningContainer.classList.add('hidden');
      warningContainer.innerHTML = '';
    }
    this.conflictsCleared = false;
  }

  /**
   * Toggle conflict acknowledgment
   */
  toggleConflictAcknowledgment(checked) {
    this.conflictsCleared = checked;
  }

  /**
   * Show detailed conflict information in a modal
   */
  showConflictDetails() {
    // Create modal HTML
    const modalHtml = `
      <div id="conflictDetailsModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
          <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
            <h3 class="text-lg font-semibold text-gray-900">Conflict Details</h3>
            <button onclick="conflictDetection.closeConflictDetails()" class="text-gray-400 hover:text-gray-600">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
          <div class="p-6">
            ${this.renderDetailedConflicts()}
          </div>
        </div>
      </div>
    `;

    // Append to body
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHtml;
    document.body.appendChild(modalContainer.firstElementChild);
  }

  /**
   * Close conflict details modal
   */
  closeConflictDetails() {
    const modal = document.getElementById('conflictDetailsModal');
    if (modal) {
      modal.remove();
    }
  }

  /**
   * Render detailed conflicts information
   */
  renderDetailedConflicts() {
    return this.conflicts.map(conflict => {
      const party = conflict.party;
      const conflicts = conflict.conflicts;

      return `
        <div class="mb-6 last:mb-0">
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-3">
            <h4 class="font-semibold text-gray-900 mb-1">${this.escapeHtml(party.name)}</h4>
            <div class="text-sm text-gray-600">
              <span class="font-medium">Type:</span> ${party.type.replace(/_/g, ' ')}
              ${party.email ? ` | <span class="font-medium">Email:</span> ${this.escapeHtml(party.email)}` : ''}
            </div>
          </div>

          <div class="space-y-3">
            ${conflicts.map(c => this.renderDetailedConflictItem(c)).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Render detailed conflict item
   */
  renderDetailedConflictItem(conflict) {
    const severityColors = {
      critical: 'border-red-300 bg-red-50',
      high: 'border-orange-300 bg-orange-50',
      medium: 'border-yellow-300 bg-yellow-50',
      low: 'border-gray-300 bg-gray-50'
    };

    const badgeColors = {
      critical: 'text-red-700 bg-red-100',
      high: 'text-orange-700 bg-orange-100',
      medium: 'text-yellow-700 bg-yellow-100',
      low: 'text-gray-700 bg-gray-100'
    };

    const borderClass = severityColors[conflict.conflict_severity] || severityColors.low;
    const badgeClass = badgeColors[conflict.conflict_severity] || badgeColors.low;

    return `
      <div class="border ${borderClass} rounded-lg p-4">
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="px-2 py-1 rounded text-xs font-bold ${badgeClass} uppercase">
              ${conflict.conflict_severity}
            </span>
            <span class="text-sm font-medium text-gray-900">
              ${conflict.conflict_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </span>
          </div>
          ${conflict.conflict_cleared ? '<span class="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">Cleared</span>' : ''}
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div class="text-xs text-gray-500 font-medium mb-0.5">Existing Matter</div>
            <div class="font-medium text-gray-900">${this.escapeHtml(conflict.matter_number)}</div>
            ${conflict.matter_name ? `<div class="text-gray-600">${this.escapeHtml(conflict.matter_name)}</div>` : ''}
          </div>
          <div>
            <div class="text-xs text-gray-500 font-medium mb-0.5">Existing Party</div>
            <div class="font-medium text-gray-900">${this.escapeHtml(conflict.existing_party_name)}</div>
            <div class="text-gray-600">${conflict.existing_party_type.replace(/_/g, ' ')}</div>
          </div>
        </div>

        <div class="mt-2 text-xs text-gray-600">
          <strong>Match Reason:</strong> ${conflict.match_reason}
        </div>

        ${conflict.conflict_notes ? `
          <div class="mt-2 p-2 bg-white border border-gray-200 rounded text-xs">
            <strong class="text-gray-700">Notes:</strong> ${this.escapeHtml(conflict.conflict_notes)}
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Check if conflicts are acknowledged (for form validation)
   */
  canProceed() {
    if (this.conflicts.length === 0) {
      return true;
    }

    return this.conflictsCleared;
  }

  /**
   * Get parties data for submission
   */
  getParties() {
    return this.parties;
  }

  /**
   * Reset the conflict detection state
   */
  reset() {
    this.parties = [];
    this.conflicts = [];
    this.conflictsCleared = false;
    this.refreshPartiesList();
    this.hideConflictWarning();
  }

  /**
   * Load existing parties for a matter (when editing)
   */
  async loadPartiesForMatter(matterId) {
    try {
      const baseUrl = this.api.baseUrl || this.api.config?.API_BASE_URL || '';
      const response = await fetch(`${baseUrl}/api/v1/conflicts/parties/${matterId}`, {
        headers: {
          'Authorization': `Bearer ${this.api.token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load parties: ${response.statusText}`);
      }

      const result = await response.json();
      this.parties = result.data.parties || [];

      // Check for conflicts excluding current matter
      await this.checkConflicts(matterId);

      this.refreshPartiesList();
    } catch (error) {
      console.error('Error loading parties:', error);
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    // Use existing Toast if available, otherwise alert
    if (window.Toast) {
      window.Toast.error(message);
    } else {
      alert(message);
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Export for use in matters.html
window.ConflictDetection = ConflictDetection;
