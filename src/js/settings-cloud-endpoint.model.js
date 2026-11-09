/**
 * Settings > Capabilities > AI > Cloud: the organization's own AI provider. Pure, no DOM.
 *
 * Wording for the row and the Change dialog, and the request bodies the dialog sends. The backend
 * (cloud-endpoint.service.js) checks everything again: the URL rules, which providers may be
 * firm-hosted, and that a saved key is only reused with the provider and address it was saved for.
 * Shapes: cloud-endpoint-api.client.js.
 *
 * window.LanaCloudEndpoint (browser) / module.exports (tests).
 */
(function (root) {
  'use strict';

  var CUSTOM = 'custom';

  // How a Test connection outcome is shown.
  var TEST_TONES = {
    ok: 'success', unauthorized: 'error', not_found: 'error', rate_limited: 'warning',
    unreachable: 'error', proxy_unavailable: 'warning', error: 'error'
  };

  // Shown in the Change dialog and in the row: an outside provider is not under LANA's control.
  var NOTICE = 'Before you connect, make sure your provider keeps none of your data and never uses it to train its AI.';

  // The "Learn more" overlay. Written for a sixth grader.
  var LEARN_MORE = {
    heading: 'Keeping client data safe with another AI provider',
    sections: [
      {
        title: 'Forge is set up for you',
        paragraphs: ['Forge is LANA\'s own cloud. It always runs in sovereign mode: it keeps nothing it is sent and never uses it for training. LANA set it up that way, so there is nothing for you to check.']
      },
      {
        title: 'Other providers are run by other companies',
        paragraphs: ['OpenAI, Anthropic, Google, Perplexity and the rest are separate companies. LANA cannot control what they do with what they receive. Your account with them decides that.']
      },
      {
        title: 'What LANA does to help',
        paragraphs: [
          'Before anything leaves your server, LANA swaps names, phone numbers, addresses and other private details for stand-ins like [PERSON_1]. The provider only sees the stand-ins. When the answer comes back, LANA puts the real details back in.',
          'This only happens while "Hide private details before sending" is on. If you turn it off, the provider sees everything as written.'
        ]
      },
      {
        title: 'What you need to check',
        paragraphs: ['Hiding details does not catch everything. The facts of a case can still be private even with the names taken out. So before you connect, make sure your account with the provider has both of these:'],
        list: [
          'Zero data retention: the provider deletes your questions and answers right after it replies, and keeps no copy.',
          'No training: the provider never uses your questions or answers to teach its AI.'
        ]
      },
      {
        title: 'Where to find these settings',
        paragraphs: [
          'Most providers list them in their business or API account settings, or in their data agreement. Some only turn on zero data retention when you ask their sales or support team. If you are not sure, ask the provider in writing before you connect.',
          'If your firm runs the AI server itself, check that it does not save a log of questions and answers, or that only your firm can read that log.'
        ]
      }
    ]
  };

  function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function findProvider(providers, id) {
    return (providers || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  function canBeFirmHosted(provider) {
    return Boolean(provider && provider.can_be_firm_hosted);
  }

  function shortDate(iso) {
    var date = iso ? new Date(iso) : null;
    if (!date || isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Forge is the default cloud and cannot be removed; choosing it in the dialog removes the
  // organization's own provider (DELETE), which sends cloud requests back to Forge.
  var FORGE = 'forge';

  /**
   * Forge as the cloud row.
   * @param {{reachable:?boolean, used:?boolean}} forge - reachable from the app's topology, used from
   *   GET /api/v1/system/ai relay.enabled; null when not known
   */
  function forgeRow(forge) {
    var info = forge || {};
    var badge = info.used === false ? { label: 'Off on your server', tone: 'gray' }
      : info.reachable === false ? { label: 'Not reachable', tone: 'yellow' }
        : info.reachable === true && info.used === true ? { label: 'Connected', tone: 'green' }
          : { label: 'Default', tone: 'gray' };
    return {
      id: 'cloud-endpoint',
      name: 'Forge',
      summary: 'LANA\'s own cloud, the default',
      badge: badge.label,
      tone: badge.tone,
      facts: [
        { label: 'Provider', value: 'Forge, LANA\'s own cloud' },
        { label: 'Reachable', value: info.reachable === true ? 'Yes' : info.reachable === false ? 'No' : 'Not checked yet' },
        { label: 'Used by your server', value: info.used === true ? 'Yes' : info.used === false ? 'No, turned off on your server' : 'Unknown' },
        { label: 'Your data', value: 'Sovereign mode, always: Forge keeps nothing it is sent and never uses it to train AI.' }
      ]
    };
  }

  /** The organization's own provider as the cloud row. */
  function customRow(endpoint) {
    var changed = endpoint.updated_by_name
      ? endpoint.updated_by_name + (shortDate(endpoint.updated_at) ? ', ' + shortDate(endpoint.updated_at) : '')
      : shortDate(endpoint.updated_at);
    var facts = [
      { label: 'Provider', value: endpoint.provider_label || endpoint.provider },
      { label: 'Model', value: endpoint.model },
      { label: 'Address', value: endpoint.effective_base_url || 'Not set' },
      { label: 'Run by', value: endpoint.hosted_by === 'firm' ? 'Your firm' : 'An outside AI company' },
      { label: 'API key', value: endpoint.api_key_set ? 'Saved (' + endpoint.api_key_masked + '). It stays on your server.' : 'None' },
      { label: 'Private details', value: endpoint.redaction_enabled ? 'Hidden before anything is sent' : 'Sent as written' },
      // Chat routing to this provider is not built yet (plan custom-cloud-endpoint.md, phase 3).
      { label: 'Used for chat', value: 'Not yet. Chat starts using it in a coming update.' }
    ];
    if (changed) facts.push({ label: 'Last changed', value: changed });
    return {
      id: 'cloud-endpoint',
      name: endpoint.provider_label || endpoint.provider,
      summary: endpoint.model + (endpoint.enabled ? '' : '. Turned off, so cloud requests go to Forge'),
      badge: endpoint.enabled ? 'On' : 'Off',
      tone: endpoint.enabled ? 'green' : 'gray',
      facts: facts
    };
  }

  /** The one cloud row: the organization's own provider when there is one, else Forge. */
  function row(endpoint, forge) {
    return endpoint ? customRow(endpoint) : forgeRow(forge);
  }

  /** The dialog's starting values. */
  function formDefaults(endpoint) {
    if (!endpoint) {
      return { provider: FORGE, base_url: '', hosted_by: 'third_party', model: '', api_key: '', redaction_enabled: true, enabled: true };
    }
    return {
      provider: endpoint.provider,
      base_url: endpoint.base_url || '',
      hosted_by: endpoint.hosted_by || 'third_party',
      model: endpoint.model || '',
      api_key: '',
      redaction_enabled: endpoint.redaction_enabled !== false,
      enabled: endpoint.enabled !== false
    };
  }

  /** True when the saved key would be kept for this provider and address. */
  function keepsSavedKey(form, endpoint, providers) {
    if (!endpoint || !endpoint.api_key_set) return false;
    var provider = findProvider(providers, form.provider);
    var url = trim(form.base_url) || (provider ? provider.default_base_url : null);
    return form.provider === endpoint.provider && url === endpoint.effective_base_url;
  }

  /** True when the dialog has Forge chosen. */
  function isForge(form) {
    return !form || form.provider === FORGE;
  }

  /** Help text under each field, for the chosen provider. */
  function fieldHelp(form, endpoint, providers) {
    if (isForge(form)) return { base_url: '', api_key: '', showHostedBy: false, showFields: false };
    var provider = findProvider(providers, form.provider) || {};
    var key;
    if (keepsSavedKey(form, endpoint, providers)) key = 'A key is saved (' + endpoint.api_key_masked + '). Leave this empty to keep it.';
    else if (endpoint && endpoint.api_key_set) key = 'Enter the key again. A saved key only works with the provider and address it was saved for.';
    else key = provider.key_required ? 'Required. It is kept encrypted on your server and never shown again.' : 'Optional. Only if your server asks for one.';
    return {
      base_url: provider.url_required
        ? 'Required. The address of the server, for example https://ai.example.com/v1'
        : 'Leave empty to use ' + provider.default_base_url,
      api_key: key,
      showHostedBy: canBeFirmHosted(provider),
      showFields: true
    };
  }

  /** The setting fields both Save and Test send. */
  function settingFields(form, providers) {
    var provider = findProvider(providers, form.provider);
    var body = {
      provider: form.provider,
      base_url: trim(form.base_url) || null,
      hosted_by: canBeFirmHosted(provider) ? form.hosted_by : 'third_party',
      model: trim(form.model),
      redaction_enabled: form.redaction_enabled !== false,
      enabled: form.enabled !== false
    };
    // Left out keeps the saved key (the server refuses that when the provider or address changed).
    var key = trim(form.api_key);
    if (key) body.api_key = key;
    return body;
  }

  /** PUT body. */
  function saveBody(form, endpoint, providers) {
    var body = settingFields(form, providers);
    body.expected_updated_at = endpoint ? endpoint.updated_at : null;
    return body;
  }

  /** How a test result reads in the dialog. */
  function testView(result) {
    if (!result) return { tone: 'error', text: 'LANA could not run the test. Try again.' };
    var text = result.message || '';
    if (result.ok && typeof result.latency_ms === 'number') text += ' (' + result.latency_ms + ' ms)';
    if (!result.ok && result.detail) text += ' ' + result.detail;
    return { tone: TEST_TONES[result.outcome] || 'error', text: text };
  }

  /** A failed save or test, as a message and the field it belongs to. */
  function errorView(error) {
    var data = (error && error.data) || {};
    var inner = data.error || {};
    if (error && error.status === 409) {
      return { stale: true, field: null, text: inner.message || 'The setting changed since you opened it. Close this and try again.' };
    }
    if (error && error.status === 403) {
      return { stale: false, field: null, text: 'Only an organization admin can change this.' };
    }
    return { stale: false, field: inner.field || null, text: inner.message || (error && error.message) || 'LANA could not save this. Try again.' };
  }

  /** Forge first (the default), then the providers. */
  function providerOptions(providers) {
    return [{ value: FORGE, label: 'Forge (LANA\'s own cloud, the default)' }]
      .concat((providers || []).map(function (p) { return { value: p.id, label: p.label }; }));
  }

  var api = {
    CUSTOM: CUSTOM,
    FORGE: FORGE,
    isForge: isForge,
    NOTICE: NOTICE,
    LEARN_MORE: LEARN_MORE,
    row: row,
    formDefaults: formDefaults,
    fieldHelp: fieldHelp,
    keepsSavedKey: keepsSavedKey,
    testBody: settingFields,
    saveBody: saveBody,
    testView: testView,
    errorView: errorView,
    providerOptions: providerOptions
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LanaCloudEndpoint = api;
})(typeof window !== 'undefined' ? window : this);
