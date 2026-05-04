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
  var _sessionTitle = null;      // conversation title from session data

  // Search debounce timer
  var _searchTimer = null;

  // Document click handler stored for cleanup on leave
  var _docClickHandler = null;

  // Poll interval for waiting on conversation creation
  var _pollInterval = null;

  // Generation banner duration ticker (Gap 1)
  var _generationDurationInterval = null;

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
    dom.app               = document.querySelector('lex-app');
    // Gap 1 — generation banner
    dom.generationBanner  = document.getElementById('cv2-generation-banner');
    dom.generationDuration = document.getElementById('cv2-generation-duration');
    dom.stopGenerationBtn = document.getElementById('cv2-stop-generation-btn');
    // Gap 3 — context meter
    dom.contextMeter      = document.getElementById('cv2-context-meter');
    dom.contextText       = document.getElementById('cv2-context-text');
    // Gap 4 — compaction banner
    dom.compactBanner     = document.getElementById('cv2-compact-banner');
    // Gap 5 — followup chip row
    dom.followupChips     = document.getElementById('cv2-followup-chips');
  }

  // =========================================================================
  // Page title + workspace details button
  // =========================================================================

  /**
   * Update the topbar page title.
   * Shows "New Conversation" when no conversation is active.
   */
  function setPageTitle(title) {
    if (dom.app && typeof dom.app.setPage === 'function') {
      dom.app.setPage({ title: title || 'New Conversation' });
    }
  }

  /**
   * Inject or update "View Workspace Details" button next to the topbar heading.
   * Placed inside lex-topbar .lex-topbar-center, after the h1.
   */
  function updateWorkspaceDetailsButton() {
    var topbar = dom.app ? dom.app.querySelector('lex-topbar') : null;
    if (!topbar) return;

    var center = topbar.querySelector('.lex-topbar-center');
    if (!center) return;

    // Ensure center uses flex layout for heading + button side by side
    center.style.display = 'flex';
    center.style.alignItems = 'center';
    center.style.gap = '12px';

    var existing = center.querySelector('[data-action="workspace-details"]');

    if (!_matter || !_matter.id) {
      // No matter — remove button if present
      if (existing) existing.remove();
      return;
    }

    var label = _matter.name ? 'View ' + _matter.name : 'View Workspace Details';

    if (existing) {
      // Update label
      var span = existing.querySelector('span');
      if (span) span.textContent = label;
    } else {
      // Create button
      var btn = document.createElement('button');
      btn.setAttribute('data-action', 'workspace-details');
      btn.title = 'View workspace details';
      btn.style.cssText = 'flex-shrink:0;display:inline-flex;align-items:center;gap:4px;padding:3px 10px;font-size:12px;font-weight:500;color:var(--lex-text-secondary);background:var(--lex-bg-tertiary);border:none;border-radius:var(--lex-radius-sm);cursor:pointer;white-space:nowrap;transition:background var(--lex-transition-fast);';
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"></path><path d="M14 4h6m0 0v6m0-6L10 14"></path></svg><span>' + escapeHtml(label) + '</span>';
      btn.addEventListener('mouseenter', function () { btn.style.background = 'var(--lex-bg-secondary)'; });
      btn.addEventListener('mouseleave', function () { btn.style.background = 'var(--lex-bg-tertiary)'; });
      btn.addEventListener('click', function () {
        openWorkspaceDetails();
      });
      center.appendChild(btn);
    }
  }

  /**
   * Open workspace details page for the current matter.
   */
  function openWorkspaceDetails() {
    if (!_matter || !_matter.id) return;
    var matterId = _matter.matter_id || _matter.id;
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') {
      Lex.Nav.go('workspace-details.html', {
        params: { id: matterId, tab: 'activity' },
        context: { matterId: matterId, tab: 'activity', source: 'chat', conversationId: _conversationId, conversationTitle: _sessionTitle }
      });
    } else {
      window.location.href = 'workspace-details.html?id=' + encodeURIComponent(matterId);
    }
  }

  /**
   * Remove the workspace details button (used on cleanup/return to landing).
   */
  function removeWorkspaceDetailsButton() {
    var topbar = dom.app ? dom.app.querySelector('lex-topbar') : null;
    if (!topbar) return;
    var btn = topbar.querySelector('[data-action="workspace-details"]');
    if (btn) btn.remove();
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
    createConversation(matter.matter_id || matter.id);
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

    // Hide the center stage entirely (matter panel + greeting)
    if (dom.stageCenterEl) {
      dom.stageCenterEl.classList.add('cv2-hidden');
    }

    // Show messages area
    dom.messagesArea.classList.add('cv2-visible');

    // Update page title to matter name (until AI generates a title)
    setPageTitle(_matter ? _matter.name : 'New Conversation');
    updateWorkspaceDetailsButton();

    // Mount lex-chat (includes its own composer)
    mountLexChat(_conversationId, initialMessage);

    // Update URL params so state is bookmarkable and survives refresh
    var urlUpdate = { session: _conversationId };
    if (_matter && _matter.id) urlUpdate.matter = _matter.id;
    syncUrlParams(urlUpdate);
  }

  // =========================================================================
  // Welcome flow — deep-link from workspace (matter pre-selected)
  // Shows greeting + composer with suggestion chips.
  // =========================================================================

  function enterActiveWithWelcome(matter) {
    _matter = matter;
    _enterActiveInvoked = true;
    _stage = 'ACTIVE';

    if (window.Lex && window.Lex.state) {
      window.Lex.state.setActiveMatter(matter.id);
    }

    if (window.Lex && window.Lex.Redact) {
      window.Lex.Redact.off(dom.cardsWrapper);
    }

    if (dom.stageCenterEl) {
      dom.stageCenterEl.classList.add('cv2-hidden');
    }

    dom.messagesArea.classList.add('cv2-visible');

    setPageTitle(_matter.name || 'New Conversation');
    updateWorkspaceDetailsButton();

    // Show welcome greeting overlay
    var welcomeEl = document.createElement('div');
    welcomeEl.id = 'cv2-welcome-greeting';
    welcomeEl.className = 'cv2-welcome-greeting';
    welcomeEl.innerHTML = '<h1 class="cv2-welcome-title">I\'m Lana, your AI assistant. How can I help you today?</h1>';
    dom.messagesArea.appendChild(welcomeEl);

    // Create conversation, then mount lex-chat
    api.post('/api/v1/chat/sessions', { matter_id: matter.matter_id || matter.id })
      .then(function (response) {
        var session = response && response.session;
        var convId = session && (session.id || session.thread_id);
        if (!convId) throw new Error('No session ID');

        _conversationId = convId;
        if (window.Lex && window.Lex.state) {
          window.Lex.state.setActiveConversation(convId);
        }

        mountLexChatWelcome(convId);

        syncUrlParams({ session: convId, matter: _matter.id });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[chat_v2] Failed to create conversation:', err);
        showErrorToast('Could not start a new conversation. Please try again.');
        returnToLanding();
      });
  }

  function mountLexChatWelcome(conversationId) {
    if (!window.customElements || !window.customElements.get('lex-chat')) {
      showErrorToast('Chat component failed to load. Please refresh and try again.');
      return;
    }

    var chatEl = document.createElement('lex-chat');
    chatEl.setAttribute('conversation-id', conversationId);
    chatEl.setAttribute('matter-id', _matter.id);
    chatEl.setAttribute('placeholder', 'Ask anything...');

    if (window.LanaConfig && window.LanaConfig.DEMO_MODE) {
      chatEl.setAttribute('source', 'demo');
    }

    dom.messagesArea.appendChild(chatEl);

    // Reset context meter and clear any stale followup chips for the new conversation
    resetContextMeter();
    clearFollowupChips();

    wireChatEvents(chatEl);

    // Add intent suggestions to the composer after lex-chat builds its DOM
    setTimeout(function () {
      var composerEl = chatEl.querySelector('lex-chat-composer');
      if (composerEl) {
        var suggestions = INTENTS.map(function (intent) {
          if (intent.id === 'ask') return { label: intent.label, value: '' };
          return { label: intent.label, value: intent.label + ' this matter' };
        });
        composerEl._renderSuggestions(suggestions);
      }
    }, 150);

    // Intercept suggestion clicks — populate textarea instead of sending
    chatEl.addEventListener('lex-composer-suggestion', function (e) {
      e.stopImmediatePropagation();
      var composerEl = chatEl.querySelector('lex-chat-composer');
      if (composerEl && e.detail) {
        if (e.detail.value) {
          composerEl.setValue(e.detail.value);
        }
        composerEl.focus();
      }
    }, true);

    // Hide welcome greeting on first message send
    chatEl.addEventListener('lex-composer-send', function () {
      var greetingEl = document.getElementById('cv2-welcome-greeting');
      if (greetingEl) {
        greetingEl.classList.add('cv2-fading');
        setTimeout(function () {
          if (greetingEl.parentNode) greetingEl.parentNode.removeChild(greetingEl);
        }, 300);
      }
    }, { capture: true, once: true });
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
    chatEl.setAttribute('matter-id', _matter.matter_id || _matter.id);
    chatEl.setAttribute('placeholder', 'Ask about this matter...');

    // Demo mode support
    if (window.LanaConfig && window.LanaConfig.DEMO_MODE) {
      chatEl.setAttribute('source', 'demo');
    }

    dom.messagesArea.appendChild(chatEl);

    // Reset context meter and clear any stale followup chips for the new conversation
    resetContextMeter();
    clearFollowupChips();

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

    // Title generated — update page title + sidebar conversation
    listen('lex-chat-title-generated', function (e) {
      var detail = e.detail || {};
      var title = detail.title;
      var convId = detail.conversationId || _conversationId;
      if (title) {
        _sessionTitle = title;
        setPageTitle(title);
        if (convId && window.ConversationMenu) {
          window.ConversationMenu.updateConversation(convId, { title: title });
        }
      }
    });

    // Gap 3 — Context meter: update display on every context_usage event.
    listen('lex-chat-context-usage', function (e) {
      var detail = e.detail || {};
      updateContextMeter(detail.percentUsed, detail.percentUntilCompact);
    });

    // Gap 4 — Auto-compaction: dedicated events from lex-chat.js.
    listen('lex-chat-auto-compact-start', function () {
      if (dom.compactBanner) dom.compactBanner.style.display = '';
      // Disable composer send while compacting
      var composerEl = chatEl.querySelector('lex-chat-composer');
      if (composerEl && typeof composerEl.setGenerating === 'function') {
        composerEl.setGenerating(true);
      }
    });

    listen('lex-chat-auto-compact-complete', function (e) {
      var detail = e.detail || {};
      if (dom.compactBanner) dom.compactBanner.style.display = 'none';
      var composerEl = chatEl.querySelector('lex-chat-composer');
      if (composerEl && typeof composerEl.setGenerating === 'function') {
        composerEl.setGenerating(false);
      }
      var saved = detail.tokensSaved;
      var dur   = detail.durationMs;
      if (saved || dur) {
        var msg = 'Context optimised';
        if (saved) msg += ' — saved ' + (saved > 999 ? (saved / 1000).toFixed(1) + 'K' : saved) + ' tokens';
        if (dur)   msg += ' in ' + (dur / 1000).toFixed(1) + 's';
        showSuccessToast(msg);
      }
    });

    // Response end — feature tracking
    listen('lex-chat-response-end', function () {
      if (window.FeatureTracker && window.Features) {
        window.FeatureTracker.trackFeature(window.Features.CHAT_MESSAGE_SENT, {
          conversation_id: _conversationId,
          chat_mode: localStorage.getItem('chatMode') || 'general',
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
        window.ChatFileDrawer.open(_conversationId, _matter ? (_matter.matter_id || _matter.id) : null);
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

    // Gap 5 — Agentic followup: render suggestion chips above the composer.
    listen('lex-chat-agentic-followup', function (e) {
      var detail = e.detail || {};
      var followups = detail.followups || detail.options || [];
      var message = detail.message || '';
      if (followups.length === 0 && !message) return;
      showFollowupChips(followups, message, chatEl);
    });

    // Gap 5 — Clear chips on next user send.
    listen('lex-chat-send', function () {
      clearFollowupChips();
    });

    // #-mention JIT processing — scan outgoing message for #filename refs and
    // trigger background document processing for any that aren't parsed yet.
    // Fire-and-forget: never blocks the send, mirrors legacy chat.js:1516-1590.
    listen('lex-chat-send', function (e) {
      var content = (e.detail && e.detail.content) || '';
      handleDocumentMentions(content);
    });

    // Gap 1 — Generation banner: fires when loadConversation() detects an in-flight
    // generation on the backend (e.g. user reloaded mid-stream or switched tabs).
    // lex-chat.js uses dispatchEvent() directly (not emit()), so the event still
    // reaches addEventListener on the same element.
    listen('lex-chat-generation-active', function (e) {
      var detail = e.detail || {};
      if (detail.active) {
        showGenerationBanner(detail.startedAt || new Date().toISOString());
      } else {
        hideGenerationBanner();
      }
    });

    // Wire stop button (one-time, not via listen() since it's not on chatEl)
    if (dom.stopGenerationBtn) {
      dom.stopGenerationBtn.onclick = function () {
        hideGenerationBanner();
        if (chatEl && typeof chatEl.stop === 'function') chatEl.stop();
      };
    }

    // Gap 1 — Also hide banner when a response ends normally.
    listen('lex-chat-response-end', function () {
      hideGenerationBanner();
    });

    // Gap 2 — Session expired: lex-chat-error detail now includes `status` from the
    // underlying SSE source. 401 → clear token + redirect to login.
    listen('lex-chat-error', function (e) {
      var detail = e.detail || {};
      if (detail.status === 401) {
        try { localStorage.removeItem('token'); } catch (_) {}
        showErrorToast('Your session has expired. Please log in again.');
        setTimeout(function () {
          window.location.href = 'index.html';
        }, 1500);
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
        html += '<div style="font-size: var(--lex-body-xs-size); color: var(--lex-text-tertiary); margin-top: 4px;">' + formatDateTime(v.created_at) + '</div>';
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
  // Gap 1 — Generation banner helpers
  // =========================================================================

  /**
   * Show the generation banner and start the duration ticker.
   * @param {string} startedAt  ISO timestamp from the backend status response.
   */
  function showGenerationBanner(startedAt) {
    if (!dom.generationBanner) return;
    dom.generationBanner.style.display = 'flex';

    function updateDuration() {
      if (!dom.generationDuration) return;
      var seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      if (seconds < 60) {
        dom.generationDuration.textContent = seconds + (seconds === 1 ? ' second ago' : ' seconds ago');
      } else {
        var mins = Math.floor(seconds / 60);
        dom.generationDuration.textContent = mins + (mins === 1 ? ' minute ago' : ' minutes ago');
      }
    }

    updateDuration();
    clearInterval(_generationDurationInterval);
    _generationDurationInterval = setInterval(updateDuration, 1000);
  }

  /**
   * Hide the generation banner and clear the duration ticker.
   */
  function hideGenerationBanner() {
    if (dom.generationBanner) dom.generationBanner.style.display = 'none';
    clearInterval(_generationDurationInterval);
    _generationDurationInterval = null;
  }

  // =========================================================================
  // Gap 3 — Context meter helpers
  // =========================================================================

  /**
   * Show the context meter in the header area and update its text.
   * @param {number} percentUsed         0-100, percentage of context window consumed.
   * @param {number|null} percentUntilCompact  percentage remaining before auto-compact triggers.
   */
  function updateContextMeter(percentUsed, percentUntilCompact) {
    if (!dom.contextText) return;
    var available = Math.max(0, 100 - (percentUsed || 0));
    if (percentUntilCompact != null) {
      dom.contextText.textContent = 'Context available: ' + available + '% (' + percentUntilCompact + '% until auto-compact)';
    } else {
      dom.contextText.textContent = 'Context available: ' + available + '%';
    }
    if (dom.contextMeter) dom.contextMeter.style.display = 'block';
    console.log('[chat_v2] Context usage:', percentUsed + '% used');
  }

  /**
   * Reset context meter to the default 100% display and hide it.
   * Called when a new conversation loads.
   */
  function resetContextMeter() {
    if (dom.contextText) dom.contextText.textContent = 'Context available: 100% (85% until auto-compact)';
    if (dom.contextMeter) dom.contextMeter.style.display = 'none';
  }

  // =========================================================================
  // #-mention JIT processing
  // =========================================================================

  /**
   * Scan an outgoing message for `#filename` tokens and trigger background
   * document processing for any matched documents that aren't parsed yet.
   * Fire-and-forget — never blocks the user's message.
   */
  function handleDocumentMentions(message) {
    if (!message || typeof message !== 'string') return;
    var mentions = message.match(/#([a-zA-Z0-9_\-\.]+)/g);
    if (!mentions || mentions.length === 0) return;
    if (!window.ChatFileDrawer || typeof window.ChatFileDrawer.getMentionItems !== 'function') return;
    if (!window.api || typeof window.api.triggerDocumentProcessing !== 'function') return;

    var docs = window.ChatFileDrawer.getMentionItems() || [];
    if (docs.length === 0) return;

    var seen = {};
    for (var i = 0; i < mentions.length; i++) {
      var filename = mentions[i].substring(1);
      if (seen[filename]) continue;
      seen[filename] = true;

      var doc = findDocByFilename(docs, filename);
      if (!doc) continue;

      (function (d, name) {
        window.api.getDocumentProcessingStatus(d.id)
          .then(function (status) {
            if (status && status.stage !== 'pending' && status.hasExtractedText) return null;
            return window.api.triggerDocumentProcessing(d.id, 'chat_reference')
              .then(function () { return window.api.pollDocumentProcessing(d.id); })
              .then(function () {
                showSuccessToast('Document "' + name + '" processed and ready');
              });
          })
          .catch(function (err) {
            console.error('[chat_v2] JIT processing failed for ' + name + ':', err);
          });
      })(doc, filename);
    }
  }

  function findDocByFilename(docs, filename) {
    var lower = filename.toLowerCase();
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      var name = (d.filename || d.name || '').toLowerCase();
      if (name === lower) return d;
    }
    // Fallback: prefix match (handles truncated mentions)
    for (var j = 0; j < docs.length; j++) {
      var d2 = docs[j];
      var n2 = (d2.filename || d2.name || '').toLowerCase();
      if (n2.indexOf(lower) === 0) return d2;
    }
    return null;
  }

  // =========================================================================
  // Gap 5 — Followup chip helpers
  // =========================================================================

  /**
   * Render followup suggestion chips above the composer and wire click handlers.
   * @param {Array}  followups  Array of followup objects from agentic_followup.
   * @param {string} message    Optional header message to display above chips.
   * @param {HTMLElement} chatEl  The lex-chat element (for chatEl.send()).
   */
  function showFollowupChips(followups, message, chatEl) {
    if (!dom.followupChips) return;
    dom.followupChips.innerHTML = '';

    if (message) {
      var label = document.createElement('span');
      label.style.cssText = 'width:100%;font-size:var(--lex-body-sm-size,13px);color:var(--lex-text-secondary);margin-bottom:4px;';
      label.textContent = message;
      dom.followupChips.appendChild(label);
    }

    for (var i = 0; i < followups.length; i++) {
      (function (fu) {
        var chip = document.createElement('button');
        chip.style.cssText = 'padding:5px 12px;font-size:var(--lex-body-sm-size,13px);color:var(--lex-text-primary);background:var(--lex-bg-tertiary);border:1px solid var(--lex-border-default);border-radius:var(--lex-radius-full,9999px);cursor:pointer;transition:background var(--lex-transition-fast);white-space:nowrap;';
        chip.textContent = fu.description || fu.label || fu.entity_type || 'Follow up';
        chip.addEventListener('mouseenter', function () { chip.style.background = 'var(--lex-bg-secondary)'; });
        chip.addEventListener('mouseleave', function () { chip.style.background = 'var(--lex-bg-tertiary)'; });
        chip.addEventListener('click', function () {
          clearFollowupChips();
          var prompt = fu.description || fu.label || 'Yes, proceed';
          if (chatEl && typeof chatEl.send === 'function') chatEl.send(prompt);
        });
        dom.followupChips.appendChild(chip);
      })(followups[i]);
    }

    dom.followupChips.style.display = 'flex';
  }

  /** Hide and empty the followup chip row. */
  function clearFollowupChips() {
    if (!dom.followupChips) return;
    dom.followupChips.style.display = 'none';
    dom.followupChips.innerHTML = '';
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

    // Hide banners, clear generation ticker, reset context meter and chips
    hideGenerationBanner();
    if (dom.compactBanner) dom.compactBanner.style.display = 'none';
    resetContextMeter();
    clearFollowupChips();

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
    _sessionTitle = null;
    _enterActiveInvoked = false;

    // Reset page title and remove workspace button
    setPageTitle('New Conversation');
    removeWorkspaceDetailsButton();

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
  // URL state — update both history.state.path AND browser URL bar.
  // chat-v2.html is standalone (not SPA-routed), so init() reads
  // location.search. We must keep the browser URL in sync so that
  // page refreshes restore the correct conversation.
  // =========================================================================

  function syncUrlParams(params) {
    // Update Lex.Nav state (history.state.path) for SPA compatibility
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.updateParams === 'function') {
      window.Lex.Nav.updateParams(params);
    }

    // Also update the actual browser URL so F5 / refresh reads correct params
    var urlParams = new URLSearchParams(window.location.search);
    var keys = Object.keys(params);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = params[key];
      if (val === null || val === undefined) {
        urlParams.delete(key);
      } else {
        urlParams.set(key, String(val));
      }
    }
    var qs = urlParams.toString();
    var newUrl = window.location.pathname + (qs ? '?' + qs : '');
    history.replaceState(history.state || {}, '', newUrl);
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
        _sessionTitle = session.title || (session.metadata && session.metadata.title) || null;

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

    // Update page title: prefer session title, fall back to matter name
    var title = _sessionTitle || (_matter ? _matter.name : null) || 'New Conversation';
    setPageTitle(title);
    updateWorkspaceDetailsButton();

    // Mount lex-chat (includes its own composer)
    mountLexChat(_conversationId, null);

    // Update URL params so state is bookmarkable and survives refresh
    var urlUpdate = { session: _conversationId };
    if (_matter && _matter.id) urlUpdate.matter = _matter.id;
    syncUrlParams(urlUpdate);
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
    _sessionTitle = null;
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
    _sessionTitle = null;
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
      console.error('[chat_v2] Required DOM elements not found. Check chat-v2.html.');
      return;
    }

    setGreeting();
    setupSearch();

    // Register selectConversation for sidebar integration
    window.selectConversation = selectConversation;

    // Register createProjectChat for NewProjectModal integration.
    // When the user opens the "+ New Chat" modal from chat-v2.html and
    // selects a matter, this handles the switch in-page (no reload).
    window.createProjectChat = function (matterId) {
      // Clean up any active conversation before switching matters
      returnToLanding();

      // Fetch the full matter and enter welcome flow
      api.get('/api/v1/matters/' + matterId)
        .then(function (response) {
          var matter = (response && response.matter) ? response.matter : null;
          if (matter && matter.id) {
            enterActiveWithWelcome(matter);
          } else {
            showErrorToast('Could not load matter. Please try again.');
            loadRecentMatters();
          }
        })
        .catch(function () {
          showErrorToast('Could not load matter. Please try again.');
          loadRecentMatters();
        });
    };

    // Activate skeleton shimmer for the cards area
    if (window.Lex && window.Lex.Redact) {
      window.Lex.Redact.on(dom.cardsWrapper);
    }

    // Clear stale history.state.path from previous visits.
    // chat-v2.html is a standalone page (not SPA-routed), so
    // updateParams() writes session/matter into history.state.path.
    // On a fresh navigation (e.g. sidebar "+ New Chat"), the browser
    // may preserve the old state, causing init() to read a stale
    // session ID and 404. Use location.search as the canonical source.
    var params = new URLSearchParams(window.location.search);
    var deepLinkSessionId = params.get('session') || null;
    var deepLinkMatterId = params.get('matter') || null;

    if (deepLinkSessionId) {
      loadExistingSession(deepLinkSessionId);
    } else if (deepLinkMatterId) {
      // Check for pre-seeded prompt from action queue drawer
      var chatPrompt = null;
      try { chatPrompt = sessionStorage.getItem('lana_chat_prompt'); sessionStorage.removeItem('lana_chat_prompt'); } catch (e) { /* ignore */ }

      api.get('/api/v1/matters/' + deepLinkMatterId)
        .then(function (response) {
          var matter = (response && response.matter) ? response.matter : null;
          if (matter && matter.id) {
            if (window.Lex && window.Lex.Redact) {
              window.Lex.Redact.off(dom.cardsWrapper);
            }

            if (chatPrompt) {
              // Pre-seeded prompt from action queue: use existing intent flow
              _stage = 'LANDING';
              onMatterSelected(matter);
              var promptWaited = 0;
              var promptPoll = setInterval(function () {
                promptWaited += 100;
                if (_conversationId) {
                  clearInterval(promptPoll);
                  enterActive(chatPrompt);
                }
                if (promptWaited >= 8000) {
                  clearInterval(promptPoll);
                }
              }, 100);
            } else {
              // Normal workspace deep-link: welcome greeting + suggestions
              enterActiveWithWelcome(matter);
            }
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
    // Ensure generation duration ticker is cleared (safety net)
    hideGenerationBanner();
    // Clean up ACTIVE stage (lex-chat, event listeners)
    cleanupActiveStage();
    // Remove workspace details button
    removeWorkspaceDetailsButton();
    // Remove document click handler
    if (_docClickHandler) {
      document.removeEventListener('click', _docClickHandler);
      _docClickHandler = null;
    }
    // Reset guards
    _enterActiveInvoked = false;
    _sessionTitle = null;
    // Clear Lex.state
    if (window.Lex && window.Lex.state) {
      window.Lex.state.setActiveConversation(null);
      window.Lex.state.setActiveMatter(null);
    }
    // Remove global selectConversation
    if (window.selectConversation === selectConversation) {
      delete window.selectConversation;
    }
    // Remove global createProjectChat
    if (typeof window.createProjectChat === 'function') {
      delete window.createProjectChat;
    }
    // Close file drawer if open
    if (window.ChatFileDrawer && typeof window.ChatFileDrawer.close === 'function') {
      window.ChatFileDrawer.close();
    }
  }

  // =========================================================================
  // Page lifecycle — standalone page, called directly
  // =========================================================================

  init();

})();
