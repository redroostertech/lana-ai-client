/* ==========================================================================
   Lex UI — <lex-agentic-plan-card>
   Renders a structured agentic execution plan card inside the chat stream.
   Shown when the backend emits a `plan_ready` SSE event before executing
   an agentic task. The user must explicitly approve or cancel.

   DATA-DRIVEN DESIGN
   ------------------
   Buttons are rendered entirely from the `actions` property (an array of
   action descriptors set by LexDynamicCardRenderer). The component contains
   NO hardcoded endpoint URLs, action IDs, or button labels — everything
   comes from the descriptor so adding new actions requires only a backend
   change.

   Action descriptor shape:
     {
       id:                 string   — unique identifier, used as data-action-id
       label:              string   — button text
       variant:            string   — lex-btn variant ('primary'|'outline'|'ghost')
       endpoint?:          string   — "METHOD /path" (e.g. "POST /api/v1/approvals/:id/approve")
       payload?:           object   — JSON body for the HTTP call
       action_type?:       string   — special client-side action ('toggle_edit_mode')
       on_success?:        object   — { set_state?, toast? }
       disabled_when_state?: string[] — list of status values that disable this button
     }

   Properties:
     plan        (Object)  — Execution plan with steps array (set as JS property)
     actions     (Array)   — Action descriptor array (set as JS property by renderer)
     approval-id (String)  — The approval request ID (kept for edit-submit fallback)
     status      (String)  — 'pending' | 'approved' | 'rejected' | 'expired'

   Status transitions:
     pending  → shows action buttons, neutral styling
     approved → hides buttons, shows "Approved — executing in background", green accent
     rejected → hides buttons, shows "Cancelled", muted styling
     expired  → hides buttons, shows "Expired", muted styling
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement, defineLex } = global.Lex;
  if (!LexElement) { console.error('[lex-agentic-plan-card] LexElement not loaded'); return; }

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-agentic-plan-card-styles';
    style.textContent = `
      lex-agentic-plan-card {
        display: block;
        animation: lex-chat-fade-in var(--lex-transition-slow, 0.3s) ease both;
      }

      /* ── Outer wrapper — mirrors assistant message layout ── */

      .lex-plan-card-wrapper {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }

      /* ── Card ── */

      .lex-plan-card {
        flex: 1;
        min-width: 0;
        background: var(--lex-bg-muted);
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-radius-lg, 8px);
        overflow: hidden;
      }

      /* ── Header ── */

      .lex-plan-card__header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px 10px;
        border-bottom: 1px solid var(--lex-border-default);
      }

      .lex-plan-card__header-icon {
        width: 16px;
        height: 16px;
        color: var(--lex-color-blue-600, #2563eb);
        flex-shrink: 0;
      }

      .lex-plan-card__title {
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: 600;
        color: var(--lex-text-primary);
        letter-spacing: 0.01em;
      }

      .lex-plan-card__status-badge {
        margin-left: auto;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 2px 8px;
        border-radius: var(--lex-radius-full, 9999px);
        border: 1px solid currentColor;
      }

      .lex-plan-card__status-badge--pending {
        color: var(--lex-color-blue-600, #2563eb);
        background: rgba(37, 99, 235, 0.06);
      }

      .lex-plan-card__status-badge--approved {
        color: var(--lex-color-success-600, #16a34a);
        background: rgba(22, 163, 74, 0.06);
      }

      .lex-plan-card__status-badge--rejected {
        color: var(--lex-text-tertiary, #9ca3af);
        background: transparent;
        border-color: var(--lex-border-default);
      }

      .lex-plan-card__status-badge--expired {
        color: var(--lex-text-tertiary, #9ca3af);
        background: transparent;
        border-color: var(--lex-border-default);
      }

      /* ── Goal ── */

      .lex-plan-card__goal {
        padding: 10px 16px 6px;
        font-size: var(--lex-body-sm-size, 0.875rem);
        color: var(--lex-text-secondary);
        line-height: 1.5;
      }

      .lex-plan-card__goal-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lex-text-tertiary, #9ca3af);
        margin-bottom: 2px;
      }

      /* ── Steps ── */

      .lex-plan-card__steps {
        padding: 8px 16px 12px;
      }

      .lex-plan-card__steps-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lex-text-tertiary, #9ca3af);
        margin-bottom: 8px;
      }

      .lex-plan-card__steps ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .lex-plan-card__steps li {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-size: var(--lex-body-sm-size, 0.875rem);
        color: var(--lex-text-primary);
        line-height: 1.5;
      }

      .lex-plan-card__step-num {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        border-radius: var(--lex-radius-full, 9999px);
        background: var(--lex-bg-subtle, rgba(0,0,0,0.04));
        border: 1px solid var(--lex-border-subtle);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--lex-font-mono);
        font-size: 10px;
        font-weight: 600;
        color: var(--lex-text-tertiary, #9ca3af);
        margin-top: 1px;
      }

      /* ── Footer ── */

      .lex-plan-card__footer {
        padding: 10px 16px 12px;
        border-top: 1px solid var(--lex-border-default);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      /* ── Confirmation states ── */

      .lex-plan-card__confirmation {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: var(--lex-body-sm-size, 0.875rem);
      }

      .lex-plan-card__confirmation-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      .lex-plan-card__confirmation--approved {
        color: var(--lex-color-success-600, #16a34a);
      }

      .lex-plan-card__confirmation--rejected,
      .lex-plan-card__confirmation--expired {
        color: var(--lex-text-tertiary, #9ca3af);
      }
    `;
    document.head.appendChild(style);
  }

  // ── SVG icons ────────────────────────────────────────────────────────────

  const ICON_CLIPBOARD = `<svg class="lex-plan-card__header-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1" ry="1"/><path d="M9 12h6M9 16h4"/></svg>`;

  const ICON_CHECK = `<svg class="lex-plan-card__confirmation-icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`;

  const ICON_X = `<svg class="lex-plan-card__confirmation-icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  const ICON_CLOCK = `<svg class="lex-plan-card__confirmation-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  // Breathing logo — matches the assistant message avatar mark
  const BREATHING_LOGO_STATIC = `
    <div class="lex-chat-indicator lex-chat-indicator--static">
      <svg class="lex-chat-indicator-corner lex-chat-indicator-corner--tl" width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M0 0L8 0M0 0L0 8" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <svg class="lex-chat-indicator-corner lex-chat-indicator-corner--br" width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M8 8L0 8M8 8L8 0" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </div>`;

  // ── Component ─────────────────────────────────────────────────────────────

  class LexAgenticPlanCard extends LexElement {

    static get properties() {
      return {
        approvalId: { type: String, default: null, attribute: 'approval-id' },
        status:     { type: String, default: 'pending', reflect: true }
      };
    }

    constructor() {
      super();
      /**
       * The plan object. Set as a JS property (not attribute) because it is
       * a complex object. The render() method reads this._plan directly.
       * @type {{ goal?: string, steps?: (string|{description:string})[] } | null}
       */
      this._plan = null;
      /**
       * Action descriptors from the backend card descriptor. The component
       * iterates this array and renders buttons dynamically. Each item has:
       *   id, label, variant, endpoint?, payload?, action_type?, on_success?,
       *   disabled_when_state?
       * @type {Array|null}
       */
      this._actions = null;
      this._loading = false;
      this._editing = false;
    }

    /**
     * Set the plan object. Triggers a re-render.
     * @param {Object} value
     */
    set plan(value) {
      this._plan = value;
      if (this._initialized) {
        this._performUpdate();
      }
    }

    get plan() {
      return this._plan;
    }

    /**
     * Set the actions array from the card descriptor. Triggers a re-render.
     * The renderer calls this after creating the element:
     *   el.actions = descriptor.actions;
     * @param {Array} value
     */
    set actions(value) {
      this._actions = Array.isArray(value) ? value : null;
      if (this._initialized) {
        this._performUpdate();
      }
    }

    get actions() {
      return this._actions;
    }

    connected() {
      injectStyles();
    }

    render() {
      const status = this.status || 'pending';
      const plan = this._plan || {};

      const goal = plan.goal || plan.summary || plan.description || null;
      const rawSteps = Array.isArray(plan.steps) ? plan.steps : [];

      // Normalise steps — backend may send strings or { description } objects
      const steps = rawSteps.map(function (s) {
        if (typeof s === 'string') return s;
        return s.description || s.name || s.action || JSON.stringify(s);
      });

      // Status badge label
      const badgeLabels = {
        pending:   'Awaiting Approval',
        approved:  'Approved',
        rejected:  'Cancelled',
        expired:   'Expired',
        cancelled: 'Cancelled'
      };
      const badgeLabel = badgeLabels[status] || status;

      // Goal section
      const goalHtml = goal ? `
        <div class="lex-plan-card__goal">
          <div class="lex-plan-card__goal-label">Goal</div>
          <div>${this.escapeHtml(goal)}</div>
        </div>` : '';

      // Steps list
      const stepsHtml = steps.length > 0 ? `
        <div class="lex-plan-card__steps">
          <div class="lex-plan-card__steps-label">Steps</div>
          <ol>
            ${steps.map(function (step, i) {
              return `<li>
                <span class="lex-plan-card__step-num">${i + 1}</span>
                <span>${this.escapeHtml(step)}</span>
              </li>`;
            }, this).join('')}
          </ol>
        </div>` : '';

      // Footer content depends on status
      let footerHtml = '';

      if (status === 'approved') {
        footerHtml = `
          <div class="lex-plan-card__footer">
            <div class="lex-plan-card__confirmation lex-plan-card__confirmation--approved">
              ${ICON_CHECK}
              <span>Approved — executing in background</span>
            </div>
          </div>`;
      } else if (status === 'rejected' || status === 'cancelled') {
        footerHtml = `
          <div class="lex-plan-card__footer">
            <div class="lex-plan-card__confirmation lex-plan-card__confirmation--rejected">
              ${ICON_X}
              <span>Cancelled</span>
            </div>
          </div>`;
      } else if (status === 'expired') {
        footerHtml = `
          <div class="lex-plan-card__footer">
            <div class="lex-plan-card__confirmation lex-plan-card__confirmation--expired">
              ${ICON_CLOCK}
              <span>Expired</span>
            </div>
          </div>`;
      } else if (this._editing) {
        // Edit mode — always shown regardless of action descriptor
        footerHtml = `
          <div class="lex-plan-card__footer" style="flex-direction:column;gap:8px;">
            <div style="width:100%;display:flex;gap:8px;">
              <input type="text" data-ref="edit-input" placeholder="Describe changes... e.g. 'Remove step 3' or 'Also email the results'"
                style="flex:1;padding:6px 10px;border:1px solid var(--lex-border-default);border-radius:var(--lex-radius-md,6px);font-size:var(--lex-body-sm-size,0.875rem);color:var(--lex-text-primary);outline:none;">
              <lex-btn variant="primary" size="sm" data-action="submit-edit">Update Plan</lex-btn>
              <lex-btn variant="ghost" size="sm" data-action="cancel-edit">Back</lex-btn>
            </div>
          </div>`;
      } else {
        // Pending (or unknown) state — render action buttons from descriptor
        const actionButtons = this._renderActionButtons(status);
        if (actionButtons) {
          footerHtml = `<div class="lex-plan-card__footer">${actionButtons}</div>`;
        }
      }

      return `
        <div class="lex-plan-card-wrapper">
          ${BREATHING_LOGO_STATIC}
          <div class="lex-plan-card">
            <div class="lex-plan-card__header">
              ${ICON_CLIPBOARD}
              <span class="lex-plan-card__title">Execution Plan</span>
              <span class="lex-plan-card__status-badge lex-plan-card__status-badge--${this.escapeHtml(status)}">${this.escapeHtml(badgeLabel)}</span>
            </div>
            ${goalHtml}
            ${stepsHtml}
            ${footerHtml}
          </div>
        </div>`;
    }

    /**
     * Render action buttons from the actions descriptor array.
     * Each button gets a `data-action-id` attribute matching the action's id
     * so the generic click handler can look up the descriptor by id.
     *
     * @param {string} currentStatus - Current status value
     * @returns {string} HTML string of <lex-btn> elements
     */
    _renderActionButtons(currentStatus) {
      var actions = this._actions;

      // Fallback to legacy static buttons if no descriptor was provided
      // (backward compatibility with pre-descriptor plan cards in history)
      if (!actions || actions.length === 0) {
        return `
          <lex-btn variant="primary" size="sm" data-action-id="approve">Approve &amp; Run</lex-btn>
          <lex-btn variant="outline" size="sm" data-action-id="edit">Edit Plan</lex-btn>
          <lex-btn variant="ghost" size="sm" data-action-id="cancel">Cancel</lex-btn>`;
      }

      var html = '';
      for (var i = 0; i < actions.length; i++) {
        var action = actions[i];
        var isDisabled = false;

        if (Array.isArray(action.disabled_when_state)) {
          isDisabled = action.disabled_when_state.indexOf(currentStatus) > -1;
        }

        var disabledAttr = isDisabled ? ' disabled' : '';
        var variant = this.escapeHtml(action.variant || 'outline');
        var label = this.escapeHtml(action.label || action.id || '');

        html += `<lex-btn variant="${variant}" size="sm" data-action-id="${this.escapeHtml(action.id)}"${disabledAttr}>${label}</lex-btn>`;
      }

      return html;
    }

    updated() {
      // Wire up the generic action click handler for all data-action-id buttons
      // This single handler covers every action from the descriptor array
      this.listen('[data-action-id]', 'click', this._handleAction.bind(this));

      // Edit submit and cancel — these are special internal actions
      this.listen('[data-action="submit-edit"]', 'click', this._handleSubmitEdit.bind(this));
      this.listen('[data-action="cancel-edit"]', 'click', this._handleCancelEdit.bind(this));

      // Enter key in edit input
      var editInput = this.$('[data-ref="edit-input"]');
      if (editInput) {
        this.listen('[data-ref="edit-input"]', 'keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this._handleSubmitEdit();
          }
        });
        // Auto-focus when edit mode is active
        if (this._editing) editInput.focus();
      }
    }

    // ── Generic action handler ────────────────────────────────────────────

    /**
     * Handle any action button click by looking up the action descriptor by
     * its id (stored in data-action-id). Dispatches to the appropriate handler:
     *   - action_type === 'toggle_edit_mode' → enter edit mode (client-side only)
     *   - endpoint present                   → fire HTTP request
     *
     * @param {Event} event - Click event
     */
    _handleAction(event) {
      if (this._loading) return;

      var btn = event.currentTarget || event.target;
      // Walk up to the element with the data-action-id attribute in case the
      // click landed on a child element inside the button
      while (btn && !btn.dataset.actionId) {
        btn = btn.parentElement;
      }
      if (!btn) return;

      var actionId = btn.dataset.actionId;
      var action = this._findAction(actionId);

      // Fallback: if no descriptor was set, handle by id directly
      if (!action) {
        action = this._buildFallbackAction(actionId);
      }

      if (!action) {
        console.warn('[lex-agentic-plan-card] No action found for id:', actionId);
        return;
      }

      // Check disabled_when_state — guard even if the button rendered enabled
      var currentStatus = this.status || 'pending';
      if (Array.isArray(action.disabled_when_state) &&
          action.disabled_when_state.indexOf(currentStatus) > -1) {
        return;
      }

      // Special client-side actions
      if (action.action_type === 'toggle_edit_mode') {
        this._editing = true;
        this._performUpdate();
        return;
      }

      // HTTP action
      if (action.endpoint) {
        this._fireEndpointAction(action);
        return;
      }

      console.warn('[lex-agentic-plan-card] Action has no endpoint or action_type:', action.id);
    }

    /**
     * Look up an action descriptor from the actions array by its id.
     * @param {string} actionId
     * @returns {Object|null}
     */
    _findAction(actionId) {
      if (!this._actions) return null;
      for (var i = 0; i < this._actions.length; i++) {
        if (this._actions[i].id === actionId) return this._actions[i];
      }
      return null;
    }

    /**
     * Fallback action descriptors for cards that were persisted before the
     * data-driven system was introduced. The approval-id attribute is used
     * to construct endpoint URLs.
     *
     * @param {string} actionId - 'approve' | 'edit' | 'cancel'
     * @returns {Object|null}
     */
    _buildFallbackAction(actionId) {
      var approvalId = this.approvalId;
      if (!approvalId) return null;

      if (actionId === 'approve') {
        return {
          id: 'approve',
          endpoint: 'POST /api/v1/approvals/' + approvalId + '/approve',
          payload: { comments: 'Approved from chat' },
          on_success: { set_state: 'approved', toast: 'Plan approved — LANA is working on it' },
          disabled_when_state: ['approved', 'rejected', 'expired', 'cancelled']
        };
      }

      if (actionId === 'edit') {
        return {
          id: 'edit',
          action_type: 'toggle_edit_mode',
          disabled_when_state: ['approved', 'rejected', 'expired', 'cancelled']
        };
      }

      if (actionId === 'cancel') {
        return {
          id: 'cancel',
          endpoint: 'POST /api/v1/approvals/' + approvalId + '/reject',
          payload: { comments: 'Cancelled from chat' },
          on_success: { set_state: 'rejected' },
          disabled_when_state: ['approved', 'rejected', 'expired', 'cancelled']
        };
      }

      return null;
    }

    /**
     * Fire an HTTP action from a descriptor endpoint string.
     * Endpoint format: "METHOD /path" (e.g. "POST /api/v1/approvals/:id/approve")
     *
     * On success: applies on_success.set_state and shows on_success.toast if set.
     *
     * @param {Object} action - Action descriptor with endpoint set
     */
    _fireEndpointAction(action) {
      var parts = action.endpoint.split(' ');
      var method = parts[0].toLowerCase();
      var path = parts.slice(1).join(' ');

      var api = global.api;
      if (!api || typeof api[method] !== 'function') {
        console.error('[lex-agentic-plan-card] global.api not available or method not supported:', method);
        return;
      }

      this._setLoading(true);

      api[method](path, action.payload || {})
        .then(() => {
          this._loading = false;

          // Apply on_success state transition
          if (action.on_success && action.on_success.set_state) {
            this.status = action.on_success.set_state;
          }

          // Show toast if requested
          if (action.on_success && action.on_success.toast) {
            if (global.Lex && global.Lex.Toast) {
              global.Lex.Toast.success(action.on_success.toast);
            }
          }

          // Re-render to apply new status and re-evaluate button disabled states
          this._performUpdate();

          // Emit legacy events for backward compatibility with pages that
          // listen to lex-plan-approved / lex-plan-rejected
          var approvalId = this.approvalId;
          if (action.id === 'approve') {
            this.emit('lex-plan-approved', { approvalId });
          } else if (action.id === 'cancel') {
            this.emit('lex-plan-rejected', { approvalId });
          }
        })
        .catch((err) => {
          console.error('[lex-agentic-plan-card] Action failed:', action.id, err);
          this._setLoading(false);
          if (global.Lex && global.Lex.Toast) {
            global.Lex.Toast.error('Action failed — please try again');
          }
        });
    }

    // ── Edit handlers ────────────────────────────────────────────────────

    _handleCancelEdit() {
      this._editing = false;
      this._performUpdate();
    }

    _handleSubmitEdit() {
      if (this._loading) return;
      var editInput = this.$('[data-ref="edit-input"]');
      var instructions = editInput ? editInput.value.trim() : '';
      if (!instructions) {
        if (global.Lex && global.Lex.Toast) global.Lex.Toast.error('Describe what to change');
        return;
      }

      this._setLoading(true);

      // Send edit as a structured chat message with plan context attached.
      // The backend detects the pending approval and treats this as a plan edit.
      var chatEl = this.closest('lex-chat');
      if (chatEl && typeof chatEl.send === 'function') {
        chatEl.send(instructions, {
          attachments: [{
            type: 'plan_edit',
            approval_id: this.approvalId,
            plan: this._plan,
            action: 'edit'
          }]
        });
        this._editing = false;
        this._loading = false;
        // The backend will emit a new plan_ready event with the updated plan
        // which will insert a new plan card — this one stays as history
        this.status = 'rejected'; // Mark old card as superseded
      } else {
        // Fallback: direct API call
        var api = global.api;
        if (api && typeof api.post === 'function') {
          api.post('/api/v1/agentic/edit-plan', {
            approval_id: this.approvalId,
            edit_instructions: instructions,
            current_plan: this._plan
          }).then(() => {
            this._editing = false;
            this._loading = false;
            this._performUpdate();
          }).catch((err) => {
            console.error('[lex-agentic-plan-card] Edit failed:', err);
            this._setLoading(false);
            if (global.Lex && global.Lex.Toast) global.Lex.Toast.error('Failed to update plan');
          });
        }
      }
    }

    /**
     * Disable/enable the action buttons while an API call is in flight.
     * @param {boolean} loading
     */
    _setLoading(loading) {
      this._loading = loading;
      // Disable/enable all action buttons generically
      var actionBtns = this.querySelectorAll('[data-action-id]');
      for (var i = 0; i < actionBtns.length; i++) {
        actionBtns[i].disabled = loading;
      }
      var submitBtn = this.$('[data-action="submit-edit"]');
      var cancelEditBtn = this.$('[data-action="cancel-edit"]');
      if (submitBtn) submitBtn.disabled = loading;
      if (cancelEditBtn) cancelEditBtn.disabled = loading;
    }
  }

  // Register and export
  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.LexAgenticPlanCard = LexAgenticPlanCard;
  defineLex('lex-agentic-plan-card', LexAgenticPlanCard);

})(typeof window !== 'undefined' ? window : globalThis);
