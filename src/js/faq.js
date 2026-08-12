/**
 * LANA AI FAQ System
 *
 * Loads and renders FAQ content with accordion-style expansion, search, and filtering
 */

const FAQSystem = (function() {
  let faqData = null;
  let searchIndex = null;
  let currentFilter = 'all';
  let currentSearchQuery = '';
  let currentlyOpenFaqId = null;

  /**
   * Initialize the FAQ system
   */
  async function init() {
    try {
      await loadFAQContent();
      renderFAQContent();
      attachEventListeners();
      applyInitialSearch();
    } catch (error) {
      console.error('Failed to initialize FAQ system:', error);
      showError();
    }
  }

  /**
   * Load FAQ content from API or mock data
   */
  async function loadFAQContent() {
    const apiUrl = 'https://redroostertec.com/lana-ai/v1/faq';

    try {
      // Try to fetch from API
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${api.token}`
        }
      });

      if (response.ok) {
        const apiData = await response.json();

        // Check if API returned empty data
        if (!apiData.categories || apiData.categories.length === 0) {
          console.warn('API returned empty data, using mock data');
          faqData = await loadMockFAQData();
        } else {
          faqData = apiData;
          console.log('Loaded FAQ content from API');
        }
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
          helpful: faq.helpful || 0,
          notHelpful: faq.notHelpful || 0,
          relatedFaqs: faq.relatedFaqs || [],
          searchText: `${faq.question} ${faq.answer} ${(faq.tags || []).join(' ')}`.toLowerCase()
        });
      });
    });
  }

  /**
   * Render FAQ content
   */
  function renderFAQContent() {
    renderCategoryTabs();
    renderPopularFAQs();
    renderFAQCategories();

    // Hide loading, show content
    document.getElementById('faqLoading').classList.add('hidden');
    document.getElementById('faqContent').classList.remove('hidden');
  }

  /**
   * Render category tabs
   */
  function renderCategoryTabs() {
    const container = document.getElementById('categoryTabs');
    if (!container || !faqData.categories) return;

    const tabs = [
      { id: 'all', title: 'All Categories' }
    ].concat(faqData.categories.map(c => ({ id: c.id, title: c.title })));

    const nav = container.querySelector('nav');
    nav.innerHTML = tabs.map(tab => {
      const isActive = currentFilter === tab.id;
      return `
        <button
          class="category-tab px-4 py-2 whitespace-nowrap font-medium transition-all ${
            isActive
              ? 'text-indigo-600 border-b-2 border-indigo-600'
              : 'text-gray-600 border-b-2 border-transparent hover:text-gray-900 hover:border-gray-300'
          }"
          data-category="${tab.id}"
        >
          ${tab.title}
        </button>
      `;
    }).join('');

    // Attach click handlers
    container.querySelectorAll('.category-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.category;
        renderCategoryTabs();
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
    const section = document.getElementById('popularFaqsSection');
    if (!container || !faqData.popularFaqs) return;

    // Only show when no filter or search
    if (currentFilter !== 'all' || currentSearchQuery) {
      if (section) section.style.display = 'none';
      return;
    } else {
      if (section) section.style.display = 'block';
    }

    const popularFaqs = faqData.popularFaqs.map(id => {
      for (const category of faqData.categories) {
        const faq = category.faqs.find(f => f.id === id);
        if (faq) {
          return { ...faq, categoryId: category.id, categoryTitle: category.title };
        }
      }
      return null;
    }).filter(Boolean);

    container.innerHTML = popularFaqs.map(faq => renderFAQItem(faq, faq.categoryId)).join('');
  }

  /**
   * Render FAQ categories
   */
  function renderFAQCategories() {
    const container = document.getElementById('faqCategories');
    if (!container || !faqData.categories) return;

    // Filter categories
    const categories = currentFilter === 'all'
      ? faqData.categories
      : faqData.categories.filter(c => c.id === currentFilter);

    const iconMap = {
      info: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      play: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      zap: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>',
      lock: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>',
      tool: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>',
      'credit-card': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>'
    };

    container.innerHTML = categories.map(category => `
      <div class="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div class="bg-gradient-to-r from-indigo-50 to-purple-50 px-6 py-4 border-b border-gray-200">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 bg-white rounded-lg flex items-center justify-center text-indigo-600 shadow-sm">
              ${iconMap[category.icon] || iconMap.info}
            </div>
            <div>
              <h2 class="text-xl font-bold text-gray-900">${category.title}</h2>
              <p class="text-sm text-gray-600">${category.description} • ${category.faqs.length} questions</p>
            </div>
          </div>
        </div>

        <div class="divide-y divide-gray-200">
          ${category.faqs.map(faq => renderFAQItem(faq, category.id)).join('')}
        </div>
      </div>
    `).join('');
  }

  /**
   * Render a single FAQ item (accordion style)
   */
  function renderFAQItem(faq, categoryId) {
    const faqId = `${categoryId}-${faq.id}`;
    const isOpen = currentlyOpenFaqId === faqId;

    return `
      <div class="faq-item" data-faq-id="${faq.id}" data-category-id="${categoryId}" data-full-id="${faqId}">
        <button class="faq-question w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
          <div class="flex-1 pr-4">
            <h3 class="font-medium text-gray-900">${faq.question}</h3>
          </div>
          <svg class="w-5 h-5 text-gray-400 flex-shrink-0 faq-chevron ${isOpen ? 'open' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </button>

        <div class="faq-answer ${isOpen ? 'open' : ''} px-6 bg-gray-50">
          <div class="pb-4">
            <div class="prose prose-sm max-w-none text-gray-700 mb-4">
              ${formatFAQAnswer(faq.answer)}
            </div>

            ${faq.tags && faq.tags.length > 0 ? `
              <div class="flex flex-wrap gap-2 mb-4">
                ${faq.tags.map(tag => `
                  <span class="px-2 py-1 bg-gray-200 text-gray-700 rounded-full text-xs">${tag}</span>
                `).join('')}
              </div>
            ` : ''}

            <div class="flex items-center justify-between pt-4 border-t border-gray-200">
              <div class="flex items-center gap-2">
                <span class="text-sm text-gray-600">Was this helpful?</span>
                <button
                  class="vote-btn p-2 rounded hover:bg-green-100 transition-colors"
                  data-vote="helpful"
                  data-faq-id="${faq.id}"
                  title="Yes, this was helpful"
                >
                  <svg class="w-4 h-4 text-gray-600 hover:text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"></path>
                  </svg>
                </button>
                <button
                  class="vote-btn p-2 rounded hover:bg-red-100 transition-colors"
                  data-vote="not-helpful"
                  data-faq-id="${faq.id}"
                  title="No, this wasn't helpful"
                >
                  <svg class="w-4 h-4 text-gray-600 hover:text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"></path>
                  </svg>
                </button>
              </div>
              <div class="text-xs text-gray-500">
                ${faq.helpful || 0} helpful • ${faq.notHelpful || 0} not helpful
              </div>
            </div>

            ${faq.relatedFaqs && faq.relatedFaqs.length > 0 ? `
              <div class="mt-4 pt-4 border-t border-gray-200">
                <p class="text-sm font-medium text-gray-700 mb-2">Related Questions:</p>
                <div class="space-y-1">
                  ${faq.relatedFaqs.map(relatedId => {
                    const related = findFAQById(relatedId);
                    return related ? `
                      <button
                        class="block w-full text-left text-sm text-indigo-600 hover:text-indigo-800 hover:underline related-faq-link"
                        data-faq-id="${related.id}"
                        data-category-id="${related.categoryId}"
                      >
                        → ${related.question}
                      </button>
                    ` : '';
                  }).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Toggle FAQ accordion
   */
  function toggleFAQ(faqElement) {
    const fullId = faqElement.dataset.fullId;
    const answer = faqElement.querySelector('.faq-answer');
    const chevron = faqElement.querySelector('.faq-chevron');

    // Close currently open FAQ if different
    if (currentlyOpenFaqId && currentlyOpenFaqId !== fullId) {
      const openElement = document.querySelector(`[data-full-id="${currentlyOpenFaqId}"]`);
      if (openElement) {
        openElement.querySelector('.faq-answer').classList.remove('open');
        openElement.querySelector('.faq-chevron').classList.remove('open');
      }
    }

    // Toggle current FAQ
    const isOpening = !answer.classList.contains('open');
    answer.classList.toggle('open');
    chevron.classList.toggle('open');

    currentlyOpenFaqId = isOpening ? fullId : null;

    // Smooth scroll to question if opening
    if (isOpening) {
      setTimeout(() => {
        faqElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
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
      .map(para => `<p class="mb-3 last:mb-0">${para}</p>`)
      .join('');
  }

  /**
   * Handle vote
   */
  async function handleVote(faqId, vote) {
    console.log(`Vote for FAQ ${faqId}: ${vote}`);

    // Show feedback
    const voteBtn = event.target.closest('.vote-btn');
    const originalHTML = voteBtn.innerHTML;

    voteBtn.innerHTML = `
      <svg class="w-4 h-4 text-green-600 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
      </svg>
    `;

    // Disable the button
    voteBtn.disabled = true;

    // Send vote to API
    try {
      const response = await fetch(`https://redroostertec.com/lana-ai/v1/faq/${faqId}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api.token}`
        },
        body: JSON.stringify({
          feedback: vote === 'helpful' ? 'helpful' : 'not_helpful'
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Vote submitted successfully:', result);

        // Update the count display if backend returns updated counts
        if (result.helpful !== undefined && result.not_helpful !== undefined) {
          const countsElement = voteBtn.closest('.faq-answer').querySelector('.text-xs.text-gray-500');
          if (countsElement) {
            countsElement.textContent = `${result.helpful} helpful • ${result.not_helpful} not helpful`;
          }
        }
      } else {
        throw new Error('Failed to submit vote');
      }
    } catch (error) {
      console.error('Failed to submit vote:', error);
      // Revert button state on error
      voteBtn.innerHTML = originalHTML;
      voteBtn.disabled = false;
    }

    // Keep the checkmark for 2 seconds, then revert
    setTimeout(() => {
      if (!voteBtn.disabled) return;
      voteBtn.innerHTML = originalHTML;
    }, 2000);
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

    // FAQ click handlers (using event delegation)
    document.addEventListener('click', (e) => {
      // FAQ question click
      const questionBtn = e.target.closest('.faq-question');
      if (questionBtn) {
        const faqItem = questionBtn.closest('.faq-item');
        if (faqItem) {
          toggleFAQ(faqItem);
        }
      }

      // Vote button click
      const voteBtn = e.target.closest('.vote-btn');
      if (voteBtn) {
        e.stopPropagation();
        handleVote(voteBtn.dataset.faqId, voteBtn.dataset.vote);
      }

      // Related FAQ link click
      const relatedLink = e.target.closest('.related-faq-link');
      if (relatedLink) {
        e.preventDefault();
        // Find and open the related FAQ
        const faqItem = document.querySelector(`[data-faq-id="${relatedLink.dataset.faqId}"][data-category-id="${relatedLink.dataset.categoryId}"]`);
        if (faqItem) {
          toggleFAQ(faqItem);
          setTimeout(() => {
            faqItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      }
    });
  }

  function applyInitialSearch() {
    var params = new URLSearchParams(window.location.search || '');
    var query = params.get('search');
    if (!query) return;
    var searchInput = document.getElementById('faqSearch');
    if (searchInput) searchInput.value = query;
    currentSearchQuery = query;
    performSearch(query);
  }

  /**
   * Perform search
   */
  function performSearch(query) {
    const resultsInfo = document.getElementById('searchResults');
    const noResults = document.getElementById('noResults');
    const popularSection = document.getElementById('popularFaqsSection');

    if (!query || query.length < 2) {
      resultsInfo.classList.add('hidden');
      noResults.classList.add('hidden');
      renderFAQCategories();
      return;
    }

    // Hide popular section during search
    if (popularSection) {
      popularSection.style.display = 'none';
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
      <div class="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div class="bg-gradient-to-r from-indigo-50 to-purple-50 px-6 py-4 border-b border-gray-200">
          <h2 class="text-xl font-bold text-gray-900">${group.categoryTitle}</h2>
          <p class="text-sm text-gray-600">${group.faqs.length} result${group.faqs.length === 1 ? '' : 's'}</p>
        </div>
        <div class="divide-y divide-gray-200">
          ${group.faqs.map(faq => renderFAQItem(faq, faq.categoryId)).join('')}
        </div>
      </div>
    `).join('');
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

// SPA: register with router so init runs on every navigation (including re-navigation)
if (window.LexRouter) {
  LexRouter.registerPageInit('faq.html', function () { FAQSystem.init(); });
}

// Standalone page — init directly (no SPA router)
if (!window.LexRouter) {
  FAQSystem.init();
}
