/**
 * LANA AI Article Display System
 *
 * Loads and renders individual help articles in a blog/guide style
 */

const ArticleSystem = (function() {
  let helpData = null;
  let currentArticle = null;

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
      attachEventListeners();
    } catch (error) {
      console.error('Failed to initialize article system:', error);
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
    document.getElementById('pageTitle').textContent = article.title;

    // Breadcrumb
    document.getElementById('breadcrumbSection').textContent = section.title;

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
        <span class="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">${tag}</span>
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
          <a href="article.html?section=${related.sectionId}&id=${related.id}"
             class="block p-4 border border-gray-200 rounded-lg hover:border-indigo-500 hover:bg-indigo-50 transition-all group">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1">
                <h4 class="font-medium text-gray-900 group-hover:text-indigo-600 mb-1">${related.title}</h4>
                <p class="text-sm text-gray-600">${related.summary}</p>
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
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 1) {
      return 'today';
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months === 1 ? '' : 's'} ago`;
    } else {
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
  }

  /**
   * Basic markdown to HTML conversion
   */
  function markdownToHtml(markdown) {
    let html = markdown;

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
    document.getElementById('articleError').classList.remove('hidden');
  }

  /**
   * Attach event listeners
   */
  function attachEventListeners() {
    // Helpful buttons
    const helpfulYes = document.getElementById('helpfulYes');
    const helpfulNo = document.getElementById('helpfulNo');
    const feedbackMessage = document.getElementById('feedbackMessage');

    if (helpfulYes) {
      helpfulYes.addEventListener('click', () => {
        recordFeedback(true);
        helpfulYes.classList.add('bg-green-50', 'border-green-500', 'text-green-700');
        helpfulNo.disabled = true;
        feedbackMessage.classList.remove('hidden');
      });
    }

    if (helpfulNo) {
      helpfulNo.addEventListener('click', () => {
        recordFeedback(false);
        helpfulNo.classList.add('bg-red-50', 'border-red-500', 'text-red-700');
        helpfulYes.disabled = true;
        feedbackMessage.classList.remove('hidden');
      });
    }
  }

  /**
   * Record feedback
   */
  async function recordFeedback(helpful) {
    const urlParams = new URLSearchParams(window.location.search);
    const articleId = urlParams.get('id');
    const sectionId = urlParams.get('section');

    console.log('Article feedback:', { articleId, sectionId, helpful });

    try {
      await fetch(`https://redroostertec.com/lana-ai/v1/help/${articleId}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api.token}`
        },
        body: JSON.stringify({
          section_id: sectionId,
          feedback: helpful ? 'helpful' : 'not_helpful'
        })
      });
      console.log('Feedback submitted successfully');
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    }
  }

  // Public API
  return {
    init
  };
})();

// Make it globally accessible
window.ArticleSystem = ArticleSystem;
