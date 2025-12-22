// chat-token-display.js
// Frontend token usage display and enhanced SSE handling

/**
 * Token Display Manager
 * Handles displaying token usage, conversation memory, and AI status
 */
class TokenDisplayManager {
  constructor() {
    this.tokenUsageEl = null;
    this.conversationMemoryEl = null;
    this.init();
  }

  /**
   * Initialize display elements
   */
  init() {
    // Create token usage display
    this.createTokenDisplay();
    // Create conversation memory indicator
    this.createMemoryIndicator();
  }

  /**
   * Create token usage meter in UI
   */
  createTokenDisplay() {
    // Find or create container
    let container = document.getElementById('token-usage-container');
    if (!container) {
      // Create container in chat header area
      const chatHeader = document.querySelector('.chat-header') || document.querySelector('#chatInterface');
      if (!chatHeader) return;

      container = document.createElement('div');
      container.id = 'token-usage-container';
      container.className = 'token-usage-container';
      chatHeader.appendChild(container);
    }

    container.innerHTML = `
      <div class="token-usage-display" id="token-usage-display" style="display: none;">
        <div class="token-meter-wrapper">
          <div class="token-meter">
            <div class="token-bar" id="token-bar" style="width: 0%;"></div>
          </div>
          <div class="token-text" id="token-text">
            <span class="token-count">0 / 8,192 tokens</span>
            <span class="token-percentage">(0%)</span>
          </div>
        </div>
      </div>
    `;

    this.tokenUsageEl = document.getElementById('token-usage-display');

    // Add CSS if not already present
    this.addTokenDisplayStyles();
  }

  /**
   * Create conversation memory indicator
   */
  createMemoryIndicator() {
    let indicator = document.getElementById('conversation-memory-indicator');
    if (!indicator) {
      const chatHeader = document.querySelector('.chat-header') || document.querySelector('#chatInterface');
      if (!chatHeader) return;

      indicator = document.createElement('div');
      indicator.id = 'conversation-memory-indicator';
      indicator.className = 'conversation-memory-indicator';
      indicator.style.display = 'none';
      chatHeader.appendChild(indicator);
    }

    this.conversationMemoryEl = indicator;
  }

  /**
   * Update token display with usage data
   * @param {Object} usage - Token usage data
   */
  updateTokenDisplay(usage) {
    if (!this.tokenUsageEl) return;

    const { total, budget, percentage } = usage;

    // Show the display
    this.tokenUsageEl.style.display = 'block';

    // Update bar width
    const bar = document.getElementById('token-bar');
    if (bar) {
      bar.style.width = `${percentage}%`;

      // Color coding
      if (percentage > 90) {
        bar.className = 'token-bar token-bar-danger';
      } else if (percentage > 75) {
        bar.className = 'token-bar token-bar-warning';
      } else {
        bar.className = 'token-bar token-bar-normal';
      }
    }

    // Update text
    const text = document.getElementById('token-text');
    if (text) {
      text.innerHTML = `
        <span class="token-count">${total.toLocaleString()} / ${budget.toLocaleString()} tokens</span>
        <span class="token-percentage">(${percentage}%)</span>
      `;
    }

    // Warning if approaching limit
    if (percentage > 80 && !this.hasWarning) {
      this.showWarning('Conversation getting long. Consider starting a new chat for best results.');
      this.hasWarning = true;
    }
  }

  /**
   * Update conversation memory indicator
   * @param {Object} info - Memory info
   */
  updateMemoryIndicator(info) {
    if (!this.conversationMemoryEl) return;

    const { fullMessageCount, summarizedCount, summaryUsed } = info;

    if (summaryUsed && summarizedCount > 0) {
      this.conversationMemoryEl.style.display = 'block';
      this.conversationMemoryEl.innerHTML = `
        <span class="memory-icon">🧠</span>
        <span class="memory-text">Remembering ${fullMessageCount} messages (${summarizedCount} summarized)</span>
      `;
    } else if (fullMessageCount > 0) {
      this.conversationMemoryEl.style.display = 'block';
      this.conversationMemoryEl.innerHTML = `
        <span class="memory-icon">💬</span>
        <span class="memory-text">Remembering last ${fullMessageCount} messages</span>
      `;
    }
  }

  /**
   * Show warning message
   */
  showWarning(message) {
    const warning = document.createElement('div');
    warning.className = 'token-warning';
    warning.innerHTML = `<span>⚠️</span> ${message}`;

    const container = this.tokenUsageEl || document.querySelector('.chat-container');
    if (container) {
      container.appendChild(warning);

      // Auto-remove after 10 seconds
      setTimeout(() => warning.remove(), 10000);
    }
  }

  /**
   * Hide token display
   */
  hide() {
    if (this.tokenUsageEl) {
      this.tokenUsageEl.style.display = 'none';
    }
    if (this.conversationMemoryEl) {
      this.conversationMemoryEl.style.display = 'none';
    }
    this.hasWarning = false;
  }

  /**
   * Add CSS styles for token display
   */
  addTokenDisplayStyles() {
    if (document.getElementById('token-display-styles')) return;

    const style = document.createElement('style');
    style.id = 'token-display-styles';
    style.textContent = `
      .token-usage-container {
        margin: 8px 0;
      }

      .token-usage-display {
        background: #f8f9fa;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        padding: 8px 12px;
        font-size: 12px;
      }

      .token-meter-wrapper {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .token-meter {
        flex: 1;
        height: 8px;
        background: #e0e0e0;
        border-radius: 4px;
        overflow: hidden;
      }

      .token-bar {
        height: 100%;
        transition: width 0.3s ease, background-color 0.3s ease;
      }

      .token-bar-normal {
        background: linear-gradient(90deg, #4CAF50, #66BB6A);
      }

      .token-bar-warning {
        background: linear-gradient(90deg, #FFA726, #FFB74D);
      }

      .token-bar-danger {
        background: linear-gradient(90deg, #EF5350, #E57373);
      }

      .token-text {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }

      .token-count {
        font-weight: 500;
        color: #333;
      }

      .token-percentage {
        color: #666;
      }

      .conversation-memory-indicator {
        background: #e3f2fd;
        border: 1px solid #90caf9;
        border-radius: 6px;
        padding: 6px 10px;
        margin: 6px 0;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .memory-icon {
        font-size: 14px;
      }

      .memory-text {
        color: #1976d2;
        font-weight: 500;
      }

      .token-warning {
        background: #fff3e0;
        border: 1px solid #ffb74d;
        border-radius: 6px;
        padding: 10px 12px;
        margin: 8px 0;
        font-size: 13px;
        color: #e65100;
        display: flex;
        align-items: center;
        gap: 8px;
        animation: slideIn 0.3s ease;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* Dark mode support */
      @media (prefers-color-scheme: dark) {
        .token-usage-display {
          background: #2c2c2c;
          border-color: #444;
        }

        .token-meter {
          background: #444;
        }

        .token-count {
          color: #e0e0e0;
        }

        .token-percentage {
          color: #aaa;
        }

        .conversation-memory-indicator {
          background: #1e3a5f;
          border-color: #2979ff;
        }

        .memory-text {
          color: #90caf9;
        }

        .token-warning {
          background: #4a3c00;
          border-color: #ffa000;
          color: #ffb74d;
        }
      }
    `;

    document.head.appendChild(style);
  }
}

/**
 * Enhanced SSE Handler
 * Extends LanaChat with enhanced SSE event handling
 */
class EnhancedSSEHandler {
  /**
   * Handle SSE events from enhanced endpoint
   * @param {Object} chat - LanaChat instance
   * @param {Function} reader - Stream reader
   * @returns {Promise<string>} Full response
   */
  static async handleEnhancedStream(chat, reader) {
    const decoder = new TextDecoder();
    const tokenDisplay = new TokenDisplayManager();
    let buffer = '';
    let fullResponse = '';
    let currentEvent = null;
    let responseStarted = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
          continue;
        }

        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.slice(5).trim());

            // Handle different event types
            switch (currentEvent) {
              case 'connected':
                this.handleConnected(data, tokenDisplay);
                break;

              case 'citations':
                this.handleCitations(data, chat);
                break;

              case 'retrieval':
                this.handleRetrieval(data, chat);
                break;

              case 'message':
                if (data.content) {
                  if (!responseStarted) {
                    chat.hideTypingIndicator();
                    chat.addMessage('assistant', data.content);
                    responseStarted = true;
                  } else {
                    chat.appendToLastMessage(data.content);
                  }
                  fullResponse += data.content;
                }
                break;

              case 'done':
                this.handleDone(data, tokenDisplay);
                break;

              case 'error':
                this.handleError(data, chat);
                break;
            }

            currentEvent = null; // Reset after handling
          } catch (parseError) {
            // Skip malformed JSON
          }
        }
      }
    }

    if (!responseStarted) {
      chat.hideTypingIndicator();
      chat.addMessage('assistant', 'No response received.');
    }

    return fullResponse;
  }

  static handleConnected(data, tokenDisplay) {
    console.log('[Enhanced SSE] Connected:', data);

    if (data.tokenUsage) {
      tokenDisplay.updateTokenDisplay(data.tokenUsage);
    }

    if (data.summaryUsed) {
      // Show indicator that conversation is being summarized
      console.log('[Enhanced SSE] Conversation summary in use');
    }
  }

  static handleCitations(data, chat) {
    console.log('[Enhanced SSE] Citations:', data);

    if (data.citations && data.citations.length > 0) {
      // Could display citations in UI
      console.log(`[Enhanced SSE] ${data.citations.length} sources found`);
    }
  }

  static handleRetrieval(data, chat) {
    console.log('[Enhanced SSE] Retrieval metrics:', data);
  }

  static handleDone(data, tokenDisplay) {
    console.log('[Enhanced SSE] Stream complete:', data);

    if (data.tokenUsage) {
      tokenDisplay.updateTokenDisplay(data.tokenUsage);
    }
  }

  static handleError(data, chat) {
    console.error('[Enhanced SSE] Error:', data);
    chat.addSystemMessage(`Error: ${data.error || data.message || 'Unknown error'}`);
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.TokenDisplayManager = TokenDisplayManager;
  window.EnhancedSSEHandler = EnhancedSSEHandler;
}
