/**
 * DocumentActionHandler - Handles AI response actions for document editing
 * Actions: Apply to Document, Insert at Cursor, Add Merge Field
 */

class DocumentActionHandler {
  constructor(options = {}) {
    this.editor = options.editor || null;
    this.chatContainer = options.chatContainer || null;
    this.onApprovalRequired = options.onApprovalRequired || this.showApprovalDialog.bind(this);

    logInfo('DocumentActionHandler initialized', {
      hasEditor: !!this.editor,
      hasChatContainer: !!this.chatContainer
    });
  }

  /**
   * Attach action buttons to the last AI message
   */
  attachToLastMessage() {
    if (!this.chatContainer) {
      logWarn('No chat container available');
      return;
    }

    const lastAiMessage = this.chatContainer.querySelector('.ai-message:last-child');
    if (!lastAiMessage) {
      logWarn('No AI message found to attach actions');
      return;
    }

    // Check if actions already attached
    if (lastAiMessage.querySelector('.document-actions')) {
      logInfo('Actions already attached to this message');
      return;
    }

    // Get message content
    const messageContent = lastAiMessage.querySelector('.chat-message-content');
    if (!messageContent) return;

    const content = messageContent.textContent || '';

    // Create action buttons container
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'document-actions mt-3 pt-3 border-t border-gray-200 flex flex-wrap gap-2';

    // Action: Apply to Document (requires approval)
    const applyBtn = this.createActionButton({
      icon: 'check',
      label: 'Apply to Document',
      variant: 'primary',
      onClick: () => this.handleApply(content, messageContent)
    });

    // Action: Insert at Cursor
    const insertBtn = this.createActionButton({
      icon: 'plus',
      label: 'Insert at Cursor',
      variant: 'secondary',
      onClick: () => this.handleInsert(content)
    });

    // Action: Copy Merge Field (if message contains merge field)
    if (this.containsMergeField(content)) {
      const mergeFields = this.extractMergeFields(content);
      const copyFieldBtn = this.createActionButton({
        icon: 'code',
        label: 'Copy Field',
        variant: 'secondary',
        onClick: () => this.handleCopyMergeField(mergeFields[0])
      });
      actionsContainer.appendChild(copyFieldBtn);
    }

    actionsContainer.appendChild(applyBtn);
    actionsContainer.appendChild(insertBtn);

    // Insert actions after message content bubble
    const messageBubble = lastAiMessage.querySelector('.bg-gray-100');
    if (messageBubble) {
      messageBubble.appendChild(actionsContainer);
    }

    logInfo('Actions attached to last AI message');
  }

  /**
   * Create action button element
   */
  createActionButton({ icon, label, variant, onClick }) {
    const button = document.createElement('button');
    button.className = variant === 'primary'
      ? 'inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition'
      : 'inline-flex items-center gap-2 px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 transition';

    button.innerHTML = `
      ${this.getIconSVG(icon)}
      <span>${label}</span>
    `;

    button.addEventListener('click', onClick);

    return button;
  }

  /**
   * Get SVG icon by name
   */
  getIconSVG(iconName) {
    const icons = {
      check: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
      plus: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>',
      code: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>'
    };

    return icons[iconName] || '';
  }

  /**
   * Handle "Apply to Document" action
   * Shows approval dialog before applying
   */
  async handleApply(content, messageElement) {
    logInfo('Apply to Document requested', {
      contentLength: content.length
    });

    // Convert markdown/formatted content to plain text for editor
    const plainText = this.convertToPlainText(messageElement);

    // Show approval dialog
    const approved = await this.onApprovalRequired({
      action: 'apply',
      content: plainText,
      preview: this.generatePreview(plainText, 200)
    });

    if (approved) {
      this.applyToDocument(plainText);
      this.showSuccessToast('Content applied to document');
    } else {
      logInfo('Apply action cancelled by user');
    }
  }

  /**
   * Handle "Insert at Cursor" action
   * Inserts content at current cursor position
   */
  async handleInsert(content) {
    if (!this.editor) {
      this.showErrorToast('No editor available');
      return;
    }

    logInfo('Insert at Cursor requested');

    try {
      // Get plain text from content
      const plainText = this.stripHTML(content);

      // Insert at current cursor position
      this.editor.commands.insertContent(plainText);

      this.showSuccessToast('Content inserted at cursor');
      logInfo('Content inserted successfully');

      // AUDIT: Log document modification for compliance (VULN-003 fix)
      await this.logDocumentModification({
        action: 'document_modified_by_ai',
        modificationType: 'insertion',
        contentLength: plainText.length
      });

    } catch (error) {
      logError('Failed to insert content', error);
      this.showErrorToast('Failed to insert content');
    }
  }

  /**
   * Handle "Copy Merge Field" action
   */
  handleCopyMergeField(mergeField) {
    logInfo('Copy merge field requested', { mergeField });

    try {
      // Format as merge field: {{matter.field_name}}
      const formattedField = mergeField.startsWith('{{') ? mergeField : `{{${mergeField}}}`;

      // Copy to clipboard
      navigator.clipboard.writeText(formattedField)
        .then(() => {
          this.showSuccessToast(`Copied: ${formattedField}`);
          logInfo('Merge field copied to clipboard');
        })
        .catch(err => {
          logError('Failed to copy to clipboard', err);
          this.showErrorToast('Failed to copy merge field');
        });

    } catch (error) {
      logError('Failed to copy merge field', error);
      this.showErrorToast('Failed to copy merge field');
    }
  }

  /**
   * Apply content to document (replace entire content)
   */
  async applyToDocument(content) {
    if (!this.editor) {
      this.showErrorToast('No editor available');
      return;
    }

    try {
      // Clear editor and set new content
      this.editor.commands.setContent(content);
      logInfo('Document content replaced');

      // AUDIT: Log document modification for compliance (VULN-003 fix)
      await this.logDocumentModification({
        action: 'document_modified_by_ai',
        modificationType: 'full_replacement',
        contentLength: content.length
      });

    } catch (error) {
      logError('Failed to apply content', error);
      this.showErrorToast('Failed to apply content');
    }
  }

  /**
   * Show approval dialog
   * Returns promise that resolves to true/false
   */
  async showApprovalDialog({ action, content, preview }) {
    return new Promise((resolve) => {
      // Create modal
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
      modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
          <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900">Confirm Action</h3>
            <button class="close-btn text-gray-400 hover:text-gray-600">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div class="px-6 py-4 overflow-y-auto flex-1">
            <p class="text-sm text-gray-700 mb-3">
              Are you sure you want to <strong>${action === 'apply' ? 'replace the entire document' : 'insert this content'}</strong>?
            </p>
            <div class="bg-gray-50 border border-gray-200 rounded p-4 text-sm text-gray-800 whitespace-pre-wrap font-mono">
              ${this.escapeHtml(preview)}
              ${preview.length < content.length ? '\n\n[... content truncated ...]' : ''}
            </div>
          </div>
          <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
            <button class="cancel-btn px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition">
              Cancel
            </button>
            <button class="approve-btn px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
              Confirm
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Event handlers
      const cleanup = () => {
        document.body.removeChild(modal);
      };

      modal.querySelector('.close-btn').addEventListener('click', () => {
        cleanup();
        resolve(false);
      });

      modal.querySelector('.cancel-btn').addEventListener('click', () => {
        cleanup();
        resolve(false);
      });

      modal.querySelector('.approve-btn').addEventListener('click', () => {
        cleanup();
        resolve(true);
      });

      // Click outside to cancel
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup();
          resolve(false);
        }
      });
    });
  }

  /**
   * Utility: Check if content contains merge fields
   */
  containsMergeField(content) {
    return /\{\{[a-z_]+\.[a-z_]+\}\}/i.test(content);
  }

  /**
   * Utility: Extract merge fields from content
   */
  extractMergeFields(content) {
    const matches = content.match(/\{\{[a-z_]+\.[a-z_]+\}\}/gi);
    return matches || [];
  }

  /**
   * Utility: Convert HTML/markdown to plain text
   */
  convertToPlainText(element) {
    if (!element) return '';

    // Clone element to avoid modifying original
    const clone = element.cloneNode(true);

    // Remove action buttons if present
    const actions = clone.querySelector('.document-actions');
    if (actions) actions.remove();

    return clone.textContent || clone.innerText || '';
  }

  /**
   * Utility: Strip HTML tags
   */
  stripHTML(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  /**
   * Utility: Generate preview (truncate if needed)
   */
  generatePreview(text, maxLength = 200) {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength);
  }

  /**
   * Utility: Escape HTML for safe display
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Log document modification to audit log (VULN-003 fix)
   * @param {Object} details - Modification details
   * @returns {Promise<void>}
   */
  async logDocumentModification(details) {
    try {
      // Get current context (templateId, matterId from window/state if available)
      const templateId = window.currentTemplateId || null;
      const matterId = window.currentMatterId || null;

      // Call backend audit endpoint
      const response = await fetch('/api/v1/document-chat/audit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`
        },
        body: JSON.stringify({
          action: details.action,
          templateId: templateId,
          matterId: matterId,
          details: {
            modification_type: details.modificationType,
            content_length: details.contentLength,
            timestamp: new Date().toISOString(),
            user_agent: navigator.userAgent
          }
        })
      });

      if (!response.ok) {
        logWarn('Failed to log audit event', { status: response.status });
      } else {
        logInfo('Document modification audited successfully');
      }
    } catch (error) {
      // Don't throw - audit logging should not break user flow
      logError('Failed to log document modification', error);
    }
  }

  /**
   * Show success toast notification
   */
  showSuccessToast(message) {
    this.showToast(message, 'success');
  }

  /**
   * Show error toast notification
   */
  showErrorToast(message) {
    this.showToast(message, 'error');
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    // Use window.Toast if available, otherwise create simple toast
    if (window.Toast) {
      window.Toast[type](message);
      return;
    }

    // Simple toast fallback
    const toast = document.createElement('div');
    toast.className = type === 'error'
      ? 'fixed bottom-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50'
      : 'fixed bottom-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => {
        document.body.removeChild(toast);
      }, 300);
    }, 3000);
  }
}

// Helper logging functions
function logInfo(message, data) {
  console.log(`[DocumentActionHandler] ${message}`, data || '');
}

function logWarn(message) {
  console.warn(`[DocumentActionHandler] ${message}`);
}

function logError(message, error) {
  console.error(`[DocumentActionHandler] ${message}`, error || '');
}

// Export for module or global use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DocumentActionHandler;
} else {
  window.DocumentActionHandler = DocumentActionHandler;
}
