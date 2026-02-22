/* ==========================================================================
   Chat V2 — Page Controller
   Single IIFE. Two conceptual states with 4 internal sub-stages:

     EMPTY (no matter scoped — user must select one)
       ├── LOADING   — skeleton shimmer, API call in flight
       └── LANDING   — matter cards + search visible

     READY (matter locked in — conversation active)
       ├── SELECTED  — intent composer visible, session POST in flight
       └── ACTIVE    — lex-chat mounted (owns its own composer)

   The <lex-chat> component handles all chat UI internally:
     - lex-chat-thread    (messages)
     - lex-chat-activity  (thinking indicator)
     - lex-chat-composer  (input, tools, send/stop, # doc picker)
     - lex-chat-documents (document mode banner)

   No regex. No classes.
   ========================================================================== */

(function () {
  'use strict';

  // =========================================================================
  // Stage state
  // =========================================================================

  var _stage = 'LOADING';
  var _matter = null;            // full matter object once selected
  var _conversationId = null;

  // Search debounce timer
  var _searchTimer = null;

  // Document click handler stored for cleanup on leave
  var _docClickHandler = null;

  // Poll interval for waiting on conversation creation
  var _pollInterval = null;

  // Guard against double enterActive() calls
  var _enterActiveInvoked = false;

  // lex-chat event listener refs for cleanup
  var _chatEventListeners = [];

  // Intent definitions (hardcoded for V1; V2 will pull from org config)
  var INTENTS = [
    { id: 'summarise',   label: 'Summarise'    },
    { id: 'draft',       label: 'Draft'        },
    { id: 'research',    label: 'Research'     },
    { id: 'review',      label: 'Review'       },
    { id: 'timeline',    label: 'Timeline'     },
    { id: 'ask',         label: 'Ask anything' }
  ];

  // =========================================================================
  // DOM references (populated in init)
  // =========================================================================

  var dom = {};

  function cacheDom() {
    dom.greetingSub       = document.getElementById('cv2-greeting-sub');
    dom.matterPanel       = document.getElementById('cv2-matter-panel');
    dom.cardsWrapper      = document.getElementById('cv2-cards-wrapper');
    dom.recentSection     = document.getElementById('cv2-recent-section');
    dom.searchInput       = document.getElementById('cv2-search-input');
    dom.searchResults     = document.getElementById('cv2-search-results');
    dom.orDivider         = document.getElementById('cv2-or-divider');
    dom.composerInline    = document.getElementById('cv2-composer-inline');
    dom.matterBadge       = document.getElementById('cv2-matter-badge');
    dom.intents           = document.getElementById('cv2-intents');
    dom.messagesArea      = document.getElementById('cv2-messages-area');
    dom.stageCenterEl     = document.getElementById('cv2-stage-center');
  }

  // =========================================================================
  // Greeting helpers
  // =========================================================================

  function setGreeting() {
    if (dom.greetingSub) dom.greetingSub.textContent = "I'm ready to help. Select a matter to begin.";
  }

  // =========================================================================
  // Priority label for action cards
  // =========================================================================

  function priorityFromStatus(status) {
    if (!status) return 'low';
    var s = status.toLowerCase();
    if (s === 'active' || s === 'urgent') return 'high';
    if (s === 'pending' || s === 'in_progress') return 'medium';
    return 'low';
  }

  // =========================================================================
  // Stage: LOADING -> LANDING (Empty state)
  // =========================================================================

  function enterLanding(recentMatters) {
    _stage = 'LANDING';

    // Remove skeleton shimmer
    if (window.Lex && window.Lex.Redact) {
      window.Lex.Redact.off(dom.cardsWrapper);
    }

    if (!recentMatters || recentMatters.length === 0) {
      // Hide the entire recent section and "or" divider — search is enough
      if (dom.recentSection) dom.recentSection.classList.add('cv2-hidden');
      if (dom.orDivider) dom.orDivider.classList.add('cv2-hidden');
      return;
    }

    // Render recent matter cards
    dom.cardsWrapper.innerHTML = '';

    recentMatters.forEach(function (matter) {
      var card = document.createElement('lex-action-card');
      card.setAttribute('title', matter.name || matter.matter_number || 'Untitled Matter');
      card.setAttribute('description', matter.client_name || '');
      card.setAttribute('tag', matter.matter_number || '');
      card.setAttribute('priority', priorityFromStatus(matter.status));

      card.addEventListener('action-click', function () {
        onMatterSelected(matter);
      });

      dom.cardsWrapper.appendChild(card);
    });
  }

  // =========================================================================
  // Stage: LANDING -> SELECTED (Empty -> Ready transition)
  // =========================================================================

  function onMatterSelected(matter) {
    if (_stage !== 'LANDING') return;  // guard against rapid clicks
    _stage = 'SELECTED';
    _matter = matter;

    // Prevent any card from firing again during transition
    dom.cardsWrapper.style.pointerEvents = 'none';
    if (dom.searchResults) dom.searchResults.classList.remove('cv2-visible');

    // Update Lex.state
    if (window.Lex && window.Lex.state) {
      window.Lex.state.setActiveMatter(matter.id);
    }

    // Collapse the matter panel
    dom.matterPanel.classList.add('cv2-collapsing');

    // After opacity transition: show inline composer
    dom.matterPanel.addEventListener('transitionend', function onPanelCollapsed(e) {
      if (e.propertyName !== 'opacity') return;
      dom.matterPanel.removeEventListener('transitionend', onPanelCollapsed);
      dom.matterPanel.classList.add('cv2-hidden');
      showInlineComposer();
    });

    // Create the conversation in the background while animation runs
    createConversation(matter.id);
  }

  function showInlineComposer() {
    // Guard: if returnToLanding() already cleared state, bail out
    if (!_matter) return;

    // Set matter badge
    if (dom.matterBadge) {
      dom.matterBadge.setAttribute('label', _matter.name || _matter.matter_number || 'Matter');
    }

    // Render intent buttons
    dom.intents.innerHTML = '';
    INTENTS.forEach(function (intent) {
      var btn = document.createElement('lex-btn');
      btn.setAttribute('variant', 'secondary');
      btn.setAttribute('size', 'sm');
      btn.textContent = intent.label;
      btn.addEventListener('click', function () {
        onIntentSelected(intent);
      });
      dom.intents.appendChild(btn);
    });

    // Fade in — two rAF ensures display:block is painted before opacity transition
    dom.composerInline.classList.add('cv2-visible');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        dom.composerInline.classList.add('cv2-entered');
      });
    });
  }

  // =========================================================================
  // POST /chat/sessions — create a new chat session
  // =========================================================================

  function createConversation(matterId) {
    api.post('/api/v1/chat/sessions', { matter_id: matterId })
      .then(function (response) {
        var session = response && response.session;
        var convId = session && (session.id || session.thread_id);

        if (!convId) {
          throw new Error('No session ID in response');
        }

        _conversationId = convId;

        if (window.Lex && window.Lex.state) {
          window.Lex.state.setActiveConversation(convId);
        }

        // If user already selected an intent before POST returned, enter active now
        if (_stage === 'ACTIVE') {
          enterActive(null);
        }

      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[chat_v2] Failed to create conversation:', err);

        // Clear poll interval FIRST to prevent double toast
        if (_pollInterval) {
          clearInterval(_pollInterval);
          _pollInterval = null;
        }

        showErrorToast('Could not start a new conversation. Please try again.');
        returnToLanding();
      });
  }

  // =========================================================================
  // Stage: SELECTED -> ACTIVE (intent chosen — Ready state)
  // =========================================================================

  function onIntentSelected(intent) {
    // Store initial message derived from intent
    var initialMessage = null;
    if (intent.id !== 'ask') {
      initialMessage = intent.label + ' this matter';
    }

    // Guard: if conversation not yet created, wait — disable intents momentarily
    if (!_conversationId) {
      var buttons = dom.intents.querySelectorAll('lex-btn');
      buttons.forEach(function (b) { b.setAttribute('disabled', ''); });

      // Poll until conversation resolves (max 8 seconds)
      var waited = 0;
      _pollInterval = setInterval(function () {
        waited += 100;
        if (_conversationId) {
          clearInterval(_pollInterval);
          _pollInterval = null;
          enterActive(initialMessage);
        }
        if (waited >= 8000) {
          clearInterval(_pollInterval);
          _pollInterval = null;
          showErrorToast('Could not start conversation. Please try again.');
          returnToLanding();
        }
      }, 100);
      return;
    }

    enterActive(initialMessage);
  }

  function enterActive(initialMessage) {
    if (_enterActiveInvoked) return;
    _enterActiveInvoked = true;
    _stage = 'ACTIVE';

    // Hide inline composer
    dom.composerInline.classList.remove('cv2-entered');
    dom.composerInline.addEventListener('transitionend', function hide(e) {
      if (e.propertyName !== 'opacity') return;
      dom.composerInline.removeEventListener('transitionend', hide);
      dom.composerInline.classList.remove('cv2-visible');
      dom.composerInline.classList.add('cv2-hidden');
    });

    // Dim the greeting
    if (dom.stageCenterEl) {
      dom.stageCenterEl.classList.add('cv2-greeting-dimmed');
    }

    // Show messages area
    dom.messagesArea.classList.add('cv2-visible');

    // Mount lex-chat (includes its own composer)
    mountLexChat(_conversationId, initialMessage);

    // Update URL params so state is bookmarkable
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.updateParams === 'function') {
      var urlParams = { session: _conversationId };
      if (_matter && _matter.id) urlParams.matter = _matter.id;
      window.Lex.Nav.updateParams(urlParams);
    }
  }

  // =========================================================================
  // lex-chat mounting + event wiring
  // =========================================================================

  function mountLexChat(conversationId, initialMessage) {
    if (!window.customElements || !window.customElements.get('lex-chat')) {
      console.warn('[chat_v2] lex-chat not registered. Ensure lex-chat scripts are loaded.');
      showErrorToast('Chat component failed to load. Please refresh and try again.');
      return;
    }

    var chatEl = document.createElement('lex-chat');
    chatEl.setAttribute('conversation-id', conversationId);
    chatEl.setAttribute('matter-id', _matter.id);
    chatEl.setAttribute('placeholder', 'Ask about this matter...');

    // Demo mode support
    if (window.LanaConfig && window.LanaConfig.DEMO_MODE) {
      chatEl.setAttribute('source', 'demo');
    }

    dom.messagesArea.appendChild(chatEl);

    // Wire all lex-chat events
    wireChatEvents(chatEl);

    // Send initial intent message if provided
    if (initialMessage) {
      setTimeout(function () {
        if (chatEl && typeof chatEl.send === 'function') {
          chatEl.send(initialMessage);
        }
      }, 150);
    }
  }

  /**
   * Wire event listeners on the lex-chat element.
   * All listeners are tracked in _chatEventListeners for cleanup.
   */
  function wireChatEvents(chatEl) {
    _chatEventListeners = [];

    function listen(eventName, handler) {
      chatEl.addEventListener(eventName, handler);
      _chatEventListeners.push({ el: chatEl, event: eventName, handler: handler });
    }

    // Citation click — open PDF at cited page
    listen('lex-chat-citation-click', function (e) {
      var detail = e.detail || {};
      var docId = detail.documentId;
      var page = detail.page || 1;
      if (!docId) return;

      var token = localStorage.getItem('token') || '';
      var baseUrl = (window.api && window.api.baseUrl) ? window.api.baseUrl : '';
      var url = baseUrl + '/api/v1/documents/' + encodeURIComponent(docId) + '/download?token=' + encodeURIComponent(token) + '#page=' + page;
      window.open(url, '_blank');
    });

    // Artifact click — route by action type
    listen('lex-chat-artifact-click', function (e) {
      var detail = e.detail || {};
      var entityId = detail.entityId;
      var artifactType = detail.artifactType;

      if (!entityId) return;

      if (artifactType === 'copy' && detail.content) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(detail.content).then(function () {
            showSuccessToast('Copied to clipboard');
          });
        }
      } else if (artifactType === 'version_history') {
        if (window.api) {
          window.api.get('/api/v1/agentic/artifacts?entity_id=' + encodeURIComponent(entityId))
            .then(function (data) {
              var versions = (data && data.artifacts) || [];
              showVersionHistoryDrawer(versions);
            })
            .catch(function (err) {
              console.error('[chat_v2] Failed to load version history:', err);
              showErrorToast('Failed to load version history');
            });
        }
      } else if (artifactType === 'download' || !artifactType) {
        var token = localStorage.getItem('token') || '';
        var baseUrl = (window.api && window.api.baseUrl) ? window.api.baseUrl : '';
        var url = baseUrl + '/api/v1/documents/' + encodeURIComponent(entityId) + '/download?token=' + encodeURIComponent(token);
        window.open(url, '_blank');
      }
    });

    // Title generated — update sidebar conversation
    listen('lex-chat-title-generated', function (e) {
      var detail = e.detail || {};
      var title = detail.title;
      var convId = detail.conversationId || _conversationId;
      if (title && convId && window.ConversationMenu) {
        window.ConversationMenu.updateConversation(convId, { title: title });
      }
    });

    // Context usage — log for V1
    listen('lex-chat-context-usage', function (e) {
      var detail = e.detail || {};
      console.log('[chat_v2] Context usage:', detail.percentUsed + '% used');
    });

    // Response end — feature tracking
    listen('lex-chat-response-end', function () {
      if (window.FeatureTracker && window.Features) {
        window.FeatureTracker.trackFeature(window.Features.CHAT_MESSAGE_SENT, {
          conversation_id: _conversationId,
          chat_mode: (window.Lex && window.Lex.state) ? window.Lex.state.chatMode : 'general',
          source: 'chat_v2'
        });
      }
    });

    // Conversation created — add to sidebar
    listen('lex-chat-conversation-created', function (e) {
      var detail = e.detail || {};
      var convId = detail.conversationId;
      if (convId && window.ConversationMenu) {
        window.ConversationMenu.addConversation({
          thread_id: convId,
          title: 'New Chat',
          matter_id: _matter ? _matter.id : null,
          matter_name: _matter ? _matter.name : '',
          updated_at: new Date().toISOString()
        });
      }
    });

    // Manage documents — open file drawer
    listen('lex-chat-manage-documents', function () {
      if (window.ChatFileDrawer && _conversationId) {
        window.ChatFileDrawer.open(_conversationId, _matter ? _matter.id : null);
      }
    });

    // Composer # document search — fetch documents for picker
    listen('lex-composer-document-search', function (e) {
      var query = (e.detail && e.detail.query) || '';
      var composerEl = chatEl.querySelector('lex-chat-composer');
      if (!composerEl) return;

      if (!_conversationId || !window.api) {
        composerEl.setDocumentResults([]);
        return;
      }

      window.api.get('/api/v1/chat/sessions/' + _conversationId + '/files?search=' + encodeURIComponent(query) + '&limit=10')
        .then(function (data) {
          var files = (data && data.files) || [];
          composerEl.setDocumentResults(files);
        })
        .catch(function () {
          composerEl.setDocumentResults([]);
        });
    });

    // Agentic followup — display followup suggestions in thread
    listen('lex-chat-agentic-followup', function (e) {
      var detail = e.detail || {};
      var followups = detail.followups || [];
      var message = detail.message || '';
      if (followups.length === 0 && !message) return;

      // Build a system-level message with followup buttons
      var html = '';
      if (message) {
        html += '<div style="margin-bottom: 8px; color: var(--lex-text-secondary); font-size: var(--lex-body-sm-size);">' + escapeHtml(message) + '</div>';
      }

      for (var i = 0; i < followups.length; i++) {
        var f = followups[i];
        html += '<lex-btn variant="outline" size="sm" style="margin: 4px 4px 4px 0;" data-followup-idx="' + i + '">';
        html += escapeHtml(f.description || f.label || f.entity_type || 'Follow up');
        html += '</lex-btn>';
      }

      // Add the followup card as a system message in the thread
      var threadEl = chatEl.querySelector('lex-chat-thread');
      if (threadEl && typeof threadEl.addMessage === 'function') {
        threadEl.addMessage('system', html);
      }

      // Wire followup button clicks to send as new message
      var followupBtns = chatEl.querySelectorAll('[data-followup-idx]');
      for (var j = 0; j < followupBtns.length; j++) {
        followupBtns[j].addEventListener('click', function (evt) {
          var idx = parseInt(evt.currentTarget.getAttribute('data-followup-idx'), 10);
          var fu = followups[idx];
          if (fu && typeof chatEl.send === 'function') {
            var prompt = fu.description || fu.label || 'Yes, proceed';
            chatEl.send(prompt);
          }
        });
      }
    });

  }

  function showVersionHistoryDrawer(versions) {
    if (!versions || versions.length === 0) {
      showErrorToast('No version history found');
      return;
    }

    var html = '';
    for (var i = 0; i < versions.length; i++) {
      var v = versions[i];
      var isCurrent = i === 0;
      html += '<div style="padding: 12px; border: 1px solid var(--lex-border-subtle); border-radius: var(--lex-radius-md); margin-bottom: 8px; background: var(--lex-bg-primary);">';
      html += '<div style="display: flex; justify-content: space-between; align-items: center;">';
      html += '<span style="font-size: var(--lex-body-sm-size); font-weight: var(--lex-weight-medium, 500); color: var(--lex-text-primary);">Version ' + (versions.length - i) + '</span>';
      if (isCurrent) {
        html += '<lex-badge color="green" label="Current"></lex-badge>';
      }
      html += '</div>';
      if (v.created_at) {
        html += '<div style="font-size: var(--lex-body-xs-size); color: var(--lex-text-tertiary); margin-top: 4px;">' + new Date(v.created_at).toLocaleString() + '</div>';
      }
      if (v.summary) {
        html += '<div style="font-size: var(--lex-body-sm-size); color: var(--lex-text-secondary); margin-top: 8px;">' + escapeHtml(v.summary) + '</div>';
      }
      html += '</div>';
    }

    window.Lex.Drawer.open({
      heading: 'Version History',
      subtitle: versions.length + ' version' + (versions.length !== 1 ? 's' : ''),
      side: 'right',
      width: 'md',
      content: html
    });
  }

  // =========================================================================
  // Matter search
  // =========================================================================

  function setupSearch() {
    if (!dom.searchInput) return;

    dom.searchInput.addEventListener('lex-input', function (e) {
      var query = (e.detail && e.detail.value) ? e.detail.value.trim() : '';
      clearTimeout(_searchTimer);

      if (!query) {
        dom.searchResults.innerHTML = '';
        dom.searchResults.classList.remove('cv2-visible');
        return;
      }

      _searchTimer = setTimeout(function () {
        searchMatters(query);
      }, 300);
    });

    // Close results when clicking outside
    _docClickHandler = function (e) {
      if (!dom.searchResults || !dom.searchResults.contains(e.target)) {
        dom.searchResults.classList.remove('cv2-visible');
      }
    };
    document.addEventListener('click', _docClickHandler);
  }

  function searchMatters(query) {
    api.get('/api/v1/matters?search=' + encodeURIComponent(query) + '&limit=8')
      .then(function (response) {
        var matters = (response && response.matters) ? response.matters : [];
        if (!Array.isArray(matters)) matters = [];
        renderSearchResults(matters);
      })
      .catch(function (err) {
        console.error('[chat_v2] Matter search failed:', err);
      });
  }

  function renderSearchResults(matters) {
    dom.searchResults.innerHTML = '';

    if (matters.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'cv2-search-result-item';
      empty.setAttribute('role', 'option');
      empty.setAttribute('aria-disabled', 'true');
      empty.textContent = 'No matters found';
      dom.searchResults.appendChild(empty);
      dom.searchResults.classList.add('cv2-visible');
      return;
    }

    matters.forEach(function (matter) {
      var item = document.createElement('div');
      item.className = 'cv2-search-result-item';
      item.setAttribute('role', 'option');
      item.innerHTML =
        '<div class="cv2-search-result-name">' + escapeHtml(matter.name || matter.matter_number || 'Untitled') + '</div>' +
        '<div class="cv2-search-result-meta">' + escapeHtml(matter.client_name || '') + '</div>';

      item.addEventListener('click', function () {
        dom.searchResults.classList.remove('cv2-visible');
        onMatterSelected(matter);
      });

      dom.searchResults.appendChild(item);
    });

    dom.searchResults.classList.add('cv2-visible');
  }

  // =========================================================================
  // Error handling helpers
  // =========================================================================

  function showErrorToast(message) {
    if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.error === 'function') {
      window.Lex.Toast.error(message);
    } else {
      console.error('[chat_v2] Error:', message);
    }
  }

  function showSuccessToast(message) {
    if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.success === 'function') {
      window.Lex.Toast.success(message);
    }
  }

  // =========================================================================
  // Cleanup helpers
  // =========================================================================

  /**
   * Clean up ACTIVE stage DOM and listeners without resetting to LANDING.
   * Shared by returnToLanding() and selectConversation().
   */
  function cleanupActiveStage() {
    // Remove all lex-chat event listeners
    _chatEventListeners.forEach(function (entry) {
      entry.el.removeEventListener(entry.event, entry.handler);
    });
    _chatEventListeners = [];

    // Remove lex-chat from DOM (triggers disconnected() for SSE cleanup)
    dom.messagesArea.innerHTML = '';
    dom.messagesArea.classList.remove('cv2-visible');

    // Reset guards
    _enterActiveInvoked = false;
  }

  function returnToLanding() {
    // Clean up ACTIVE stage if we were in it
    if (_stage === 'ACTIVE' || _stage === 'SELECTED') {
      cleanupActiveStage();
    }

    _stage = 'LANDING';
    _matter = null;
    _conversationId = null;
    _enterActiveInvoked = false;

    // Clear any pending intent-wait poll
    if (_pollInterval) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }

    // Reset inline composer + matter panel
    dom.composerInline.classList.remove('cv2-visible', 'cv2-entered', 'cv2-hidden');
    dom.matterPanel.classList.remove('cv2-collapsing', 'cv2-hidden');
    dom.cardsWrapper.style.pointerEvents = '';
    if (dom.stageCenterEl) {
      dom.stageCenterEl.classList.remove('cv2-greeting-dimmed', 'cv2-hidden');
    }

    // Clear search results and input
    if (dom.searchResults) {
      dom.searchResults.innerHTML = '';
      dom.searchResults.classList.remove('cv2-visible');
    }
    if (dom.searchInput) {
      dom.searchInput.value = '';
      var innerInput = dom.searchInput.querySelector('input');
      if (innerInput) innerInput.value = '';
    }
  }

  // =========================================================================
  // XSS prevention — string-only, no regex
  // =========================================================================

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  // =========================================================================
  // Load existing session (deep-link with ?session=xxx or sidebar click)
  // =========================================================================

  function loadExistingSession(sessionId) {
    api.get('/api/v1/chat/sessions/' + sessionId)
      .then(function (response) {
        var session = response && response.session;
        if (!session) {
          showErrorToast('Conversation not found.');
          loadRecentMatters();
          return;
        }

        _conversationId = session.thread_id || session.id;

        if (window.Lex && window.Lex.state) {
          window.Lex.state.setActiveConversation(_conversationId);
        }

        // If session has a matter, fetch it for context
        if (session.matter_id) {
          api.get('/api/v1/matters/' + session.matter_id)
            .then(function (matterResp) {
              var matter = (matterResp && matterResp.matter) ? matterResp.matter : null;
              _matter = matter || { id: session.matter_id, name: 'Matter' };

              if (window.Lex && window.Lex.state) {
                window.Lex.state.setActiveMatter(_matter.id);
              }

              enterActiveFromSession();
            })
            .catch(function () {
              _matter = { id: session.matter_id, name: 'Matter' };
              enterActiveFromSession();
            });
        } else {
          _matter = { id: '', name: 'General' };
          enterActiveFromSession();
        }
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[chat_v2] Failed to load session:', err);
        showErrorToast('Could not load conversation.');
        loadRecentMatters();
      });
  }

  /**
   * Enter ACTIVE stage directly from a loaded session.
   * Skips the LANDING -> SELECTED animation flow.
   */
  function enterActiveFromSession() {
    _enterActiveInvoked = true;
    _stage = 'ACTIVE';

    // Remove skeleton shimmer
    if (window.Lex && window.Lex.Redact) {
      window.Lex.Redact.off(dom.cardsWrapper);
    }

    // Hide the center stage entirely (matter panel + greeting)
    if (dom.stageCenterEl) {
      dom.stageCenterEl.classList.add('cv2-hidden');
    }

    // Show messages area
    dom.messagesArea.classList.add('cv2-visible');

    // Mount lex-chat (includes its own composer)
    mountLexChat(_conversationId, null);

    // Update URL params
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.updateParams === 'function') {
      var urlParams = { session: _conversationId };
      if (_matter && _matter.id) urlParams.matter = _matter.id;
      window.Lex.Nav.updateParams(urlParams);
    }
  }

  // =========================================================================
  // Conversation switching — called by ConversationMenu in the sidebar
  // =========================================================================

  function selectConversation(threadId, matterId) {
    // If already in ACTIVE stage, tear down current lex-chat
    if (_stage === 'ACTIVE') {
      cleanupActiveStage();
    }

    // Reset state for new conversation
    _conversationId = null;
    _matter = null;
    _enterActiveInvoked = false;

    // Load the selected session
    loadExistingSession(threadId);
  }

  // =========================================================================
  // Page initialisation
  // =========================================================================

  function init() {
    // Reset module state on every page enter
    _stage = 'LOADING';
    _matter = null;
    _conversationId = null;
    _searchTimer = null;
    _enterActiveInvoked = false;
    _chatEventListeners = [];

    // Guard: check api is available
    if (typeof api === 'undefined' || !api) {
      console.error('[chat_v2] API client not loaded. Chat cannot initialize.');
      return;
    }

    cacheDom();

    // Guard: if required DOM elements are missing, bail out safely
    if (!dom.matterPanel || !dom.cardsWrapper) {
      console.error('[chat_v2] Required DOM elements not found. Check chat_v2.html.');
      return;
    }

    setGreeting();
    setupSearch();

    // Register selectConversation for sidebar integration
    window.selectConversation = selectConversation;

    // Activate skeleton shimmer for the cards area
    if (window.Lex && window.Lex.Redact) {
      window.Lex.Redact.on(dom.cardsWrapper);
    }

    // Check for deep-link params
    var params = window.Lex && window.Lex.Nav ? window.Lex.Nav.getParams() : null;
    var deepLinkSessionId = params && params.get ? params.get('session') : null;
    var deepLinkMatterId = params && params.get ? params.get('matter') : null;

    if (deepLinkSessionId) {
      loadExistingSession(deepLinkSessionId);
    } else if (deepLinkMatterId) {
      api.get('/api/v1/matters/' + deepLinkMatterId)
        .then(function (response) {
          var matter = (response && response.matter) ? response.matter : null;
          if (matter && matter.id) {
            if (window.Lex && window.Lex.Redact) {
              window.Lex.Redact.off(dom.cardsWrapper);
            }
            _stage = 'LANDING';
            onMatterSelected(matter);
          } else {
            loadRecentMatters();
          }
        })
        .catch(function () {
          loadRecentMatters();
        });
    } else {
      loadRecentMatters();
    }
  }

  function loadRecentMatters() {
    api.get('/api/v1/matters/recent?limit=3')
      .then(function (response) {
        var matters = (response && response.matters) ? response.matters : [];
        if (!Array.isArray(matters)) matters = [];
        enterLanding(matters);
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[chat_v2] Failed to load recent matters:', err);
        enterLanding([]);
      });
  }

  // =========================================================================
  // Page lifecycle — onLeave cleanup
  // =========================================================================

  function onLeave() {
    // Cancel pending search
    if (_searchTimer) {
      clearTimeout(_searchTimer);
      _searchTimer = null;
    }
    // Clear poll interval
    if (_pollInterval) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }
    // Clean up ACTIVE stage (lex-chat, event listeners)
    cleanupActiveStage();
    // Remove document click handler
    if (_docClickHandler) {
      document.removeEventListener('click', _docClickHandler);
      _docClickHandler = null;
    }
    // Reset guards
    _enterActiveInvoked = false;
    // Clear Lex.state
    if (window.Lex && window.Lex.state) {
      window.Lex.state.setActiveConversation(null);
      window.Lex.state.setActiveMatter(null);
    }
    // Remove global selectConversation
    if (window.selectConversation === selectConversation) {
      delete window.selectConversation;
    }
    // Close file drawer if open
    if (window.ChatFileDrawer && typeof window.ChatFileDrawer.close === 'function') {
      window.ChatFileDrawer.close();
    }
  }

  // =========================================================================
  // Page lifecycle — LexRouter registration
  // =========================================================================

  if (window.LexRouter) {
    LexRouter.registerPageInit('chat_v2.html', function () {
      LexRouter.registerView({ onLeave: onLeave });
      init();
    });
  } else {
    init();
  }

})();
