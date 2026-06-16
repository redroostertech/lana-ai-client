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
    console.log('[AgenticUI] Progress event received:', JSON.stringify(data));

    // Map backend event structure to frontend expected structure
    // Backend sends: { phase, status, message, currentStep, totalSteps, stepDescription, progress, error }
    // Frontend expects: { step, totalSteps, stepType, description, status }

    // Map phase names to step numbers for display
    const phaseToStep = {
      'classification': 1,
      'planning': 2,
      'execution': 3
    };

    const mappedData = {
      step: data.currentStep || data.step || phaseToStep[data.phase] || 1,
      totalSteps: data.totalSteps || 3, // Default to 3 phases
      stepType: data.phase || data.stepType || 'processing',
      description: data.stepDescription || data.message || data.description || 'Processing...',
      status: data.status || 'in_progress'
    };

    console.log('[AgenticUI] Mapped data:', JSON.stringify(mappedData));

    // Show progress indicator if this is the first event OR if no indicator is shown yet
    const progressContainer = document.getElementById('agentic-progress-container');
    if (!progressContainer || data.phase === 'classification' || mappedData.step === 1) {
      console.log('[AgenticUI] Showing progress indicator');
      this.showProgressIndicator(mappedData.totalSteps);
      this.progressStartTime = Date.now();
      this.startElapsedTimeCounter();
    }

    // Update step status
    this.updateStep(mappedData);

    // Update progress bar
    if (mappedData.step && mappedData.totalSteps) {
      this.updateProgressBar(mappedData.step, mappedData.totalSteps);
    } else if (data.progress !== undefined) {
      // Use progress percentage if available
      const progressBar = document.getElementById('agentic-progress-bar');
      if (progressBar) {
        progressBar.style.width = `${data.progress * 100}%`;
      }
    }
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
    // Only render DOCUMENT artifacts (with content) as panels.
    // Entity artifacts (matters, contacts, etc.) are already rendered as
    // clickable buttons via the agentic_artifacts SSE event.
    if (data.artifacts && data.artifacts.length > 0) {
      const documentArtifacts = data.artifacts.filter(a => !a.entity_type && a.content);
      documentArtifacts.forEach(artifact => {
        this.renderArtifact(artifact);
      });
    }

    // Show completion message if no document artifacts were rendered
    const hasDocumentArtifacts = data.artifacts && data.artifacts.some(a => !a.entity_type && a.content);
    if (!hasDocumentArtifacts) {
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

    // Do not show error card; fallback response + inline notice in chat handle communication
  }

  /**
   * Handle agentic_blocked SSE event.
   * A blocked run stopped on a missing precondition; it is not a crashed task.
   * @param {Object} data - Blocked precondition payload from backend
   */
  handleAgenticBlocked(data) {
    console.log('[AgenticUI] Blocked event:', data);

    this.stopElapsedTimeCounter();

    if (data.failedStep) {
      const stepElement = document.getElementById(`agentic-step-${data.failedStep}`);
      if (stepElement) {
        stepElement.querySelector('.step-icon').innerHTML = this.getStatusIcon('warning');
        stepElement.querySelector('.step-description').classList.remove('text-blue-700');
        stepElement.querySelector('.step-description').classList.add('text-amber-700');
      }
    }

    setTimeout(() => {
      this.hideProgressIndicator();
    }, 1200);

    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const reason = data.failureReason || 'missing_precondition';
    const summary = data.summary || data.error || 'The agent stopped because a required precondition was missing.';
    const followupCount = Array.isArray(data.suggestedFollowups) ? data.suggestedFollowups.length : 0;
    const followupText = followupCount > 0
      ? `${followupCount} follow-up option${followupCount === 1 ? '' : 's'} available below.`
      : 'Resolve the missing prerequisite, then retry the workflow.';

    const blockedHtml = `
      <div class="agentic-blocked bg-amber-50 border border-amber-200 rounded-lg p-4 my-4">
        <div class="flex items-start space-x-3">
          <svg class="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
          </svg>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-amber-900 text-sm">Workflow blocked</div>
            <p class="text-sm text-amber-900 mt-1">${this.escapeHtml(summary)}</p>
            <div class="text-xs text-amber-700 mt-2">
              Reason: <span class="font-medium">${this.escapeHtml(reason)}</span>. ${this.escapeHtml(followupText)}
            </div>
          </div>
        </div>
      </div>
    `;

    chatMessages.insertAdjacentHTML('beforeend', blockedHtml);
    this.scrollToBottom();
  }

  /**
   * Handle agentic_approval_required SSE event.
   * Rendered inline in the chat stream using Lex design tokens.
   *
   * @param {Object} data - Approval-required payload from backend
   *   {
   *     status: 'awaiting_approval',
   *     currentStep: { id, description, stepType, ... },
   *     approvalMessage: 'Review the proposed changes before continuing.',
   *     snapshotId: 'uuid',
   *     stepsCompleted: 2,
   *     totalSteps: 5,
   *     summary: '...'
   *   }
   * @param {string} conversationId - Active conversation ID from chat context
   */
  handleAgenticApprovalRequired(data, conversationId) {
    console.log('[AgenticUI] Approval Required event:', data);

    this.stopElapsedTimeCounter();
    setTimeout(() => { this.hideProgressIndicator(); }, 500);

    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) {
      console.warn('[AgenticUI] chatMessages container not found');
      return;
    }

    const snapshotId = data.snapshotId || '';
    const stepsCompleted = data.stepsCompleted || 0;
    const totalSteps = data.totalSteps || 0;
    const approvalMessage = data.approvalMessage || 'Review the proposed action before continuing.';
    const currentStep = data.currentStep || {};
    const stepDescription = currentStep.description || currentStep.stepDescription || '';
    const stepTypeRaw = currentStep.stepType || currentStep.step_type || '';
    const stepType = stepTypeRaw ? stepTypeRaw.replace(/_/g, ' ') : '';

    // Store context for approve/reject callbacks
    this.pendingApproval = {
      snapshotId: snapshotId,
      conversationId: conversationId || (window.chatApp && window.chatApp.currentConversationId) || ''
    };

    // Cap totalSteps to at least stepsCompleted + 1 for display sanity
    const displayTotal = Math.max(totalSteps, stepsCompleted + 1);
    const progressLabel = totalSteps > 0
      ? `Step ${stepsCompleted + 1} of ${displayTotal} — awaiting approval`
      : 'Awaiting approval';

    const stepDetailHtml = stepDescription
      ? `<div style="margin-top:12px;padding:12px;background:var(--lex-bg-secondary,#f9fafb);border:1px solid var(--lex-border-subtle,#e5e7eb);border-radius:6px;">
          ${stepType ? `<div style="font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--lex-text-tertiary,#6b7280);margin-bottom:4px;">${this.escapeHtml(stepType)}</div>` : ''}
          <div style="font-size:0.875rem;color:var(--lex-text-primary,#111827);line-height:1.5;">${this.escapeHtml(stepDescription)}</div>
        </div>`
      : '';

    const approvalId = 'agentic-approval-' + (snapshotId || Date.now());
    const approvalHtml = `
      <div id="${approvalId}" class="agentic-approval-card" data-snapshot-id="${this.escapeHtml(snapshotId)}" style="
        margin:16px 0;
        padding:16px;
        background:var(--lex-card-bg,#ffffff);
        border:1px solid var(--lex-color-warning-300,#fcd34d);
        border-left:4px solid var(--lex-color-warning-500,#f59e0b);
        border-radius:var(--lex-card-radius,8px);
        box-shadow:var(--lex-shadow-sm,0 1px 2px rgba(0,0,0,0.05));
      ">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--lex-color-warning-600,#d97706)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div style="font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--lex-color-warning-700,#b45309);">
            ${this.escapeHtml(progressLabel)}
          </div>
        </div>
        <div style="font-size:0.9375rem;font-weight:600;color:var(--lex-text-primary,#111827);line-height:1.4;">
          ${this.escapeHtml(approvalMessage)}
        </div>
        ${stepDetailHtml}
        <div style="display:flex;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap;">
          <button
            type="button"
            data-approval-action="approve"
            onclick="window.AgenticUI.approveAgenticTask('${this.escapeHtml(approvalId)}')"
            style="
              display:inline-flex;align-items:center;gap:6px;
              padding:8px 14px;
              font-size:0.8125rem;font-weight:600;
              color:#ffffff;
              background:var(--lex-color-primary-600,#4f46e5);
              border:1px solid var(--lex-color-primary-600,#4f46e5);
              border-radius:var(--lex-btn-radius,6px);
              cursor:pointer;
              transition:background-color 0.15s ease;
            "
            onmouseover="this.style.background='var(--lex-color-primary-700,#4338ca)'"
            onmouseout="this.style.background='var(--lex-color-primary-600,#4f46e5)'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Approve &amp; Continue
          </button>
          <button
            type="button"
            data-approval-action="reject"
            onclick="window.AgenticUI.rejectAgenticTask('${this.escapeHtml(approvalId)}')"
            style="
              display:inline-flex;align-items:center;gap:6px;
              padding:8px 14px;
              font-size:0.8125rem;font-weight:600;
              color:var(--lex-text-primary,#111827);
              background:var(--lex-card-bg,#ffffff);
              border:1px solid var(--lex-border-default,#d1d5db);
              border-radius:var(--lex-btn-radius,6px);
              cursor:pointer;
              transition:background-color 0.15s ease;
            "
            onmouseover="this.style.background='var(--lex-bg-secondary,#f9fafb)'"
            onmouseout="this.style.background='var(--lex-card-bg,#ffffff)'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Reject
          </button>
          <span data-approval-status style="font-size:0.75rem;color:var(--lex-text-tertiary,#6b7280);margin-left:4px;"></span>
        </div>
      </div>
    `;

    chatMessages.insertAdjacentHTML('beforeend', approvalHtml);
    this.scrollToBottom();
  }

  /**
   * Approve the paused agentic task and resume execution.
   * @param {string} approvalId - DOM id of the approval card
   */
  approveAgenticTask(approvalId) {
    this._submitApprovalDecision(approvalId, 'approve');
  }

  /**
   * Reject the paused agentic task and cancel remaining execution.
   * @param {string} approvalId - DOM id of the approval card
   */
  rejectAgenticTask(approvalId) {
    this._submitApprovalDecision(approvalId, 'reject');
  }

  /**
   * Shared submission path for approve/reject decisions.
   * Calls the task-level resume endpoint which continues sequential execution.
   *
   * @private
   */
  _submitApprovalDecision(approvalId, decision) {
    const card = document.getElementById(approvalId);
    if (!card) {
      console.warn('[AgenticUI] Approval card not found:', approvalId);
      return;
    }

    const pending = this.pendingApproval || {};
    const conversationId = pending.conversationId;

    if (!conversationId) {
      this._setApprovalStatus(card, 'Missing conversation context. Please reload.', 'error');
      return;
    }

    // Disable both buttons to prevent double-submit
    const buttons = card.querySelectorAll('button[data-approval-action]');
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    });
    this._setApprovalStatus(card, decision === 'approve' ? 'Resuming task...' : 'Cancelling task...', 'pending');

    const endpoint = decision === 'approve'
      ? `/api/v1/streaming/agentic/tasks/${encodeURIComponent(conversationId)}/approve`
      : `/api/v1/streaming/agentic/tasks/${encodeURIComponent(conversationId)}/reject`;

    const apiClient = window.api;
    if (!apiClient || typeof apiClient.post !== 'function') {
      this._setApprovalStatus(card, 'API client unavailable.', 'error');
      this._reenableApprovalButtons(card);
      return;
    }

    apiClient.post(endpoint, { comments: '' })
      .then(resp => {
        const result = (resp && resp.data) || {};
        const finalStatus = result.status || (decision === 'approve' ? 'approved' : 'cancelled');
        this._finalizeApprovalCard(card, decision, finalStatus);
        this.pendingApproval = null;

        if (window.Lex && window.Lex.Toast) {
          const toastFn = decision === 'approve' ? window.Lex.Toast.success : window.Lex.Toast.info;
          if (typeof toastFn === 'function') {
            toastFn(decision === 'approve' ? 'Task approved and resumed' : 'Task cancelled');
          }
        }
      })
      .catch(err => {
        console.error('[AgenticUI] Approval decision failed:', err);
        const message = (err && err.message) ? err.message : 'Request failed';
        this._setApprovalStatus(card, `Failed: ${message}`, 'error');
        this._reenableApprovalButtons(card);

        if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.error === 'function') {
          window.Lex.Toast.error(`Failed to ${decision} task`);
        }
      });
  }

  /**
   * Replace the card body with a resolved/terminal state.
   * @private
   */
  _finalizeApprovalCard(card, decision, finalStatus) {
    if (!card) return;

    const isApprove = decision === 'approve';
    const iconColor = isApprove ? 'var(--lex-color-success-600,#059669)' : 'var(--lex-text-tertiary,#6b7280)';
    const borderColor = isApprove ? 'var(--lex-color-success-300,#6ee7b7)' : 'var(--lex-border-default,#d1d5db)';
    const accentColor = isApprove ? 'var(--lex-color-success-500,#10b981)' : 'var(--lex-text-tertiary,#9ca3af)';
    const label = isApprove ? 'Approved — task resumed' : 'Rejected — task cancelled';
    const hint = isApprove
      ? 'The remaining steps are running in the background. Reload the conversation to see full results.'
      : 'No changes will be applied. You can send a new message to start over.';
    const iconPath = isApprove
      ? '<polyline points="20 6 9 17 4 12"/>'
      : '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';

    card.style.borderColor = borderColor;
    card.style.borderLeftColor = accentColor;
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:2px;">
          ${iconPath}
        </svg>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.875rem;font-weight:600;color:var(--lex-text-primary,#111827);">${this.escapeHtml(label)}</div>
          <div style="font-size:0.75rem;color:var(--lex-text-secondary,#4b5563);margin-top:4px;line-height:1.4;">${this.escapeHtml(hint)}</div>
        </div>
      </div>
    `;
  }

  /** @private */
  _setApprovalStatus(card, text, tone) {
    if (!card) return;
    const statusEl = card.querySelector('[data-approval-status]');
    if (!statusEl) return;
    statusEl.textContent = text;
    if (tone === 'error') {
      statusEl.style.color = 'var(--lex-color-danger-600,#dc2626)';
    } else if (tone === 'pending') {
      statusEl.style.color = 'var(--lex-text-tertiary,#6b7280)';
    } else {
      statusEl.style.color = 'var(--lex-text-tertiary,#6b7280)';
    }
  }

  /** @private */
  _reenableApprovalButtons(card) {
    if (!card) return;
    const buttons = card.querySelectorAll('button[data-approval-action]');
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    });
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
    console.log('[AgenticUI] updateStep called:', { step, totalSteps, stepType, description, status });

    const stepList = document.getElementById('agentic-step-list');
    if (!stepList) {
      console.warn('[AgenticUI] Step list element not found');
      return;
    }

    const stepId = `agentic-step-${step}`;
    let stepElement = document.getElementById(stepId);

    if (!stepElement) {
      // Create new step element
      console.log('[AgenticUI] Creating new step element:', stepId);
      const stepHtml = `
        <div id="${stepId}" class="flex items-start space-x-2 p-2 rounded bg-gray-50">
          <div class="flex-shrink-0 mt-0.5 step-icon">
            ${this.getStatusIcon(status)}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium step-description ${this.getStatusColor(status)}">${this.escapeHtml(description)}</p>
            <p class="text-xs text-gray-500 step-type">${this.formatStepType(stepType)}</p>
          </div>
        </div>
      `;
      stepList.insertAdjacentHTML('beforeend', stepHtml);
      stepElement = document.getElementById(stepId);
    } else {
      // Update existing step
      console.log('[AgenticUI] Updating existing step:', stepId);
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
  // FOLLOW-UP SUGGESTIONS
  // ========================================================================

  /**
   * Handle agentic_followup SSE event
   * Renders interactive follow-up suggestion card with Yes/No/Custom options
   * @param {Object} data - Follow-up data from backend
   * {
   *   followups: [{ entity_type, description, data }],
   *   message: 'I also found...',
   *   matterId: 'MATT-00006',
   *   options: [{ id, label, description }]
   * }
   */
  handleAgenticFollowup(data) {
    console.log('[AgenticUI] Follow-up event:', data);

    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages || !data.followups || data.followups.length === 0) return;

    // Store follow-up data for later use
    this.pendingFollowups = data;

    // Build follow-up items HTML
    const entityTypeLabels = {
      'task': 'Task',
      'contact': 'Contact',
      'note': 'Note',
      'matter': 'Matter',
      'document': 'Document'
    };

    const entityTypeIcons = {
      'task': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>',
      'contact': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>',
      'note': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>'
    };

    const followupItemsHtml = data.followups.map((f, idx) => {
      const label = entityTypeLabels[f.entity_type] || f.entity_type;
      const icon = entityTypeIcons[f.entity_type] || entityTypeIcons['note'];
      return `
        <div class="flex items-start space-x-2 p-2 rounded bg-white border border-indigo-100">
          <div class="flex-shrink-0 mt-0.5 text-indigo-500">${icon}</div>
          <div class="flex-1 min-w-0">
            <span class="text-xs font-medium text-indigo-600 uppercase">${this.escapeHtml(label)}</span>
            <p class="text-sm text-gray-800">${this.escapeHtml(f.description)}</p>
          </div>
        </div>
      `;
    }).join('');

    // Build options buttons HTML
    const optionsHtml = (data.options || []).map(opt => {
      let btnClass = '';
      if (opt.id === 'yes') {
        btnClass = 'bg-indigo-600 hover:bg-indigo-700 text-white';
      } else if (opt.id === 'no') {
        btnClass = 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300';
      } else {
        btnClass = 'bg-white hover:bg-gray-50 text-indigo-600 border border-indigo-300';
      }
      return `
        <button onclick="window.AgenticUI.respondToFollowup('${opt.id}')"
                class="px-4 py-2 rounded-lg text-sm font-medium transition ${btnClass}"
                title="${this.escapeHtml(opt.description || '')}">
          ${this.escapeHtml(opt.label)}
        </button>
      `;
    }).join('');

    const followupHtml = `
      <div id="agentic-followup-card" class="bg-indigo-50 border border-indigo-200 rounded-lg p-4 my-4">
        <div class="flex items-center space-x-2 mb-3">
          <svg class="w-5 h-5 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <h4 class="font-semibold text-indigo-900 text-sm">${this.escapeHtml(data.message || 'Additional items found')}</h4>
        </div>
        <div class="space-y-2 mb-4">
          ${followupItemsHtml}
        </div>
        <div class="flex items-center space-x-3">
          ${optionsHtml}
        </div>
      </div>
    `;

    chatMessages.insertAdjacentHTML('beforeend', followupHtml);
    this.scrollToBottom();
  }

  /**
   * Handle user response to follow-up suggestions
   * @param {string} choice - 'yes' | 'no' | 'custom'
   */
  respondToFollowup(choice) {
    const followupCard = document.getElementById('agentic-followup-card');
    const data = this.pendingFollowups;

    if (!data) {
      console.warn('[AgenticUI] No pending follow-ups to respond to');
      return;
    }

    // Disable buttons to prevent double-clicks
    if (followupCard) {
      followupCard.querySelectorAll('button').forEach(btn => {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
      });
    }

    if (choice === 'yes') {
      // Build a message that lists all follow-up entities to create
      const entityDescriptions = data.followups.map(f => {
        const dataJson = f.data ? JSON.stringify(f.data) : '';
        return `- ${f.entity_type}: ${f.description}${dataJson ? ' ' + dataJson : ''}`;
      }).join('\n');

      const followupMessage = `Yes, please create the following for this matter:\n${entityDescriptions}`;

      // Send as a new agentic mode message
      this.sendFollowupMessage(followupMessage, data.matterId);

      // Update card to show confirmation
      if (followupCard) {
        followupCard.innerHTML = `
          <div class="flex items-center space-x-2 text-indigo-800">
            <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-sm font-medium">Creating ${data.followups.length} additional record${data.followups.length > 1 ? 's' : ''}...</span>
          </div>
        `;
      }

    } else if (choice === 'no') {
      // Send a simple decline
      this.sendFollowupMessage('No thanks, that is all for now.', data.matterId);

      // Update card to show acknowledged
      if (followupCard) {
        followupCard.innerHTML = `
          <div class="flex items-center space-x-2 text-gray-600">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
            </svg>
            <span class="text-sm">Got it. Let me know if you need anything else.</span>
          </div>
        `;
      }

    } else if (choice === 'custom') {
      // Focus the text input for the user to type their own instructions
      const chatInput = document.getElementById('chatInput') || document.getElementById('messageInput');
      if (chatInput) {
        chatInput.focus();
        chatInput.placeholder = 'Type your instructions for what to create...';
      }

      // Update card to show custom mode
      if (followupCard) {
        followupCard.querySelector('.flex.items-center.space-x-3').innerHTML = `
          <span class="text-sm text-indigo-600 italic">Type your instructions in the chat input below...</span>
        `;
      }
    }

    // Clear pending follow-ups
    this.pendingFollowups = null;
  }

  /**
   * Send a follow-up message through the chat system
   * @param {string} message - Message to send
   * @param {string} matterId - Matter ID for context
   */
  sendFollowupMessage(message, matterId) {
    // Use the global chat instance to send a message
    // The chat.js exposes sendMessage or similar on the window/chat instance
    if (window.chat && typeof window.chat.sendMessage === 'function') {
      window.chat.sendMessage(message);
    } else if (window.chatInstance && typeof window.chatInstance.sendMessage === 'function') {
      window.chatInstance.sendMessage(message);
    } else {
      // Fallback: programmatically set input and trigger send
      const chatInput = document.getElementById('chatInput') || document.getElementById('messageInput');
      const sendButton = document.getElementById('sendButton') || document.getElementById('sendBtn');

      if (chatInput) {
        chatInput.value = message;
        // Trigger input event for any listeners
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Click send button if available
        if (sendButton) {
          sendButton.click();
        } else {
          // Dispatch Enter key event
          chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
      } else {
        console.error('[AgenticUI] Could not find chat input to send follow-up message');
        this.showToast('Could not send message. Please type your response manually.', 'warning');
      }
    }
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
    return timeAgo(timestamp);
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
    // Lex.state.activeMatterId is the canonical source (synced with localStorage 'activeMatterId')
    if (window.Lex && window.Lex.state && window.Lex.state.activeMatterId) {
      return window.Lex.state.activeMatterId;
    }

    // Legacy: window.api.currentMatterId
    if (window.api && window.api.currentMatterId) {
      return window.api.currentMatterId;
    }

    // Try from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const matterId = urlParams.get('matter_id');
    if (matterId) return matterId;

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
