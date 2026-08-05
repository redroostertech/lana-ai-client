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
    bar.value = number === null ? 0 : Math.max(0, Math.min(100, number));
  }

  function normalizeProductivity(response) {
    var root = response && (response.usage || response.productivity || response.data || response);
    root = root || {};

    var tokenRoot = root.tokens || root.token_usage || {};
    var redactionRoot = root.information_redacted || root.redactions || {};
    var protectRoot = root.protect_in_research || root.protect || {};
    var chatQuota = root.chat_usage || root.chat_quota || {};

    return {
      messages: firstNumber([root.messages, root.message_count, root.total_messages, root.total_messages_sent]),
      uploads: firstNumber([root.documents_uploaded, root.upload_count, root.total_documents_uploaded]),
      conversations: firstNumber([root.conversations, root.conversation_count, root.total_conversations]),
      totalTokens: firstNumber([root.estimated_tokens, root.total_tokens, tokenRoot.total, tokenRoot.total_tokens]),
      promptTokens: firstNumber([root.prompt_tokens, root.input_tokens, tokenRoot.prompt, tokenRoot.input_tokens]),
      completionTokens: firstNumber([root.completion_tokens, root.output_tokens, tokenRoot.completion, tokenRoot.output_tokens]),
      chatPercent: firstNumber([chatQuota.percentage_used, chatQuota.usage_percent, chatQuota.percent]),
      chatDetail: chatQuota.detail || chatQuota.reset_detail || '',
      redactionTotal: firstNumber([redactionRoot.total, root.redaction_total]),
      redactionBreakdown: redactionRoot.breakdown || redactionRoot.entities || root.redaction_breakdown || null,
      protectPercent: firstNumber([protectRoot.percentage, protectRoot.percent, root.protect_percentage]),
      protectedMessages: firstNumber([protectRoot.protected, protectRoot.protected_messages]),
      researchMessages: firstNumber([protectRoot.total, protectRoot.total_messages, protectRoot.research_messages])
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
      usedFormatted: root.used_formatted || '',
      totalFormatted: root.total_formatted || ''
    };
  }

  function renderRedaction(usage) {
    setText('sv2-redaction-total', formatCount(usage.redactionTotal));
    var container = el('sv2-redaction-breakdown');
    var breakdown = usage.redactionBreakdown;
    if (!container || !breakdown || typeof breakdown !== 'object') return;

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

    if (usage.promptTokens !== null || usage.completionTokens !== null) {
      setText('sv2-token-breakdown', formatCount(usage.promptTokens || 0) + ' prompt · ' +
        formatCount(usage.completionTokens || 0) + ' completion');
    }

    if (usage.chatPercent !== null) {
      setText('sv2-chat-usage-percent', formatPercent(usage.chatPercent, 'used'));
      setProgress('sv2-chat-usage-bar', usage.chatPercent);
      if (usage.chatDetail) setText('sv2-chat-usage-detail', usage.chatDetail);
    }

    renderRedaction(usage);
    renderProtect(usage);
  }

  function renderStorage() {
    var storage = normalizeStorage(state.storage);
    setText('sv2-storage-percent', storage.percent === null ? 'Not metered' : formatPercent(storage.percent, 'used'));
    setProgress('sv2-storage-bar', storage.percent);

    if (storage.usedFormatted && storage.totalFormatted) {
      setText('sv2-storage-detail', storage.usedFormatted + ' of ' + storage.totalFormatted);
    } else if (storage.usedFormatted) {
      setText('sv2-storage-detail', storage.usedFormatted + ' used');
    } else if (storage.used !== null && storage.total !== null) {
      setText('sv2-storage-detail', formatCount(storage.used) + ' of ' + formatCount(storage.total) + ' bytes');
    } else if (storage.used !== null) {
      setText('sv2-storage-detail', formatCount(storage.used) + ' bytes used');
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
