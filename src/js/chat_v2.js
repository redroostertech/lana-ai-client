/* ==========================================================================
   Chat V2 — New Conversation Page Controller
   Single IIFE. 4-stage state machine: LOADING -> LANDING -> SELECTED -> ACTIVE.
   No regex. No classes. Under 400 lines.
   ========================================================================== */

(function () {
  'use strict';

  // =========================================================================
  // Stage state (module-level, 4 variables only)
  // =========================================================================

  var _stage = 'LOADING';
  var _matter = null;            // full matter object once selected
  var _conversationId = null;
  var _abortController = null;

  // Search debounce timer
  var _searchTimer = null;

  // Document click handler stored for cleanup on leave (Risk 6)
  var _docClickHandler = null;

  // Pinned composer handler refs for cleanup (C1)
  var _sendBtnHandler = null;
  var _mentionKeydownHandler = null;

  // Poll interval for waiting on conversation creation (I4)
  var _pollInterval = null;

  // Guard against double enterActive() calls (C2)
  var _enterActiveInvoked = false;

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
    dom.composerPinned    = document.getElementById('cv2-composer-pinned');
    dom.pinnedBadgeRow    = document.getElementById('cv2-pinned-badge-row');
    dom.pinnedMatterBadge = document.getElementById('cv2-pinned-matter-badge');
    dom.mentionInput      = document.getElementById('cv2-mention-input');
    dom.sendBtn           = document.getElementById('cv2-send-btn');
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
  // Stage: LOADING -> LANDING
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
  // Stage: LANDING -> SELECTED
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
    // NOTE: cannot use { once: true } here because transitionend fires per-property.
    // If transform fires before opacity, { once: true } would remove the handler
    // before opacity fires. Manual removeEventListener handles cleanup instead.
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

    // Set matter badge — use setAttribute('label', ...) per correction #7
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
    _abortController = new AbortController();

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
        // Otherwise wait for user to pick an intent

      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;  // page navigation, ignore
        console.error('[chat_v2] Failed to create conversation:', err);
        showErrorToast('Could not start a new conversation. Please try again.');
        returnToLanding();
      });
  }

  // =========================================================================
  // Stage: SELECTED -> ACTIVE (intent chosen)
  // =========================================================================

  function onIntentSelected(intent) {
    // Store initial message derived from intent
    var initialMessage = null;
    if (intent.id !== 'ask') {
      initialMessage = intent.label + ' this matter';
    }

    // Guard: if conversation not yet created, wait — disable intents momentarily
    if (!_conversationId) {
      // Disable intent buttons while POST is still in flight
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
    if (_enterActiveInvoked) return;  // C2: prevent double entry from race
    _enterActiveInvoked = true;
    _stage = 'ACTIVE';

    // Hide inline composer
    dom.composerInline.classList.remove('cv2-entered');
    dom.composerInline.addEventListener('transitionend', function hide() {
      dom.composerInline.removeEventListener('transitionend', hide);
      dom.composerInline.classList.remove('cv2-visible');
      dom.composerInline.classList.add('cv2-hidden');
    }, { once: true });

    // Dim the greeting
    if (dom.stageCenterEl) {
      dom.stageCenterEl.classList.add('cv2-greeting-dimmed');
    }

    // Show messages area
    dom.messagesArea.classList.add('cv2-visible');

    // Mount lex-chat
    mountLexChat(_conversationId, initialMessage);

    // Slide up pinned composer
    dom.composerPinned.classList.add('cv2-visible');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        dom.composerPinned.classList.add('cv2-entered');
      });
    });

    // Set badge in pinned composer — use setAttribute('label', ...) per correction #7
    if (dom.pinnedMatterBadge) {
      dom.pinnedMatterBadge.setAttribute('label', _matter.name || _matter.matter_number || 'Matter');
    }

    // Wire send button
    wirePinnedComposer();
  }

  // =========================================================================
  // lex-chat mounting (only after conversation ID exists)
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
    chatEl.setAttribute('show-composer', 'false');  // we use the pinned composer
    chatEl.style.height = '100%';

    dom.messagesArea.appendChild(chatEl);

    // Send initial intent message if provided
    if (initialMessage) {
      // Small delay to let lex-chat connect its source
      setTimeout(function () {
        if (chatEl && typeof chatEl.send === 'function') {
          chatEl.send(initialMessage);
        }
      }, 150);
    }
  }

  // =========================================================================
  // Pinned composer wiring
  // =========================================================================

  function wirePinnedComposer() {
    if (!dom.sendBtn || !dom.mentionInput) return;

    // Remove any previous listeners from a prior activation (C1/V4)
    if (_sendBtnHandler) dom.sendBtn.removeEventListener('click', _sendBtnHandler);
    if (_mentionKeydownHandler) dom.mentionInput.removeEventListener('keydown', _mentionKeydownHandler);

    _sendBtnHandler = function () {
      sendFromPinnedComposer();
    };

    _mentionKeydownHandler = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        // Do not intercept Enter when the mention picker is open —
        // lex-mention-input handles item selection internally
        var pickerOpen = dom.mentionInput &&
          dom.mentionInput.querySelector('.lex-mention-picker.lex-mention-picker--open');
        if (pickerOpen) return;

        e.preventDefault();
        sendFromPinnedComposer();
      }
    };

    dom.sendBtn.addEventListener('click', _sendBtnHandler);
    dom.mentionInput.addEventListener('keydown', _mentionKeydownHandler);
  }

  function sendFromPinnedComposer() {
    var chatEl = dom.messagesArea.querySelector('lex-chat');
    if (!chatEl || typeof chatEl.send !== 'function') return;

    var mentionEl = dom.mentionInput;
    // Correction #1: use getTextContent() to read, not .value
    var text = mentionEl && typeof mentionEl.getTextContent === 'function'
      ? mentionEl.getTextContent().trim()
      : '';
    if (!text) return;

    chatEl.send(text);

    // Correction #1: clear via querySelector('.lex-mention-editor').innerHTML
    if (mentionEl) {
      var editor = mentionEl.querySelector('.lex-mention-editor');
      if (editor) editor.innerHTML = '';
    }
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

    // Close results when clicking outside — stored for cleanup in onLeave (Risk 6)
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
    // Correction #2: use Lex.Toast.error(message), not Lex.Toast.show({...})
    if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.error === 'function') {
      window.Lex.Toast.error(message);
    } else {
      console.error('[chat_v2] Error:', message);
    }
  }

  function returnToLanding() {
    _stage = 'LANDING';
    _matter = null;
    _conversationId = null;
    _enterActiveInvoked = false;  // C2: reset guard

    // Clear any pending intent-wait poll (prevents double toast on POST failure race)
    if (_pollInterval) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }

    // Clean up ACTIVE-stage DOM (I1)
    dom.messagesArea.innerHTML = '';
    dom.messagesArea.classList.remove('cv2-visible');
    dom.composerPinned.classList.remove('cv2-visible', 'cv2-entered');

    // Reset inline composer + matter panel
    dom.composerInline.classList.remove('cv2-visible', 'cv2-entered', 'cv2-hidden');
    dom.matterPanel.classList.remove('cv2-collapsing', 'cv2-hidden');
    dom.cardsWrapper.style.pointerEvents = '';
    if (dom.stageCenterEl) {
      dom.stageCenterEl.classList.remove('cv2-greeting-dimmed', 'cv2-hidden');
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
  // Load existing session (deep-link with ?session=xxx)
  // =========================================================================

  function loadExistingSession(sessionId) {
    _abortController = new AbortController();

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

        // If session has a matter, fetch it for the badge
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
              // Matter fetch failed — still proceed with minimal matter info
              _matter = { id: session.matter_id, name: 'Matter' };
              enterActiveFromSession();
            });
        } else {
          // No matter — general workspace chat
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
   * Skips the LANDING → SELECTED animation flow since we never showed the
   * matter panel or inline composer.
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

    // Mount lex-chat
    mountLexChat(_conversationId, null);

    // Slide up pinned composer
    dom.composerPinned.classList.add('cv2-visible');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        dom.composerPinned.classList.add('cv2-entered');
      });
    });

    // Set badge in pinned composer
    if (dom.pinnedMatterBadge && _matter) {
      dom.pinnedMatterBadge.setAttribute('label', _matter.name || _matter.matter_number || 'Matter');
    }

    // Wire send button
    wirePinnedComposer();
  }

  // =========================================================================
  // Page initialisation (called by LexRouter on every navigation to this page)
  // =========================================================================

  function init() {
    // Reset module state on every page enter (handles re-navigation)
    _stage = 'LOADING';
    _matter = null;
    _conversationId = null;
    _searchTimer = null;
    _enterActiveInvoked = false;

    // Abort any lingering requests from a previous visit
    if (_abortController) {
      _abortController.abort();
      _abortController = null;
    }

    cacheDom();

    // Guard: if required DOM elements are missing, bail out safely
    if (!dom.matterPanel || !dom.cardsWrapper) {
      console.error('[chat_v2] Required DOM elements not found. Check chat_v2.html.');
      return;
    }

    setGreeting();
    setupSearch();

    // Activate skeleton shimmer for the cards area
    if (window.Lex && window.Lex.Redact) {
      window.Lex.Redact.on(dom.cardsWrapper);
    }

    // Check for deep-link params
    var params = window.Lex && window.Lex.Nav ? window.Lex.Nav.getParams() : null;
    var deepLinkSessionId = params && params.get ? params.get('session') : null;
    var deepLinkMatterId = params && params.get ? params.get('matter') : null;

    if (deepLinkSessionId) {
      // Load existing conversation — skip matter selection flow entirely
      loadExistingSession(deepLinkSessionId);
    } else if (deepLinkMatterId) {
      // Fetch the specific matter, then jump to SELECTED
      api.get('/api/v1/matters/' + deepLinkMatterId)
        .then(function (response) {
          var matter = (response && response.matter) ? response.matter : null;
          if (matter && matter.id) {
            if (window.Lex && window.Lex.Redact) {
              window.Lex.Redact.off(dom.cardsWrapper);
            }
            _stage = 'LANDING';  // C3: set stage before guard check in onMatterSelected
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
    _abortController = new AbortController();

    api.get('/api/v1/matters/recent?limit=3')
      .then(function (response) {
        var matters = (response && response.matters) ? response.matters : [];
        if (!Array.isArray(matters)) matters = [];
        enterLanding(matters);
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[chat_v2] Failed to load recent matters:', err);
        enterLanding([]);  // Enter LANDING with empty state — search still works
      });
  }

  // =========================================================================
  // Page lifecycle — LexRouter view hooks
  // =========================================================================

  LexRouter.registerView({
    onEnter: function () {
      init();
    },
    onLeave: function () {
      // Cancel in-flight API calls
      if (_abortController) {
        _abortController.abort();
        _abortController = null;
      }
      // Cancel pending search
      if (_searchTimer) {
        clearTimeout(_searchTimer);
        _searchTimer = null;
      }
      // Clear poll interval (I4)
      if (_pollInterval) {
        clearInterval(_pollInterval);
        _pollInterval = null;
      }
      // Remove pinned composer listeners (C1)
      if (_sendBtnHandler && dom.sendBtn) {
        dom.sendBtn.removeEventListener('click', _sendBtnHandler);
        _sendBtnHandler = null;
      }
      if (_mentionKeydownHandler && dom.mentionInput) {
        dom.mentionInput.removeEventListener('keydown', _mentionKeydownHandler);
        _mentionKeydownHandler = null;
      }
      // Remove document click handler to prevent listener accumulation (Risk 6)
      if (_docClickHandler) {
        document.removeEventListener('click', _docClickHandler);
        _docClickHandler = null;
      }
      // Reset guards
      _enterActiveInvoked = false;
      // Clear Lex.state conversation (leaving this page means we are done)
      if (window.Lex && window.Lex.state) {
        window.Lex.state.setActiveConversation(null);
      }
    }
  });

  // Also register via page init for first-load compatibility
  LexRouter.registerPageInit('chat_v2.html', init);

})();
