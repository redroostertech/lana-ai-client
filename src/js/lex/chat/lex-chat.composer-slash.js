/* ==========================================================================
   Lex Chat Composer Slash Commands
   Helpers for /agents:<name> and /automations:<name> typeahead + dispatch.
   ========================================================================== */

(function (root) {
  'use strict';

  const COMMANDS_ENDPOINT = '/api/v1/composer/commands';
  const DISPATCH_ENDPOINT = '/api/v1/composer/dispatch';
  const NAMESPACES = {
    agents: { type: 'agent', label: 'Agents', capability: 'agents_available' },
    automations: { type: 'automation', label: 'Automations', capability: 'automations_available' }
  };

  let catalogPromise = null;
  let catalogValue = null;

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeCatalog(raw) {
    const body = raw && raw.data ? raw.data : (raw || {});
    const capabilities = body.capabilities || {};
    return {
      agents: asArray(body.agents).map((agent) => ({
        namespace: 'agents',
        type: 'agent',
        ref: agent.slug || agent.name || '',
        value: agent.slug || agent.name || '',
        label: agent.name || agent.slug || 'Untitled agent',
        slug: agent.slug || '',
        description: agent.description || '',
        enabled: agent.enabled !== false
      })).filter((item) => item.value || item.label),
      automations: asArray(body.automations).map((automation) => ({
        namespace: 'automations',
        type: 'automation',
        ref: automation.id || automation.name || '',
        value: automation.id || automation.name || '',
        label: automation.name || automation.id || 'Untitled automation',
        id: automation.id || '',
        description: automation.description || '',
        enabled: automation.enabled !== false
      })).filter((item) => item.value || item.label),
      capabilities: {
        agents_available: capabilities.agents_available === true,
        automations_available: capabilities.automations_available === true
      }
    };
  }

  async function getCatalog(apiClient) {
    if (catalogValue) return catalogValue;
    if (!catalogPromise) {
      if (!apiClient || typeof apiClient.get !== 'function') {
        catalogPromise = Promise.resolve(normalizeCatalog({}));
      } else {
        catalogPromise = apiClient.get(COMMANDS_ENDPOINT)
          .then(normalizeCatalog)
          .catch(() => normalizeCatalog({}));
      }
    }
    catalogValue = await catalogPromise;
    return catalogValue;
  }

  function resetCatalog() {
    catalogPromise = null;
    catalogValue = null;
  }

  function namespaceForInput(value) {
    const text = String(value || '');
    const match = text.match(/^\/(agents|automations):/i);
    return match ? match[1].toLowerCase() : null;
  }

  function isDispatchCommand(value) {
    return !!namespaceForInput(value);
  }

  function detectSlashTrigger(value, caret) {
    const text = String(value || '');
    const pos = typeof caret === 'number' ? caret : text.length;
    const before = text.slice(0, pos);
    const match = before.match(/^\/(agents|automations):(.*)$/i);
    if (!match) {
      if (before === '/' || before.match(/^\/[a-z]*$/i)) {
        return { namespace: null, query: before.slice(1), mode: 'namespace' };
      }
      return null;
    }
    if (text.slice(pos).trim()) return null;
    return {
      namespace: match[1].toLowerCase(),
      query: match[2],
      mode: 'item'
    };
  }

  function namespaceSuggestions(catalog, query) {
    const q = String(query || '').toLowerCase();
    return Object.keys(NAMESPACES)
      .filter((namespace) => {
        const meta = NAMESPACES[namespace];
        if (!catalog.capabilities[meta.capability]) return false;
        return !q || namespace.indexOf(q) === 0;
      })
      .map((namespace) => ({
        namespace,
        type: NAMESPACES[namespace].type,
        label: '/' + namespace + ':',
        description: NAMESPACES[namespace].label,
        enabled: true,
        isNamespace: true
      }));
  }

  function itemSuggestions(catalog, namespace, query, limit) {
    const meta = NAMESPACES[namespace];
    if (!meta || !catalog.capabilities[meta.capability]) return [];
    const q = String(query || '').trim().toLowerCase();
    const items = asArray(catalog[namespace]);
    return items
      .filter((item) => {
        if (!q) return true;
        return String(item.label || '').toLowerCase().indexOf(q) >= 0
          || String(item.value || '').toLowerCase().indexOf(q) >= 0
          || String(item.description || '').toLowerCase().indexOf(q) >= 0;
      })
      .slice(0, limit || 8);
  }

  function suggestionsForInput(catalog, value, caret, limit) {
    const trigger = detectSlashTrigger(value, caret);
    if (!trigger) return [];
    if (trigger.mode === 'namespace') return namespaceSuggestions(catalog, trigger.query).slice(0, limit || 8);
    return itemSuggestions(catalog, trigger.namespace, trigger.query, limit);
  }

  function itemAliases(item) {
    return [item.label, item.value, item.slug, item.id]
      .filter(Boolean)
      .map((v) => String(v).trim())
      .filter(Boolean);
  }

  function findCatalogMatch(catalog, namespace, body) {
    const items = asArray(catalog && catalog[namespace]);
    const haystack = String(body || '').trim();
    if (!haystack) return null;
    const lower = haystack.toLowerCase();
    let best = null;
    for (const item of items) {
      for (const alias of itemAliases(item)) {
        const needle = alias.toLowerCase();
        if (lower === needle || lower.indexOf(needle + ' ') === 0) {
          if (!best || needle.length > best.alias.length) {
            best = { item, alias: needle, refText: alias };
          }
        }
      }
    }
    return best;
  }

  function parseCommand(input, catalog) {
    const text = String(input || '').trim();
    const namespace = namespaceForInput(text);
    if (!namespace) return null;
    const meta = NAMESPACES[namespace];
    const body = text.slice(namespace.length + 2).trim();
    if (!body) {
      return { valid: false, namespace, type: meta.type, error: 'missing_ref' };
    }

    const matched = findCatalogMatch(catalog || normalizeCatalog({}), namespace, body);
    if (matched) {
      const ref = matched.item.value || matched.item.ref || matched.refText;
      const inputText = body.slice(matched.refText.length).trim();
      return {
        valid: true,
        namespace,
        type: meta.type,
        ref,
        label: matched.item.label || matched.refText,
        inputText,
        item: matched.item
      };
    }

    return {
      valid: true,
      namespace,
      type: meta.type,
      ref: body,
      label: body,
      inputText: ''
    };
  }

  function parseInputPayload(inputText) {
    const text = String(inputText || '').trim();
    if (!text) return {};
    if (text[0] === '{') {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const clean = { ...parsed };
          [
            'user_id',
            'userId',
            'organization_id',
            'organizationId',
            'org_id',
            'orgId',
            'tenant_id',
            'tenantId',
            'created_by',
            'createdBy'
          ].forEach((key) => { delete clean[key]; });
          return clean;
        }
      } catch (_err) {
        // Fall through to text payload.
      }
    }
    return { text };
  }

  function buildDispatchBody(command, context) {
    const body = {
      type: command.type,
      ref: command.ref
    };
    const input = parseInputPayload(command.inputText);
    if (context && context.conversationId) input.conversation_id = context.conversationId;
    if (context && context.matterId) input.matter_id = context.matterId;
    if (context && context.attachments) input.attachments = context.attachments;
    if (Object.keys(input).length > 0) body.input = input;
    return body;
  }

  async function dispatchCommand(apiClient, command, context) {
    if (!apiClient || typeof apiClient.post !== 'function') {
      throw new Error('Composer dispatch requires the API client.');
    }
    const response = await apiClient.post(DISPATCH_ENDPOINT, buildDispatchBody(command, context));
    return response && response.data ? response.data : response;
  }

  function formatDispatchResult(result) {
    const data = result || {};
    if (data.type === 'agent') {
      const name = data.slug || 'agent';
      const run = data.run_id ? '\n\nRun ID: `' + data.run_id + '`' : '';
      return 'Started agent `' + name + '`.' + run;
    }
    if (data.type === 'automation') {
      const name = data.name || data.automation_id || 'automation';
      const execution = data.execution || {};
      const status = execution.status || execution.state || 'completed';
      const message = execution.message || execution.summary || execution.result || '';
      let out = 'Ran automation `' + name + '`.\n\nStatus: `' + status + '`';
      if (message && typeof message === 'string') out += '\n\n' + message;
      return out;
    }
    return 'Command dispatched.';
  }

  function namesFromList(list) {
    return asArray(list).map((item) => item.name || item.label || item.slug || item.id || item).filter(Boolean);
  }

  function formatDispatchError(error) {
    const data = (error && error.data) || {};
    const err = data.error || {};
    const code = error && (error.code || err.code);
    const message = err.message || (error && error.message) || 'Command failed.';
    const names = namesFromList(err.candidates || err.available).slice(0, 20);
    if (code === 'NOT_FOUND') {
      return names.length > 0
        ? message + '\n\nDid you mean: ' + names.map((n) => '`' + n + '`').join(', ')
        : message;
    }
    if (code === 'AMBIGUOUS_REF') {
      return names.length > 0
        ? message + '\n\nChoose one: ' + names.map((n) => '`' + n + '`').join(', ')
        : message;
    }
    if (code === 'APP_UNAVAILABLE') return message;
    if (code === 'RATE_LIMITED') {
      const retry = err.retryAfterSeconds ? ' Try again in ' + err.retryAfterSeconds + ' seconds.' : '';
      return message + retry;
    }
    return message;
  }

  const api = {
    COMMANDS_ENDPOINT,
    DISPATCH_ENDPOINT,
    normalizeCatalog,
    getCatalog,
    resetCatalog,
    isDispatchCommand,
    detectSlashTrigger,
    suggestionsForInput,
    parseCommand,
    parseInputPayload,
    buildDispatchBody,
    dispatchCommand,
    formatDispatchResult,
    formatDispatchError
  };

  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = api;
  }

  root.Lex = root.Lex || {};
  root.Lex.Chat = root.Lex.Chat || {};
  root.Lex.Chat.ComposerSlash = api;
})(typeof window !== 'undefined' ? window : globalThis);
