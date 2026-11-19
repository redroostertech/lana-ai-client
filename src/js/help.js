/**
 * LANA AI Help System
 *
 * Loads and renders help content from the help center (js/config.js HELP_CENTER_API)
 * Handles contact support form submissions
 */

const HelpSystem = (function() {
  let helpData = null;
  let faqData = null;
  let searchIndex = null;

  // Help center content is remote text: escaped everywhere it goes into markup.
  const esc = (value) => window.Lex.escapeHtml(value == null ? '' : String(value));

  /**
   * A quick link's address: an https: address or a relative app path (js/shared/safe-url.js),
   * else '' (the link is then shown as plain text).
   */
  function quickLinkHref(raw) {
    const safe = window.LanaSafeUrl;
    const href = safe ? safe.safeAppOrLinkHref(raw) : '';
    if (!href) return '';
    return safe.schemeOf(raw) === 'relative' || href.indexOf('https:') === 0 ? href : '';
  }

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

  /** The help center's address (js/config.js). */
  function helpCenterUrl(path) {
    return window.LanaConfig.HELP_CENTER_API + path;
  }

  /** GET one help center list; rejects when it cannot be reached or answers nothing. */
  async function fetchHelpCenter(path, listKey) {
    // The help center is public: no LANA token or cookies go to it (RedRoosterTech-Web routes/lana-ai.js).
    const response = await fetch(helpCenterUrl(path), {
      method: 'GET',
      credentials: 'omit',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`The help center answered ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data[listKey]) || data[listKey].length === 0) throw new Error('The help center sent no content');
    return data;
  }

  /**
   * Load the help center's sections, and its FAQs for search. Offline, init shows the
   * help center message (showError); FAQs that do not load only leave them out of search.
   */
  async function loadHelpContent() {
    helpData = await fetchHelpCenter('/help', 'sections');
    // The help center names it quick_links.
    if (!helpData.quickLinks && Array.isArray(helpData.quick_links)) helpData.quickLinks = helpData.quick_links;

    try {
      faqData = await fetchHelpCenter('/faq', 'categories');
    } catch (error) {
      console.warn('Failed to load FAQ data for help search:', error);
      faqData = null;
    }

    // Build search index
    buildSearchIndex();
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

    container.innerHTML = visibleLinks.map(link => {
      const href = quickLinkHref(link.href);
      const tag = href ? 'a' : 'div';
      const target = href ? `href="${esc(href)}" ${link.external ? 'target="_blank" rel="noopener"' : ''}` : '';
      return `
      <${tag} ${target} class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0 text-indigo-600">
            ${iconMap[link.icon] || iconMap.mail}
          </div>
          <div class="flex-1">
            <h3 class="font-semibold text-gray-900 mb-1">${esc(link.title)}</h3>
            <p class="text-sm text-gray-600">${esc(link.description)}</p>
          </div>
          ${href && link.external ? '<svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>' : ''}
        </div>
      </${tag}>
    `;
    }).join('');
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
            <h2 class="text-2xl font-bold text-gray-900">${esc(section.title)}</h2>
            <p class="text-gray-600">${esc(section.description)}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${section.articles.map(article => `
            <button
              class="text-left bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow article-card"
              data-article-id="${esc(article.id)}"
              data-section-id="${esc(section.id)}"
            >
              <h3 class="font-semibold text-gray-900 mb-2">${esc(article.title)}</h3>
              <p class="text-sm text-gray-600 mb-3">${esc(article.summary)}</p>
              <div class="flex items-center justify-between text-xs text-gray-500">
                <span>${esc(article.readTime)} min read</span>
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
    window.location.href = `${articlePath}?section=${encodeURIComponent(sectionId)}&id=${encodeURIComponent(articleId)}`;
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
      const categorySelect = document.getElementById('contactCategory');
      if (categorySelect) {
        categorySelect.addEventListener('lex-change', () => { categorySelect.error = ''; });
      }
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
            data-type="${esc(item.type)}"
            data-item-id="${esc(item.id)}"
            data-section-id="${esc(item.sectionId)}"
          >
            <div class="text-xs text-indigo-600 font-medium mb-2">${esc(item.type === 'faq' ? 'FAQ' : item.section)}</div>
            <h3 class="font-semibold text-gray-900 mb-2">${esc(item.title)}</h3>
            <p class="text-sm text-gray-600">${esc(item.summary)}</p>
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

    // lex-select is not form-associated, so the browser's required check
    // does not cover it: validate the category explicitly.
    const categorySelect = document.getElementById('contactCategory');
    if (categorySelect && typeof categorySelect.validate === 'function' && !categorySelect.validate().valid) {
      return;
    }

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
      // No personal data in logs: say only which is missing.
      console.error('Contact form: the signed-in user\'s name or email is missing');
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


    try {
      const response = await fetch(helpCenterUrl('/support/contact'), {
        method: 'POST',
        // Public endpoint: no LANA token or cookies.
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      console.log('Contact form response status:', response.status);

      if (response.ok) {
        const result = await response.json();
        console.log('Contact form sent');

        // Show success
        document.getElementById('ticketId').textContent = result.ticket_id || result.ticketId || 'N/A';
        successMsg.classList.remove('hidden');

        // Reset form (lex-selects are not form-associated, so reset them too)
        form.reset();
        document.getElementById('contactCategory').value = '';
        document.getElementById('contactPriority').value = 'normal';

        // Re-fill user data
        prefillContactForm();

        // Scroll to success message
        successMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Contact form: the help center answered', response.status);
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
    // Try again works even though the page never finished loading.
    const retryBtn = document.getElementById('retryLoadHelp');
    if (retryBtn && !retryBtn.dataset.wired) {
      retryBtn.dataset.wired = 'true';
      retryBtn.addEventListener('click', () => location.reload());
    }
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
