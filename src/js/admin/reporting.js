/* Lex UI — Admin Reporting Page Controller
   V2 page controller for admin/reporting.html.
   Module sidebar, period controls, and report execution shell.
*/

(function () {
  'use strict';

  // ==========================================================================
  // State
  // ==========================================================================

  var allModules = [];
  var moduleCategories = {};
  var selectedModuleKey = null;

  // ==========================================================================
  // Helpers
  // ==========================================================================

  function formatDate(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function showInfo(message) {
    var infoEl = document.getElementById('executionInfo');
    var infoTextEl = document.getElementById('executionInfoText');
    var errEl = document.getElementById('executionError');
    if (infoTextEl) infoTextEl.textContent = message;
    if (infoEl) infoEl.style.display = 'block';
    if (errEl) errEl.style.display = 'none';
  }

  function showError(message) {
    var errEl = document.getElementById('executionError');
    var errTextEl = document.getElementById('executionErrorText');
    var infoEl = document.getElementById('executionInfo');
    if (errTextEl) errTextEl.textContent = message;
    if (errEl) errEl.style.display = 'block';
    if (infoEl) infoEl.style.display = 'none';
  }

  function hideError() {
    var errEl = document.getElementById('executionError');
    if (errEl) errEl.style.display = 'none';
  }

  // ==========================================================================
  // Period Presets
  // ==========================================================================

  function selectPeriodPreset(preset) {
    var today = new Date();
    var startDate, endDate;

    switch (preset) {
      case 'last7days':
        endDate = new Date(today);
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 6);
        break;
      case 'last30days':
        endDate = new Date(today);
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 29);
        break;
      case 'thisMonth':
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        endDate = new Date(today);
        break;
      case 'lastMonth':
        startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        endDate = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'thisQuarter':
        var currentQuarter = Math.floor(today.getMonth() / 3);
        startDate = new Date(today.getFullYear(), currentQuarter * 3, 1);
        endDate = new Date(today);
        break;
      case 'thisYear':
        startDate = new Date(today.getFullYear(), 0, 1);
        endDate = new Date(today);
        break;
      case 'lastYear':
        startDate = new Date(today.getFullYear() - 1, 0, 1);
        endDate = new Date(today.getFullYear() - 1, 11, 31);
        break;
      default:
        endDate = new Date(today);
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7);
    }

    var periodStartEl = document.getElementById('periodStart');
    var periodEndEl = document.getElementById('periodEnd');
    if (periodStartEl) periodStartEl.value = formatDate(startDate);
    if (periodEndEl) periodEndEl.value = formatDate(endDate);

    updateCompareByOptions(startDate, endDate, preset);
    showInfo('Period set to: ' + formatDate(startDate) + ' to ' + formatDate(endDate));
  }

  function updateCompareByOptions(startDate, endDate, preset) {
    var periodTypeEl = document.getElementById('periodType');
    if (!periodTypeEl) return;

    var currentValue = periodTypeEl.value;
    var durationMs = endDate - startDate;
    var durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));

    var allOptions = [
      { value: 'daily',     label: 'Daily' },
      { value: 'weekly',    label: 'Weekly' },
      { value: 'monthly',   label: 'Monthly' },
      { value: 'quarterly', label: 'Quarterly' },
      { value: 'yearly',    label: 'Yearly' }
    ];

    if (preset === 'lastYear' || (durationDays >= 365 && durationDays <= 366)) {
      periodTypeEl.options = [{ value: 'monthly', label: 'Monthly' }];
      periodTypeEl.value = 'monthly';
    } else {
      periodTypeEl.options = allOptions;
      if (['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].indexOf(currentValue) !== -1) {
        periodTypeEl.value = currentValue;
      }
    }
  }

  function initPeriodControls() {
    // Period preset buttons
    var presetsContainer = document.getElementById('periodPresets');
    if (presetsContainer) {
      presetsContainer.addEventListener('click', function (e) {
        var btn = e.target.closest('lex-btn[data-preset]');
        if (!btn) return;
        selectPeriodPreset(btn.dataset.preset);
      });
    }

    // Date input change listeners
    var periodStartEl = document.getElementById('periodStart');
    var periodEndEl = document.getElementById('periodEnd');

    if (periodStartEl) {
      periodStartEl.addEventListener('lex-change', function () {
        var startVal = periodStartEl.value;
        var endVal = periodEndEl ? periodEndEl.value : '';
        if (startVal && endVal) {
          updateCompareByOptions(new Date(startVal + 'T00:00:00'), new Date(endVal + 'T23:59:59'), null);
        }
      });
    }

    if (periodEndEl) {
      periodEndEl.addEventListener('lex-change', function () {
        var startVal = periodStartEl ? periodStartEl.value : '';
        var endVal = periodEndEl.value;
        if (startVal && endVal) {
          updateCompareByOptions(new Date(startVal + 'T00:00:00'), new Date(endVal + 'T23:59:59'), null);
        }
      });
    }

    // Execute button
    var executeBtn = document.getElementById('executeBtn');
    if (executeBtn) {
      executeBtn.addEventListener('click', function () {
        executeModule();
      });
    }

    // Default: Last 7 days
    selectPeriodPreset('last7days');
  }

  // ==========================================================================
  // Module Execution
  // ==========================================================================

  async function executeModule() {
    if (!selectedModuleKey) {
      showError('Please select a report module from the sidebar.');
      return;
    }

    var periodStartEl = document.getElementById('periodStart');
    var periodEndEl = document.getElementById('periodEnd');
    var periodTypeEl = document.getElementById('periodType');
    var executeBtn = document.getElementById('executeBtn');

    var startDate = periodStartEl ? periodStartEl.value : '';
    var endDate = periodEndEl ? periodEndEl.value : '';
    var periodType = periodTypeEl ? periodTypeEl.value : 'monthly';

    if (!startDate || !endDate) {
      showError('Please select a date range.');
      return;
    }

    // Loading state
    if (executeBtn) executeBtn.loading = true;
    hideError();
    showInfo('Running report...');

    try {
      var result = await api.post('/api/v1/modules/' + selectedModuleKey + '/execute', {
        period_start: startDate,
        period_end: endDate,
        period_type: periodType
      });

      // Hide placeholder, show results area
      var placeholder = document.getElementById('reportingPlaceholder');
      var resultsEl = document.getElementById('moduleResults');
      if (placeholder) placeholder.style.display = 'none';
      if (resultsEl) resultsEl.style.display = 'flex';

      // Render results into visualizationsContainer
      var container = document.getElementById('visualizationsContainer');
      if (container && result) {
        // TODO: Wire up visualization rendering from module-execution logic
        container.innerHTML = '<div class="lex-body-sm lex-text-secondary" style="padding:2rem;text-align:center;">Report executed successfully. Visualization rendering coming soon.</div>';
      }

      showInfo('Report completed successfully.');
    } catch (error) {
      console.error('[Reporting] Execution failed:', error);
      showError(error.message || 'Failed to execute report. Please try again.');
    } finally {
      if (executeBtn) executeBtn.loading = false;
    }
  }

  // ==========================================================================
  // Module Loading
  // ==========================================================================

  async function loadModules() {
    var moduleMenu = document.getElementById('moduleMenu');

    try {
      var response = await api.get('/api/v1/modules');

      allModules = response.modules || [];

      if (response.categories && Array.isArray(response.categories)) {
        response.categories.forEach(function (cat) {
          moduleCategories[cat.key] = cat.name;
        });
      }

      if (!allModules.length) {
        if (moduleMenu) moduleMenu.innerHTML = '<div class="lex-body-sm lex-text-secondary" style="padding:0.75rem;text-align:center;">No modules available</div>';
        return;
      }

      // Group by category
      var modulesByCategory = {};
      allModules.forEach(function (module) {
        var cat = module.category || 'other';
        if (!modulesByCategory[cat]) modulesByCategory[cat] = [];
        modulesByCategory[cat].push(module);
      });

      // Build sidebar menu
      if (moduleMenu) moduleMenu.innerHTML = '';
      var categoryKeys = Object.keys(modulesByCategory).sort();

      categoryKeys.forEach(function (category, index) {
        var modules = modulesByCategory[category];
        var categorySection = document.createElement('div');
        categorySection.style.marginBottom = '0.25rem';
        categorySection.dataset.categorySection = category;

        if (index > 0) {
          categorySection.style.borderTop = '1px solid var(--lex-border-default)';
          categorySection.style.paddingTop = '0.75rem';
          categorySection.style.marginTop = '0.75rem';
        }

        // Category header (collapsible)
        var categoryHeader = document.createElement('button');
        categoryHeader.className = 'w-full';
        categoryHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.375rem 0.5rem;border-radius:var(--lex-radius-md);cursor:pointer;background:none;border:none;width:100%;';
        categoryHeader.dataset.category = category;

        var categoryName = document.createElement('span');
        categoryName.className = 'lex-overline lex-text-secondary';
        categoryName.textContent = moduleCategories[category] || category;
        categoryHeader.appendChild(categoryName);

        var chevron = document.createElement('svg');
        chevron.setAttribute('width', '14');
        chevron.setAttribute('height', '14');
        chevron.setAttribute('fill', 'none');
        chevron.setAttribute('stroke', 'currentColor');
        chevron.setAttribute('stroke-width', '2');
        chevron.setAttribute('viewBox', '0 0 24 24');
        chevron.style.transition = 'transform 0.2s ease';
        chevron.style.color = 'var(--lex-text-tertiary)';
        chevron.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>';
        categoryHeader.appendChild(chevron);
        categorySection.appendChild(categoryHeader);

        // Module items container
        var moduleContainer = document.createElement('div');
        moduleContainer.style.cssText = 'display:flex;flex-direction:column;gap:0.125rem;margin-top:0.25rem;';
        moduleContainer.dataset.categoryModules = category;

        modules.forEach(function (module) {
          var btn = document.createElement('button');
          btn.style.cssText = [
            'display:block;width:100%;text-align:left;padding:0.375rem 0.5rem;',
            'border-radius:var(--lex-radius-md);border:none;background:none;cursor:pointer;',
            'transition:var(--lex-transition-fast);'
          ].join('');
          btn.dataset.moduleKey = module.moduleKey;
          btn.dataset.category = category;
          btn.dataset.moduleName = module.name.toLowerCase();
          btn.dataset.moduleDescription = (module.description || '').toLowerCase();

          if (module.available) {
            btn.style.color = 'var(--lex-text-primary)';
          } else {
            btn.style.color = 'var(--lex-text-disabled)';
            btn.style.cursor = 'not-allowed';
            btn.disabled = true;
          }

          var nameEl = document.createElement('div');
          nameEl.className = 'lex-label-sm';
          nameEl.textContent = module.name;
          btn.appendChild(nameEl);

          if (!module.available) {
            var note = document.createElement('div');
            note.className = 'lex-body-xs lex-text-tertiary';
            note.style.marginTop = '0.125rem';
            note.textContent = 'Requires connectors';
            btn.appendChild(note);
          } else {
            btn.addEventListener('click', function () {
              // Clear all selections
              moduleMenu.querySelectorAll('button[data-module-key]').forEach(function (b) {
                b.style.background = 'none';
                b.style.color = 'var(--lex-text-primary)';
              });
              // Apply active state
              btn.style.background = 'var(--lex-bg-accent-soft)';
              btn.style.color = 'var(--lex-text-accent)';
              // Track selection
              selectedModuleKey = module.moduleKey;
            });
          }

          moduleContainer.appendChild(btn);
        });

        categorySection.appendChild(moduleContainer);

        // Collapse / expand on header click
        categoryHeader.addEventListener('click', function () {
          var collapsed = moduleContainer.style.display === 'none';
          if (collapsed) {
            moduleContainer.style.display = 'flex';
            chevron.style.transform = 'rotate(0deg)';
          } else {
            moduleContainer.style.display = 'none';
            chevron.style.transform = 'rotate(-90deg)';
          }
        });

        if (moduleMenu) moduleMenu.appendChild(categorySection);
      });

      // Auto-select first available module
      var firstAvailable = allModules.find(function (m) { return m.available; });
      if (firstAvailable && moduleMenu) {
        selectedModuleKey = firstAvailable.moduleKey;
        var firstBtn = moduleMenu.querySelector('button[data-module-key="' + firstAvailable.moduleKey + '"]');
        if (firstBtn) {
          firstBtn.style.background = 'var(--lex-bg-accent-soft)';
          firstBtn.style.color = 'var(--lex-text-accent)';
        }
      }

    } catch (error) {
      console.error('[Reporting] Failed to load modules:', error);
      if (moduleMenu) {
        moduleMenu.innerHTML = '<div class="lex-body-sm" style="color:var(--lex-status-danger);padding:0.75rem;text-align:center;">Failed to load modules. Please refresh.</div>';
      }
    }
  }

  // ==========================================================================
  // Module Search
  // ==========================================================================

  function initModuleSearch() {
    var searchInput = document.getElementById('moduleSearchInput');
    var moduleMenu = document.getElementById('moduleMenu');
    var emptyEl = document.getElementById('moduleSearchEmpty');

    if (!searchInput) return;

    // lex-input fires 'lex-input' event
    searchInput.addEventListener('lex-input', function (e) {
      var query = (e.detail && e.detail.value !== undefined) ? e.detail.value.toLowerCase().trim() : '';
      filterModules(query, moduleMenu, emptyEl);
    });

    // Also catch native input from the inner input element
    searchInput.addEventListener('input', function (e) {
      var query = (e.target.value || '').toLowerCase().trim();
      filterModules(query, moduleMenu, emptyEl);
    });
  }

  function filterModules(searchQuery, moduleMenu, emptyEl) {
    if (!moduleMenu) return;

    var moduleItems = moduleMenu.querySelectorAll('button[data-module-key]');
    var categorySections = moduleMenu.querySelectorAll('[data-category-section]');

    if (!searchQuery) {
      moduleItems.forEach(function (item) { item.style.display = ''; });
      categorySections.forEach(function (s) { s.style.display = ''; });
      if (emptyEl) emptyEl.style.display = 'none';
      return;
    }

    var searchWords = searchQuery.split(/\s+/).filter(function (w) { return w.length > 0; });
    var visibleCount = 0;
    var visibleCategories = {};
    var hasNameMatches = false;
    var matchResults = [];

    moduleItems.forEach(function (item) {
      var moduleName = item.dataset.moduleName || '';
      var moduleDesc = item.dataset.moduleDescription || '';
      var category = item.dataset.category || '';

      var nameWords = moduleName.split(/[\s&-]+/).filter(function (w) { return w.length > 0; });
      var descWords = moduleDesc.split(/[\s&-]+/).filter(function (w) { return w.length > 0; });

      var nameContainsAll = searchWords.every(function (sw) {
        return nameWords.some(function (nw) { return nw.indexOf(sw) !== -1; });
      });
      var nameStartsWith = moduleName.indexOf(searchQuery) === 0;
      var descMatch = searchQuery.length >= 3 && searchWords.every(function (sw) {
        return descWords.some(function (dw) { return dw.indexOf(sw) !== -1; });
      });

      var nameMatch = nameContainsAll || nameStartsWith;
      if (nameMatch) hasNameMatches = true;

      matchResults.push({ item: item, category: category, nameMatch: nameMatch, descriptionMatch: descMatch });
    });

    matchResults.forEach(function (r) {
      var shouldShow = hasNameMatches ? r.nameMatch : (r.nameMatch || r.descriptionMatch);
      if (shouldShow) {
        r.item.style.display = '';
        visibleCategories[r.category] = true;
        visibleCount++;
      } else {
        r.item.style.display = 'none';
      }
    });

    categorySections.forEach(function (section) {
      var cat = section.dataset.categorySection;
      if (visibleCategories[cat]) {
        section.style.display = '';
        var container = section.querySelector('[data-category-modules]');
        if (container) container.style.display = 'flex';
      } else {
        section.style.display = 'none';
      }
    });

    if (emptyEl) emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
  }

  // ==========================================================================
  // Init
  // ==========================================================================

  function init() {
    loadModules();
    initModuleSearch();
    initPeriodControls();
  }

  if (typeof LexRouter !== 'undefined') {
    LexRouter.registerPageInit('admin/reporting.html', init);
  }
  init();

})();
