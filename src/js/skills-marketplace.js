/**
 * Skills Marketplace - Browse and install skills
 * @module skills-marketplace
 */

(function() {
  'use strict';

  // State
  let allSkills = [];
  let filteredSkills = [];
  let searchTerm = '';
  let selectedCategory = 'all';
  let viewMode = 'grid'; // 'grid' or 'list'
  let selectedSkill = null;
  let selectedMatters = [];

  // DOM Elements
  let searchInput, categoryFilter, gridViewBtn, listViewBtn;
  let loadingState, skillsContainer, emptyState, filterChips;
  let skillDetailsModal, matterSelectorModal;

  /**
   * Initialize the marketplace
   */
  function init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initAfterDOM);
    } else {
      initAfterDOM();
    }
  }

  function initAfterDOM() {
    // Initialize menu
    if (typeof window.initializeMenu === 'function') {
      window.initializeMenu();
    }

    // Get DOM elements
    searchInput = document.getElementById('search-input');
    categoryFilter = document.getElementById('category-filter');
    gridViewBtn = document.getElementById('grid-view-btn');
    listViewBtn = document.getElementById('list-view-btn');
    loadingState = document.getElementById('loading-state');
    skillsContainer = document.getElementById('skills-container');
    emptyState = document.getElementById('empty-state');
    filterChips = document.getElementById('filter-chips');
    skillDetailsModal = document.getElementById('skill-details-modal');
    matterSelectorModal = document.getElementById('matter-selector-modal');

    // Attach event listeners
    attachEventListeners();

    // Load skills
    loadSkills();
  }

  /**
   * Attach event listeners
   */
  function attachEventListeners() {
    // Search
    if (searchInput) {
      searchInput.addEventListener('input', debounce(handleSearch, 300));
    }

    // Category filter
    if (categoryFilter) {
      categoryFilter.addEventListener('change', handleCategoryChange);
    }

    // View toggle
    if (gridViewBtn) {
      gridViewBtn.addEventListener('click', () => setViewMode('grid'));
    }
    if (listViewBtn) {
      listViewBtn.addEventListener('click', () => setViewMode('list'));
    }

    // Create skill button
    const createSkillBtn = document.getElementById('create-skill-btn');
    if (createSkillBtn) {
      createSkillBtn.addEventListener('click', () => {
        window.location.href = 'skill-editor.html';
      });
    }

    // Modal close buttons
    const modalCloseButtons = document.querySelectorAll('.modal-close');
    modalCloseButtons.forEach(btn => {
      btn.addEventListener('click', closeAllModals);
    });

    // Modal overlay clicks
    const modalOverlays = document.querySelectorAll('.modal-overlay');
    modalOverlays.forEach(overlay => {
      overlay.addEventListener('click', closeAllModals);
    });

    // Modal action buttons
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    if (modalCancelBtn) {
      modalCancelBtn.addEventListener('click', closeAllModals);
    }

    const modalInstallBtn = document.getElementById('modal-install-btn');
    if (modalInstallBtn) {
      modalInstallBtn.addEventListener('click', openMatterSelector);
    }

    const matterModalCancelBtn = document.getElementById('matter-modal-cancel-btn');
    if (matterModalCancelBtn) {
      matterModalCancelBtn.addEventListener('click', closeAllModals);
    }

    const matterModalInstallBtn = document.getElementById('matter-modal-install-btn');
    if (matterModalInstallBtn) {
      matterModalInstallBtn.addEventListener('click', installSkillToMatters);
    }

    // Matter search
    const matterSearchInput = document.getElementById('matter-search-input');
    if (matterSearchInput) {
      matterSearchInput.addEventListener('input', debounce(handleMatterSearch, 300));
    }
  }

  /**
   * Load skills from API
   */
  async function loadSkills() {
    try {
      showLoading();

      const baseUrl = window.api?.baseUrl || window.LanaConfig?.API_BASE_URL || '';
      const response = await fetch(`${baseUrl}/api/v1/skills`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch skills');
      }

      const data = await response.json();
      allSkills = data.skills || [];
      filteredSkills = [...allSkills];

      renderSkills();
      updateFilterChips();
      hideLoading();
    } catch (error) {
      console.error('Error loading skills:', error);
      showToast('Failed to load skills. Please try again.', 'error');
      hideLoading();
      showEmpty();
    }
  }

  /**
   * Render skills in grid or list view
   */
  function renderSkills() {
    if (!skillsContainer) return;

    if (filteredSkills.length === 0) {
      showEmpty();
      return;
    }

    skillsContainer.className = viewMode === 'grid' ? 'skills-grid' : 'skills-list';
    skillsContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');

    skillsContainer.innerHTML = filteredSkills.map(skill => {
      if (viewMode === 'grid') {
        return renderSkillCard(skill);
      } else {
        return renderSkillListItem(skill);
      }
    }).join('');

    // Attach click listeners to skill cards
    const skillElements = skillsContainer.querySelectorAll('[data-skill-id]');
    skillElements.forEach(el => {
      el.addEventListener('click', (e) => {
        // Don't open modal if clicking install button
        if (e.target.closest('.install-btn')) return;

        const skillId = el.dataset.skillId;
        const skill = allSkills.find(s => s.skill_id === skillId);
        if (skill) {
          openSkillDetails(skill);
        }
      });
    });

    // Attach install button listeners
    const installButtons = skillsContainer.querySelectorAll('.install-btn');
    installButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const skillId = btn.dataset.skillId;
        const skill = allSkills.find(s => s.skill_id === skillId);
        if (skill) {
          selectedSkill = skill;
          openMatterSelector();
        }
      });
    });
  }

  /**
   * Render skill card (grid view)
   */
  function renderSkillCard(skill) {
    const icon = getCategoryIcon(skill.metadata?.category || 'automation');
    const isInstalled = skill.installation_count > 0;

    return `
      <div class="skill-card" data-skill-id="${skill.skill_id}">
        <div class="skill-card-header">
          <div class="skill-icon">${icon}</div>
          <span class="skill-status-badge ${isInstalled ? 'skill-status-installed' : 'skill-status-not-installed'}">
            ${isInstalled ? `Installed (${skill.installation_count})` : 'Not Installed'}
          </span>
        </div>
        <h3 class="skill-name">${escapeHtml(skill.skill_name)}</h3>
        <p class="skill-version">v${skill.metadata?.version || '1.0.0'}</p>
        <p class="skill-description">${escapeHtml(skill.description || 'No description available')}</p>
        <div class="skill-meta">
          <span class="category-badge category-${skill.metadata?.category || 'automation'}">
            ${formatCategory(skill.metadata?.category || 'automation')}
          </span>
          ${skill.skill_type === 'custom' ? '<span class="text-gray-500">Custom</span>' : '<span class="text-indigo-600">Built-in</span>'}
        </div>
        <div class="skill-tags">
          ${(skill.metadata?.tags || []).slice(0, 3).map(tag => `<span class="skill-tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <div class="skill-footer">
          <button class="install-btn" data-skill-id="${skill.skill_id}">
            <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            Install
          </button>
          <button class="text-sm text-indigo-600 hover:text-indigo-700">View Details</button>
        </div>
      </div>
    `;
  }

  /**
   * Render skill list item (list view)
   */
  function renderSkillListItem(skill) {
    const icon = getCategoryIcon(skill.metadata?.category || 'automation');
    const isInstalled = skill.installation_count > 0;

    return `
      <div class="skill-list-item" data-skill-id="${skill.skill_id}">
        <div class="skill-list-content">
          <div class="skill-list-icon">${icon}</div>
          <div class="skill-list-body">
            <div class="skill-list-header">
              <div>
                <h3 class="skill-list-name">${escapeHtml(skill.skill_name)}</h3>
                <p class="skill-list-version">v${skill.metadata?.version || '1.0.0'}</p>
              </div>
              <button class="install-btn" data-skill-id="${skill.skill_id}">
                <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                Install
              </button>
            </div>
            <p class="skill-list-description">${escapeHtml(skill.description || 'No description available')}</p>
            <div class="skill-list-meta">
              <span class="category-badge category-${skill.metadata?.category || 'automation'}">
                ${formatCategory(skill.metadata?.category || 'automation')}
              </span>
              ${skill.skill_type === 'custom' ? '<span>Custom Skill</span>' : '<span class="text-indigo-600">Built-in Skill</span>'}
              <span class="skill-status-badge ${isInstalled ? 'skill-status-installed' : 'skill-status-not-installed'}">
                ${isInstalled ? `${skill.installation_count} installations` : 'Not installed'}
              </span>
              ${(skill.metadata?.tags || []).slice(0, 5).map(tag => `<span class="skill-tag">${escapeHtml(tag)}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Open skill details modal
   */
  function openSkillDetails(skill) {
    selectedSkill = skill;
    const modal = document.getElementById('skill-details-modal');
    const body = document.getElementById('skill-details-body');

    if (!modal || !body) return;

    body.innerHTML = `
      <div class="skill-detail-section">
        <div class="flex items-start gap-4 mb-4">
          <div class="skill-list-icon">${getCategoryIcon(skill.metadata?.category || 'automation')}</div>
          <div class="flex-1">
            <h2 class="text-2xl font-bold text-gray-900 mb-1">${escapeHtml(skill.skill_name)}</h2>
            <p class="text-gray-600">v${skill.metadata?.version || '1.0.0'} • ${skill.skill_type === 'custom' ? 'Custom Skill' : 'Built-in Skill'}</p>
          </div>
        </div>
        <p class="text-gray-700">${escapeHtml(skill.description || 'No description available')}</p>
      </div>

      <div class="skill-detail-section">
        <h4 class="skill-detail-section-title">Details</h4>
        <div class="skill-detail-info">
          <div class="skill-detail-info-item">
            <p class="skill-detail-info-label">Category</p>
            <p class="skill-detail-info-value">
              <span class="category-badge category-${skill.metadata?.category || 'automation'}">
                ${formatCategory(skill.metadata?.category || 'automation')}
              </span>
            </p>
          </div>
          <div class="skill-detail-info-item">
            <p class="skill-detail-info-label">Installations</p>
            <p class="skill-detail-info-value">${skill.installation_count} matters</p>
          </div>
          <div class="skill-detail-info-item">
            <p class="skill-detail-info-label">Created</p>
            <p class="skill-detail-info-value">${formatDate(skill.created_at)}</p>
          </div>
          <div class="skill-detail-info-item">
            <p class="skill-detail-info-label">Last Updated</p>
            <p class="skill-detail-info-value">${formatDate(skill.updated_at)}</p>
          </div>
        </div>
      </div>

      ${skill.metadata?.tags && skill.metadata.tags.length > 0 ? `
        <div class="skill-detail-section">
          <h4 class="skill-detail-section-title">Tags</h4>
          <div class="skill-tags">
            ${skill.metadata.tags.map(tag => `<span class="skill-tag">${escapeHtml(tag)}</span>`).join('')}
          </div>
        </div>
      ` : ''}

      ${skill.trigger_event ? `
        <div class="skill-detail-section">
          <h4 class="skill-detail-section-title">Trigger Event</h4>
          <p class="text-sm text-gray-700"><code class="skill-detail-code">${escapeHtml(skill.trigger_event)}</code></p>
        </div>
      ` : ''}

      ${skill.trigger_conditions && Object.keys(skill.trigger_conditions).length > 0 ? `
        <div class="skill-detail-section">
          <h4 class="skill-detail-section-title">Trigger Conditions</h4>
          <pre class="skill-detail-code">${JSON.stringify(skill.trigger_conditions, null, 2)}</pre>
        </div>
      ` : ''}

      ${skill.actions && skill.actions.length > 0 ? `
        <div class="skill-detail-section">
          <h4 class="skill-detail-section-title">Actions (${skill.actions.length})</h4>
          <ul class="skill-detail-list">
            ${skill.actions.map(action => `<li>${escapeHtml(action.action_type)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `;

    modal.classList.remove('hidden');
  }

  /**
   * Open matter selector modal
   */
  async function openMatterSelector() {
    if (!selectedSkill) return;

    const modal = document.getElementById('matter-selector-modal');
    const mattersList = document.getElementById('matters-list');

    if (!modal || !mattersList) return;

    // Close skill details modal
    skillDetailsModal.classList.add('hidden');

    try {
      // Load matters
      const baseUrl = window.api?.baseUrl || window.LanaConfig?.API_BASE_URL || '';
      const response = await fetch(`${baseUrl}/api/v1/matters`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch matters');
      }

      const data = await response.json();
      const matters = data.matters || [];

      mattersList.innerHTML = matters.map(matter => `
        <div class="matter-item" data-matter-id="${matter.matter_id}">
          <div class="matter-item-content">
            <input type="checkbox" class="matter-item-checkbox" id="matter-${matter.matter_id}" />
            <label for="matter-${matter.matter_id}" class="flex-1 cursor-pointer">
              <p class="matter-item-name">${escapeHtml(matter.matter_name)}</p>
              <p class="matter-item-meta">${escapeHtml(matter.client_name || 'No client')} • ${matter.matter_number || 'No number'}</p>
            </label>
          </div>
        </div>
      `).join('');

      // Attach checkbox listeners
      const checkboxes = mattersList.querySelectorAll('.matter-item-checkbox');
      checkboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
          const matterId = e.target.closest('[data-matter-id]').dataset.matterId;
          if (e.target.checked) {
            selectedMatters.push(matterId);
            e.target.closest('.matter-item').classList.add('selected');
          } else {
            selectedMatters = selectedMatters.filter(id => id !== matterId);
            e.target.closest('.matter-item').classList.remove('selected');
          }
        });
      });

      modal.classList.remove('hidden');
    } catch (error) {
      console.error('Error loading matters:', error);
      showToast('Failed to load matters. Please try again.', 'error');
    }
  }

  /**
   * Install skill to selected matters
   */
  async function installSkillToMatters() {
    if (!selectedSkill || selectedMatters.length === 0) {
      showToast('Please select at least one matter', 'warning');
      return;
    }

    try {
      const installButton = document.getElementById('matter-modal-install-btn');
      installButton.disabled = true;
      installButton.textContent = 'Installing...';

      let successCount = 0;
      let errorCount = 0;

      const baseUrl = window.api?.baseUrl || window.LanaConfig?.API_BASE_URL || '';

      for (const matterId of selectedMatters) {
        try {
          const response = await fetch(`${baseUrl}/api/v1/matters/${matterId}/skills`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${getAuthToken()}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              skill_id: selectedSkill.skill_id
            })
          });

          if (response.ok) {
            successCount++;
          } else {
            errorCount++;
          }
        } catch (error) {
          errorCount++;
        }
      }

      closeAllModals();

      if (successCount > 0) {
        showToast(`Successfully installed skill to ${successCount} matter(s)`, 'success');
        loadSkills(); // Reload to update installation counts
      }

      if (errorCount > 0) {
        showToast(`Failed to install to ${errorCount} matter(s)`, 'error');
      }

      installButton.disabled = false;
      installButton.textContent = 'Install';
      selectedMatters = [];
    } catch (error) {
      console.error('Error installing skill:', error);
      showToast('Failed to install skill. Please try again.', 'error');
    }
  }

  /**
   * Handle search input
   */
  function handleSearch(e) {
    searchTerm = e.target.value.toLowerCase();
    filterSkills();
  }

  /**
   * Handle category filter change
   */
  function handleCategoryChange(e) {
    selectedCategory = e.target.value;
    filterSkills();
  }

  /**
   * Handle matter search
   */
  function handleMatterSearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    const mattersList = document.getElementById('matters-list');
    const matterItems = mattersList.querySelectorAll('.matter-item');

    matterItems.forEach(item => {
      const name = item.querySelector('.matter-item-name').textContent.toLowerCase();
      const meta = item.querySelector('.matter-item-meta').textContent.toLowerCase();

      if (name.includes(searchTerm) || meta.includes(searchTerm)) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
  }

  /**
   * Filter skills based on search and category
   */
  function filterSkills() {
    filteredSkills = allSkills.filter(skill => {
      // Search filter
      if (searchTerm) {
        const nameMatch = skill.skill_name.toLowerCase().includes(searchTerm);
        const descMatch = (skill.description || '').toLowerCase().includes(searchTerm);
        const tagsMatch = (skill.metadata?.tags || []).some(tag => tag.toLowerCase().includes(searchTerm));

        if (!nameMatch && !descMatch && !tagsMatch) {
          return false;
        }
      }

      // Category filter
      if (selectedCategory !== 'all') {
        if ((skill.metadata?.category || 'automation') !== selectedCategory) {
          return false;
        }
      }

      return true;
    });

    renderSkills();
    updateFilterChips();
  }

  /**
   * Update filter chips
   */
  function updateFilterChips() {
    if (!filterChips) return;

    const chips = [];

    if (searchTerm) {
      chips.push(`
        <span class="filter-chip">
          Search: "${escapeHtml(searchTerm)}"
          <button class="filter-chip-remove" data-filter="search">&times;</button>
        </span>
      `);
    }

    if (selectedCategory !== 'all') {
      chips.push(`
        <span class="filter-chip">
          Category: ${formatCategory(selectedCategory)}
          <button class="filter-chip-remove" data-filter="category">&times;</button>
        </span>
      `);
    }

    filterChips.innerHTML = chips.join('');

    // Attach remove listeners
    const removeButtons = filterChips.querySelectorAll('.filter-chip-remove');
    removeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const filterType = btn.dataset.filter;
        if (filterType === 'search') {
          searchInput.value = '';
          searchTerm = '';
        } else if (filterType === 'category') {
          categoryFilter.value = 'all';
          selectedCategory = 'all';
        }
        filterSkills();
      });
    });
  }

  /**
   * Set view mode (grid or list)
   */
  function setViewMode(mode) {
    viewMode = mode;

    if (mode === 'grid') {
      gridViewBtn.classList.add('active');
      listViewBtn.classList.remove('active');
    } else {
      listViewBtn.classList.add('active');
      gridViewBtn.classList.remove('active');
    }

    renderSkills();
  }

  /**
   * Close all modals
   */
  function closeAllModals() {
    skillDetailsModal.classList.add('hidden');
    matterSelectorModal.classList.add('hidden');
    selectedSkill = null;
    selectedMatters = [];
  }

  /**
   * Show loading state
   */
  function showLoading() {
    loadingState.classList.remove('hidden');
    skillsContainer.classList.add('hidden');
    emptyState.classList.add('hidden');
  }

  /**
   * Hide loading state
   */
  function hideLoading() {
    loadingState.classList.add('hidden');
  }

  /**
   * Show empty state
   */
  function showEmpty() {
    skillsContainer.classList.add('hidden');
    emptyState.classList.remove('hidden');
  }

  /**
   * Show toast notification
   */
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconMap = {
      success: '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
      error: '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
      warning: '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>'
    };

    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-icon ${type}">${iconMap[type]}</div>
        <p class="toast-message">${escapeHtml(message)}</p>
        <button class="toast-close">&times;</button>
      </div>
    `;

    container.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 5000);

    // Manual close
    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    });
  }

  /**
   * Get category icon
   */
  function getCategoryIcon(category) {
    const icons = {
      'document-intelligence': '📄',
      'ai-assistance': '🤖',
      'automation': '⚡',
      'workflow': '📋',
      'integration': '🔗'
    };
    return icons[category] || '⚡';
  }

  /**
   * Format category name
   */
  function formatCategory(category) {
    return category.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  /**
   * Format date
   */
  function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /**
   * Escape HTML
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Get auth token
   */
  function getAuthToken() {
    return localStorage.getItem('lana_auth_token') || '';
  }

  /**
   * Debounce function
   */
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

  // Initialize on load
  init();

})();
