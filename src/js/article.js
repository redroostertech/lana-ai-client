/**
 * LANA AI Article Display System
 *
 * Loads and renders individual help articles in a blog/guide style
 */

const ArticleSystem = (function() {
  let helpData = null;
  let currentArticle = null;

  // Help center content is remote text: escaped everywhere it goes into markup.
  const esc = (value) => window.Lex.escapeHtml(value == null ? '' : String(value));

  // The help center could not be reached (a different message from "not found").
  let offline = false;

  /**
   * Initialize the article system
   */
  async function init() {
    try {
      // Get article ID from URL params
      const urlParams = new URLSearchParams(window.location.search);
      const articleId = urlParams.get('id');
      const sectionId = urlParams.get('section');

      if (!articleId || !sectionId) {
        showError();
        return;
      }

      await loadHelpContent();
      loadAndRenderArticle(sectionId, articleId);
    } catch (error) {
      console.error('Failed to initialize article system:', error);
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

  /** Load the help center's sections. Offline, init shows the help center message. */
  async function loadHelpContent() {
    try {
      helpData = await fetchHelpCenter('/help', 'sections');
    } catch (error) {
      offline = true;
      throw error;
    }
  }

  /**
   * Load and render the article
   */
  function loadAndRenderArticle(sectionId, articleId) {
    const section = helpData.sections.find(s => s.id === sectionId);
    if (!section) {
      showError();
      return;
    }

    const article = section.articles.find(a => a.id === articleId);
    if (!article) {
      showError();
      return;
    }

    currentArticle = { ...article, section: section };
    renderArticle();

    // Hide loading, show content
    document.getElementById('articleLoading').classList.add('hidden');
    document.getElementById('articleContainer').classList.remove('hidden');
  }

  /**
   * Render the article
   */
  function renderArticle() {
    const article = currentArticle;
    const section = article.section;

    // Update page title
    document.title = `${article.title} - LanaAI Help`;
    var pageTitleEl = document.getElementById('pageTitle');
    if (pageTitleEl) pageTitleEl.textContent = article.title;
    // Lex shell: update topbar heading
    var lexApp = document.querySelector('lex-app');
    if (lexApp && lexApp.setPage) lexApp.setPage({ title: article.title });

    // Breadcrumb
    var breadcrumbEl = document.getElementById('articleBreadcrumb');
    if (breadcrumbEl) {
      breadcrumbEl.items = [
        { label: 'Help & Support', href: 'help.html' },
        { label: section.title }
      ];
    }
    // Legacy fallback
    var breadcrumbSection = document.getElementById('breadcrumbSection');
    if (breadcrumbSection) breadcrumbSection.textContent = section.title;

    // Header
    document.getElementById('articleCategory').textContent = section.title;
    document.getElementById('articleReadTime').textContent = `${article.readTime} min read`;
    document.getElementById('articleTitle').textContent = article.title;
    document.getElementById('articleSummary').textContent = article.summary;
    document.getElementById('articleUpdated').textContent = formatDate(article.lastUpdated);

    // Tags
    const tagsContainer = document.getElementById('articleTags');
    if (article.tags && article.tags.length > 0) {
      tagsContainer.innerHTML = article.tags.map(tag => `
        <span class="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">${esc(tag)}</span>
      `).join('');
    }

    // Content
    const contentHtml = markdownToHtml(article.content);
    document.getElementById('articleContent').innerHTML = contentHtml;

    // Related articles
    renderRelatedArticles();
  }

  /**
   * Render related articles
   */
  function renderRelatedArticles() {
    const article = currentArticle;
    const container = document.getElementById('relatedArticlesList');

    if (!article.relatedArticles || article.relatedArticles.length === 0) {
      document.getElementById('relatedArticles').style.display = 'none';
      return;
    }

    const relatedArticlesHtml = article.relatedArticles
      .map(relatedId => {
        const related = findArticleById(relatedId);
        if (!related) return '';

        return `
          <a href="article.html?section=${esc(encodeURIComponent(related.sectionId))}&amp;id=${esc(encodeURIComponent(related.id))}"
             class="block p-4 border border-gray-200 rounded-lg hover:border-indigo-500 hover:bg-indigo-50 transition-all group">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1">
                <h4 class="font-medium text-gray-900 group-hover:text-indigo-600 mb-1">${esc(related.title)}</h4>
                <p class="text-sm text-gray-600">${esc(related.summary)}</p>
              </div>
              <svg class="w-5 h-5 text-gray-400 group-hover:text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
              </svg>
            </div>
          </a>
        `;
      })
      .filter(html => html !== '')
      .join('');

    container.innerHTML = relatedArticlesHtml;
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
   * Format date string
   */
  function formatDate(dateString) {
    return LanaTime.timeAgo(dateString, { style: 'words', maxDays: 365 }) || Lex.Utils.formatDateLong(dateString);
  }

  /**
   * Basic markdown to HTML conversion
   */
  function markdownToHtml(markdown) {
    // Escaped first: the help center's markdown is text, and only these rules add markup.
    let html = esc(markdown);

    // Code blocks (must be processed before inline code)
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Split into paragraphs and lists
    const lines = html.split('\n');
    let inList = false;
    let listType = null;
    let processedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        if (inList) {
          processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
          inList = false;
          listType = null;
        }
        continue;
      }

      // Ordered list
      if (/^\d+\.\s/.test(line)) {
        if (!inList) {
          processedLines.push('<ol>');
          inList = true;
          listType = 'ol';
        } else if (listType === 'ul') {
          processedLines.push('</ul>');
          processedLines.push('<ol>');
          listType = 'ol';
        }
        processedLines.push('<li>' + line.replace(/^\d+\.\s/, '') + '</li>');
      }
      // Unordered list
      else if (/^[-*]\s/.test(line)) {
        if (!inList) {
          processedLines.push('<ul>');
          inList = true;
          listType = 'ul';
        } else if (listType === 'ol') {
          processedLines.push('</ol>');
          processedLines.push('<ul>');
          listType = 'ul';
        }
        processedLines.push('<li>' + line.replace(/^[-*]\s/, '') + '</li>');
      }
      // Headers
      else if (line.startsWith('<h')) {
        if (inList) {
          processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
          inList = false;
          listType = null;
        }
        processedLines.push(line);
      }
      // Code blocks
      else if (line.startsWith('<pre>') || line.startsWith('</pre>')) {
        if (inList) {
          processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
          inList = false;
          listType = null;
        }
        processedLines.push(line);
      }
      // Regular paragraph
      else {
        if (inList) {
          processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
          inList = false;
          listType = null;
        }
        processedLines.push('<p>' + line + '</p>');
      }
    }

    // Close any open lists
    if (inList) {
      processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
    }

    return processedLines.join('\n');
  }

  /**
   * Show error state
   */
  function showError() {
    document.getElementById('articleLoading').classList.add('hidden');
    const box = document.getElementById('articleError');
    box.classList.remove('hidden');
    if (offline) {
      // Not "not found": the help center could not be reached.
      const title = box.querySelector('h3');
      const detail = box.querySelector('p');
      if (title) title.textContent = 'The help center could not be reached';
      if (detail) detail.textContent = 'Check your internet connection, then try again.';
      // Try again, as on the Help and FAQ pages.
      const retryBtn = document.getElementById('retryLoadArticle');
      if (retryBtn) {
        retryBtn.classList.remove('hidden');
        if (!retryBtn.dataset.wired) {
          retryBtn.dataset.wired = 'true';
          retryBtn.addEventListener('click', () => location.reload());
        }
      }
    }
  }

  // Public API
  return {
    init
  };
})();

// Make it globally accessible
window.ArticleSystem = ArticleSystem;

// SPA: register with router so init runs on every navigation (including re-navigation)
if (window.LexRouter) {
  LexRouter.registerPageInit('article.html', function () { ArticleSystem.init(); });
}

// Standalone page — init directly (no SPA router)
if (!window.LexRouter) {
  ArticleSystem.init();
}
