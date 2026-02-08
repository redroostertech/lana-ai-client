/**
 * Lana AI - Agentic Mode UI Component
 *
 * Handles the frontend UI for Agentic Mode features:
 * - Real-time progress tracking via SSE events
 * - Artifact rendering and management
 * - Error handling and recovery
 *
 * Integration: This module extends the existing chat.js SSE handling
 */

class AgenticUI {
  constructor() {
    this.currentPlan = null;
    this.currentExecution = null;
    this.progressStartTime = null;
    this.elapsedTimeInterval = null;

    this.init();
  }

  init() {
    console.log('[AgenticUI] Initialized');
  }

  // ========================================================================
  // SSE EVENT HANDLERS (Called from chat.js)
  // ========================================================================

  /**
   * Handle agentic_progress SSE event
   * @param {Object} data - Progress data from backend
   * {
   *   step: 2,
   *   totalSteps: 5,
   *   stepType: 'rag_search',
   *   description: 'Searching for similar motions to dismiss',
   *   status: 'in_progress',
   *   result: null
   * }
   */
  handleAgenticProgress(data) {
    console.log('[AgenticUI] Progress event:', data);

    // Show progress indicator if first step
    if (data.step === 1) {
      this.showProgressIndicator(data.totalSteps);
      this.progressStartTime = Date.now();
      this.startElapsedTimeCounter();
    }

    // Update step status
    this.updateStep(data);

    // Update progress bar
    this.updateProgressBar(data.step, data.totalSteps);
  }

  /**
   * Handle agentic_complete SSE event
   * @param {Object} data - Completion data from backend
   * {
   *   success: true,
   *   plan: { steps: [...], totalSteps: 5 },
   *   artifacts: [...],
   *   executionTime: 13542
   * }
   */
  handleAgenticComplete(data) {
    console.log('[AgenticUI] Complete event:', data);

    // Stop elapsed time counter
    this.stopElapsedTimeCounter();

    // Mark all steps as completed
    if (data.plan && data.plan.steps) {
      data.plan.steps.forEach((step, index) => {
        this.updateStep({
          step: index + 1,
          totalSteps: data.plan.totalSteps,
          stepType: step.type,
          description: step.description,
          status: 'completed'
        });
      });
    }

    // Update progress bar to 100%
    if (data.plan) {
      this.updateProgressBar(data.plan.totalSteps, data.plan.totalSteps);
    }

    // Hide progress indicator after delay
    setTimeout(() => {
      this.hideProgressIndicator();
    }, 3000);

    // Render artifacts if present
    if (data.artifacts && data.artifacts.length > 0) {
      data.artifacts.forEach(artifact => {
        this.renderArtifact(artifact);
      });
    } else {
      // If no artifacts, show completion message
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) {
        const messageHtml = `
          <div class="agentic-completion bg-green-50 border border-green-200 rounded-lg p-4 my-4">
            <div class="flex items-center space-x-2 text-green-800">
              <svg class="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
              </svg>
              <span class="font-medium">Task completed successfully</span>
              ${data.executionTime ? `<span class="text-sm text-green-600">(${(data.executionTime / 1000).toFixed(1)}s)</span>` : ''}
            </div>
          </div>
        `;
        chatMessages.insertAdjacentHTML('beforeend', messageHtml);
        this.scrollToBottom();
      }
    }
  }

  /**
   * Handle agentic_error SSE event
   * @param {Object} data - Error data from backend
   * {
   *   success: false,
   *   error: 'Task execution failed: ...',
   *   failedStep: 2,
   *   partialResults: [...]
   * }
   */
  handleAgenticError(data) {
    console.error('[AgenticUI] Error event:', data);

    // Stop elapsed time counter
    this.stopElapsedTimeCounter();

    // Mark failed step
    if (data.failedStep) {
      const stepElement = document.getElementById(`agentic-step-${data.failedStep}`);
      if (stepElement) {
        stepElement.querySelector('.step-icon').innerHTML = this.getStatusIcon('failed');
        stepElement.querySelector('.step-description').classList.remove('text-blue-700');
        stepElement.querySelector('.step-description').classList.add('text-red-700');
      }
    }

    // Hide progress indicator
    setTimeout(() => {
      this.hideProgressIndicator();
    }, 2000);

    // Display error message
    this.displayError(data);
  }

  // ========================================================================
  // PROGRESS INDICATOR UI
  // ========================================================================

  showProgressIndicator(totalSteps) {
    // Remove existing indicator if present
    const existing = document.getElementById('agentic-progress-container');
    if (existing) {
      existing.remove();
    }

    const html = `
      <div id="agentic-progress-container" class="fixed bottom-4 right-4 bg-white rounded-lg shadow-2xl p-4 max-w-md z-50 border border-blue-200">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center space-x-2">
            <div class="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
              <svg class="w-4 h-4 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h3 class="text-sm font-semibold text-gray-800">Agentic Task In Progress</h3>
          </div>
          <button id="cancel-agentic-task" class="text-gray-400 hover:text-gray-600 p-1" title="Cancel task">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <div id="agentic-step-list" class="space-y-2 mb-3 max-h-64 overflow-y-auto">
          <!-- Steps will be dynamically added here -->
        </div>

        <div class="mt-3">
          <div class="flex justify-between text-xs text-gray-600 mb-1">
            <span id="agentic-current-step-text">Initializing...</span>
            <span id="agentic-elapsed-time">0:00</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-2">
            <div id="agentic-progress-bar" class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // Bind cancel button
    const cancelBtn = document.getElementById('cancel-agentic-task');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to cancel this task?')) {
          this.cancelTask();
        }
      });
    }
  }

  hideProgressIndicator() {
    const container = document.getElementById('agentic-progress-container');
    if (container) {
      container.style.opacity = '0';
      container.style.transition = 'opacity 0.3s ease';
      setTimeout(() => {
        container.remove();
      }, 300);
    }
  }

  updateStep(stepData) {
    const { step, totalSteps, stepType, description, status } = stepData;
    const stepList = document.getElementById('agentic-step-list');
    if (!stepList) return;

    const stepId = `agentic-step-${step}`;
    let stepElement = document.getElementById(stepId);

    if (!stepElement) {
      // Create new step element
      const stepHtml = `
        <div id="${stepId}" class="flex items-start space-x-2 p-2 rounded bg-gray-50">
          <div class="flex-shrink-0 mt-0.5 step-icon">
            ${this.getStatusIcon(status)}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium step-description ${this.getStatusColor(status)}">${description}</p>
            <p class="text-xs text-gray-500 step-type">${this.formatStepType(stepType)}</p>
          </div>
        </div>
      `;
      stepList.insertAdjacentHTML('beforeend', stepHtml);
      stepElement = document.getElementById(stepId);
    } else {
      // Update existing step
      stepElement.querySelector('.step-icon').innerHTML = this.getStatusIcon(status);
      stepElement.querySelector('.step-description').textContent = description;
      stepElement.querySelector('.step-description').className = `text-sm font-medium step-description ${this.getStatusColor(status)}`;
    }

    // Update current step text
    const currentStepText = document.getElementById('agentic-current-step-text');
    if (currentStepText && status === 'in_progress') {
      currentStepText.textContent = `Step ${step} of ${totalSteps}`;
    }
  }

  updateProgressBar(currentStep, totalSteps) {
    const progressBar = document.getElementById('agentic-progress-bar');
    if (!progressBar) return;

    const percentage = (currentStep / totalSteps) * 100;
    progressBar.style.width = `${percentage}%`;
  }

  startElapsedTimeCounter() {
    this.elapsedTimeInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.progressStartTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      const elapsedTimeEl = document.getElementById('agentic-elapsed-time');
      if (elapsedTimeEl) {
        elapsedTimeEl.textContent = timeText;
      }
    }, 1000);
  }

  stopElapsedTimeCounter() {
    if (this.elapsedTimeInterval) {
      clearInterval(this.elapsedTimeInterval);
      this.elapsedTimeInterval = null;
    }
  }

  cancelTask() {
    // TODO: Implement task cancellation via API
    console.log('[AgenticUI] Cancel task requested');
    this.hideProgressIndicator();
    this.showToast('Task cancelled', 'warning');
  }

  // ========================================================================
  // ARTIFACT RENDERING
  // ========================================================================

  renderArtifact(artifact) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const artifactHtml = `
      <div class="artifact-result bg-blue-50 border border-blue-200 rounded-lg p-4 my-4" data-artifact-id="${artifact.artifact_id}">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center space-x-2">
            <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <h4 class="font-semibold text-blue-900">${this.escapeHtml(artifact.artifact_name)}</h4>
          </div>
          <span class="text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded">Version ${artifact.version}</span>
        </div>

        <div class="artifact-content bg-white rounded border border-blue-200 p-3 mb-3 max-h-96 overflow-y-auto">
          <pre class="text-sm text-gray-800 whitespace-pre-wrap font-mono">${this.escapeHtml(artifact.content)}</pre>
        </div>

        <div class="flex items-center justify-between">
          <div class="flex space-x-2">
            <button onclick="window.AgenticUI.downloadArtifact('${artifact.artifact_id}', '${this.escapeHtml(artifact.artifact_name)}')"
                    class="artifact-action-btn text-blue-600 hover:bg-blue-100 px-3 py-1 rounded text-sm flex items-center space-x-1 transition">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
              </svg>
              <span>Download</span>
            </button>
            <button onclick="window.AgenticUI.copyArtifactToClipboard('${artifact.artifact_id}')"
                    class="artifact-action-btn text-blue-600 hover:bg-blue-100 px-3 py-1 rounded text-sm flex items-center space-x-1 transition">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
              </svg>
              <span>Copy</span>
            </button>
            <button onclick="window.AgenticUI.viewVersionHistory('${artifact.artifact_name}')"
                    class="artifact-action-btn text-blue-600 hover:bg-blue-100 px-3 py-1 rounded text-sm flex items-center space-x-1 transition">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <span>Versions</span>
            </button>
          </div>
          <span class="text-xs text-gray-500">${this.formatTimestamp(artifact.created_at)}</span>
        </div>
      </div>
    `;

    chatMessages.insertAdjacentHTML('beforeend', artifactHtml);
    this.scrollToBottom();
  }

  // ========================================================================
  // ARTIFACT ACTIONS
  // ========================================================================

  async downloadArtifact(artifactId, artifactName) {
    try {
      const element = document.querySelector(`[data-artifact-id="${artifactId}"] pre`);
      if (!element) {
        throw new Error('Artifact not found');
      }

      const content = element.textContent;
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${artifactName}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showToast('Artifact downloaded', 'success');
    } catch (error) {
      console.error('[AgenticUI] Download error:', error);
      this.showToast('Failed to download artifact', 'error');
    }
  }

  async copyArtifactToClipboard(artifactId) {
    try {
      const element = document.querySelector(`[data-artifact-id="${artifactId}"] pre`);
      if (!element) {
        throw new Error('Artifact not found');
      }

      const content = element.textContent;
      await navigator.clipboard.writeText(content);
      this.showToast('Artifact copied to clipboard', 'success');
    } catch (error) {
      console.error('[AgenticUI] Copy error:', error);
      this.showToast('Failed to copy artifact', 'error');
    }
  }

  async viewVersionHistory(artifactName) {
    try {
      // Get current matter ID and token
      const token = localStorage.getItem('token');
      const matterId = this.getCurrentMatterId();

      if (!matterId) {
        throw new Error('No active matter selected');
      }

      // Fetch version history from backend
      let baseUrl = '';
      if (window.api) {
        baseUrl = window.api.baseUrl || window.LanaConfig?.API_BASE_URL || '';
      }

      const response = await fetch(`${baseUrl}/api/v1/agentic/artifacts?matter_id=${matterId}&artifact_name=${encodeURIComponent(artifactName)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.artifacts && data.artifacts.length > 0) {
        this.showVersionHistoryModal(data.artifacts);
      } else {
        this.showToast('No version history available', 'info');
      }
    } catch (error) {
      console.error('[AgenticUI] Version history error:', error);
      this.showToast('Failed to load version history', 'error');
    }
  }

  showVersionHistoryModal(versions) {
    // Remove existing modal if present
    const existing = document.getElementById('version-history-modal');
    if (existing) {
      existing.remove();
    }

    const versionsHtml = versions.map((v, index) => `
      <div class="version-item p-3 border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
           data-artifact-id="${v.artifact_id}">
        <div class="flex items-center justify-between mb-1">
          <span class="font-medium text-sm text-gray-800">Version ${v.version}</span>
          <span class="text-xs text-gray-500">${this.formatTimestamp(v.created_at)}</span>
        </div>
        <p class="text-xs text-gray-600 line-clamp-2">${this.escapeHtml(v.content.substring(0, 150))}...</p>
        ${index === 0 ? '<span class="text-xs text-green-600 font-medium">Current</span>' : ''}
      </div>
    `).join('');

    const modalHtml = `
      <div id="version-history-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onclick="if(event.target === this) this.remove()">
        <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
          <div class="flex items-center justify-between p-4 border-b border-gray-200">
            <h3 class="text-lg font-semibold text-gray-900">Version History</h3>
            <button onclick="document.getElementById('version-history-modal').remove()"
                    class="text-gray-400 hover:text-gray-600">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto">
            ${versionsHtml}
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Add click handlers for version items
    document.querySelectorAll('.version-item').forEach(item => {
      item.addEventListener('click', () => {
        const artifactId = item.dataset.artifactId;
        this.viewArtifactVersion(artifactId);
      });
    });
  }

  viewArtifactVersion(artifactId) {
    // Scroll to artifact in chat
    const artifactElement = document.querySelector(`[data-artifact-id="${artifactId}"]`);
    if (artifactElement) {
      artifactElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      artifactElement.classList.add('ring-2', 'ring-blue-400');
      setTimeout(() => {
        artifactElement.classList.remove('ring-2', 'ring-blue-400');
      }, 2000);
    }

    // Close modal
    const modal = document.getElementById('version-history-modal');
    if (modal) {
      modal.remove();
    }
  }

  // ========================================================================
  // ERROR HANDLING
  // ========================================================================

  displayError(errorData) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const errorHtml = `
      <div class="agentic-error bg-red-50 border border-red-200 rounded-lg p-4 my-4">
        <div class="flex items-start space-x-3">
          <svg class="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
          </svg>
          <div class="flex-1">
            <h4 class="font-semibold text-red-900 mb-1">Task Execution Failed</h4>
            <p class="text-sm text-red-700">${this.escapeHtml(errorData.error)}</p>
            ${errorData.failedStep ? `<p class="text-xs text-red-600 mt-2">Failed at step ${errorData.failedStep}</p>` : ''}
            <div class="mt-3">
              <button onclick="window.AgenticUI.retryTask()"
                      class="text-sm text-red-600 hover:text-red-800 font-medium">
                Retry Task
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    chatMessages.insertAdjacentHTML('beforeend', errorHtml);
    this.scrollToBottom();
  }

  retryTask() {
    // TODO: Implement retry logic
    console.log('[AgenticUI] Retry task requested');
    this.showToast('Retry not yet implemented', 'info');
  }

  // ========================================================================
  // UTILITY FUNCTIONS
  // ========================================================================

  getStatusIcon(status) {
    switch (status) {
      case 'completed':
        return `
          <svg class="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
          </svg>
        `;
      case 'in_progress':
        return `
          <svg class="w-5 h-5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        `;
      case 'failed':
        return `
          <svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
          </svg>
        `;
      default: // pending
        return `
          <svg class="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12z" clip-rule="evenodd"></path>
          </svg>
        `;
    }
  }

  getStatusColor(status) {
    switch (status) {
      case 'completed': return 'text-green-700';
      case 'in_progress': return 'text-blue-700';
      case 'failed': return 'text-red-700';
      default: return 'text-gray-600';
    }
  }

  formatStepType(stepType) {
    const labels = {
      'rag_search': 'Document Search',
      'document_generation': 'Document Generation',
      'data_extraction': 'Data Extraction',
      'save_artifact': 'Save Artifact',
      'search_legal_database': 'Legal Database Search',
      'analyze_documents': 'Document Analysis',
      'generate_document': 'Document Generation'
    };
    return labels[stepType] || stepType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  formatTimestamp(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

    return date.toLocaleDateString();
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  scrollToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }, 100);
    }
  }

  getCurrentMatterId() {
    // Try multiple sources for matter ID
    if (window.api && window.api.currentMatterId) {
      return window.api.currentMatterId;
    }

    // Try from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const matterId = urlParams.get('matter_id');
    if (matterId) return matterId;

    // Try from localStorage
    const storedMatterId = localStorage.getItem('current_matter_id');
    if (storedMatterId) return storedMatterId;

    return null;
  }

  showToast(message, type = 'info') {
    // Simple toast notification
    const toast = document.createElement('div');
    const bgColors = {
      success: 'bg-green-500',
      error: 'bg-red-500',
      warning: 'bg-yellow-500',
      info: 'bg-blue-500'
    };

    toast.className = `fixed bottom-4 left-4 ${bgColors[type]} text-white px-4 py-3 rounded-lg shadow-lg z-50 transition-opacity`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Initialize and export to global scope
if (typeof window !== 'undefined') {
  window.AgenticUI = new AgenticUI();
}
