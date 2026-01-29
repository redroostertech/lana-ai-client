/**
 * DocumentChat - Extends LanaChat for document editing workflows
 * Adds document-specific context and action handlers
 */

class DocumentChat extends LanaChat {
  constructor(options = {}) {
    super(options);

    // Document-specific properties
    this.editor = options.editor || null; // Tiptap editor instance
    this.matterId = options.matterId || null;
    this.actionHandler = options.actionHandler || null;
    this.onDocumentChange = options.onDocumentChange || (() => {});

    // Document context tracking
    this.lastDocumentSnapshot = '';
    this.documentObserver = null;

    // Week 2: Selection metadata tracking
    this.selectionMetadata = null;

    logInfo('DocumentChat initialized', {
      hasMatter: !!this.matterId,
      hasEditor: !!this.editor,
      hasActionHandler: !!this.actionHandler
    });
  }

  /**
   * Store selection metadata from editor
   * Called when AI buttons are clicked
   */
  setSelectionMetadata(metadata) {
    this.selectionMetadata = metadata;
    logInfo('[DocumentChat] Selection metadata stored', {
      hasSelection: metadata?.hasSelection || false,
      selectionLength: metadata?.length || 0,
      cursorPosition: metadata?.cursorPosition,
      blockLevel: metadata?.blockLevel || false
    });
  }

  /**
   * Clear selection metadata after use
   */
  clearSelectionMetadata() {
    this.selectionMetadata = null;
  }

  /**
   * Override sendViaSSE to include document context
   */
  async sendViaSSE(content) {
    this.showTypingIndicator();

    try {
      const token = localStorage.getItem('token');

      // Get document content from editor
      const documentContent = this.getDocumentContent();

      logInfo('[DocumentChat] Sending message with document context', {
        messageLength: content.length,
        documentLength: documentContent.length,
        matterId: this.matterId
      });

      // Wait for ApiClient to be ready
      let baseUrl = '';
      if (this.api) {
        if (this.api._readyPromise) {
          await this.api._readyPromise;
        }
        baseUrl = this.api.baseUrl || '';
      }

      if (!baseUrl) {
        baseUrl = window.LanaConfig?.API_BASE_URL || '';
      }

      const isInvalidUrl = (url) => {
        if (!url || url === 'null' || url === 'undefined') return true;
        if (url.startsWith('file:')) return true;
        return false;
      };

      // Try localStorage synchronously first (fastest path)
      if (isInvalidUrl(baseUrl)) {
        try {
          const savedServer = localStorage.getItem('lana_saved_server');
          if (savedServer) {
            const serverInfo = JSON.parse(savedServer);
            if (serverInfo.url) {
              baseUrl = serverInfo.url;
              if (this.api) this.api.baseUrl = baseUrl;
              console.log('[DocumentChat] Got server URL from localStorage:', baseUrl);
            }
          }
        } catch (err) { /* ignore */ }
      }

      // If still empty and in Electron, try IPC to main process
      if (isInvalidUrl(baseUrl) && window.electronAPI) {
        try {
          const result = await window.electronAPI.getSavedServer();
          if (result && result.success && result.server && result.server.url) {
            baseUrl = result.server.url;
            if (this.api) this.api.baseUrl = baseUrl;
            console.log('[DocumentChat] Got server URL from Electron IPC:', baseUrl);
          }
        } catch (err) {
          console.error('[DocumentChat] Failed to get saved server:', err);
        }
      }

      if (isInvalidUrl(baseUrl)) {
        throw new Error('Server not connected. Please wait for server discovery or check your connection.');
      }

      // Build message with selection chip prefix if selection exists
      let finalMessage = content;
      const attachments = {};

      if (this.selectionMetadata && this.selectionMetadata.hasSelection) {
        // Add selection chip to message (like file chip)
        const selectionLabel = this.selectionMetadata.blockLevel
          ? `📝 Block: ${this.selectionMetadata.text.substring(0, 30)}...`
          : `✏️ ${this.selectionMetadata.text.substring(0, 30)}...`;

        finalMessage = `${selectionLabel} × ${content}`;

        // Add selection to attachments
        attachments.selections = [{
          from: this.selectionMetadata.from,
          to: this.selectionMetadata.to,
          text: this.selectionMetadata.text,
          html: this.selectionMetadata.html,
          length: this.selectionMetadata.length,
          context: this.selectionMetadata.context,
          blockLevel: this.selectionMetadata.blockLevel || false
        }];
      }

      // Build request body with document context AND selection metadata
      const body = {
        message: finalMessage,
        context: {
          documentContent: documentContent,
          documentLength: documentContent.length,
          matterId: this.matterId,

          // Week 2: Include selection metadata (backward compatibility)
          selection: this.selectionMetadata || null
        }
      };

      // Add attachments if they exist
      if (Object.keys(attachments).length > 0) {
        body.attachments = attachments;
      }

      if (this.currentConversationId) {
        body.conversation_id = this.currentConversationId;
      }

      if (this.matterId) {
        body.matter_id = this.matterId;
      }

      // Clear selection metadata and chip after sending
      this.clearSelectionMetadata();

      // Remove visual chip from input
      if (typeof removeSelectionChip === 'function') {
        removeSelectionChip();
      }

      const response = await fetch(`${baseUrl}/api/v1/document-chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let responseStarted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        let currentEvent = 'message';
        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(5).trim());

              // Handle 'done' event
              if (currentEvent === 'done') {
                logInfo('[DocumentChat] Stream complete', {
                  conversationId: data.conversationId,
                  strategy: data.strategy,
                  tokenUsage: data.tokenUsage
                });

                if (data.conversationId) {
                  this.currentConversationId = data.conversationId;
                }

                this.hideTypingIndicator();
                continue;
              }

              // Handle 'content' event (structured content with actions)
              if (currentEvent === 'content') {
                this.handleStructuredContent(data);
                continue;
              }

              // Handle 'message' event
              if (currentEvent === 'message' && data.content) {
                if (!responseStarted) {
                  this.hideTypingIndicator();
                  this.addMessage('assistant', data.content);
                  responseStarted = true;
                } else {
                  this.appendToLastMessage(data.content);
                }
              }
            } catch (parseError) {
              // Skip malformed JSON
            }
          }
        }
      }

      if (!responseStarted) {
        this.hideTypingIndicator();
        this.addMessage('assistant', 'No response received.');
      }

      // Trigger action handler attachment after AI response
      if (this.actionHandler) {
        this.actionHandler.attachToLastMessage();
      }

    } catch (error) {
      this.hideTypingIndicator();
      this.addSystemMessage('Failed to send message. Please try again.');
      console.error('[DocumentChat] Error:', error);
    }
  }

  /**
   * Handle structured content from backend (HTML content + actions)
   * @param {Object} data - Structured content data
   * @param {string} data.html - HTML content to insert
   * @param {Array} data.actions - Available actions
   * @param {string} data.contentType - Type of content
   * @param {Object} data.metadata - Metadata (merge fields, etc.)
   */
  handleStructuredContent(data) {
    const { html, actions, contentType, metadata } = data;

    logInfo('[DocumentChat] Structured content received', {
      contentLength: html?.length || 0,
      actionCount: actions?.length || 0,
      contentType,
      metadata,
      hasReplacementRange: !!metadata?.replacementRange
    });

    // Create action buttons container
    const actionsHTML = this.renderActionButtons(actions, html, metadata);

    // Append to last AI message
    const lastMessage = this.messagesContainer.lastElementChild;
    if (lastMessage && lastMessage.classList.contains('assistant-message')) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'message-actions mt-3 flex gap-2 flex-wrap';
      actionsDiv.innerHTML = actionsHTML;

      // Week 2: Store replacement range if present
      if (metadata?.replacementRange) {
        actionsDiv.dataset.replacementRange = JSON.stringify(metadata.replacementRange);
      }

      lastMessage.appendChild(actionsDiv);

      // Attach event listeners
      this.attachActionListeners(actionsDiv, html);
    } else {
      logWarn('[DocumentChat] No assistant message found to attach actions');
    }
  }

  /**
   * Render action buttons for structured content
   * @param {Array} actions - Action definitions
   * @param {string} content - HTML content
   * @param {Object} metadata - Content metadata
   * @returns {string} HTML for action buttons
   */
  renderActionButtons(actions, content, metadata) {
    if (!actions || actions.length === 0) {
      // Default actions if none specified
      actions = [
        { type: 'insert', label: 'Insert at Cursor' },
        { type: 'copy', label: 'Copy to Clipboard' }
      ];
    }

    return actions.map(action => `
      <button
        class="action-button px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
        data-action="${action.type}"
        data-content="${this.escapeHtml(content)}"
        title="${action.label}"
      >
        ${this.getActionIcon(action.type)} ${action.label}
      </button>
    `).join('');
  }

  /**
   * Attach event listeners to action buttons
   * @param {HTMLElement} container - Container with action buttons
   * @param {string} content - HTML content to act upon
   */
  attachActionListeners(container, content) {
    const buttons = container.querySelectorAll('.action-button');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const actionType = btn.dataset.action;
        const actionContent = this.unescapeHtml(btn.dataset.content);

        logInfo('[DocumentChat] Action button clicked', {
          actionType,
          contentLength: actionContent.length
        });

        this.executeAction(actionType, actionContent);
      });
    });
  }

  /**
   * Execute an action on the content
   * @param {string} type - Action type (insert, copy, apply, replace)
   * @param {string} content - HTML content
   */
  executeAction(type, content) {
    if (!this.actionHandler) {
      logWarn('[DocumentChat] No action handler available');
      this.showNotification('Action handler not configured', 'error');
      return;
    }

    try {
      // Week 2: Check if response includes position metadata
      const lastMessage = this.messagesContainer.lastElementChild;
      const actionsDiv = lastMessage?.querySelector('.message-actions');
      const replacementRange = actionsDiv?.dataset?.replacementRange
        ? JSON.parse(actionsDiv.dataset.replacementRange)
        : null;

      switch(type) {
        case 'apply':
          if (typeof this.actionHandler.applyToDocument === 'function') {
            this.actionHandler.applyToDocument(content);
            this.showNotification('Content applied to document', 'success');
          } else {
            logWarn('[DocumentChat] applyToDocument not implemented');
          }
          break;

        case 'insert':
          if (typeof this.actionHandler.insertAtCursor === 'function') {
            this.actionHandler.insertAtCursor(content);
            this.showNotification('Content inserted at cursor', 'success');
          } else {
            logWarn('[DocumentChat] insertAtCursor not implemented');
          }
          break;

        case 'copy':
          if (typeof this.actionHandler.copyToClipboard === 'function') {
            this.actionHandler.copyToClipboard(content);
            this.showNotification('Content copied to clipboard', 'success');
          } else {
            // Fallback to browser clipboard API
            this.copyToClipboardFallback(content);
          }
          break;

        case 'replace':
          if (replacementRange && typeof this.actionHandler.replaceAtPosition === 'function') {
            // Week 2: Position-aware replacement
            this.actionHandler.replaceAtPosition(content, replacementRange);
            this.showNotification('Content replaced at selection', 'success');
          } else if (typeof this.actionHandler.replaceSelection === 'function') {
            // Fallback to replaceSelection
            this.actionHandler.replaceSelection(content);
            this.showNotification('Selection replaced', 'success');
          } else {
            logWarn('[DocumentChat] replaceSelection not implemented');
          }
          break;

        default:
          logWarn('[DocumentChat] Unknown action type', { type });
      }
    } catch (error) {
      logError('[DocumentChat] Action execution failed', error);
      this.showNotification('Action failed: ' + error.message, 'error');
    }
  }

  /**
   * Fallback clipboard copy using browser API
   * @param {string} content - Content to copy
   */
  async copyToClipboardFallback(content) {
    try {
      await navigator.clipboard.writeText(content);
      this.showNotification('Content copied to clipboard', 'success');
    } catch (error) {
      logError('[DocumentChat] Clipboard copy failed', error);
      this.showNotification('Failed to copy to clipboard', 'error');
    }
  }

  /**
   * Show a notification to the user
   * @param {string} message - Notification message
   * @param {string} type - Notification type (success, error, info)
   */
  showNotification(message, type = 'info') {
    // Simple console notification - can be enhanced with UI toast
    console.log(`[${type.toUpperCase()}] ${message}`);

    // If LanaChat has a notification method, use it
    if (typeof this.addSystemMessage === 'function') {
      this.addSystemMessage(message);
    }
  }

  /**
   * Get icon for action type
   * @param {string} type - Action type
   * @returns {string} Icon HTML or emoji
   */
  getActionIcon(type) {
    const icons = {
      'apply': '✓',
      'insert': '→',
      'copy': '📋',
      'replace': '↔'
    };
    return icons[type] || '•';
  }

  /**
   * Escape HTML for safe storage in data attributes
   * @param {string} html - HTML to escape
   * @returns {string} Escaped HTML
   */
  escapeHtml(html) {
    if (!html) return '';
    return html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Unescape HTML from data attributes
   * @param {string} html - Escaped HTML
   * @returns {string} Unescaped HTML
   */
  unescapeHtml(html) {
    if (!html) return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = html;
    return textarea.value;
  }

  /**
   * Get current document content from Tiptap editor
   * @returns {string} HTML content
   */
  getDocumentContent() {
    if (!this.editor) {
      logWarn('[DocumentChat] No editor instance available');
      return '';
    }

    try {
      const html = this.editor.getHTML();
      return html;
    } catch (error) {
      logError('[DocumentChat] Failed to get document content', error);
      return '';
    }
  }

  /**
   * Observe document changes (optional - for future optimization)
   * Can be used to detect when document changes significantly
   */
  observeDocumentChanges() {
    if (!this.editor) return;

    // Debounce document change tracking
    let changeTimeout;

    this.editor.on('update', ({ editor }) => {
      clearTimeout(changeTimeout);
      changeTimeout = setTimeout(() => {
        const currentContent = editor.getHTML();

        // Check if document changed significantly
        const similarity = this.calculateSimilarity(this.lastDocumentSnapshot, currentContent);

        if (similarity < 0.9) {
          // Document changed significantly
          logInfo('[DocumentChat] Document changed significantly', {
            similarity: similarity.toFixed(2)
          });

          this.lastDocumentSnapshot = currentContent;
          this.onDocumentChange(currentContent);
        }
      }, 1000); // 1 second debounce
    });
  }

  /**
   * Calculate similarity between two strings (simple version)
   * @param {string} a
   * @param {string} b
   * @returns {number} Similarity ratio (0-1)
   */
  calculateSimilarity(a, b) {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;

    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;

    if (longer.length === 0) return 1.0;

    // Simple Levenshtein-like approximation
    const editDistance = this.levenshtein(shorter, longer);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Levenshtein distance (simple implementation)
   */
  levenshtein(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Clear conversation and reset document tracking
   */
  clearMessages() {
    super.clearMessages();
    this.lastDocumentSnapshot = this.getDocumentContent();
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    if (this.documentObserver) {
      this.editor.off('update');
      this.documentObserver = null;
    }
    super.destroy();
  }
}

// Helper logging functions
function logInfo(message, data) {
  console.log(`[DocumentChat] ${message}`, data || '');
}

function logWarn(message, data) {
  console.warn(`[DocumentChat] ${message}`, data || '');
}

function logError(message, error) {
  console.error(`[DocumentChat] ${message}`, error || '');
}

// Export for module or global use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DocumentChat;
} else {
  window.DocumentChat = DocumentChat;
}
