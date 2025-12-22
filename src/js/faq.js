/**
 * LANA AI FAQ System
 *
 * Loads and renders FAQ content with search, filtering, and voting
 */

const FAQSystem = (function() {
  let faqData = null;
  let searchIndex = null;
  let currentFilter = 'all';
  let currentSearchQuery = '';

  /**
   * Initialize the FAQ system
   */
  async function init() {
    try {
      await loadFAQContent();
      renderFAQContent();
      attachEventListeners();
    } catch (error) {
      console.error('Failed to initialize FAQ system:', error);
      showError();
    }
  }

  /**
   * Load FAQ content from API or mock data
   */
  async function loadFAQContent() {
    const apiUrl = `${window.LanaConfig.CONNECTOR_REGISTRY_URL}/lana-ai/v1/faq`;

    try {
      // Try to fetch from API
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        faqData = await response.json();
        console.log('Loaded FAQ content from API');
      } else {
        throw new Error('API returned error');
      }
    } catch (error) {
      console.warn('Failed to load from API, using mock data:', error);
      // Fall back to mock data
      faqData = await loadMockFAQData();
    }

    // Build search index
    buildSearchIndex();
  }

  /**
   * Load mock FAQ data from local file
   */
  async function loadMockFAQData() {
    try {
      const response = await fetch('mock-data/faq-data.json');
      if (!response.ok) {
        throw new Error('Failed to load mock data');
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to load mock FAQ data:', error);
      throw error;
    }
  }

  /**
   * Build search index for fast searching
   */
  function buildSearchIndex() {
    searchIndex = [];

    faqData.categories.forEach(category => {
      category.faqs.forEach(faq => {
        searchIndex.push({
          categoryId: category.id,
          categoryTitle: category.title,
          id: faq.id,
          question: faq.question,
          answer: faq.answer,
          tags: faq.tags || [],
          searchText: `${faq.question} ${faq.answer} ${(faq.tags || []).join(' ')}`.toLowerCase()
        });
      });
    });
  }

  /**
   * Render FAQ content
   */
  function renderFAQContent() {
    renderCategoryFilters();
    renderPopularFAQs();
    renderFAQCategories();

    // Hide loading, show content
    document.getElementById('faqLoading').classList.add('hidden');
    document.getElementById('faqContent').classList.remove('hidden');
  }

  /**
   * Render category filters
   */
  function renderCategoryFilters() {
    const container = document.getElementById('categoryFilters');
    if (!container || !faqData.categories) return;

    const filters = [
      { id: 'all', title: 'All Categories', icon: null }
    ].concat(faqData.categories);

    container.innerHTML = filters.map(filter => {
      const isActive = currentFilter === filter.id;
      return `
        <button
          class="category-filter px-4 py-2 rounded-lg font-medium transition-colors ${
            isActive
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }"
          data-category="${filter.id}"
        >
          ${filter.title}
        </button>
      `;
    }).join('');

    // Attach click handlers
    container.querySelectorAll('.category-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.category;
        renderCategoryFilters();
        if (currentSearchQuery) {
          performSearch(currentSearchQuery);
        } else {
          renderFAQCategories();
        }
      });
    });
  }

  /**
   * Render popular FAQs
   */
  function renderPopularFAQs() {
    const container = document.getElementById('popularFaqsList');
    if (!container || !faqData.popularFaqs) return;

    const popularFaqs = faqData.popularFaqs.map(id => {
      for (const category of faqData.categories) {
        const faq = category.faqs.find(f => f.id === id);
        if (faq) {
          return { ...faq, categoryId: category.id };
        }
      }
      return null;
    }).filter(Boolean);

    container.innerHTML = popularFaqs.map(faq => `
      <button
        class="block w-full text-left p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow faq-item"
        data-faq-id="${faq.id}"
        data-category-id="${faq.categoryId}"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1">
            <h4 class="font-medium text-gray-900 mb-1">${faq.question}</h4>
            <p class="text-sm text-gray-600 line-clamp-2">${faq.answer}</p>
          </div>
          <svg class="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
          </svg>
        </div>
      </button>
    `).join('');

    // Attach click handlers
    container.querySelectorAll('.faq-item').forEach(item => {
      item.addEventListener('click', () => {
        showFAQModal(item.dataset.categoryId, item.dataset.faqId);
      });
    });
  }

  /**
   * Render FAQ categories
   */
  function renderFAQCategories() {
    const container = document.getElementById('faqCategories');
    if (!container || !faqData.categories) return;

    // Show popular section only when not filtered
    const popularSection = document.getElementById('popularFaqs');
    if (popularSection) {
      popularSection.style.display = currentFilter === 'all' ? 'block' : 'none';
    }

    // Filter categories
    const categories = currentFilter === 'all'
      ? faqData.categories
      : faqData.categories.filter(c => c.id === currentFilter);

    const iconMap = {
      info: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      play: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      zap: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>',
      lock: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>',
      tool: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>',
      'credit-card': '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>'
    };

    container.innerHTML = categories.map(category => `
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
            ${iconMap[category.icon] || iconMap.info}
          </div>
          <div>
            <h2 class="text-xl font-bold text-gray-900">${category.title}</h2>
            <p class="text-sm text-gray-600">${category.description}</p>
          </div>
        </div>

        <div class="space-y-3">
          ${category.faqs.map(faq => `
            <button
              class="block w-full text-left p-4 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors faq-item"
              data-faq-id="${faq.id}"
              data-category-id="${category.id}"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1">
                  <h3 class="font-medium text-gray-900">${faq.question}</h3>
                </div>
                <svg class="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                </svg>
              </div>
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');

    // Attach click handlers
    document.querySelectorAll('.faq-item').forEach(item => {
      item.addEventListener('click', () => {
        showFAQModal(item.dataset.categoryId, item.dataset.faqId);
      });
    });
  }

  /**
   * Show FAQ in modal
   */
  function showFAQModal(categoryId, faqId) {
    const category = faqData.categories.find(c => c.id === categoryId);
    const faq = category?.faqs.find(f => f.id === faqId);

    if (!faq) return;

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-50 overflow-y-auto';
    modal.innerHTML = `
      <div class="min-h-screen px-4 flex items-center justify-center">
        <div class="fixed inset-0 bg-black opacity-50" id="faqModalOverlay"></div>
        <div class="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <!-- Header -->
          <div class="flex items-start justify-between p-6 border-b border-gray-200">
            <div class="flex-1">
              <div class="text-sm text-indigo-600 font-medium mb-2">${category.title}</div>
              <h2 class="text-2xl font-bold text-gray-900">${faq.question}</h2>
            </div>
            <button id="closeFaqModal" class="text-gray-400 hover:text-gray-600">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="flex-1 overflow-y-auto p-6">
            <div class="prose prose-indigo max-w-none">
              ${formatFAQAnswer(faq.answer)}
            </div>

            ${faq.tags && faq.tags.length > 0 ? `
              <div class="mt-6 pt-6 border-t border-gray-200">
                <p class="text-sm font-medium text-gray-700 mb-2">Tags:</p>
                <div class="flex flex-wrap gap-2">
                  ${faq.tags.map(tag => `
                    <span class="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">${tag}</span>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            ${faq.relatedFaqs && faq.relatedFaqs.length > 0 ? `
              <div class="mt-6 pt-6 border-t border-gray-200">
                <p class="text-sm font-medium text-gray-700 mb-3">Related Questions:</p>
                <div class="space-y-2">
                  ${faq.relatedFaqs.map(relatedId => {
                    const related = findFAQById(relatedId);
                    return related ? `
                      <button
                        class="block w-full text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded text-sm text-indigo-600 hover:text-indigo-800 related-faq-link"
                        data-faq-id="${related.id}"
                        data-category-id="${related.categoryId}"
                      >
                        ${related.question} →
                      </button>
                    ` : '';
                  }).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Footer - Helpful? -->
          <div class="border-t border-gray-200 p-6">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-gray-700">Was this helpful?</span>
              <div class="flex gap-2">
                <button
                  class="vote-btn px-4 py-2 border border-gray-300 rounded-lg hover:bg-green-50 hover:border-green-500 transition-colors flex items-center gap-2"
                  data-vote="helpful"
                  data-faq-id="${faq.id}"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"></path>
                  </svg>
                  Yes
                </button>
                <button
                  class="vote-btn px-4 py-2 border border-gray-300 rounded-lg hover:bg-red-50 hover:border-red-500 transition-colors flex items-center gap-2"
                  data-vote="not-helpful"
                  data-faq-id="${faq.id}"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"></path>
                  </svg>
                  No
                </button>
              </div>
            </div>
            <div id="voteMessage" class="hidden mt-3 p-3 bg-blue-50 rounded text-sm text-blue-800">
              Thank you for your feedback!
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    document.getElementById('closeFaqModal').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    document.getElementById('faqModalOverlay').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // Vote handlers
    modal.querySelectorAll('.vote-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        handleVote(btn.dataset.faqId, btn.dataset.vote);
        // Show thank you message
        document.getElementById('voteMessage').classList.remove('hidden');
        // Disable vote buttons
        modal.querySelectorAll('.vote-btn').forEach(b => b.disabled = true);
      });
    });

    // Related FAQ handlers
    modal.querySelectorAll('.related-faq-link').forEach(link => {
      link.addEventListener('click', () => {
        document.body.removeChild(modal);
        showFAQModal(link.dataset.categoryId, link.dataset.faqId);
      });
    });
  }

  /**
   * Find FAQ by ID across all categories
   */
  function findFAQById(faqId) {
    for (const category of faqData.categories) {
      const faq = category.faqs.find(f => f.id === faqId);
      if (faq) {
        return { ...faq, categoryId: category.id };
      }
    }
    return null;
  }

  /**
   * Format FAQ answer with paragraphs
   */
  function formatFAQAnswer(answer) {
    return answer
      .split('\n\n')
      .map(para => `<p class="mb-4">${para}</p>`)
      .join('');
  }

  /**
   * Handle vote
   */
  async function handleVote(faqId, vote) {
    console.log(`Vote for FAQ ${faqId}: ${vote}`);

    // In a real implementation, this would send the vote to the API
    // For now, just log it
    try {
      // await fetch(`${window.LanaConfig.CONNECTOR_REGISTRY_URL}/lana-ai/v1/faq/${faqId}/vote`, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ vote: vote === 'helpful' ? 'helpful' : 'not-helpful' })
      // });
    } catch (error) {
      console.error('Failed to submit vote:', error);
    }
  }

  /**
   * Search FAQs
   */
  function searchFAQs(query) {
    if (!query || query.length < 2) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    let results = searchIndex.filter(item => item.searchText.includes(lowerQuery));

    // Apply category filter
    if (currentFilter !== 'all') {
      results = results.filter(item => item.categoryId === currentFilter);
    }

    return results;
  }

  /**
   * Attach event listeners
   */
  function attachEventListeners() {
    // Search
    const searchInput = document.getElementById('faqSearch');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          currentSearchQuery = e.target.value;
          performSearch(currentSearchQuery);
        }, 300);
      });
    }

    // Clear search
    const clearSearchBtns = [
      document.getElementById('clearSearch'),
      document.getElementById('clearSearchNoResults')
    ];

    clearSearchBtns.forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          currentSearchQuery = '';
          document.getElementById('faqSearch').value = '';
          document.getElementById('searchResults').classList.add('hidden');
          document.getElementById('noResults').classList.add('hidden');
          renderFAQCategories();
        });
      }
    });

    // Retry button
    const retryBtn = document.getElementById('retryLoadFaq');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        location.reload();
      });
    }
  }

  /**
   * Perform search
   */
  function performSearch(query) {
    if (!query || query.length < 2) {
      document.getElementById('searchResults').classList.add('hidden');
      document.getElementById('noResults').classList.add('hidden');
      renderFAQCategories();
      return;
    }

    const results = searchFAQs(query);
    renderSearchResults(results, query);
  }

  /**
   * Render search results
   */
  function renderSearchResults(results, query) {
    const resultsInfo = document.getElementById('searchResults');
    const noResults = document.getElementById('noResults');
    const container = document.getElementById('faqCategories');
    const popularSection = document.getElementById('popularFaqs');

    // Hide popular section during search
    if (popularSection) {
      popularSection.style.display = 'none';
    }

    if (results.length === 0) {
      resultsInfo.classList.add('hidden');
      noResults.classList.remove('hidden');
      container.innerHTML = '';
      return;
    }

    // Show results info
    noResults.classList.add('hidden');
    resultsInfo.classList.remove('hidden');
    document.getElementById('searchResultCount').textContent = results.length;
    document.getElementById('searchQuery').textContent = query;

    // Group results by category
    const byCategory = {};
    results.forEach(faq => {
      if (!byCategory[faq.categoryId]) {
        byCategory[faq.categoryId] = {
          categoryId: faq.categoryId,
          categoryTitle: faq.categoryTitle,
          faqs: []
        };
      }
      byCategory[faq.categoryId].faqs.push(faq);
    });

    // Render grouped results
    container.innerHTML = Object.values(byCategory).map(group => `
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 class="text-xl font-bold text-gray-900 mb-4">${group.categoryTitle}</h2>
        <div class="space-y-3">
          ${group.faqs.map(faq => `
            <button
              class="block w-full text-left p-4 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors faq-item"
              data-faq-id="${faq.id}"
              data-category-id="${faq.categoryId}"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1">
                  <h3 class="font-medium text-gray-900 mb-2">${highlightQuery(faq.question, query)}</h3>
                  <p class="text-sm text-gray-600 line-clamp-2">${highlightQuery(faq.answer, query)}</p>
                </div>
                <svg class="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                </svg>
              </div>
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');

    // Attach click handlers
    document.querySelectorAll('.faq-item').forEach(item => {
      item.addEventListener('click', () => {
        showFAQModal(item.dataset.categoryId, item.dataset.faqId);
      });
    });
  }

  /**
   * Highlight search query in text
   */
  function highlightQuery(text, query) {
    if (!query || query.length < 2) return text;

    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark class="bg-yellow-200">$1</mark>');
  }

  /**
   * Show error state
   */
  function showError() {
    document.getElementById('faqLoading').classList.add('hidden');
    document.getElementById('faqError').classList.remove('hidden');
  }

  // Public API
  return {
    init
  };
})();

// Export for global access
window.FAQSystem = FAQSystem;
