/**
 * Relevance Labeling Interface
 * Allows SMEs to manually label search results for ground truth data
 */

class RelevanceLabeling {
  constructor() {
    this.currentQuery = null;
    this.currentResults = [];
    this.labels = new Map(); // document_id -> relevance_score
    this.labeledCount = 0;
  }

  async init() {
    this.setupEventListeners();
    await this.loadNextQuery();
  }

  setupEventListeners() {
    document.getElementById('saveLabelsBtn').addEventListener('click', () => {
      this.saveLabels();
    });

    document.getElementById('skipBtn').addEventListener('click', () => {
      this.skipQuery();
    });
  }

  async loadNextQuery() {
    try {
      document.getElementById('loadingState').classList.remove('hidden');
      document.getElementById('noQueriesState').classList.add('hidden');
      document.getElementById('labelingInterface').classList.add('hidden');

      // Fetch next unlabeled query
      const response = await fetch('/api/analytics/search/unlabeled-queries?limit=1', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load unlabeled queries');
      }

      const data = await response.json();
      const queries = data.unlabeled_queries || data;

      if (!queries || queries.length === 0) {
        // No more unlabeled queries
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('noQueriesState').classList.remove('hidden');
        return;
      }

      this.currentQuery = queries[0];

      // Fetch results for this query
      await this.loadQueryResults();

      // Render the query and results
      this.renderQuery();
      this.renderResults();

      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('labelingInterface').classList.remove('hidden');

      // Update progress
      this.updateProgress();

    } catch (error) {
      console.error('Failed to load query:', error);
      alert('Failed to load unlabeled query. Please try again.');
    }
  }

  async loadQueryResults() {
    // Get the top 5 results for this query from the results JSON
    const results = this.currentQuery.results || [];

    if (results.length === 0) {
      // If no results stored, we can't label (shouldn't happen for real queries)
      this.currentResults = [];
      return;
    }

    // Take top 5 results
    this.currentResults = results.slice(0, 5);

    // Initialize labels with default score of 3 (relevant)
    this.labels.clear();
    this.currentResults.forEach(result => {
      const docId = result.doc_id || result.document_id;
      this.labels.set(docId, { relevance_score: 3, rank: result.rank });
    });
  }

  renderQuery() {
    document.getElementById('queryText').textContent = this.currentQuery.query_text;
    document.getElementById('queryDate').textContent = this.formatTimestamp(this.currentQuery.created_at);
    document.getElementById('queryUser').textContent = this.currentQuery.user_email || 'Unknown';
    document.getElementById('queryMatter').textContent = this.currentQuery.matter_name || 'N/A';
    document.getElementById('queryResultCount').textContent = (this.currentQuery.results || []).length;
  }

  renderResults() {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = '';

    if (this.currentResults.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-gray-500">
          <p>No results to label for this query.</p>
        </div>
      `;
      return;
    }

    this.currentResults.forEach((result, index) => {
      const resultCard = this.createResultCard(result, index);
      container.appendChild(resultCard);
    });
  }

  createResultCard(result, index) {
    const card = document.createElement('div');
    card.className = 'border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow';

    const docId = result.doc_id || result.document_id;
    const documentTitle = result.filename || result.document_title || result.document_name || `Document ${docId}`;
    const snippet = result.snippet || result.content_preview || 'No preview available';
    const score = result.score || 0;

    card.innerHTML = `
      <div class="flex items-start justify-between mb-3">
        <div class="flex-1">
          <h3 class="font-semibold text-gray-900">Result ${index + 1}: ${this.escapeHtml(documentTitle)}</h3>
          <p class="text-sm text-gray-500 mt-1">Rank: ${result.rank} | Similarity Score: ${(score * 100).toFixed(1)}%</p>
        </div>
        <button class="text-indigo-600 hover:text-indigo-800 text-sm font-medium" data-doc-id="${docId}">
          View Full Document
        </button>
      </div>

      <div class="bg-gray-50 rounded p-3 mb-4">
        <p class="text-sm text-gray-700 line-clamp-3">${this.escapeHtml(snippet)}</p>
      </div>

      <div class="space-y-2">
        <p class="text-sm font-medium text-gray-700 mb-2">Relevance Score:</p>
        <div class="grid grid-cols-6 gap-2">
          ${[0, 1, 2, 3, 4, 5].map(score => `
            <label class="relative flex items-center justify-center cursor-pointer">
              <input
                type="radio"
                name="relevance_${docId}"
                value="${score}"
                ${score === 3 ? 'checked' : ''}
                class="sr-only peer"
                data-doc-id="${docId}"
                data-rank="${result.rank}"
                data-score="${score}"
              >
              <div class="w-full py-2 text-center border-2 rounded-lg transition-all
                         peer-checked:border-indigo-600 peer-checked:bg-indigo-50 peer-checked:font-semibold
                         border-gray-300 hover:border-gray-400
                         ${score === 0 ? 'text-red-600' : score === 5 ? 'text-green-600' : 'text-gray-700'}">
                ${score}
              </div>
            </label>
          `).join('')}
        </div>
        <div class="flex justify-between text-xs text-gray-500 mt-1">
          <span>Completely Irrelevant</span>
          <span>Perfect Match</span>
        </div>
      </div>
    `;

    // Add event listeners for radio buttons
    const radios = card.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        const docId = e.target.getAttribute('data-doc-id');
        const rank = parseInt(e.target.getAttribute('data-rank'));
        const score = parseInt(e.target.getAttribute('data-score'));
        this.labels.set(docId, { relevance_score: score, rank });
      });
    });

    // Add event listener for view document button
    const viewBtn = card.querySelector('button[data-doc-id]');
    viewBtn.addEventListener('click', (e) => {
      const docId = e.target.getAttribute('data-doc-id');
      this.viewDocument(docId);
    });

    return card;
  }

  async saveLabels() {
    try {
      // Validate that we have labels
      if (this.labels.size === 0) {
        alert('No labels to save');
        return;
      }

      // Convert labels map to array
      const labelsArray = Array.from(this.labels.entries()).map(([doc_id, label]) => ({
        doc_id,
        rank: label.rank,
        relevance_score: label.relevance_score
      }));

      const payload = {
        query_log_id: this.currentQuery.id,
        labels: labelsArray
      };

      const response = await fetch('/api/analytics/search/label-relevance', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Failed to save labels');
      }

      // Show success message
      this.showSuccessMessage();

      // Increment labeled count
      this.labeledCount++;

      // Load next query
      setTimeout(() => {
        this.loadNextQuery();
      }, 500);

    } catch (error) {
      console.error('Failed to save labels:', error);
      alert('Failed to save labels. Please try again.');
    }
  }

  skipQuery() {
    this.loadNextQuery();
  }

  viewDocument(docId) {
    // Open document in new tab
    window.open(`/document-viewer.html?id=${docId}`, '_blank');
  }

  showSuccessMessage() {
    // Create a temporary success toast
    const toast = document.createElement('div');
    toast.className = 'fixed top-20 right-8 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2';
    toast.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
      </svg>
      <span>Labels saved successfully!</span>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 2000);
  }

  updateProgress() {
    const progressIndicator = document.getElementById('progressIndicator');
    const progressText = document.getElementById('progressText');

    if (this.labeledCount > 0) {
      progressIndicator.classList.remove('hidden');
      progressText.textContent = `${this.labeledCount} labeled`;
    }
  }

  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  const labeling = new RelevanceLabeling();
  labeling.init();
});
