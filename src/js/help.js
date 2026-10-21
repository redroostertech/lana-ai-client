/**
 * LANA AI Help System
 *
 * Loads and renders help content from API or mock data
 * Handles contact support form submissions
 */

const HelpSystem = (function() {
  let helpData = null;
  let faqData = null;
  let searchIndex = null;

  /**
   * Initialize the help system
   */
  async function init() {
    try {
      await loadHelpContent();
      renderHelpContent();
      prefillContactForm();
      attachEventListeners();
    } catch (error) {
      console.error('Failed to initialize help system:', error);
      showError();
    }
  }

  /**
   * Load help content from API or mock data
   */
  async function loadHelpContent() {
    const apiUrl = 'https://redroostertec.com/lana-ai/v1/help';

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
        if (!apiData.sections || apiData.sections.length === 0) {
          console.warn('API returned empty data, using mock data');
          helpData = await loadMockHelpData();
        } else {
          helpData = apiData;
          console.log('Loaded help content from API');
        }
      } else {
        throw new Error('API returned error');
      }
    } catch (error) {
      console.warn('Failed to load from API, using mock data:', error);
      // Fall back to mock data
      helpData = await loadMockHelpData();
    }

    try {
      faqData = await loadMockFAQData();
    } catch (error) {
      console.warn('Failed to load FAQ data for help search:', error);
      faqData = null;
    }

    // Build search index
    buildSearchIndex();
  }

  /**
   * Load mock help data from local file
   */
  async function loadMockHelpData() {
    try {
      const response = await fetch('mock-data/help-data.json');
      if (!response.ok) {
        throw new Error('Failed to load mock data');
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to load mock help data:', error);
      throw error;
    }
  }

  async function loadMockFAQData() {
    const response = await fetch('mock-data/faq-data.json');
    if (!response.ok) {
      throw new Error('Failed to load FAQ data');
    }
    return await response.json();
  }

  function plainTextFromHtmlish(value) {
    return String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[#*_`>\[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Build search index for fast searching
   */
  function buildSearchIndex() {
    searchIndex = [];

    helpData.sections.forEach(section => {
      section.articles.forEach(article => {
        searchIndex.push({
          type: 'article',
          section: section.title,
          sectionId: section.id,
          id: article.id,
          title: article.title,
          summary: article.summary,
          content: article.content,
          tags: article.tags || [],
          searchText: `${article.title} ${article.summary} ${article.content} ${(article.tags || []).join(' ')}`.toLowerCase()
        });
      });
    });

    if (faqData && Array.isArray(faqData.categories)) {
      faqData.categories.forEach(category => {
        (category.faqs || []).forEach(faq => {
          var answerText = plainTextFromHtmlish(faq.answer);
          searchIndex.push({
            type: 'faq',
            section: category.title,
            sectionId: category.id,
            id: faq.id,
            title: faq.question,
            summary: answerText.length > 160 ? answerText.substring(0, 157) + '...' : answerText,
            content: answerText,
            tags: faq.tags || [],
            searchText: `${faq.question} ${answerText} ${(faq.tags || []).join(' ')}`.toLowerCase()
          });
        });
      });
    }
  }

  /**
   * Render help content
   */
  function renderHelpContent() {
    renderQuickLinks();
    renderHelpSections();

    // Hide loading, show content
    document.getElementById('helpLoading').classList.add('hidden');
    document.getElementById('helpContent').classList.remove('hidden');
  }

  /**
   * Render quick links
   */
  function renderQuickLinks() {
    const container = document.getElementById('quickLinks');
    if (!container || !helpData.quickLinks) return;

    const iconMap = {
      mail: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>',
      video: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>',
      activity: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>',
      code: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>'
    };

    // Filter out hidden links
    const visibleLinks = helpData.quickLinks.filter(link => !link.hidden);

    container.innerHTML = visibleLinks.map(link => `
      <a href="${link.href}" ${link.external ? 'target="_blank" rel="noopener"' : ''} class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0 text-indigo-600">
            ${iconMap[link.icon] || iconMap.mail}
          </div>
          <div class="flex-1">
            <h3 class="font-semibold text-gray-900 mb-1">${link.title}</h3>
            <p class="text-sm text-gray-600">${link.description}</p>
          </div>
          ${link.external ? '<svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>' : ''}
        </div>
      </a>
    `).join('');
  }

  /**
   * Render help sections
   */
  function renderHelpSections() {
    const container = document.getElementById('helpSections');
    if (!container || !helpData.sections) return;

    const iconMap = {
      rocket: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>',
      sparkles: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path></svg>',
      wrench: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>',
      shield: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>'
    };

    container.innerHTML = helpData.sections.map(section => `
      <div class="mb-12">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
            ${iconMap[section.icon] || iconMap.rocket}
          </div>
          <div>
            <h2 class="text-2xl font-bold text-gray-900">${section.title}</h2>
            <p class="text-gray-600">${section.description}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${section.articles.map(article => `
            <button
              class="text-left bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow article-card"
              data-article-id="${article.id}"
              data-section-id="${section.id}"
            >
              <h3 class="font-semibold text-gray-900 mb-2">${article.title}</h3>
              <p class="text-sm text-gray-600 mb-3">${article.summary}</p>
              <div class="flex items-center justify-between text-xs text-gray-500">
                <span>${article.readTime} min read</span>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                </svg>
              </div>
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');

    // Attach click handlers to article cards
    document.querySelectorAll('.article-card').forEach(card => {
      card.addEventListener('click', () => {
        const sectionId = card.dataset.sectionId;
        const articleId = card.dataset.articleId;
        showArticleModal(sectionId, articleId);
      });
    });
  }

  /**
   * Navigate to article page
   */
  function showArticleModal(sectionId, articleId) {
    // Navigate to dedicated article page
    const articlePath = typeof getPagePath === 'function' ? getPagePath('article.html') : 'article.html';
    window.location.href = `${articlePath}?section=${sectionId}&id=${articleId}`;
  }

  /**
   * Search help articles
   */
  function searchContent(query) {
    if (!query || query.length < 2) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    return searchIndex.filter(item => item.searchText.includes(lowerQuery));
  }

  /**
   * Pre-fill contact form with user data
   */
  function prefillContactForm() {
    const user = api?.user;
    if (!user) return;

    // Pre-fill name
    const nameField = document.getElementById('contactName');
    if (nameField && user.firstName && user.lastName) {
      nameField.value = `${user.firstName} ${user.lastName}`;
    }

    // Pre-fill email
    const emailField = document.getElementById('contactEmail');
    if (emailField && user.email) {
      emailField.value = user.email;
    }

    // Pre-fill organization
    const orgField = document.getElementById('contactOrganization');
    if (orgField && user.organizationName) {
      orgField.value = user.organizationName;
    }
  }

  /**
   * Attach event listeners
   */
  function attachEventListeners() {
    // Search
    const searchInput = document.getElementById('helpSearch');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          performSearch(e.target.value);
        }, 300);
      });
    }

    // Retry button
    const retryBtn = document.getElementById('retryLoadHelp');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        location.reload();
      });
    }

    // Contact form
    const contactForm = document.getElementById('contactSupportForm');
    if (contactForm) {
      contactForm.addEventListener('submit', handleContactFormSubmit);
    }
  }

  /**
   * Perform search
   */
  function performSearch(query) {
    if (!query || query.length < 2) {
      renderHelpSections();
      return;
    }

    const results = searchContent(query);
    renderSearchResults(results, query);
  }

  /**
   * Render search results
   */
  function renderSearchResults(results, query) {
    const container = document.getElementById('helpSections');
    if (!container) return;

    if (results.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12">
          <svg class="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <h3 class="text-lg font-semibold text-gray-900 mb-2">No results found</h3>
          <p class="text-gray-600">Try different keywords or browse sections above</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-gray-900 mb-2">Search Results</h2>
        <p class="text-gray-600">Found ${results.length} result${results.length === 1 ? '' : 's'}</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${results.map(item => `
          <button
            class="text-left bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow search-result-card"
            data-type="${item.type}"
            data-item-id="${item.id}"
            data-section-id="${item.sectionId}"
          >
            <div class="text-xs text-indigo-600 font-medium mb-2">${item.type === 'faq' ? 'FAQ' : item.section}</div>
            <h3 class="font-semibold text-gray-900 mb-2">${item.title}</h3>
            <p class="text-sm text-gray-600">${item.summary}</p>
          </button>
        `).join('')}
      </div>
    `;

    // Attach click handlers
    document.querySelectorAll('.search-result-card').forEach(card => {
      card.addEventListener('click', () => {
        const sectionId = card.dataset.sectionId;
        const itemId = card.dataset.itemId;
        if (card.dataset.type === 'faq') {
          const faqPath = typeof getPagePath === 'function' ? getPagePath('faq.html') : 'faq.html';
          window.location.href = `${faqPath}?search=${encodeURIComponent(query || '')}`;
          return;
        }
        showArticleModal(sectionId, itemId);
      });
    });
  }

  /**
   * Handle contact form submission
   */
  async function handleContactFormSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const submitBtn = document.getElementById('submitContactForm');
    const successMsg = document.getElementById('contactSuccess');
    const errorMsg = document.getElementById('contactError');

    // Hide previous messages
    successMsg.classList.add('hidden');
    errorMsg.classList.add('hidden');

    // Disable submit button
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
        <span>Sending...</span>
      </div>
    `;

    // Collect form data
    const name = document.getElementById('contactName').value;
    const email = document.getElementById('contactEmail').value;

    // Validate that user data is populated
    if (!name || !email) {
      console.error('User data not populated. Name:', name, 'Email:', email);
      errorMsg.classList.remove('hidden');
      document.getElementById('contactErrorMessage').textContent =
        'Unable to retrieve your account information. Please refresh the page and try again.';
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <span>Send Message</span>
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path>
        </svg>
      `;
      return;
    }

    const formData = {
      name: name,
      email: email,
      organization: document.getElementById('contactOrganization').value || undefined,
      subject: document.getElementById('contactSubject').value,
      category: document.getElementById('contactCategory').value,
      priority: document.getElementById('contactPriority').value,
      message: document.getElementById('contactMessage').value,
      userAgent: navigator.userAgent,
      appVersion: window.LanaConfig?.APP_VERSION || '2.0.0',
      deploymentId: undefined // TODO: Get from config if available
    };

    console.log('Submitting contact form with data:', formData);

    try {
      const response = await fetch('https://redroostertec.com/lana-ai/v1/support/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api.token}`
        },
        body: JSON.stringify(formData)
      });

      console.log('Contact form response status:', response.status);

      if (response.ok) {
        const result = await response.json();
        console.log('Contact form success:', result);

        // Show success
        document.getElementById('ticketId').textContent = result.ticket_id || result.ticketId || 'N/A';
        successMsg.classList.remove('hidden');

        // Reset form
        form.reset();

        // Re-fill user data
        prefillContactForm();

        // Scroll to success message
        successMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Contact form API error:', errorData);
        throw new Error(errorData.message || errorData.error || 'Failed to submit');
      }
    } catch (error) {
      console.error('Contact form submission error:', error);

      // Show error
      document.getElementById('contactErrorMessage').textContent =
        'An error occurred while sending your message. Please try again or email support@redroostertec.com directly.';
      errorMsg.classList.remove('hidden');

      // Scroll to error
      errorMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      // Re-enable submit button
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <span>Send Message</span>
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path>
        </svg>
      `;
    }
  }

  /**
   * Show error state
   */
  function showError() {
    document.getElementById('helpLoading').classList.add('hidden');
    document.getElementById('helpError').classList.remove('hidden');
  }

  // Public API
  return {
    init
  };
})();

// Export for global access
window.HelpSystem = HelpSystem;

// SPA: register with router so init runs on every navigation (including re-navigation)
if (window.LexRouter) {
  LexRouter.registerPageInit('help.html', function () { HelpSystem.init(); });
}

// Standalone page — init directly (no SPA router)
if (!window.LexRouter) {
  HelpSystem.init();
}
