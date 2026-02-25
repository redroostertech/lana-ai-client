/* Action Queue — Full page view of all action queue items.
   Provides filtering by type and severity, pagination, dismiss, and card click routing.

   Rules:
     - NO regex anywhere — string methods only (includes, indexOf, split, etc.)
     - All HTML escaping via Lex.Utils.escapeHtml()
     - All time/date formatting via Lex.Utils.timeAgo() / Lex.Utils.formatDate()
     - IIFE wrapper to keep scope clean
*/

(function () {
  'use strict';

  // =========================================================================
  // Lex aliases
  // =========================================================================

  var escHtml    = Lex.Utils.escapeHtml;
  var timeAgo    = Lex.Utils.timeAgo;

  // =========================================================================
  // State
  // =========================================================================

  var _currentPage       = 1;
  var _pageSize          = 20;
  var _actionTypeFilter  = '';
  var _severityFilter    = '';
  var _totalItems        = 0;

  /** Cache of action queue items keyed by item ID for detail modal lookup */
  var _actionItemsMap = {};

  // =========================================================================
  // Helpers (shared logic with dashboard.js)
  // =========================================================================

  function el(id) {
    return document.getElementById(id);
  }

  function show(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.remove('hidden');
  }

  function hide(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.add('hidden');
  }

  /**
   * Check if an action queue item has a Lana-type suggested action.
   * @param {Object} item
   * @returns {boolean}
   */
  function isLanaAction(item) {
    var ctx = item.context;
    if (!ctx) return false;
    if (typeof ctx === 'string') {
      try { ctx = JSON.parse(ctx); } catch (e) { return false; }
    }
    return ctx.suggested_action && ctx.suggested_action.type === 'lana';
  }

  /**
   * Extract the suggested_action from an item's context.
   * @param {Object} item
   * @returns {Object|null}
   */
  function getSuggestedAction(item) {
    var ctx = item.context;
    if (!ctx) return null;
    if (typeof ctx === 'string') {
      try { ctx = JSON.parse(ctx); } catch (e) { return null; }
    }
    return ctx.suggested_action || null;
  }

  /**
   * Get the first matter_id from a suggested action.
   * @param {Object} action
   * @returns {string|null}
   */
  function getActionMatterId(action) {
    if (!action) return null;
    if (action.matter_id) return action.matter_id;
    if (action.matter_ids && action.matter_ids.length > 0) return action.matter_ids[0];
    return null;
  }

  /**
   * Get a severity tag label.
   * @param {string} severity
   * @returns {string}
   */
  function severityTag(severity) {
    if (!severity) return '';
    var s = String(severity).toLowerCase();
    if (s === 'critical') return 'Critical';
    if (s === 'high')     return 'High';
    if (s === 'medium')   return 'Medium';
    if (s === 'low')      return 'Low';
    return '';
  }

  /**
   * Format a date string as a short date (e.g. "Feb 20").
   */
  function formatShortDate(dateStr) {
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[d.getMonth()] + ' ' + d.getDate();
    } catch (e) {
      return dateStr;
    }
  }

  /**
   * Build and display a detail modal for an action queue item.
   * @param {Object} item — full action queue item from the API
   */
  function showActionDetail(item) {
    if (!item) return;

    var ctx = item.context;
    if (ctx && typeof ctx === 'string') {
      try { ctx = JSON.parse(ctx); } catch (e) { ctx = null; }
    }

    var sa = (ctx && ctx.suggested_action) || null;
    var details = (ctx && ctx.details) || {};
    var subCheck = (ctx && ctx.sub_check) || '';

    var sevColor = 'var(--lex-text-tertiary)';
    var sev = String(item.severity || 'low').toLowerCase();
    if (sev === 'critical' || sev === 'high') sevColor = 'var(--lex-color-danger-500, #ef4444)';
    else if (sev === 'medium') sevColor = 'var(--lex-color-warning-500, #f59e0b)';

    var subCheckLabel = '';
    if (subCheck) {
      subCheckLabel = subCheck.split('_').join(' ');
      subCheckLabel = subCheckLabel.charAt(0).toUpperCase() + subCheckLabel.slice(1);
    }

    var bodyParts = [];

    // Severity + type row
    bodyParts.push(
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + sevColor + ';flex-shrink:0;"></span>' +
        '<span style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--lex-text-tertiary);font-weight:500;">' +
          escHtml(sev) + (subCheckLabel ? ' \u00b7 ' + escHtml(subCheckLabel) : '') +
        '</span>' +
      '</div>'
    );

    // Message
    if (details.message) {
      bodyParts.push(
        '<p style="font-size:0.8125rem;color:var(--lex-text-secondary);line-height:1.5;margin:0 0 16px;">' +
          escHtml(details.message) +
        '</p>'
      );
    }

    // Resolve first matter ID from any available source
    var firstMatterId = null;
    if (sa) {
      if (sa.matter_id) firstMatterId = sa.matter_id;
      if (!firstMatterId && sa.matter_ids && sa.matter_ids.length > 0) firstMatterId = sa.matter_ids[0];
    }

    // Affected matters list
    if (sa && sa.items && sa.items.length > 0) {
      bodyParts.push('<div style="margin-bottom:16px;">');
      bodyParts.push(
        '<div style="font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--lex-text-tertiary);font-weight:500;margin-bottom:8px;">Affected Matters</div>'
      );

      for (var k = 0; k < sa.items.length; k++) {
        var it = sa.items[k];
        var itemLabel = escHtml(it.matter_name || it.title || it.filename || 'Item ' + (k + 1));
        var itemMeta = '';
        var matterId = it.matter_id || '';

        if (!firstMatterId && matterId) firstMatterId = matterId;

        if (it.completeness_pct !== undefined) {
          itemMeta = it.completeness_pct + '% complete';
        }
        if (it.missing_fields && it.missing_fields.length > 0) {
          itemMeta += (itemMeta ? ' \u00b7 ' : '') + 'Missing: ' + escHtml(it.missing_fields.join(', '));
        }
        if (it.due_date) {
          itemMeta += (itemMeta ? ' \u00b7 ' : '') + 'Due ' + escHtml(formatShortDate(it.due_date));
        }
        if (it.days_since_activity !== undefined) {
          itemMeta += (itemMeta ? ' \u00b7 ' : '') + it.days_since_activity + ' days inactive';
        }

        var rowStyle = 'padding:8px 0;border-bottom:1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));';
        if (matterId) {
          rowStyle += 'cursor:pointer;transition:background 0.15s ease;';
        }

        bodyParts.push(
          '<div class="lex-detail-matter-row" style="' + rowStyle + '"' +
            (matterId ? ' data-matter-id="' + escHtml(matterId) + '"' : '') + '>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
              '<div style="font-size:0.8125rem;color:var(--lex-text-primary);">' + itemLabel + '</div>' +
              (matterId ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.3;flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>' : '') +
            '</div>' +
            (itemMeta ? '<div style="font-size:0.6875rem;color:var(--lex-text-tertiary);margin-top:2px;">' + escHtml(itemMeta) + '</div>' : '') +
          '</div>'
        );
      }

      bodyParts.push('</div>');
    }

    // Suggested action
    if (sa) {
      var actionLabel = '';
      if (sa.type === 'lana') {
        actionLabel = 'Lana can handle this automatically';
      } else if (sa.action) {
        actionLabel = sa.action.split('_').join(' ');
        actionLabel = 'Suggested: ' + actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1);
      }
      if (actionLabel) {
        bodyParts.push(
          '<div style="font-size:0.75rem;color:var(--lex-text-secondary);padding:10px 12px;background:var(--lex-bg-secondary, rgba(0,0,0,0.02));border-radius:6px;">' +
            escHtml(actionLabel) +
          '</div>'
        );
      }
    }

    // Timestamp
    if (item.created_at) {
      bodyParts.push(
        '<div style="font-size:0.6875rem;color:var(--lex-text-tertiary);margin-top:12px;">' +
          'Created ' + escHtml(timeAgo(item.created_at)) +
        '</div>'
      );
    }

    // "Discuss with Lana" button
    if (firstMatterId) {
      var chatMatterId = firstMatterId;
      bodyParts.push(
        '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));">' +
          '<button class="lex-detail-discuss-btn" data-chat-matter-id="' + escHtml(chatMatterId) + '" style="' +
            'display:flex;align-items:center;justify-content:center;gap:6px;width:100%;' +
            'padding:10px 16px;border:1px solid var(--lex-border-subtle, rgba(0,0,0,0.12));' +
            'border-radius:var(--lex-radius-md, 6px);background:var(--lex-bg-primary);' +
            'color:var(--lex-text-primary);font-size:0.8125rem;font-weight:500;font-family:inherit;' +
            'cursor:pointer;transition:background 0.15s ease;' +
          '">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>' +
            'Discuss with Lana' +
          '</button>' +
        '</div>'
      );
    }

    var drawer = Lex.Drawer.open({
      heading: item.title || 'Action Detail',
      content: bodyParts.join(''),
      width: 'md',
      side: 'right',
      closeOnOverlay: true
    });

    // Wire matter row clicks → navigate to workspace detail
    // Use rAF to ensure the drawer's custom element lifecycle has rendered content
    if (drawer) {
      requestAnimationFrame(function () {
        var matterRows = drawer.querySelectorAll('.lex-detail-matter-row[data-matter-id]');
        for (var m = 0; m < matterRows.length; m++) {
          matterRows[m].addEventListener('click', function () {
            var mid = this.getAttribute('data-matter-id');
            if (mid) Lex.Nav.go('workspace-details.html', { params: { id: mid } });
          });
          matterRows[m].addEventListener('mouseenter', function () {
            this.style.background = 'var(--lex-bg-secondary, rgba(0,0,0,0.02))';
          });
          matterRows[m].addEventListener('mouseleave', function () {
            this.style.background = '';
          });
        }

        // Wire "Discuss with Lana" button
        var discussBtn = drawer.querySelector('.lex-detail-discuss-btn');
        if (discussBtn) {
          discussBtn.addEventListener('mouseenter', function () {
            this.style.background = 'var(--lex-bg-secondary, rgba(0,0,0,0.02))';
          });
          discussBtn.addEventListener('mouseleave', function () {
            this.style.background = 'var(--lex-bg-primary)';
          });
          discussBtn.addEventListener('click', function () {
            var mid = this.getAttribute('data-chat-matter-id');
            var prompt = (item.title || 'Action item') + ': ' + ((details && details.message) || '');
            if (sa && sa.action) {
              var actionText = sa.action.split('_').join(' ');
              prompt += ' Suggested action: ' + actionText + '.';
            }
            try { sessionStorage.setItem('lana_chat_prompt', prompt); } catch (e) { /* ignore */ }
            Lex.Nav.go('chat-v2.html', { params: { matter: mid } });
          });
        }
      });
    }
  }

  // =========================================================================
  // Data loading
  // =========================================================================

  /**
   * Load the action queue with current filters and pagination.
   * @returns {Promise<void>}
   */
  async function loadActionQueue() {
    var loadingEl    = el('aqLoading');
    var cardEl       = el('aqCard');
    var itemsEl      = el('aqItems');
    var paginationEl = el('aqPagination');
    var emptyEl      = el('aqEmpty');

    if (!itemsEl) return;

    // Build URL
    var offset = (_currentPage - 1) * _pageSize;
    var url = '/api/v1/action-queue?limit=' + _pageSize + '&offset=' + offset +
              '&sort_by=severity&sort_order=desc';
    if (_actionTypeFilter) {
      url += '&action_type=' + encodeURIComponent(_actionTypeFilter);
    }
    if (_severityFilter) {
      url += '&severity=' + encodeURIComponent(_severityFilter);
    }

    var items = [];
    _totalItems = 0;

    try {
      var result = await api.get(url);
      items = (result && (result.items || result.actions || result.data)) || [];
      // Get total count from pagination metadata
      if (result && result.pagination) {
        _totalItems = result.pagination.total || items.length;
      } else if (result && result.total !== undefined) {
        _totalItems = result.total;
      } else {
        _totalItems = items.length;
      }
    } catch (err) {
      console.warn('[ActionQueue] Could not load action queue:', err && err.message);
    }

    if (loadingEl) hide(loadingEl);

    // Empty state
    if (items.length === 0) {
      hide(cardEl);
      hide(paginationEl);
      show(emptyEl);
      return;
    }

    hide(emptyEl);

    // Cache items for detail modal lookup
    _actionItemsMap = {};
    for (var j = 0; j < items.length; j++) {
      _actionItemsMap[String(items[j].id)] = items[j];
    }

    // Render cards
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var item     = items[i];
      var sev      = item.severity || item.priority || 'low';
      var title    = escHtml(item.title || item.name || item.description || 'Untitled');
      var matter   = escHtml(item.matter_name || item.matter || '');
      var ts       = item.due_date || item.created_at || null;
      var meta     = [];
      if (matter) meta.push(matter);
      if (ts)     meta.push(escHtml(timeAgo(ts)));
      var priority = (sev === 'critical' || sev === 'high') ? 'high' : (sev === 'medium' ? 'medium' : 'low');
      // Map severity → task priority for Lana assignment (urgent, high, medium, low)
      var taskPriority = (sev === 'critical') ? 'urgent' : (sev === 'high' ? 'high' : (sev === 'medium' ? 'medium' : 'low'));

      var lana      = isLanaAction(item);
      var sa        = getSuggestedAction(item);
      var tagLabel  = severityTag(sev);

      if (lana) {
        var actionAttr = ' data-lana-action="' + escHtml(JSON.stringify(sa)) + '"';
        var metaParts = [];
        if (matter) metaParts.push(matter);
        metaParts.push('Let Lana handle this');
        if (ts) metaParts.push(escHtml(timeAgo(ts)));
        var metaStr = metaParts.join(' \u00b7 ');

        html +=
          '<lex-action-card' +
            ' title="' + title + '"' +
            ' description="' + escHtml(metaStr) + '"' +
            ' priority="' + priority + '"' +
            (tagLabel ? ' tag="' + escHtml(tagLabel) + '"' : '') +
            ' dismissible' +
            ' feedback' +
            ' data-action-id="' + escHtml(String(item.id || '')) + '"' +
            ' data-entity-id="' + escHtml(String(item.entity_id || item.id || '')) + '"' +
            ' data-action-type="' + escHtml(String(item.action_type || '')) + '"' +
            ' data-priority="' + escHtml(taskPriority) + '"' +
            actionAttr +
          '></lex-action-card>';
      } else {
        var humanMatterId = getActionMatterId(sa) || item.matter_id || '';
        var metaStr2 = meta.join(' \u00b7 ');

        html +=
          '<lex-action-card' +
            ' title="' + title + '"' +
            ' description="' + escHtml(metaStr2) + '"' +
            ' priority="' + priority + '"' +
            (tagLabel ? ' tag="' + escHtml(tagLabel) + '"' : '') +
            ' dismissible' +
            ' feedback' +
            ' data-action-id="' + escHtml(String(item.id || '')) + '"' +
            ' data-entity-id="' + escHtml(String(item.entity_id || item.id || '')) + '"' +
            ' data-action-type="' + escHtml(String(item.action_type || '')) + '"' +
            ' data-priority="' + escHtml(taskPriority) + '"' +
            (humanMatterId ? ' data-matter-id="' + escHtml(String(humanMatterId)) + '"' : '') +
          '></lex-action-card>';
      }
    }

    itemsEl.innerHTML = html;
    show(cardEl);

    // Update pagination
    var totalPages = Math.max(1, Math.ceil(_totalItems / _pageSize));
    if (paginationEl) {
      paginationEl.page       = _currentPage;
      paginationEl.totalPages = totalPages;
      paginationEl.total      = _totalItems;
      paginationEl.limit      = _pageSize;
      if (_totalItems > _pageSize) {
        show(paginationEl);
      } else {
        hide(paginationEl);
      }
    }
  }

  // =========================================================================
  // Event handlers
  // =========================================================================

  /**
   * Handle dismiss click on an action card.
   * @param {Element} card
   */
  async function handleDismiss(card) {
    var actionType = card.getAttribute('data-action-type') || 'alert';
    var entityId   = card.getAttribute('data-entity-id') || card.getAttribute('data-action-id');

    if (!entityId) return;

    // Animate card out
    card.classList.add('aq-card-dismissing');

    try {
      await api.patch(
        '/api/v1/action-queue/' + encodeURIComponent(actionType) + '/' + encodeURIComponent(entityId) + '/dismiss',
        {}
      );
    } catch (err) {
      console.warn('[ActionQueue] Dismiss failed:', err && err.message);
      // Remove animation class on failure
      card.classList.remove('aq-card-dismissing');
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.show('Could not dismiss action', 'error');
      }
      return;
    }

    // Wait for animation, then reload
    setTimeout(function () {
      var itemsEl = el('aqItems');
      var remaining = itemsEl ? itemsEl.querySelectorAll('lex-action-card:not(.aq-card-dismissing)').length : 0;

      if (remaining === 0 && _currentPage > 1) {
        _currentPage--;
      }
      loadActionQueue();
    }, 350);
  }

  /**
   * Handle accept-click on a feedback button.
   * Marks the item as acknowledged.
   * @param {Element} card
   */
  async function handleAccept(card) {
    var actionType = card.getAttribute('data-action-type') || 'alert';
    var entityId   = card.getAttribute('data-entity-id') || card.getAttribute('data-action-id');
    if (!entityId) return;

    // Resolve matter context from cached item
    var itemId = card.getAttribute('data-action-id');
    var cached = itemId ? _actionItemsMap[itemId] : null;
    var sa     = cached ? getSuggestedAction(cached) : null;
    var title  = cached ? (cached.title || '') : '';

    // Collect all matter IDs for this action
    var matterIds = [];
    if (sa) {
      if (sa.matter_ids && sa.matter_ids.length) {
        matterIds = sa.matter_ids;
      } else if (sa.matter_id) {
        matterIds = [sa.matter_id];
      }
      if (sa.items && sa.items.length) {
        for (var k = 0; k < sa.items.length; k++) {
          var mid = sa.items[k].matter_id || sa.items[k].matterId;
          if (mid && matterIds.indexOf(mid) === -1) matterIds.push(mid);
        }
      }
    }
    if (!matterIds.length && cached && cached.matter_id) {
      matterIds = [cached.matter_id];
    }

    card.classList.add('aq-card-dismissing');

    try {
      await api.patch(
        '/api/v1/action-queue/' + encodeURIComponent(actionType) + '/' + encodeURIComponent(entityId) + '/acknowledge',
        {}
      );

      // Create a task on each related matter so it's trackable
      var taskDescription = sa && sa.action ? sa.action : (cached && cached.message ? cached.message : '');
      for (var t = 0; t < matterIds.length; t++) {
        try {
          await api.post('/api/v1/matters/' + encodeURIComponent(matterIds[t]) + '/tasks', {
            title: title || 'Action queue item',
            description: taskDescription || '',
            priority: (cached && cached.severity === 'critical') ? 'high' : (cached && cached.severity ? cached.severity : 'medium'),
            status: 'pending'
          });
        } catch (taskErr) {
          console.warn('[ActionQueue] Could not create task for matter ' + matterIds[t] + ':', taskErr && taskErr.message);
        }
      }

      if (typeof Lex !== 'undefined' && Lex.Toast) {
        var toastMsg = matterIds.length > 0
          ? 'Accepted — task created on ' + matterIds.length + ' matter' + (matterIds.length > 1 ? 's' : '')
          : 'Accepted';
        Lex.Toast.show(toastMsg, 'success');
      }
      setTimeout(function () {
        var itemsEl = el('aqItems');
        var remaining = itemsEl ? itemsEl.querySelectorAll('lex-action-card:not(.aq-card-dismissing)').length : 0;
        if (remaining === 0 && _currentPage > 1) _currentPage--;
        loadActionQueue();
      }, 350);
    } catch (err) {
      console.warn('[ActionQueue] Accept failed:', err && err.message);
      card.classList.remove('aq-card-dismissing');
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.show('Could not accept action', 'error');
      }
    }
  }

  /**
   * Handle assign-click — show priority picker then assign to Lana.
   * Pre-selects priority based on alert severity, user can override.
   * @param {Element} card
   */
  function handleAssign(card) {
    var actionType = card.getAttribute('data-action-type') || 'alert';
    var entityId   = card.getAttribute('data-entity-id') || card.getAttribute('data-action-id');
    if (!entityId) return;

    // Pre-select priority from severity mapping
    var defaultPriority = card.getAttribute('data-priority') || 'medium';

    var modalContent =
      '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:var(--lex-form-font-size,0.8125rem);font-weight:var(--lex-weight-medium,500);color:var(--lex-text-primary);margin-bottom:6px;">Task Priority</label>' +
        '<select id="aqAssignPriority" style="width:100%;padding:8px 12px;font-family:inherit;font-size:var(--lex-form-font-size,0.8125rem);border:1px solid var(--lex-border-subtle,rgba(0,0,0,0.12));border-radius:var(--lex-input-radius,6px);background:var(--lex-bg-primary);color:var(--lex-text-primary);outline:none;">' +
          '<option value="urgent"' + (defaultPriority === 'urgent' ? ' selected' : '') + '>Urgent</option>' +
          '<option value="high"' + (defaultPriority === 'high' ? ' selected' : '') + '>High</option>' +
          '<option value="medium"' + (defaultPriority === 'medium' ? ' selected' : '') + '>Medium</option>' +
          '<option value="low"' + (defaultPriority === 'low' ? ' selected' : '') + '>Low</option>' +
        '</select>' +
        '<p style="font-size:0.6875rem;color:var(--lex-text-tertiary);margin-top:6px;">Higher priority tasks are executed sooner. Urgent and High start immediately.</p>' +
      '</div>';

    Lex.Modal.open({
      heading: 'Assign to Lana',
      content: modalContent,
      hideActions: false,
      confirmText: 'Assign',
      cancelText: 'Cancel',
      size: 'sm',
      onConfirm: function () {
        var priorityEl = document.getElementById('aqAssignPriority');
        var priority = priorityEl ? priorityEl.value : defaultPriority;

        card.classList.add('aq-card-dismissing');

        api.post(
          '/api/v1/action-queue/' + encodeURIComponent(actionType) + '/' + encodeURIComponent(entityId) + '/assign-to-lana',
          { priority: priority }
        ).then(function () {
          if (typeof Lex !== 'undefined' && Lex.Toast) {
            Lex.Toast.show('Queued (' + priority + ') — Lana is working on it', 'success');
          }
          setTimeout(function () {
            var itemsEl = el('aqItems');
            var remaining = itemsEl ? itemsEl.querySelectorAll('lex-action-card:not(.aq-card-dismissing)').length : 0;
            if (remaining === 0 && _currentPage > 1) _currentPage--;
            loadActionQueue();
          }, 350);
        }).catch(function (queueErr) {
          card.classList.remove('aq-card-dismissing');
          console.warn('[ActionQueue] Failed to assign to Lana:', queueErr && queueErr.message);
          if (typeof Lex !== 'undefined' && Lex.Toast) {
            var errMsg = queueErr && queueErr.message ? queueErr.message : '';
            var msg;
            if (errMsg.indexOf('Already assigned') !== -1) {
              msg = 'Already assigned to Lana';
            } else if (errMsg.indexOf('currently handling') !== -1) {
              msg = errMsg;
            } else {
              msg = 'Could not queue task — try again';
            }
            Lex.Toast.show(msg, 'error');
          }
        });
      }
    });
  }

  /**
   * Handle reject-click — open a modal for reason + suppression.
   * @param {Element} card
   */
  function handleReject(card) {
    var actionType = card.getAttribute('data-action-type') || 'alert';
    var entityId   = card.getAttribute('data-entity-id') || card.getAttribute('data-action-id');
    if (!entityId) return;

    var modalContent =
      '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:var(--lex-form-font-size,0.8125rem);font-weight:var(--lex-weight-medium,500);color:var(--lex-text-primary);margin-bottom:6px;">Reason for rejection</label>' +
        '<textarea id="aqRejectReason" rows="3" maxlength="500" placeholder="Why is this not relevant?" style="width:100%;padding:8px 12px;font-family:inherit;font-size:var(--lex-form-font-size,0.8125rem);border:1px solid var(--lex-border-subtle,rgba(0,0,0,0.12));border-radius:var(--lex-input-radius,6px);background:var(--lex-bg-primary);color:var(--lex-text-primary);resize:vertical;outline:none;"></textarea>' +
      '</div>' +
      '<div>' +
        '<label style="display:block;font-size:var(--lex-form-font-size,0.8125rem);font-weight:var(--lex-weight-medium,500);color:var(--lex-text-primary);margin-bottom:6px;">Suppress for</label>' +
        '<select id="aqRejectDays" style="padding:8px 12px;font-family:inherit;font-size:var(--lex-form-font-size,0.8125rem);border:1px solid var(--lex-border-subtle,rgba(0,0,0,0.12));border-radius:var(--lex-input-radius,6px);background:var(--lex-bg-primary);color:var(--lex-text-primary);outline:none;">' +
          '<option value="45">45 days</option>' +
          '<option value="60">60 days</option>' +
        '</select>' +
      '</div>';

    var modal = Lex.Modal.open({
      heading: 'Reject Action',
      content: modalContent,
      hideActions: false,
      confirmText: 'Reject',
      cancelText: 'Cancel',
      variant: 'danger',
      size: 'sm',
      onConfirm: function () {
        var reasonEl = document.getElementById('aqRejectReason');
        var daysEl   = document.getElementById('aqRejectDays');
        var reason   = reasonEl ? reasonEl.value.trim() : '';
        var days     = daysEl ? parseInt(daysEl.value, 10) : 45;

        if (!reason) {
          if (typeof Lex !== 'undefined' && Lex.Toast) {
            Lex.Toast.show('Please provide a reason', 'error');
          }
          return;
        }

        // Animate card out
        card.classList.add('aq-card-dismissing');

        api.patch(
          '/api/v1/action-queue/' + encodeURIComponent(actionType) + '/' + encodeURIComponent(entityId) + '/reject',
          { reason: reason, suppression_days: days }
        ).then(function () {
          if (typeof Lex !== 'undefined' && Lex.Toast) {
            Lex.Toast.show('Rejected — won\'t resurface for ' + days + ' days', 'success');
          }
          setTimeout(function () {
            var itemsContainer = el('aqItems');
            var remaining = itemsContainer ? itemsContainer.querySelectorAll('lex-action-card:not(.aq-card-dismissing)').length : 0;
            if (remaining === 0 && _currentPage > 1) {
              _currentPage--;
            }
            loadActionQueue();
          }, 350);
        }).catch(function (err) {
          console.warn('[ActionQueue] Reject failed:', err && err.message);
          card.classList.remove('aq-card-dismissing');
          if (typeof Lex !== 'undefined' && Lex.Toast) {
            Lex.Toast.show('Could not reject action', 'error');
          }
        });
      }
    });
  }

  /**
   * Wire all event listeners.
   */
  function wireEvents() {
    // Type filter (segmented control)
    var typeFilter = el('aqTypeFilter');
    if (typeFilter) {
      typeFilter.addEventListener('lex-change', function (e) {
        var val = e.detail && e.detail.value;
        _actionTypeFilter = (val === 'all') ? '' : (val || '');
        _currentPage = 1;
        Lex.Nav.updateParams({ action_type: _actionTypeFilter || null });
        loadActionQueue();
      });
    }

    // Severity filter (select)
    var severityFilter = el('aqSeverityFilter');
    if (severityFilter) {
      severityFilter.addEventListener('lex-change', function (e) {
        var val = e.detail && e.detail.value;
        _severityFilter = val || '';
        _currentPage = 1;
        Lex.Nav.updateParams({ severity: _severityFilter || null });
        loadActionQueue();
      });
    }

    // Pagination
    var paginationEl = el('aqPagination');
    if (paginationEl) {
      paginationEl.addEventListener('page-change', function (e) {
        var page = e.detail && e.detail.page;
        if (page) {
          _currentPage = page;
          loadActionQueue();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }

    // Delegated events on items container
    var itemsEl = el('aqItems');
    if (itemsEl) {
      // Dismiss click
      itemsEl.addEventListener('dismiss-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (card) handleDismiss(card);
      });

      // Action click — open detail modal
      itemsEl.addEventListener('action-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (!card) return;

        var itemId = card.getAttribute('data-action-id');
        var cached = itemId ? _actionItemsMap[itemId] : null;
        if (cached) {
          showActionDetail(cached);
        }
      });

      // Feedback: Accept
      itemsEl.addEventListener('accept-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (card) handleAccept(card);
      });

      // Feedback: Assign to Lana
      itemsEl.addEventListener('assign-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (card) handleAssign(card);
      });

      // Feedback: Reject
      itemsEl.addEventListener('reject-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (card) handleReject(card);
      });
    }
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  /**
   * Initialize the action queue page.
   */
  async function init() {
    // Read initial filter state from URL params
    var params = Lex.Nav.getParams();
    var urlType     = params.get('action_type') || '';
    var urlSeverity = params.get('severity') || '';

    if (urlType) {
      _actionTypeFilter = urlType;
      var typeFilter = el('aqTypeFilter');
      if (typeFilter) typeFilter.value = urlType;
    }

    if (urlSeverity) {
      _severityFilter = urlSeverity;
      var severityFilter = el('aqSeverityFilter');
      if (severityFilter) severityFilter.value = urlSeverity;
    }

    wireEvents();
    await loadActionQueue();
  }

  // Run
  init();

})();
