/* ==========================================================================
   Lex UI — LexDynamicCardRenderer
   Generic helper that renders dynamic chat cards from backend-emitted
   descriptors. Works identically for live SSE streams and history reloads.

   Card descriptors arrive from the backend in two ways:
     1. Live stream  : embedded in the `plan_ready` SSE event (event.card)
     2. History load : stored in message metadata under `dynamic_cards[]`

   The renderer is data-driven — it never contains feature-specific logic.
   Adding a new card type requires only:
     1. Adding the component tag to ALLOWED_CARD_TYPES below
     2. Writing the new web component
     3. Adding a builder in dynamic-cards.service.js (backend)
     4. Emitting the descriptor from a backend handler

   Depends on:
     - global.api  (the shared LANA API client — api.js)
     - Custom elements registered by card component scripts

   Usage:
     // Render a card from a descriptor
     LexDynamicCardRenderer.renderCard(descriptor, containerEl);

     // Batch-refresh states for cards in a loaded history
     const states = await LexDynamicCardRenderer.refreshCardStates(descriptors);
     // states = { 'plan_abc': 'approved', 'plan_def': 'pending' }
   ========================================================================== */

(function (global) {
  'use strict';

  /**
   * Whitelist of allowed card component tag names.
   * Only tags listed here will be created by renderCard(). Any descriptor
   * with an unknown type is logged and skipped — this prevents a compromised
   * backend response from injecting arbitrary elements.
   *
   * @type {string[]}
   */
  var ALLOWED_CARD_TYPES = [
    'lex-agentic-plan-card'
    // Future: 'lex-artifact-preview-card', 'lex-skill-approval-card', etc.
  ];

  /**
   * Render a dynamic card from a descriptor and append it to a container.
   *
   * Sets HTML attributes for primitive values (from descriptor.props) and JS
   * properties for complex values (from descriptor.data and descriptor.actions)
   * so the component can access nested objects and arrays.
   *
   * @param {Object}      descriptor          - Card descriptor from the backend
   * @param {string}      descriptor.type     - Custom element tag name (must be in ALLOWED_CARD_TYPES)
   * @param {string}      [descriptor.card_id] - Stable identifier for state refresh
   * @param {string}      [descriptor.state]  - Initial state to set on the element
   * @param {Object}      [descriptor.props]  - Primitive attribute values
   * @param {Object}      [descriptor.data]   - Complex JS property values
   * @param {Array}       [descriptor.actions] - Action descriptor array
   * @param {HTMLElement} container           - DOM element to append the card to
   * @returns {HTMLElement|null} The created card element, or null if skipped
   */
  function renderCard(descriptor, container) {
    if (!descriptor || !descriptor.type || !container) return null;

    if (ALLOWED_CARD_TYPES.indexOf(descriptor.type) === -1) {
      console.warn('[LexDynamicCardRenderer] Unknown card type — skipping:', descriptor.type);
      return null;
    }

    var el = document.createElement(descriptor.type);

    // Set primitive HTML attributes from props
    if (descriptor.props && typeof descriptor.props === 'object') {
      var propKeys = Object.keys(descriptor.props);
      for (var i = 0; i < propKeys.length; i++) {
        el.setAttribute(propKeys[i], String(descriptor.props[propKeys[i]]));
      }
    }

    // Set complex JS properties — these are set after element creation so the
    // component's property setter can trigger a re-render once connected
    if (descriptor.data && typeof descriptor.data === 'object') {
      var dataKeys = Object.keys(descriptor.data);
      for (var j = 0; j < dataKeys.length; j++) {
        el[dataKeys[j]] = descriptor.data[dataKeys[j]];
      }
    }

    // Pass the actions array — the card component iterates this and renders
    // buttons dynamically without hardcoding any endpoint URLs or labels
    if (Array.isArray(descriptor.actions)) {
      el.actions = descriptor.actions;
    }

    // Set initial state as an attribute so CSS selectors and reflected
    // properties work before the component initialises
    if (descriptor.state) {
      el.setAttribute('status', descriptor.state);
    }

    // Track the card by its stable ID so the state-refresh loop can find it
    if (descriptor.card_id) {
      el.setAttribute('card-id', descriptor.card_id);
    }

    container.appendChild(el);
    return el;
  }

  /**
   * Batch-fetch current state for multiple cards from the backend.
   *
   * Called after all history messages are rendered so that any cards that have
   * transitioned (e.g. pending → approved) are updated to reflect their real
   * current state rather than the state that was saved when the message was
   * persisted.
   *
   * @param {Array<Object>} descriptors - Card descriptors (must have card_id + state_refresh)
   * @returns {Promise<Object>} Map of card_id → current state string
   */
  async function refreshCardStates(descriptors) {
    if (!descriptors || descriptors.length === 0) return {};

    var cardsToRefresh = [];
    for (var i = 0; i < descriptors.length; i++) {
      var d = descriptors[i];
      if (d && d.card_id && d.state_refresh) {
        cardsToRefresh.push({
          card_id: d.card_id,
          state_refresh: d.state_refresh
        });
      }
    }

    if (cardsToRefresh.length === 0) return {};

    try {
      var api = global.api;
      if (!api || typeof api.post !== 'function') {
        console.warn('[LexDynamicCardRenderer] global.api not available for state refresh');
        return {};
      }

      var result = await api.post('/api/v1/dynamic-cards/refresh-state', {
        cards: cardsToRefresh
      });

      return (result && result.data && result.data.states) ? result.data.states : {};
    } catch (err) {
      console.warn('[LexDynamicCardRenderer] State refresh failed:', err && err.message);
      return {};
    }
  }

  // Expose on global so lex-chat.js and other scripts can use it
  global.LexDynamicCardRenderer = {
    renderCard: renderCard,
    refreshCardStates: refreshCardStates,
    ALLOWED_CARD_TYPES: ALLOWED_CARD_TYPES
  };

})(typeof window !== 'undefined' ? window : globalThis);
