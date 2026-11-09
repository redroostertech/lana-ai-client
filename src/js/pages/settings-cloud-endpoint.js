/**
 * Settings > Capabilities > AI > Cloud: "Your own AI provider", for organization admins.
 *
 * One expandable row (window.LanaAiRow from settings-ai-models.js) with Change, Test and Remove,
 * and a Change dialog: provider list (or Custom), address, who runs it (Custom only), model,
 * API key, the redaction switch, and Test connection. Shown only when GET answers: people who
 * are not organization admins get 403 and see nothing here.
 *
 * Wording and request bodies: settings-cloud-endpoint.model.js (window.LanaCloudEndpoint).
 * Requests: cloud-endpoint-api.client.js.
 */
(function () {
  'use strict';

  var M = window.LanaCloudEndpoint;
  var client = null;
  var state = null; // { endpoint, providers }
  var forge = { reachable: null, used: null }; // the app's topology and GET /api/v1/system/ai relay.enabled

  function el(id) {
    return document.getElementById(id);
  }

  function toast(kind, text) {
    if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast[kind] === 'function') window.Lex.Toast[kind](text);
  }

  function button(label, variant, action) {
    var node = document.createElement('lex-btn');
    node.setAttribute('variant', variant);
    node.setAttribute('size', 'sm');
    node.setAttribute('label', label);
    node.setAttribute('data-cloud-action', action);
    return node;
  }

  function note(className) {
    var node = document.createElement('p');
    node.className = className;
    node.hidden = true;
    return node;
  }

  function showNote(node, view) {
    node.textContent = view.text;
    node.dataset.tone = view.tone;
    node.hidden = false;
  }

  // ---- Notice and the Learn more overlay ----

  /** The notice line with a Learn more button (data-cloud-action="learn-more"). */
  function notice() {
    var box = document.createElement('div');
    box.className = 'sv2-cloud-endpoint-notice';
    box.setAttribute('role', 'note');
    var copy = document.createElement('span');
    copy.className = 'sv2-cloud-endpoint-notice-text';
    copy.textContent = M.NOTICE;
    box.appendChild(copy);
    box.appendChild(button('Learn more', 'ghost', 'learn-more'));
    return box;
  }

  function openLearnMore() {
    if (!window.Lex || !window.Lex.Modal) return;
    var body = document.createElement('div');
    body.className = 'sv2-cloud-endpoint-learn';
    M.LEARN_MORE.sections.forEach(function (section) {
      var title = document.createElement('h4');
      title.className = 'sv2-cloud-endpoint-learn-title';
      title.textContent = section.title;
      body.appendChild(title);
      (section.paragraphs || []).forEach(function (text) {
        var p = document.createElement('p');
        p.className = 'sv2-cloud-endpoint-learn-text';
        p.textContent = text;
        body.appendChild(p);
      });
      if (section.list) {
        var list = document.createElement('ul');
        list.className = 'sv2-cloud-endpoint-learn-list';
        section.list.forEach(function (text) {
          var item = document.createElement('li');
          item.textContent = text;
          list.appendChild(item);
        });
        body.appendChild(list);
      }
    });
    var modal = window.Lex.Modal.open({ heading: M.LEARN_MORE.heading, size: 'lg', content: body });
    // Above the Change dialog when it is open.
    if (modal && modal.style) modal.style.setProperty('--lex-z-modal', '70');
  }

  // ---- Row ----

  function render() {
    var box = el('sv2-ai-cloud-endpoint');
    if (!box || !state || !window.LanaAiRow) return;
    var endpoint = state.endpoint;
    var actions = document.createElement('div');
    actions.className = 'sv2-ai-item-actions sv2-cloud-endpoint-actions';
    var buttons = document.createElement('div');
    buttons.className = 'sv2-cloud-endpoint-buttons';
    buttons.appendChild(button('Edit connection', 'secondary', 'change'));
    // Forge cannot be removed. Leaving your own provider sends cloud requests back to Forge.
    if (endpoint) {
      buttons.appendChild(button('Test connection', 'ghost', 'test'));
      buttons.appendChild(button('Go back to Forge', 'ghost', 'remove'));
      actions.appendChild(notice());
    }
    actions.appendChild(buttons);
    var result = note('sv2-cloud-endpoint-result');
    actions.appendChild(result);
    actions.addEventListener('click', function (event) {
      var target = event.target.closest && event.target.closest('[data-cloud-action]');
      if (!target) return;
      var action = target.getAttribute('data-cloud-action');
      if (action === 'change') openDialog();
      else if (action === 'test') testSaved(target, result);
      else if (action === 'remove') remove();
      else if (action === 'learn-more') openLearnMore();
    });
    box.innerHTML = '';
    box.appendChild(window.LanaAiRow.create(M.row(endpoint, forge), { actions: actions }));
    box.hidden = false;
    // This row says everything the Forge lines above it would (settings-ai-models.js), so they hide.
    var forgeLines = el('sv2-ai-cloud-rows');
    if (forgeLines) forgeLines.hidden = true;
    var group = el('sv2-ai-cloud');
    if (group) group.hidden = false;
  }

  function loadForge() {
    window.api.get('/api/v1/system/ai', { quietStatuses: [404] }).then(function (report) {
      forge.used = report && report.relay ? report.relay.enabled === true : null;
      render();
    }).catch(function () { /* Forge's row says "Unknown". */ });
  }

  /** Whether Forge answers, from the app's topology (settings-ai-models.js). */
  function readReachable(topology) {
    var info = topology && topology.forge;
    forge.reachable = info && typeof info.reachable === 'boolean' ? info.reachable : null;
  }

  function load() {
    loadForge();
    return client.get().then(function (data) {
      state = data && Array.isArray(data.providers) ? data : null;
      if (state) render();
      else hide();
    }).catch(function () { hide(); });
  }

  /** Not an organization admin (403) or an older server: the plain Forge lines stay. */
  function hide() {
    var box = el('sv2-ai-cloud-endpoint');
    if (box) box.hidden = true;
    var forgeLines = el('sv2-ai-cloud-rows');
    if (forgeLines) forgeLines.hidden = false;
  }

  function testSaved(target, result) {
    target.setAttribute('loading', 'true');
    client.test({}).then(function (outcome) {
      showNote(result, M.testView(outcome));
    }).catch(function (error) {
      showNote(result, { tone: 'error', text: M.errorView(error).text });
    }).then(function () { target.removeAttribute('loading'); });
  }

  function remove() {
    if (!window.Lex || !window.Lex.Modal) return;
    window.Lex.Modal.confirmAsync(
      'Go back to Forge?',
      'Cloud AI requests go back to Forge, LANA\'s own cloud. Your provider\'s settings and saved API key are deleted from your server.',
      { variant: 'danger', confirmText: 'Go back to Forge' }
    ).then(function (yes) {
      if (!yes) return null;
      return client.remove().then(function (data) {
        state = data;
        render();
        toast('success', 'Cloud AI requests go to Forge again.');
      });
    }).catch(function (error) {
      toast('error', M.errorView(error).text);
    });
  }

  // ---- Change dialog ----

  function field(tag, attrs) {
    var node = document.createElement(tag);
    Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  function toggleRow(label, help, checked, name) {
    var wrap = document.createElement('div');
    wrap.className = 'sv2-cloud-endpoint-option';
    var copy = document.createElement('div');
    copy.className = 'sv2-cloud-endpoint-option-copy';
    var title = document.createElement('span');
    title.className = 'sv2-cloud-endpoint-option-name';
    title.textContent = label;
    var description = document.createElement('span');
    description.className = 'sv2-cloud-endpoint-option-description';
    description.textContent = help;
    copy.appendChild(title);
    copy.appendChild(description);
    var toggle = field('lex-toggle', { name: name, 'aria-label': label });
    if (checked) toggle.setAttribute('checked', 'true');
    wrap.appendChild(copy);
    wrap.appendChild(toggle);
    return { wrap: wrap };
  }

  function openDialog() {
    if (!window.Lex || !window.Lex.Modal || !state) return;
    var endpoint = state.endpoint;
    var providers = state.providers;
    var start = M.formDefaults(endpoint);

    // lex-modal copies the content it is given, so the form is built from attributes here and
    // every field is looked up again inside the open dialog below.
    var form = document.createElement('div');
    form.className = 'sv2-cloud-endpoint-form';
    form.appendChild(field('lex-select', { label: 'Provider', name: 'provider' }));
    var forgeNote = document.createElement('p');
    forgeNote.className = 'sv2-cloud-endpoint-forge-note';
    forgeNote.textContent = 'Forge is LANA\'s own cloud and the default. It always runs in sovereign mode: it keeps nothing it is sent and never uses it to train AI. There is nothing to set up.';
    form.appendChild(forgeNote);
    form.appendChild(notice());
    form.appendChild(field('lex-input', { label: 'Address', name: 'base_url', type: 'url', placeholder: 'https://' }));
    var hostedWrap = document.createElement('div');
    hostedWrap.className = 'sv2-cloud-endpoint-hosted';
    var hostedLabel = document.createElement('span');
    hostedLabel.className = 'sv2-cloud-endpoint-option-name';
    hostedLabel.textContent = 'Who runs this server?';
    var hostedHelp = document.createElement('span');
    hostedHelp.className = 'sv2-cloud-endpoint-option-description';
    hostedHelp.textContent = 'Pick "Our firm" only for a server your firm runs itself. Then it may also answer matters marked never to leave the firm.';
    hostedWrap.appendChild(hostedLabel);
    hostedWrap.appendChild(field('lex-segmented', { name: 'hosted_by' }));
    hostedWrap.appendChild(hostedHelp);
    form.appendChild(hostedWrap);
    form.appendChild(field('lex-input', { label: 'Model', name: 'model', placeholder: 'For example gpt-5 or claude-sonnet-5-5' }));
    form.appendChild(field('lex-input', { label: 'API key', name: 'api_key', type: 'password', autocomplete: 'off' }));
    form.appendChild(toggleRow('Hide private details before sending',
      'Names, numbers and other private details are swapped for placeholders before anything leaves your server, and put back in the answer. Turn this off only if your agreement with the provider covers client data.',
      start.redaction_enabled, 'redaction_enabled').wrap);
    form.appendChild(toggleRow('Use this provider', 'Turn off to keep the setting but send nothing to it.', start.enabled, 'enabled').wrap);
    form.appendChild(note('sv2-cloud-endpoint-result'));
    // data-slot="footer": lex-modal moves these into its footer.
    var spacer = document.createElement('span');
    spacer.className = 'sv2-cloud-endpoint-footer-spacer';
    [button('Test connection', 'ghost', 'dialog-test'), spacer, button('Cancel', 'secondary', 'dialog-cancel'), button('Save', 'primary', 'dialog-save')]
      .forEach(function (node) {
        node.setAttribute('data-slot', 'footer');
        form.appendChild(node);
      });

    var modal = window.Lex.Modal.open({
      heading: 'Edit cloud connection',
      size: 'xl',
      width: 'calc(100vw - 96px)',
      content: form
    });

    function find(selector) {
      return modal.querySelector(selector);
    }
    var provider = find('lex-select[name="provider"]');
    var baseUrl = find('lex-input[name="base_url"]');
    var hosted = find('lex-segmented[name="hosted_by"]');
    var hostedBox = find('.sv2-cloud-endpoint-hosted');
    var model = find('lex-input[name="model"]');
    var apiKey = find('lex-input[name="api_key"]');
    var redaction = find('lex-toggle[name="redaction_enabled"]');
    var enabled = find('lex-toggle[name="enabled"]');
    var message = find('.lex-modal-body .sv2-cloud-endpoint-result');
    var testBtn = find('[data-cloud-action="dialog-test"]');
    var cancelBtn = find('[data-cloud-action="dialog-cancel"]');
    var saveBtn = find('[data-cloud-action="dialog-save"]');
    var forgeLine = find('.sv2-cloud-endpoint-forge-note');
    // Everything but the provider list and the Forge line belongs to your own provider.
    var providerOnly = [find('.lex-modal-body .sv2-cloud-endpoint-notice'), baseUrl, model, apiKey,
      redaction.closest('.sv2-cloud-endpoint-option'), enabled.closest('.sv2-cloud-endpoint-option'), testBtn];

    provider.options = M.providerOptions(providers);
    provider.value = start.provider;
    hosted.options = [{ value: 'third_party', label: 'An outside company' }, { value: 'firm', label: 'Our firm' }];
    hosted.value = start.hosted_by;
    baseUrl.value = start.base_url;
    model.value = start.model;

    function values() {
      return {
        provider: provider.value,
        base_url: baseUrl.value,
        hosted_by: hosted.value,
        model: model.value,
        api_key: apiKey.value,
        redaction_enabled: redaction.checked === true,
        enabled: enabled.checked === true
      };
    }

    function refreshHelp() {
      var help = M.fieldHelp(values(), endpoint, providers);
      baseUrl.help = help.base_url;
      apiKey.help = help.api_key;
      hostedBox.hidden = !help.showHostedBy;
      providerOnly.forEach(function (node) { if (node) node.hidden = !help.showFields; });
      forgeLine.hidden = help.showFields;
    }

    function clearErrors() {
      [provider, baseUrl, model, apiKey].forEach(function (node) { node.error = ''; });
      message.hidden = true;
    }

    function showError(error) {
      var view = M.errorView(error);
      var target = { provider: provider, base_url: baseUrl, model: model, api_key: apiKey }[view.field];
      if (target) target.error = view.text;
      else showNote(message, { tone: 'error', text: view.text });
      if (view.stale) load();
    }

    modal.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('[data-cloud-action="learn-more"]')) openLearnMore();
    });
    modal.addEventListener('lex-change', refreshHelp);
    modal.addEventListener('lex-input', refreshHelp);
    testBtn.addEventListener('click', function () {
      clearErrors();
      testBtn.setAttribute('loading', 'true');
      client.test(M.testBody(values(), providers)).then(function (result) {
        showNote(message, M.testView(result));
      }).catch(showError).then(function () { testBtn.removeAttribute('loading'); });
    });
    cancelBtn.addEventListener('click', function () { modal.removeAfterClose(); });
    saveBtn.addEventListener('click', function () {
      clearErrors();
      saveBtn.setAttribute('loading', 'true');
      // Forge: drop your own provider (nothing to drop when there is none).
      var request = M.isForge(values())
        ? (endpoint ? client.remove() : Promise.resolve(state))
        : client.save(M.saveBody(values(), endpoint, providers));
      request.then(function (data) {
        state = data;
        render();
        modal.removeAfterClose();
        toast('success', state && state.endpoint ? 'Your AI provider was saved.' : 'Cloud AI requests go to Forge.');
      }).catch(showError).then(function () { saveBtn.removeAttribute('loading'); });
    });

    refreshHelp();
  }

  function boot() {
    if (!M || !el('sv2-ai-cloud-endpoint') || !window.api || typeof window.CloudEndpointAPIClient !== 'function') return;
    client = new window.CloudEndpointAPIClient(window.api);
    readReachable(window.LanaAiRow && window.LanaAiRow.topology ? window.LanaAiRow.topology() : null);
    window.addEventListener('lana-ai-topology', function (event) { readReachable(event.detail); render(); });
    load();
    document.addEventListener('lex-refresh', load);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
