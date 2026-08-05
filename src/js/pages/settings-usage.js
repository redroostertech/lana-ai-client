/**
 * settings-usage.js
 *
 * Renders the current user's Usage settings view from authenticated APIs:
 *   - GET /api/v1/activity/my/productivity
 *   - GET /api/v1/conversations (pagination total only)
 *   - GET /api/v1/storage/usage
 *
 * The normalizer also accepts richer usage fields when the activity endpoint
 * supplies token, quota, redaction, or Protect metrics. Until those fields are
 * present, the UI explicitly marks them unavailable instead of inventing data.
 */
(function () {
  'use strict';

  var state = {
    period: '30days',
    productivity: null,
    conversations: null,
    storage: null,
    loadedOnce: false
  };

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value;
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function firstNumber(values) {
    for (var i = 0; i < values.length; i++) {
      var value = finiteNumber(values[i]);
      if (value !== null) return value;
    }
    return null;
  }

  function formatCount(value) {
    var number = finiteNumber(value);
    return number === null ? '—' : Math.max(0, Math.round(number)).toLocaleString();
  }

  function formatPercent(value, suffix) {
    var number = finiteNumber(value);
    if (number === null) return '—';
    var bounded = Math.max(0, Math.min(100, number));
    var label = bounded > 0 && bounded < 1 ? '<1%' : Math.round(bounded) + '%';
    return suffix ? label + ' ' + suffix : label;
  }

  function setProgress(id, value) {
    var bar = el(id);
    var number = finiteNumber(value);
    if (!bar) return;
    var hasValue = number !== null;
    bar.hidden = !hasValue;
    bar.value = hasValue ? Math.max(0, Math.min(100, number)) : 0;
  }

  function hasOwn(object, key) {
    return !!object && Object.prototype.hasOwnProperty.call(object, key);
  }

  function firstOwnNumber(object, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (!hasOwn(object, keys[i])) continue;
      var value = finiteNumber(object[keys[i]]);
      if (value !== null) return value;
    }
    return null;
  }

  function normalizeProductivity(response) {
    var root = response && (response.usage || response.productivity || response.data || response);
    root = root || {};

    var tokenRoot = root.tokens || root.token_usage || {};
    var redactionRoot = root.information_redacted || root.redactions || {};
    var protectRoot = root.protect_in_research || root.protect || {};
    var chatQuota = root.chat_usage || root.chat_quota || {};

    return {
      period: root.period || null,
      periodStart: root.period_start || root.periodStart || null,
      periodEnd: root.period_end || root.periodEnd || null,
      messages: firstNumber([root.messages, root.message_count, root.total_messages, root.total_messages_sent]),
      uploads: firstNumber([root.documents_uploaded, root.upload_count, root.total_documents_uploaded]),
      conversations: firstNumber([root.conversations, root.conversation_count, root.total_conversations]),
      totalTokens: firstNumber([
        firstOwnNumber(root, ['estimated_tokens', 'total_tokens']),
        firstOwnNumber(tokenRoot, ['total', 'total_tokens'])
      ]),
      promptTokens: firstNumber([
        firstOwnNumber(root, ['prompt_tokens', 'input_tokens']),
        firstOwnNumber(tokenRoot, ['prompt', 'input_tokens'])
      ]),
      completionTokens: firstNumber([
        firstOwnNumber(root, ['completion_tokens', 'output_tokens']),
        firstOwnNumber(tokenRoot, ['completion', 'output_tokens'])
      ]),
      chatPercent: firstNumber([chatQuota.percentage_used, chatQuota.usage_percent, chatQuota.percent]),
      chatDetail: chatQuota.detail || chatQuota.reset_detail || '',
      redactionTotal: firstNumber([
        firstOwnNumber(redactionRoot, ['total']),
        firstOwnNumber(root, ['redaction_total'])
      ]),
      redactionBreakdown: redactionRoot.breakdown || redactionRoot.entities || root.redaction_breakdown || null,
      protectPercent: firstNumber([
        firstOwnNumber(protectRoot, ['percentage', 'percent']),
        firstOwnNumber(root, ['protect_percentage'])
      ]),
      protectedMessages: firstOwnNumber(protectRoot, ['protected', 'protected_messages']),
      researchMessages: firstOwnNumber(protectRoot, ['total', 'total_messages', 'research_messages'])
    };
  }

  function normalizeStorage(response) {
    var root = response && (response.storage || response.data || response);
    root = root || {};
    var used = firstNumber([root.used_bytes, root.bytes_used]);
    var total = firstNumber([root.total_bytes, root.limit_bytes, root.quota_bytes]);
    var percent = firstNumber([root.percentage_used, root.usage_percent, root.percentage]);

    if (used !== null && total && total > 0) percent = (used / total) * 100;

    return {
      used: used,
      total: total,
      percent: percent,
      scope: root.usage_scope || root.scope || (root.user_id ? 'user' : (root.organization_id ? 'organization' : 'user')),
      usedFormatted: root.used_formatted || '',
      totalFormatted: root.total_formatted || ''
    };
  }

  function renderRedaction(usage) {
    setText('sv2-redaction-total', formatCount(usage.redactionTotal));
    var container = el('sv2-redaction-breakdown');
    var breakdown = usage.redactionBreakdown;
    if (!container) return;

    if (!breakdown || typeof breakdown !== 'object') {
      container.textContent = '';
      var unavailable = document.createElement('span');
      unavailable.className = 'sv2-usage-unavailable';
      unavailable.textContent = 'Redaction telemetry is not available for this account.';
      container.appendChild(unavailable);
      return;
    }

    while (container.firstChild) container.removeChild(container.firstChild);
    var keys = Object.keys(breakdown);
    if (!keys.length) {
      var empty = document.createElement('span');
      empty.className = 'sv2-usage-unavailable';
      empty.textContent = 'No redaction activity in this period.';
      container.appendChild(empty);
      return;
    }

    keys.forEach(function (key) {
      var row = document.createElement('div');
      var label = document.createElement('span');
      var count = document.createElement('strong');
      row.className = 'sv2-usage-breakdown-row';
      label.className = 'sv2-usage-breakdown-label';
      label.textContent = key.split('_').join(' ');
      count.textContent = formatCount(breakdown[key]);
      row.appendChild(label);
      row.appendChild(count);
      container.appendChild(row);
    });
  }

  function renderProtect(usage) {
    setText('sv2-protect-percent', formatPercent(usage.protectPercent));
    if (usage.protectedMessages !== null && usage.researchMessages !== null) {
      setText('sv2-protect-detail', formatCount(usage.protectedMessages) + ' of ' +
        formatCount(usage.researchMessages) + ' research messages protected');
    } else {
      setText('sv2-protect-detail', 'Protection telemetry is not available for this account.');
    }
  }

  function renderProductivity() {
    var usage = normalizeProductivity(state.productivity);
    var conversationTotal = usage.conversations;
    if (conversationTotal === null && state.conversations) {
      var pagination = state.conversations.pagination ||
        (state.conversations.data && state.conversations.data.pagination) || {};
      conversationTotal = firstNumber([pagination.total, state.conversations.total]);
    }

    setText('sv2-message-count', formatCount(usage.messages));
    setText('sv2-upload-count', formatCount(usage.uploads));
    setText('sv2-conversation-count', formatCount(conversationTotal));
    setText('sv2-estimated-tokens', formatCount(usage.totalTokens));
    setText('sv2-message-detail', usage.period ? 'In selected period' : 'Recent activity');
    setText('sv2-upload-detail', usage.period ? 'In selected period' : 'Recent activity');
    setText('sv2-conversation-detail', usage.conversations === null && conversationTotal !== null
      ? 'All-time total'
      : 'In selected period');
    setText('sv2-token-breakdown', 'Token detail unavailable');

    if (usage.promptTokens !== null || usage.completionTokens !== null) {
      setText('sv2-token-breakdown', formatCount(usage.promptTokens || 0) + ' prompt · ' +
        formatCount(usage.completionTokens || 0) + ' completion');
    }

    if (usage.chatPercent !== null) {
      setText('sv2-chat-usage-percent', formatPercent(usage.chatPercent, 'used'));
      setProgress('sv2-chat-usage-bar', usage.chatPercent);
      if (usage.chatDetail) setText('sv2-chat-usage-detail', usage.chatDetail);
    } else {
      setText('sv2-chat-usage-percent', 'Not metered');
      setText('sv2-chat-usage-detail', 'Your current plan does not report a chat limit.');
      setProgress('sv2-chat-usage-bar', null);
    }

    renderRedaction(usage);
    renderProtect(usage);
  }

  function renderStorage() {
    var storage = normalizeStorage(state.storage);
    var isOrganizationScope = storage.scope === 'organization';
    setText('sv2-storage-label', isOrganizationScope ? 'Organization storage quota' : 'Your stored files');
    setText('sv2-storage-percent', storage.percent === null ? 'Not metered' : formatPercent(storage.percent, 'used'));
    setProgress('sv2-storage-bar', storage.percent);

    if (storage.usedFormatted && storage.totalFormatted) {
      setText('sv2-storage-detail', storage.usedFormatted + ' of ' + storage.totalFormatted +
        (isOrganizationScope ? ' used across your organization.' : ''));
    } else if (storage.usedFormatted) {
      setText('sv2-storage-detail', storage.usedFormatted + ' used. Personal storage quota is not metered.');
    } else if (storage.used !== null && storage.total !== null) {
      setText('sv2-storage-detail', formatCount(storage.used) + ' of ' + formatCount(storage.total) +
        ' bytes' + (isOrganizationScope ? ' across your organization.' : ''));
    } else if (storage.used !== null) {
      setText('sv2-storage-detail', formatCount(storage.used) + ' bytes used. Personal storage quota is not metered.');
    } else {
      setText('sv2-storage-detail', 'Storage usage unavailable');
    }
  }

  function injectIcons() {
    if (!window.Lex || !window.Lex.Icons) return;
    var slots = document.querySelectorAll('[data-usage-icon]');
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].innerHTML) continue;
      var name = slots[i].getAttribute('data-usage-icon');
      try {
        slots[i].innerHTML = Lex.Icons.get({ name: name, size: 'small' });
      } catch (error) { /* The text label remains accessible without an icon. */ }
    }
  }

  function revealTeamUsageForAdmins() {
    var user = window.api && window.api.user;
    var roles = user && (user.roles || user.role_names || []);
    if (!Array.isArray(roles)) roles = [roles];
    var names = roles.map(function (role) {
      return String(role && (role.name || role.role_name || role) || '').toLowerCase();
    });
    var directRole = String(user && (user.role_name || user.role) || '').toLowerCase();
    var isAdmin = directRole.indexOf('admin') !== -1 || names.some(function (name) {
      return name.indexOf('admin') !== -1;
    });
    var link = el('sv2-team-usage-link');
    if (link && isAdmin) link.classList.remove('sv2-hidden');
  }

  function finishLoading(failedCount) {
    var section = el('sv2-section-usage');
    if (section) section.setAttribute('aria-busy', 'false');
    if (window.Lex && Lex.Redact && section) Lex.Redact.off(section);
    setText('sv2-usage-status', failedCount ? 'Some usage details could not be loaded.' : '');
    state.loadedOnce = true;
  }

  function loadUsage() {
    var api = window.api;
    var section = el('sv2-section-usage');
    if (!api || !section) return;
    section.setAttribute('aria-busy', 'true');
    if (!state.loadedOnce && window.Lex && Lex.Redact) Lex.Redact.on(section);

    var requests = [
      api.getMyProductivity(state.period),
      api.getMyConversationUsageSummary(),
      api.getStorageUsage()
    ];

    Promise.allSettled(requests).then(function (results) {
      var failed = 0;
      if (results[0].status === 'fulfilled') state.productivity = results[0].value;
      else failed++;
      if (results[1].status === 'fulfilled') state.conversations = results[1].value;
      else failed++;
      if (results[2].status === 'fulfilled') state.storage = results[2].value;
      else failed++;

      renderProductivity();
      renderStorage();
      finishLoading(failed);
    });
  }

  function bindPeriod() {
    var period = el('sv2-usage-period');
    if (!period || period.getAttribute('data-usage-bound') === 'true') return;
    period.setAttribute('data-usage-bound', 'true');
    period.addEventListener('lex-change', function (event) {
      var next = event && event.detail && event.detail.value;
      if (!next || next === state.period) return;
      state.period = next;
      loadUsage();
    });
  }

  function boot() {
    if (!el('sv2-section-usage')) return;
    injectIcons();
    bindPeriod();
    revealTeamUsageForAdmins();
    loadUsage();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
