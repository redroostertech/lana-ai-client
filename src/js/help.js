/**
 * LANA AI Help System
 *
 * Loads and renders help content from API or mock data
 * Handles contact support form submissions
 */

const HelpSystem = (function() {
  let helpData = null;
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
   * Show article in modal (legacy - no longer used)
   */
  function showArticleModalLegacy(sectionId, articleId) {
    const section = helpData.sections.find(s => s.id === sectionId);
    const article = section?.articles.find(a => a.id === articleId);

    if (!article) return;

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-50 overflow-y-auto';
    modal.innerHTML = `
      <div class="min-h-screen px-4 flex items-center justify-center">
        <div class="fixed inset-0 bg-black opacity-50" id="articleModalOverlay"></div>
        <div class="relative bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <!-- Header -->
          <div class="flex items-start justify-between p-6 border-b border-gray-200">
            <div class="flex-1">
              <h2 class="text-2xl font-bold text-gray-900 mb-2">${article.title}</h2>
              <div class="flex items-center gap-4 text-sm text-gray-500">
                <span>${article.readTime} min read</span>
                <span>•</span>
                <span>${section.title}</span>
              </div>
            </div>
            <button id="closeArticleModal" class="text-gray-400 hover:text-gray-600">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="flex-1 overflow-y-auto p-6">
            <div class="prose prose-indigo max-w-none">
              ${markdownToHtml(article.content)}
            </div>

            ${article.tags && article.tags.length > 0 ? `
              <div class="mt-6 pt-6 border-t border-gray-200">
                <p class="text-sm font-medium text-gray-700 mb-2">Tags:</p>
                <div class="flex flex-wrap gap-2">
                  ${article.tags.map(tag => `
                    <span class="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">${tag}</span>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            ${article.relatedArticles && article.relatedArticles.length > 0 ? `
              <div class="mt-6 pt-6 border-t border-gray-200">
                <p class="text-sm font-medium text-gray-700 mb-3">Related Articles:</p>
                <div class="space-y-2">
                  ${article.relatedArticles.map(relatedId => {
                    const related = findArticleById(relatedId);
                    return related ? `
                      <button
                        class="block w-full text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded text-sm text-indigo-600 hover:text-indigo-800 related-article-link"
                        data-article-id="${related.id}"
                        data-section-id="${related.sectionId}"
                      >
                        ${related.title} →
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

    document.body.appendChild(modal);

    // Close handlers
    document.getElementById('closeArticleModal').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    document.getElementById('articleModalOverlay').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // Related article handlers
    modal.querySelectorAll('.related-article-link').forEach(link => {
      link.addEventListener('click', () => {
        document.body.removeChild(modal);
        showArticleModal(link.dataset.sectionId, link.dataset.articleId);
      });
    });
  }

  /**
   * Find article by ID across all sections
   */
  function findArticleById(articleId) {
    for (const section of helpData.sections) {
      const article = section.articles.find(a => a.id === articleId);
      if (article) {
        return { ...article, sectionId: section.id };
      }
    }
    return null;
  }

  /**
   * Basic markdown to HTML conversion
   */
  function markdownToHtml(markdown) {
    let html = markdown
      // Headers
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Lists
      .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
      .replace(/^- (.*$)/gim, '<li>$1</li>')
      // Paragraphs
      .split('\n\n')
      .map(para => {
        if (para.startsWith('<h') || para.startsWith('<li>')) {
          return para;
        }
        return `<p>${para}</p>`;
      })
      .join('\n');

    // Wrap lists
    html = html.replace(/(<li>.*?<\/li>)/gis, match => {
      return `<ul>${match}</ul>`;
    });

    return html;
  }

  /**
   * Search help articles
   */
  function searchArticles(query) {
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

    const results = searchArticles(query);
    renderSearchResults(results);
  }

  /**
   * Render search results
   */
  function renderSearchResults(results) {
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
        <p class="text-gray-600">Found ${results.length} article${results.length === 1 ? '' : 's'}</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${results.map(article => `
          <button
            class="text-left bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow article-card"
            data-article-id="${article.id}"
            data-section-id="${article.sectionId}"
          >
            <div class="text-xs text-indigo-600 font-medium mb-2">${article.section}</div>
            <h3 class="font-semibold text-gray-900 mb-2">${article.title}</h3>
            <p class="text-sm text-gray-600">${article.summary}</p>
          </button>
        `).join('')}
      </div>
    `;

    // Attach click handlers
    document.querySelectorAll('.article-card').forEach(card => {
      card.addEventListener('click', () => {
        const sectionId = card.dataset.sectionId;
        const articleId = card.dataset.articleId;
        showArticleModal(sectionId, articleId);
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
