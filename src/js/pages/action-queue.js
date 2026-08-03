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
   * Check if an action queue item is a low-severity informational BI finding
   * that qualifies for auto-acknowledge or digest generation.
   * @param {Object} item
   * @returns {boolean}
   */
  function isInformationalItem(item) {
    if (!item) return false;
    var sev = String(item.severity || '').toLowerCase();
    if (sev !== 'low' && sev !== 'medium') return false;
    // Must be a non-lana (human) type
    if (isLanaAction(item)) return false;
    // Must be an alert type (BI findings come through as alerts)
    if (item.action_type !== 'alert') return false;
    return true;
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
    if (ctx.suggested_action) return ctx.suggested_action;
    // Generic plugin context nests data inside findings[]
    if (ctx.findings && ctx.findings.length > 0 && ctx.findings[0].suggested_action) {
      return ctx.findings[0].suggested_action;
    }
    return null;
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

  // =========================================================================
  // BI Pulse detail helpers — render rich item labels from BI plugin shapes
  // =========================================================================

  /**
   * Format a connector_id for display — strip UUID prefix if present.
   * @param {string} connectorId
   * @returns {string}
   */
  function _formatConnectorId(connectorId) {
    if (!connectorId) return 'Unknown connector';
    // If it looks like a UUID, show first 8 chars; otherwise show as-is
    if (connectorId.length === 36 && connectorId.indexOf('-') === 8) {
      return 'Connector ' + connectorId.slice(0, 8);
    }
    return connectorId;
  }

  /**
   * Format an entity_type slug as a readable label.
   * @param {string} entityType
   * @returns {string}
   */
  function _formatEntityType(entityType) {
    if (!entityType) return '';
    return entityType.split('_').join(' ');
  }

  /**
   * Determine the section heading for the items list based on sub_check.
   * Falls back to "Affected Items" when no specific heading applies.
   * @param {string} subCheck
   * @param {Object} sa — suggested_action
   * @returns {string}
   */
  function _biSectionTitle(subCheck, sa) {
    if (!subCheck) return 'Affected Matters';

    // Connector data intelligence
    if (subCheck === 'pending_staging_review')     return 'Pending Review by Source';
    if (subCheck === 'expiring_staging_data')      return 'Expiring Records by Source';
    if (subCheck === 'data_volume_trends')         return 'Connector Sync Volume (7 days)';
    if (subCheck === 'failed_record_accumulation') return 'Failed Records by Connector';
    if (subCheck === 'unlinked_connector_data')    return 'Unlinked Records by Source';
    if (subCheck === 'entity_distribution_health') return 'Entity Distribution by Connector';

    // CRM intelligence
    if (subCheck === 'new_contacts_unlinked')       return 'Unlinked Contacts';
    if (subCheck === 'stale_leads')                 return 'Stale Leads';
    if (subCheck === 'pipeline_snapshot')            return 'Pipeline Stages';
    if (subCheck === 'campaign_performance')         return 'Campaign Metrics';
    if (subCheck === 'contact_coverage_gaps')        return 'Matters Without Contacts';
    if (subCheck === 'orphaned_connector_contacts')  return 'Orphaned Contacts by Connector';

    // Financial intelligence
    if (subCheck === 'unbilled_time')       return 'Unbilled Time by Matter';
    if (subCheck === 'overdue_invoices')    return 'Overdue Invoice Aging';
    if (subCheck === 'trust_balance_alerts') return 'Trust Account Alerts';
    if (subCheck === 'budget_adherence')    return 'Budget Status by Matter';
    if (subCheck === 'payment_velocity')    return 'Payment Trends';
    if (subCheck === 'expiring_estimates')  return 'Expiring Estimates';

    // Work intelligence
    if (subCheck === 'upcoming_deadlines')   return 'Upcoming Deadlines';
    if (subCheck === 'overdue_milestones')   return 'Overdue Milestones';
    if (subCheck === 'checklist_completion') return 'Checklist Progress';
    if (subCheck === 'communication_trends') return 'Communication Activity';
    if (subCheck === 'unassigned_tasks')     return 'Unassigned Tasks';
    if (subCheck === 'project_health')       return 'Project Status';

    // Document intelligence
    if (subCheck === 'unprocessed_documents')      return 'Unprocessed Documents by Matter';
    if (subCheck === 'recent_generation_activity')  return 'Document Generation Activity';
    if (subCheck === 'storage_concentration')       return 'Storage Distribution by Matter';
    if (subCheck === 'batch_upload_health')         return 'Batch Upload Status';
    if (subCheck === 'version_activity')            return 'Version Activity';
    if (subCheck === 'annotation_gaps')             return 'Documents Missing Annotations';

    // Conversation intelligence
    if (subCheck === 'ai_adoption_trends')        return 'AI Usage Trends';
    if (subCheck === 'token_usage_trends')         return 'Token Usage';
    if (subCheck === 'negative_feedback_signals')  return 'Negative Feedback';
    if (subCheck === 'retrieval_quality')           return 'Retrieval Quality Issues';
    if (subCheck === 'stale_threads')              return 'Stale Conversation Threads';
    if (subCheck === 'memory_utilization')          return 'Memory Usage';

    // Matter intelligence (existing)
    if (subCheck === 'staleness_check')    return 'Stale Matters';
    if (subCheck === 'unreviewed_docs')    return 'Documents Needing Review';
    if (subCheck === 'task_health')        return 'Overdue Tasks';
    if (subCheck === 'engagement_drop')    return 'Engagement Changes';
    if (subCheck === 'profile_freshness')  return 'Stale Profiles';
    if (subCheck === 'quick_wins')         return 'Quick Win Opportunities';
    if (subCheck === 'matter_completeness') return 'Incomplete Matters';

    return 'Affected Items';
  }

  /**
   * Derive a human-readable label for an item based on its shape.
   * BI plugins produce items with varying fields — this function detects
   * the shape and produces the best label.
   * @param {Object} item
   * @param {number} index
   * @returns {string}
   */
  function _biItemLabel(item, index) {
    if (!item) return 'Item ' + (index + 1);

    // Matter-based items (matter_intelligence, financial, document, CRM coverage)
    if (item.matter_name) return item.matter_name;

    // Task/milestone/checklist/project items with titles
    if (item.title) return item.title;
    if (item.name) return item.name;

    // Document items
    if (item.filename) return item.filename;

    // CRM contact items
    if (item.contact_name) return item.contact_name;
    if (item.contact_id) return 'Contact ' + String(item.contact_id).slice(0, 8);

    // CRM lead items
    if (item.lead_name) return item.lead_name;
    if (item.lead_id) return 'Lead ' + String(item.lead_id).slice(0, 8);

    // CRM opportunity/pipeline items
    if (item.stage_name) return item.stage_name;
    if (item.stage) return item.stage;
    if (item.opportunity_id) return 'Opportunity ' + String(item.opportunity_id).slice(0, 8);

    // Financial aging bucket
    if (item.aging_bucket) return item.aging_bucket;

    // Financial estimate
    if (item.estimate_id) return 'Estimate ' + String(item.estimate_id).slice(0, 8);

    // Connector + entity type items
    if (item.connector_id && item.entity_type) {
      return _formatConnectorId(item.connector_id) + ' \u2014 ' + _formatEntityType(item.entity_type);
    }
    if (item.connector_id) return _formatConnectorId(item.connector_id);

    // Conversation items
    if (item.conversation_id) return 'Thread ' + String(item.conversation_id).slice(0, 8);

    // Batch upload items
    if (item.batch_id) return 'Batch ' + String(item.batch_id).slice(0, 8);

    // Work items with IDs
    if (item.task_id) return 'Task ' + String(item.task_id).slice(0, 8);
    if (item.milestone_id) return 'Milestone ' + String(item.milestone_id).slice(0, 8);
    if (item.checklist_id) return 'Checklist ' + String(item.checklist_id).slice(0, 8);
    if (item.project_id) return 'Project ' + String(item.project_id).slice(0, 8);
    if (item.document_id) return 'Document ' + String(item.document_id).slice(0, 8);

    // UUID-based matter_id without name
    if (item.matter_id) return 'Matter ' + String(item.matter_id).slice(0, 8);

    return 'Item ' + (index + 1);
  }

  /**
   * Build metadata line for an item based on its fields.
   * Returns empty string if no meaningful metadata is available.
   * @param {Object} item
   * @param {string} subCheck
   * @returns {string}
   */
  function _biItemMeta(item, subCheck) {
    if (!item) return '';
    var parts = [];

    // Counts — most BI items have some kind of count
    if (item.count !== undefined && item.count !== null) {
      parts.push(item.count + ' record' + (item.count !== 1 ? 's' : ''));
    }
    if (item.pending_count !== undefined) {
      parts.push(item.pending_count + ' pending');
    }
    if (item.failed_count !== undefined) {
      parts.push(item.failed_count + ' failed');
    }
    if (item.doc_count !== undefined) {
      parts.push(item.doc_count + ' document' + (item.doc_count !== 1 ? 's' : ''));
    }
    if (item.unlinked_count !== undefined) {
      parts.push(item.unlinked_count + ' unlinked');
    }
    if (item.expiring_count !== undefined) {
      parts.push(item.expiring_count + ' expiring');
    }

    // Trend data (data_volume_trends)
    if (item.current_count !== undefined && item.prior_count !== undefined) {
      parts.push('This week: ' + item.current_count + ' \u00b7 Last week: ' + item.prior_count);
      if (item.change_percent !== undefined) {
        var sign = item.change_percent >= 0 ? '+' : '';
        parts.push(sign + item.change_percent + '% change');
      }
    }

    // Entity types list (entity_distribution_health)
    if (item.entity_types && item.entity_types.length > 0) {
      var typeLabels = [];
      for (var t = 0; t < item.entity_types.length && t < 5; t++) {
        typeLabels.push(_formatEntityType(item.entity_types[t]));
      }
      var typeSuffix = item.entity_types.length > 5 ? ' +' + (item.entity_types.length - 5) + ' more' : '';
      parts.push(typeLabels.join(', ') + typeSuffix);
    }
    if (item.total_records !== undefined) {
      parts.push(item.total_records + ' total records');
    }

    // Expiry dates
    if (item.earliest_expiry) {
      parts.push('Earliest expiry: ' + formatShortDate(item.earliest_expiry));
    }

    // Financial metadata
    if (item.total_hours !== undefined) {
      parts.push(item.total_hours + ' hours');
    }
    if (item.total_amount !== undefined) {
      parts.push('$' + Number(item.total_amount).toLocaleString());
    }
    if (item.invoice_count !== undefined) {
      parts.push(item.invoice_count + ' invoice' + (item.invoice_count !== 1 ? 's' : ''));
    }
    if (item.budget_pct !== undefined) {
      parts.push(item.budget_pct + '% of budget used');
    }
    if (item.expires_at) {
      parts.push('Expires ' + formatShortDate(item.expires_at));
    }
    if (item.avg_days_to_pay !== undefined) {
      parts.push('Avg ' + item.avg_days_to_pay + ' days to pay');
    }

    // Matter intelligence metadata
    if (item.completeness_pct !== undefined) {
      parts.push(item.completeness_pct + '% complete');
    }
    if (item.missing_fields && item.missing_fields.length > 0) {
      parts.push('Missing: ' + item.missing_fields.join(', '));
    }
    if (item.due_date) {
      parts.push('Due ' + formatShortDate(item.due_date));
    }
    if (item.days_since_activity !== undefined) {
      parts.push(item.days_since_activity + ' days inactive');
    }

    // Work intelligence
    if (item.completion_pct !== undefined) {
      parts.push(item.completion_pct + '% complete');
    }
    if (item.assigned_to) {
      parts.push('Assigned to ' + item.assigned_to);
    }
    if (item.status) {
      parts.push(item.status);
    }
    if (item.type && !item.entity_type) {
      parts.push(_formatEntityType(item.type));
    }

    // Conversation intelligence
    if (item.message_count !== undefined) {
      parts.push(item.message_count + ' message' + (item.message_count !== 1 ? 's' : ''));
    }
    if (item.token_count !== undefined) {
      parts.push(item.token_count.toLocaleString() + ' tokens');
    }
    if (item.last_active) {
      parts.push('Last active ' + formatShortDate(item.last_active));
    }

    return parts.join(' \u00b7 ');
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

    // Handle two context structures:
    // 1. Finding-based: { suggested_action, details, sub_check }
    // 2. Generic plugin: { findings: [{ suggested_action, message, sub_check }], ... }
    var finding = null;
    if (ctx && ctx.findings && ctx.findings.length > 0) {
      finding = ctx.findings[0];
    }

    var sa = (ctx && ctx.suggested_action) || (finding && finding.suggested_action) || null;
    var details = (ctx && ctx.details) || {};
    var subCheck = (ctx && ctx.sub_check) || '';

    // Pull message from finding if details.message is empty
    if (!details.message && finding && finding.message) {
      details = { message: finding.message };
    }

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

    // Message — prefer context.details.message, fall back to item.message
    var displayMessage = details.message || item.message || '';
    if (displayMessage) {
      bodyParts.push(
        '<p style="font-size:0.8125rem;color:var(--lex-text-secondary);line-height:1.5;margin:0 0 16px;">' +
          escHtml(displayMessage) +
        '</p>'
      );
    }

    // Resolve first matter ID from any available source
    var firstMatterId = null;
    if (sa) {
      if (sa.matter_id) firstMatterId = sa.matter_id;
      if (!firstMatterId && sa.matter_ids && sa.matter_ids.length > 0) firstMatterId = sa.matter_ids[0];
    }
    if (!firstMatterId && item.matter_id) firstMatterId = item.matter_id;

    // Items list — render differently based on sub_check type
    var hasItems = sa && sa.items && sa.items.length > 0;

    if (hasItems && subCheck === 'unreviewed_docs') {
      // ── Unreviewed documents: group by matter, show filenames ──
      var matterGroups = {};
      for (var k = 0; k < sa.items.length; k++) {
        var it = sa.items[k];
        var mid = it.matter_id || 'unknown';
        if (!matterGroups[mid]) {
          matterGroups[mid] = { name: it.matter_name || 'Unknown Matter', docs: [] };
        }
        matterGroups[mid].docs.push(it);
        if (!firstMatterId && mid !== 'unknown') firstMatterId = mid;
      }

      bodyParts.push('<div style="margin-bottom:16px;">');
      bodyParts.push(
        '<div style="font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--lex-text-tertiary);font-weight:500;margin-bottom:8px;">Documents Needing Review</div>'
      );

      var matterKeys = Object.keys(matterGroups);
      for (var m = 0; m < matterKeys.length; m++) {
        var mKey = matterKeys[m];
        var group = matterGroups[mKey];

        // Matter header row (clickable)
        bodyParts.push(
          '<div class="lex-detail-matter-row" style="padding:8px 0;border-bottom:1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));cursor:pointer;transition:background 0.15s ease;" data-matter-id="' + escHtml(mKey) + '">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
              '<div style="font-size:0.8125rem;font-weight:500;color:var(--lex-text-primary);">' + escHtml(group.name) + '</div>' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.3;flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>' +
            '</div>' +
          '</div>'
        );

        // Document rows under this matter
        for (var d = 0; d < group.docs.length; d++) {
          var doc = group.docs[d];
          var docName = escHtml(doc.filename || 'Untitled Document');
          var docMeta = doc.uploaded_at ? 'Uploaded ' + escHtml(timeAgo(doc.uploaded_at)) : '';

          bodyParts.push(
            '<div style="padding:6px 0 6px 16px;border-bottom:1px solid var(--lex-border-subtle, rgba(0,0,0,0.04));">' +
              '<div style="display:flex;align-items:center;gap:6px;">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--lex-text-tertiary);flex-shrink:0;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
                '<span style="font-size:0.8125rem;color:var(--lex-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + docName + '</span>' +
              '</div>' +
              (docMeta ? '<div style="font-size:0.6875rem;color:var(--lex-text-tertiary);margin-top:1px;padding-left:20px;">' + docMeta + '</div>' : '') +
            '</div>'
          );
        }
      }

      // Total count
      if (sa.total_count && sa.total_count > sa.items.length) {
        bodyParts.push(
          '<div style="font-size:0.6875rem;color:var(--lex-text-tertiary);padding:8px 0;text-align:center;">Showing ' + sa.items.length + ' of ' + sa.total_count + ' documents</div>'
        );
      }

      bodyParts.push('</div>');

    } else if (hasItems) {
      // ── Smart items renderer — detects item shape and renders rich detail ──
      var sectionTitle = _biSectionTitle(subCheck, sa);
      bodyParts.push('<div style="margin-bottom:16px;">');
      bodyParts.push(
        '<div style="font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--lex-text-tertiary);font-weight:500;margin-bottom:8px;">' + escHtml(sectionTitle) + '</div>'
      );

      for (var k2 = 0; k2 < sa.items.length; k2++) {
        var it2 = sa.items[k2];
        var itemLabel = _biItemLabel(it2, k2);
        var itemMeta = _biItemMeta(it2, subCheck);
        var matterId = it2.matter_id || '';

        if (!firstMatterId && matterId) firstMatterId = matterId;

        var rowStyle = 'padding:8px 0;border-bottom:1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));';
        if (matterId) {
          rowStyle += 'cursor:pointer;transition:background 0.15s ease;';
        }

        bodyParts.push(
          '<div class="lex-detail-matter-row" style="' + rowStyle + '"' +
            (matterId ? ' data-matter-id="' + escHtml(matterId) + '"' : '') + '>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
              '<div style="font-size:0.8125rem;color:var(--lex-text-primary);">' + escHtml(itemLabel) + '</div>' +
              (matterId ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.3;flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>' : '') +
            '</div>' +
            (itemMeta ? '<div style="font-size:0.6875rem;color:var(--lex-text-tertiary);margin-top:2px;">' + escHtml(itemMeta) + '</div>' : '') +
          '</div>'
        );
      }

      // Total count when items are truncated
      if (sa.total_count && sa.total_count > sa.items.length) {
        bodyParts.push(
          '<div style="font-size:0.6875rem;color:var(--lex-text-tertiary);padding:8px 0;text-align:center;">Showing ' + sa.items.length + ' of ' + sa.total_count + ' items</div>'
        );
      }

      bodyParts.push('</div>');
    }

    // Fallback: when items are empty but matter_ids exist, show clickable matter links
    if (!hasItems && sa && sa.matter_ids && sa.matter_ids.length > 0) {
      var docCount = sa.total_count || sa.matter_ids.length;
      bodyParts.push('<div style="margin-bottom:16px;">');
      bodyParts.push(
        '<div style="font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--lex-text-tertiary);font-weight:500;margin-bottom:8px;">Affected Matters (' + docCount + ' document' + (docCount !== 1 ? 's' : '') + ')</div>'
      );

      for (var mi = 0; mi < sa.matter_ids.length; mi++) {
        var mId = sa.matter_ids[mi];
        if (!firstMatterId) firstMatterId = mId;

        bodyParts.push(
          '<div class="lex-detail-matter-row" style="padding:10px 0;border-bottom:1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));cursor:pointer;transition:background 0.15s ease;" data-matter-id="' + escHtml(mId) + '">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--lex-text-tertiary);flex-shrink:0;"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>' +
                '<span style="font-size:0.8125rem;color:var(--lex-text-primary);">' + escHtml(mId) + '</span>' +
              '</div>' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.3;flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>' +
            '</div>' +
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

    // Auto-acknowledge + Generate Digest buttons for informational items
    if (item.action_type === 'alert' && !isLanaAction(item)) {
      var itemSev = String(item.severity || '').toLowerCase();
      if (itemSev === 'low' || itemSev === 'medium' || itemSev === 'info') {
        var itemEntityId = item.entity_id || item.id || '';
        var itemActionType = item.action_type || 'alert';

        bodyParts.push(
          '<div style="margin-top:16px;display:flex;gap:8px;">' +
            '<button class="lex-detail-auto-ack-btn" data-ack-entity-id="' + escHtml(String(itemEntityId)) + '" data-ack-action-type="' + escHtml(itemActionType) + '" style="' +
              'flex:1;display:flex;align-items:center;justify-content:center;gap:6px;' +
              'padding:8px 12px;border:1px solid var(--lex-border-subtle, rgba(0,0,0,0.12));' +
              'border-radius:var(--lex-radius-md, 6px);background:var(--lex-bg-primary);' +
              'color:var(--lex-text-secondary);font-size:0.75rem;font-weight:500;font-family:inherit;' +
              'cursor:pointer;transition:background 0.15s ease;' +
            '">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' +
              'Auto-Acknowledge' +
            '</button>' +
            '<button class="lex-detail-digest-btn" data-digest-entity-id="' + escHtml(String(itemEntityId)) + '" data-digest-action-type="' + escHtml(itemActionType) + '" style="' +
              'flex:1;display:flex;align-items:center;justify-content:center;gap:6px;' +
              'padding:8px 12px;border:1px solid var(--lex-border-subtle, rgba(0,0,0,0.12));' +
              'border-radius:var(--lex-radius-md, 6px);background:var(--lex-bg-primary);' +
              'color:var(--lex-text-secondary);font-size:0.75rem;font-weight:500;font-family:inherit;' +
              'cursor:pointer;transition:background 0.15s ease;' +
            '">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' +
              'Generate Digest' +
            '</button>' +
          '</div>'
        );
      }
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

        // Wire "Auto-Acknowledge" button in detail drawer
        var autoAckBtn = drawer.querySelector('.lex-detail-auto-ack-btn');
        if (autoAckBtn) {
          autoAckBtn.addEventListener('mouseenter', function () {
            this.style.background = 'var(--lex-bg-secondary, rgba(0,0,0,0.02))';
          });
          autoAckBtn.addEventListener('mouseleave', function () {
            this.style.background = 'var(--lex-bg-primary)';
          });
          autoAckBtn.addEventListener('click', function () {
            var eid = this.getAttribute('data-ack-entity-id');
            var aType = this.getAttribute('data-ack-action-type') || 'alert';
            if (!eid) return;

            this.textContent = 'Acknowledging...';
            this.style.pointerEvents = 'none';

            api.post(
              '/api/v1/action-queue/' + encodeURIComponent(aType) + '/' + encodeURIComponent(eid) + '/auto-acknowledge',
              {}
            ).then(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) {
                Lex.Toast.show('Auto-acknowledged', 'success');
              }
              Lex.Drawer.close();
              loadActionQueue();
            }).catch(function (err) {
              console.warn('[ActionQueue] Auto-acknowledge from drawer failed:', err && err.message);
              if (typeof Lex !== 'undefined' && Lex.Toast) {
                Lex.Toast.show('Could not auto-acknowledge', 'error');
              }
            });
          });
        }

        // Wire "Generate Digest" button in detail drawer
        var digestBtn = drawer.querySelector('.lex-detail-digest-btn');
        if (digestBtn) {
          digestBtn.addEventListener('mouseenter', function () {
            this.style.background = 'var(--lex-bg-secondary, rgba(0,0,0,0.02))';
          });
          digestBtn.addEventListener('mouseleave', function () {
            this.style.background = 'var(--lex-bg-primary)';
          });
          digestBtn.addEventListener('click', function () {
            var eid = this.getAttribute('data-digest-entity-id');
            var aType = this.getAttribute('data-digest-action-type') || 'alert';
            if (!eid) return;

            this.textContent = 'Generating...';
            this.style.pointerEvents = 'none';

            api.post(
              '/api/v1/action-queue/' + encodeURIComponent(aType) + '/' + encodeURIComponent(eid) + '/generate-digest',
              {}
            ).then(function (result) {
              var digestText = (result && result.data && result.data.digest) || '';
              Lex.Drawer.close();

              if (digestText) {
                Lex.Modal.open({
                  heading: 'BI Digest',
                  content:
                    '<div style="white-space:pre-wrap;font-size:0.8125rem;line-height:1.6;color:var(--lex-text-secondary);max-height:400px;overflow-y:auto;">' +
                      escHtml(digestText) +
                    '</div>',
                  hideActions: false,
                  confirmText: 'Done',
                  size: 'md'
                });
              }

              if (typeof Lex !== 'undefined' && Lex.Toast) {
                Lex.Toast.show('Digest generated', 'success');
              }
              loadActionQueue();
            }).catch(function (err) {
              console.warn('[ActionQueue] Generate digest from drawer failed:', err && err.message);
              if (typeof Lex !== 'undefined' && Lex.Toast) {
                Lex.Toast.show('Could not generate digest', 'error');
              }
            });
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
            if (window.NavigationHelpers && typeof window.NavigationHelpers.navigateToMatterChat === 'function') {
              window.NavigationHelpers.navigateToMatterChat(mid);
            } else {
              Lex.Nav.go('dashboard.html');
            }
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
              '&sort_by=created_at&sort_order=desc';
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

    // Empty state — contextual per active filter
    if (items.length === 0) {
      hide(cardEl);
      hide(paginationEl);

      var emptyStates = {
        '': {
          icon: 'inbox',
          message: 'No actions pending',
          description: 'Your action queue is empty. Heartbeat checks, scheduled jobs, and connector syncs will generate items here automatically.'
        },
        'alert': {
          icon: 'bell',
          message: 'No alerts',
          description: 'Alerts are generated by the heartbeat system every 60 minutes. They flag stale matters, orphaned contacts, connector issues, and other items that need your attention.'
        },
        'scheduled_task': {
          icon: 'clock',
          message: 'No scheduled jobs',
          description: 'Scheduled jobs run automatically on a recurring schedule. Create a Skill with a scheduled trigger (hourly, daily, weekly) to see upcoming jobs here.'
        },
        'approval_required': {
          icon: 'check-circle',
          message: 'No pending approvals',
          description: 'When LANA plans a multi-step action (sending emails, creating matters, updating records), it will ask for your approval here before executing.'
        },
        'sync_failure': {
          icon: 'alert-triangle',
          message: 'No sync failures',
          description: 'Connector sync failures from the last 24 hours appear here. All your connected data sources are syncing normally.'
        }
      };

      var state = emptyStates[_actionTypeFilter || ''] || emptyStates[''];
      emptyEl.innerHTML = '<lex-empty icon="' + state.icon + '" message="' + state.message + '" description="' + state.description + '"></lex-empty>';
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
      var itemMsg  = item.message || '';
      var meta     = [];
      if (matter) meta.push(matter);
      // When no matter name, derive context from suggested_action
      if (!matter && sa && sa.matter_ids && sa.matter_ids.length > 0) {
        var docCount = sa.total_count || sa.matter_ids.length;
        meta.push(docCount + ' document' + (docCount !== 1 ? 's' : ''));
        if (sa.matter_ids.length === 1) {
          meta.push(escHtml(sa.matter_ids[0]));
        } else {
          meta.push(sa.matter_ids.length + ' matter' + (sa.matter_ids.length !== 1 ? 's' : ''));
        }
      }
      if (!matter && !meta.length && itemMsg) meta.push(escHtml(itemMsg));
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
   * Handle auto-acknowledge click for informational items.
   * Acknowledges + resolves in one call, removing it from the queue.
   * @param {Element} card
   */
  async function handleAutoAcknowledge(card) {
    var actionType = card.getAttribute('data-action-type') || 'alert';
    var entityId   = card.getAttribute('data-entity-id') || card.getAttribute('data-action-id');
    if (!entityId) return;

    card.classList.add('aq-card-dismissing');

    try {
      await api.post(
        '/api/v1/action-queue/' + encodeURIComponent(actionType) + '/' + encodeURIComponent(entityId) + '/auto-acknowledge',
        {}
      );

      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.show('Auto-acknowledged', 'success');
      }
      setTimeout(function () {
        var itemsEl = el('aqItems');
        var remaining = itemsEl ? itemsEl.querySelectorAll('lex-action-card:not(.aq-card-dismissing)').length : 0;
        if (remaining === 0 && _currentPage > 1) _currentPage--;
        loadActionQueue();
      }, 350);
    } catch (err) {
      console.warn('[ActionQueue] Auto-acknowledge failed:', err && err.message);
      card.classList.remove('aq-card-dismissing');
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.show('Could not auto-acknowledge', 'error');
      }
    }
  }

  /**
   * Handle generate-digest click for informational items.
   * Generates a summary digest and resolves the item.
   * @param {Element} card
   */
  async function handleGenerateDigest(card) {
    var actionType = card.getAttribute('data-action-type') || 'alert';
    var entityId   = card.getAttribute('data-entity-id') || card.getAttribute('data-action-id');
    if (!entityId) return;

    // Show loading state
    card.classList.add('aq-card-dismissing');

    try {
      var result = await api.post(
        '/api/v1/action-queue/' + encodeURIComponent(actionType) + '/' + encodeURIComponent(entityId) + '/generate-digest',
        {}
      );

      var digestText = (result && result.data && result.data.digest) || '';

      if (digestText) {
        // Show digest in a modal
        Lex.Modal.open({
          heading: 'BI Digest',
          content:
            '<div style="white-space:pre-wrap;font-size:0.8125rem;line-height:1.6;color:var(--lex-text-secondary);max-height:400px;overflow-y:auto;">' +
              escHtml(digestText) +
            '</div>',
          hideActions: false,
          confirmText: 'Done',
          size: 'md'
        });
      }

      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.show('Digest generated and item resolved', 'success');
      }

      setTimeout(function () {
        var itemsEl = el('aqItems');
        var remaining = itemsEl ? itemsEl.querySelectorAll('lex-action-card:not(.aq-card-dismissing)').length : 0;
        if (remaining === 0 && _currentPage > 1) _currentPage--;
        loadActionQueue();
      }, 350);
    } catch (err) {
      console.warn('[ActionQueue] Generate digest failed:', err && err.message);
      card.classList.remove('aq-card-dismissing');
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.show('Could not generate digest', 'error');
      }
    }
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

      // Auto-acknowledge (informational items)
      itemsEl.addEventListener('auto-acknowledge-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (card) handleAutoAcknowledge(card);
      });

      // Generate digest (informational items)
      itemsEl.addEventListener('generate-digest-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (card) handleGenerateDigest(card);
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
