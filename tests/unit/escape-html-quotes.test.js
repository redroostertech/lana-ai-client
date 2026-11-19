/**
 * HTML escaping must cover both quote characters.
 *
 * LexElement.escapeHtml (and about forty copies across src/) escaped by
 * setting textContent and reading innerHTML back. That escapes & < > but
 * leaves " and ' raw, so any value placed inside a quoted attribute could
 * close the attribute and add new ones (onfocus, autofocus, ...). These
 * tests pin the shared helper and a few of the converted call sites.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');
const tick = (window, ms = 20) => new Promise((resolve) => window.setTimeout(resolve, ms));

const ATTACK = 'x" autofocus onfocus="window.__pwned=1" data-pwn="1';
const SINGLE_ATTACK = "x' onmouseover='window.__pwned=1' data-pwn='1";

function boot(scripts, before) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/',
  });
  const { window } = dom;
  window.console.log = () => {};
  window.console.warn = () => {};
  if (before) before(window);
  scripts.forEach((rel) => window.eval(typeof rel === 'function' ? rel() : read(rel)));
  return window;
}

describe('LexElement.escapeHtml', () => {
  let window;
  beforeAll(() => {
    window = boot(['time-utils.js', 'lex/lex.core.js']);
  });

  test('a component instance escapes double and single quotes', () => {
    const { LexElement } = window.Lex;
    const el = Object.create(LexElement.prototype);
    expect(el.escapeHtml(`a"b'c`)).toBe('a&quot;b&#039;c');
  });

  test('Lex.escapeHtml is exposed by lex.core with the Lex.Utils mapping', () => {
    expect(typeof window.Lex.escapeHtml).toBe('function');
    expect(window.Lex.escapeHtml(`<a href="x" title='y'>&</a>`))
      .toBe('&lt;a href=&quot;x&quot; title=&#039;y&#039;&gt;&amp;&lt;/a&gt;');
  });

  test('null and undefined give an empty string; other values are stringified', () => {
    expect(window.Lex.escapeHtml(null)).toBe('');
    expect(window.Lex.escapeHtml(undefined)).toBe('');
    expect(window.Lex.escapeHtml(0)).toBe('0');
    expect(window.Lex.escapeHtml(false)).toBe('false');
  });

  test('text without quotes is unchanged from the old textContent output', () => {
    const sample = 'Smith & Sons <LLC> 100% > 99 % plain text\n\ttabs';
    const div = window.document.createElement('div');
    div.textContent = sample;
    expect(window.Lex.escapeHtml(sample)).toBe(div.innerHTML);
  });

  test('U+00A0 is the one intended difference: kept raw, not turned into &nbsp;', () => {
    const sample = 'Room\u00A0101';
    const div = window.document.createElement('div');
    div.textContent = sample;
    expect(div.innerHTML).toBe('Room&nbsp;101');
    expect(window.Lex.escapeHtml(sample)).toBe('Room\u00A0101');
    // Both parse back to the same text.
    const host = window.document.createElement('div');
    host.innerHTML = window.Lex.escapeHtml(sample);
    expect(host.textContent).toBe(sample);
  });

  test('matches Lex.Utils.escapeHtml when both are loaded', () => {
    const w = boot(['time-utils.js', 'lex/lex.core.js', 'lex/lex.utils.js']);
    const sample = `"quoted" & 'single' <tag>`;
    expect(w.Lex.escapeHtml(sample)).toBe(w.Lex.Utils.escapeHtml(sample));
  });
});

describe('lex-input value attribute', () => {
  test.each([
    ['double quote', ATTACK],
    ['single quote', SINGLE_ATTACK],
  ])('a value with a %s keeps the full value and adds no attribute', async (_name, value) => {
    const window = boot(['time-utils.js', 'lex/lex.core.js', 'lex/lex.forms.js', 'lex/components/form/lex-input.js']);
    window.document.body.innerHTML = '<lex-input id="i" name="location"></lex-input>';
    await tick(window);
    const el = window.document.getElementById('i');
    el.value = value;
    await tick(window);
    const input = el.querySelector('input');
    expect(input).not.toBeNull();
    expect(input.value).toBe(value);
    expect(input.hasAttribute('autofocus')).toBe(false);
    expect(input.hasAttribute('onfocus')).toBe(false);
    expect(input.hasAttribute('onmouseover')).toBe(false);
    expect(input.hasAttribute('data-pwn')).toBe(false);
    expect(window.__pwned).toBeUndefined();
  });
});

describe('converted escape helpers', () => {
  test('similar-matters-widget keeps a quoted matter id inside data-matter-id', () => {
    const window = boot([
      'time-utils.js', 'lex/lex.core.js',
      () => read('similar-matters-widget.js') + '\n;window.SimilarMattersWidget = SimilarMattersWidget;',
    ]);
    const widget = new window.SimilarMattersWidget({});
    const html = widget.getMatterCardHTML({
      matter_id: ATTACK, name: 'Estate', combined_score: 0.5, matching_reasons: [],
    });
    const host = window.document.createElement('div');
    host.innerHTML = html;
    const card = host.querySelector('.similar-matter-card');
    expect(card.getAttribute('data-matter-id')).toBe(ATTACK);
    expect(card.hasAttribute('autofocus')).toBe(false);
    expect(card.hasAttribute('onfocus')).toBe(false);
    expect(card.hasAttribute('data-pwn')).toBe(false);
  });

  test('metric-grid block keeps a quoted label inside the lex-metric label attribute', () => {
    const renderers = {};
    const window = boot(['time-utils.js', 'lex/lex.core.js', () => {
      return 'window.Lex.SchemaRegistry = { register: function (n, s, fn) { window.__renderers[n] = fn; } };';
    }, 'lex/blocks/metric-grid.block.js'], (w) => { w.__renderers = renderers; });
    const container = window.document.createElement('div');
    renderers.metric_grid(container, { type: 'metric_grid', metrics: [{ label: ATTACK, value: `1'2` }] });
    const metric = container.querySelector('lex-metric');
    expect(metric.getAttribute('label')).toBe(ATTACK);
    expect(metric.getAttribute('value')).toBe(`1'2`);
    expect(metric.hasAttribute('onfocus')).toBe(false);
    expect(metric.hasAttribute('data-pwn')).toBe(false);
  });

  test('lex-action-menu escapes quotes in its private helper', () => {
    const window = boot(['time-utils.js', 'lex/lex.core.js', 'lex/components/foundation/lex-action-menu.js']);
    const Menu = window.customElements.get('lex-action-menu');
    expect(Menu.prototype._esc.call(Object.create(Menu.prototype), `a"b'c`)).toBe('a&quot;b&#039;c');
  });
});

describe('drilldown-renderer attribute sinks', () => {
  function bootDrilldown() {
    return boot(['time-utils.js', 'lex/lex.core.js', 'drilldown-renderer.js']);
  }

  test('breakdown card filter attributes keep quoted values (around :1167)', () => {
    const window = bootDrilldown();
    window.document.body.innerHTML =
      '<div id="drilldown-breakdown-cards-container" class="hidden"><div id="drilldown-breakdown-cards"></div></div>';
    const r = new window.DrilldownRenderer();
    r.currentData = { breakdown_cards: [{ key: SINGLE_ATTACK, title: 'T', value: 1, filter_column: 'status', filter_value: ATTACK }] };
    r.renderBreakdownCards();
    const card = window.document.querySelector('.drilldown-breakdown-card');
    expect(card.getAttribute('data-filter-value')).toBe(ATTACK);
    expect(card.getAttribute('data-card-key')).toBe(SINGLE_ATTACK);
    expect(card.hasAttribute('onfocus')).toBe(false);
    expect(card.hasAttribute('onmouseover')).toBe(false);
    expect(card.hasAttribute('data-pwn')).toBe(false);
  });

  test('badge column keeps a quoted label inside lex-badge label (around :2298)', () => {
    const window = bootDrilldown();
    const r = new window.DrilldownRenderer();
    const html = r.renderBadgeColumn(ATTACK, { type: 'badge', legend: { [ATTACK]: ATTACK } });
    const host = window.document.createElement('div');
    host.innerHTML = html;
    const badge = host.querySelector('lex-badge');
    expect(badge.getAttribute('label').toLowerCase()).toBe(ATTACK.toLowerCase());
    expect(badge.hasAttribute('onfocus')).toBe(false);
    expect(badge.hasAttribute('data-pwn')).toBe(false);
  });
});

describe('search highlighting matches raw text, not escaped entities', () => {
  const MODALS = [
    ['contact-search-modal.js', 'ContactSearchModal'],
    ['conversation-search-modal.js', 'ConversationSearchModal'],
  ];

  function load(file, name) {
    const window = boot(['time-utils.js', 'lex/lex.core.js', () => read(file) + `\n;window.__M = ${name};`]);
    return window;
  }

  describe.each(MODALS)('%s', (file, name) => {
    function render(text, query) {
      const window = load(file, name);
      const host = window.document.createElement('div');
      host.innerHTML = window.__M.highlightText(text, query);
      return host;
    }

    test.each([
      [`O'Brien "Tom"`, 't', ['T']],
      [`O'Brien "Tom"`, '0', []],
      [`O'Brien`, "'", ["'"]],
      ['A & B <c>', '&', ['&']],
      ['say "hi"', 'quot', []],
      ['quote " here', 'quot', ['quot']],
    ])('%s searched for %s keeps the text and marks only real matches', (text, query, marks) => {
      const host = render(text, query);
      expect(host.textContent).toBe(text);
      expect([...host.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(marks);
    });

    test('markup in the text stays text', () => {
      const host = render('<img src=x onerror=alert(1)> Tom', 'tom');
      expect(host.querySelector('img')).toBeNull();
      expect(host.querySelector('mark').textContent).toBe('Tom');
    });
  });
});

describe('workflow-builder node config form', () => {
  const TAG_ATTACK = '</textarea><img src=x onerror="window.__pwned=1">' + ATTACK;

  test('every config input and textarea keeps hostile values as values', () => {
    const window = boot(['time-utils.js', 'lex/lex.core.js', 'workflow-builder.js']);
    const all = [].concat(...Object.values(window.WorkflowNodeTypes));
    const proto = window.WorkflowBuilder.prototype;
    let checked = 0;
    for (const nodeDef of all) {
      const config = {};
      Object.keys(nodeDef.config || {}).concat(['cron', 'field', 'value', 'to', 'subject', 'message', 'title', 'reason', 'savePath'])
        .forEach((k) => { config[k] = TAG_ATTACK; });
      const host = window.document.createElement('div');
      host.innerHTML = proto.renderConfigForm.call({}, nodeDef, config, 'n1');
      expect(host.querySelector('img')).toBeNull();
      expect(host.querySelector('[onfocus], [data-pwn], [autofocus]')).toBeNull();
      host.querySelectorAll('input[type="text"][id^="config-"], textarea[id^="config-"]').forEach((el) => {
        expect(el.value).toBe(TAG_ATTACK);
        checked += 1;
      });
    }
    expect(checked).toBeGreaterThan(8);
  });
});

describe('admin onboarding_management.html steps', () => {
  test('step name and description stay inside their value attributes', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'admin', 'onboarding_management.html'), 'utf8');
    const start = html.indexOf('function renderSteps()');
    const end = html.indexOf('\n        }\n', start) + '\n        }\n'.length;
    expect(start).toBeGreaterThan(-1);
    const window = boot(['time-utils.js', 'lex/lex.core.js']);
    window.document.body.innerHTML = '<div id="stepsContainer"></div>';
    window.onboardingSteps = [{ id: 1, name: ATTACK, description: SINGLE_ATTACK.replace(/'/g, '"'), required: false, enabled: true }];
    window.eval(html.slice(start, end) + '\nrenderSteps();');
    const inputs = window.document.querySelectorAll('#stepsContainer input[type="text"]');
    expect(inputs[0].value).toBe(ATTACK);
    expect(inputs[1].value).toBe(SINGLE_ATTACK.replace(/'/g, '"'));
    expect(window.document.querySelector('#stepsContainer [onfocus], #stepsContainer [data-pwn], #stepsContainer [onmouseover]')).toBeNull();
  });
});

describe('connector-config-renderer fields', () => {
  const TYPES = ['directory_browser', 'oauth', 'text', 'url', 'email', 'password', 'api_key', 'number', 'select', 'multiselect', 'checkbox', 'file_picker'];
  const HOSTILE = '<img src=x onerror="window.__pwned=1">' + ATTACK + SINGLE_ATTACK;

  test.each(TYPES)('%s renders hostile schema and values as text', (type) => {
    // ES module: drop the import/export lines so the render helpers run as a classic script.
    const window = boot(['time-utils.js', 'lex/lex.core.js', () => read('connector-config-renderer.js')
      .replace(/^import .*$/m, '').replace(/^export default[\s\S]*$/m, '').replace(/^export /gm, '')]);
    const field = {
      field_name: HOSTILE, label: HOSTILE, description: HOSTILE, type, placeholder: HOSTILE,
      checkbox_label: HOSTILE, accept: HOSTILE, oauth_config: { provider: HOSTILE },
      options: [{ value: HOSTILE, label: HOSTILE }], browser_config: { root: HOSTILE },
      validation: { min: HOSTILE, max: HOSTILE, step: HOSTILE },
    };
    const host = window.document.createElement('div');
    host.innerHTML = window.renderField(field, HOSTILE);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[onfocus], [data-pwn], [onmouseover], [autofocus]')).toBeNull();
    const browse = host.querySelector('.browse-btn');
    if (browse) expect(JSON.parse(browse.dataset.config)).toEqual({ root: HOSTILE });
  });
});

describe('matters.html inline renderers', () => {
  const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'matters.html'), 'utf8');
  // Returns the source of `function name(...) { ... }` by brace matching.
  function extract(name) {
    const start = PAGE.indexOf('function ' + name + '(');
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = PAGE.indexOf('{', start); i < PAGE.length; i++) {
      if (PAGE[i] === '{') depth += 1;
      else if (PAGE[i] === '}' && --depth === 0) return PAGE.slice(start, i + 1);
    }
    throw new Error('unbalanced ' + name);
  }
  const HOSTILE = '<img src=x onerror="window.__pwned=1">' + ATTACK;

  function bootWith(names, body) {
    const window = boot(['time-utils.js', 'lex/lex.core.js']);
    window.document.body.innerHTML = body;
    window.eval('function escapeHtml(t) { if (!t) return \'\'; return window.Lex.escapeHtml(t); }\n'
      + 'function formatFileSize(n) { return String(n); }\nfunction insertMention() {}\nfunction insertDocumentReference() {}\n'
      + names.map(extract).join('\n'));
    return window;
  }

  test('mention dropdown keeps user name, id and email as data and text', () => {
    const window = bootWith(['showMentionDropdown'], '<div id="mentionDropdown" class="hidden"><div id="mentionList"></div></div>');
    window.showMentionDropdown([{ id: HOSTILE, name: HOSTILE, email: HOSTILE }]);
    const item = window.document.querySelector('.mention-item');
    expect(window.document.querySelector('#mentionList img')).toBeNull();
    expect(window.document.querySelector('#mentionList [onfocus], #mentionList [data-pwn]')).toBeNull();
    expect(item.dataset.userName).toBe(HOSTILE);
    expect(item.dataset.userId).toBe(HOSTILE);
  });

  test('document dropdown keeps the file name as data and text', () => {
    const window = bootWith(['showDocumentDropdown'], '<div id="documentDropdown" class="hidden"><div id="documentList"></div></div>');
    window.showDocumentDropdown([{ id: HOSTILE, filename: HOSTILE, file_size: 1 }]);
    const item = window.document.querySelector('.document-item');
    expect(window.document.querySelector('#documentList img')).toBeNull();
    expect(window.document.querySelector('#documentList [onfocus], #documentList [data-pwn]')).toBeNull();
    expect(item.dataset.docName).toBe(HOSTILE);
    expect(item.dataset.docId).toBe(HOSTILE);
  });
  test('comment content and activity descriptions render user text as text', () => {
    const window = boot(['time-utils.js', 'lex/lex.core.js']);
    window.eval(extract('renderCommentContent') + '\n' + extract('getActivityDescription')
      + '\nwindow.renderCommentContent = renderCommentContent; window.getActivityDescription = getActivityDescription;');
    const host = window.document.createElement('div');
    host.innerHTML = window.renderCommentContent('hi @[Ann](u1) ' + HOSTILE + '\nline two');
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('span').textContent).toBe('@Ann');
    expect(host.querySelectorAll('br')).toHaveLength(1);
    expect(host.textContent).toContain(HOSTILE);
    [
      { user: { first_name: HOSTILE, last_name: 'x' }, display_message: HOSTILE },
      { type: 'comment', content: HOSTILE, actor: { name: HOSTILE } },
      { action_type: 'document_uploaded', metadata: { filename: HOSTILE } },
      { description: HOSTILE },
    ].forEach((activity) => {
      host.innerHTML = window.getActivityDescription(activity);
      expect(host.querySelector('img')).toBeNull();
    });
  });

  test('matter card handlers get the matter id as one string', () => {
    const window = boot(['time-utils.js', 'lex/lex.core.js']);
    window.eval('var selectedMatters = new Set(); function statusBadge() { return \'\'; }\n'
      + extract('escapeHtml') + '\n' + (PAGE.includes('function jsArg(') ? extract('jsArg') : '') + '\n'
      + extract('formatDate') + '\n' + extract('renderMatterCard') + '\nwindow.renderMatterCard = renderMatterCard;');
    const evil = "m1');window.__pwned=1;//";
    const host = window.document.createElement('div');
    host.innerHTML = window.renderMatterCard({ matter_id: evil, name: HOSTILE, source: evil, is_pinned: '1);window.__pwned=1;//' });
    const calls = [];
    ['toggleMatterSelection', 'viewMatter', 'togglePin'].forEach((n) => { window[n] = (id) => calls.push(id); });
    host.querySelectorAll('[onclick]').forEach((el) => {
      const code = el.getAttribute('onclick');
      if (/toggleMatterSelection|viewMatter|togglePin/.test(code)) new window.Function('event', code)({ stopPropagation() {} });
    });
    expect(window.__pwned).toBeUndefined();
    expect(calls).toEqual([evil, evil, evil]);
  });

  test('contact card keeps synced contact fields and ids inert', () => {
    const window = boot(['time-utils.js', 'lex/lex.core.js']);
    window.eval(extract('escapeHtml') + '\n' + extract('jsArg') + '\nvar matter = { matter_id: "m1" };\n' + extract('renderContactCard')
      + '\nwindow.renderContactCard = renderContactCard;');
    const evil = "x');window.__pwned=1;//" + HOSTILE;
    const host = window.document.createElement('div');
    host.innerHTML = window.renderContactCard({ id: evil, display_name: HOSTILE, email: HOSTILE, title: HOSTILE, company_name: HOSTILE, phone_mobile: HOSTILE, role: 'client', link_type: 'linked' });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[onfocus], [data-pwn]')).toBeNull();
    const calls = [];
    window.openContactDetail = (id) => calls.push(id);
    window.unlinkContactFromMatter = (id) => calls.push(id);
    host.querySelectorAll('[onclick]').forEach((el) => {
      const code = el.getAttribute('onclick');
      if (/openContactDetail|unlinkContactFromMatter/.test(code)) new window.Function('event', code)({ stopPropagation() {} });
    });
    expect(window.__pwned).toBeUndefined();
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((id) => expect(id).toBe(evil));
  });
});

describe('integrations/connectors.html cards', () => {
  const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'integrations', 'connectors.html'), 'utf8');
  function extract(name) {
    const start = PAGE.indexOf('function ' + name + '(');
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = PAGE.indexOf('{', start); i < PAGE.length; i++) {
      if (PAGE[i] === '{') depth += 1;
      else if (PAGE[i] === '}' && --depth === 0) return PAGE.slice(start, i + 1);
    }
    throw new Error('unbalanced ' + name);
  }
  const HOSTILE = '<img src=x onerror="window.__pwned=1">' + ATTACK;
  const EVIL_ID = "x');window.__pwned=1;//";

  function load() {
    const window = boot(['time-utils.js', 'lex/lex.core.js']);
    const helpers = PAGE.includes('function connectorJsArg(') ? extract('connectorJsArg') : '';
    window.eval('var ConnectorRegistry = { isConnectorInstalled: function () { return false; } };\n'
      + 'function getConnectorWithDefaults(c) { return c; }\nfunction timeAgo() { return \'now\'; }\n'
      + helpers + '\n' + extract('formatText') + '\n' + extract('renderConnectorCard') + '\n' + extract('renderAvailableConnectorCard')
      + '\nwindow.renderConnectorCard = renderConnectorCard; window.renderAvailableConnectorCard = renderAvailableConnectorCard;');
    return window;
  }

  function check(window, html) {
    const host = window.document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelectorAll('img').length).toBe(1);
    const img = host.querySelector('img');
    expect(img.getAttribute('alt')).toBe(HOSTILE);
    expect(host.querySelector('[onfocus], [data-pwn]')).toBeNull();
    const calls = [];
    ['showConnectorDetails', 'showConnectorActionsModal', 'installConnector', 'openConnector'].forEach((n) => { window[n] = (id) => calls.push(id); });
    host.querySelectorAll('button[onclick]').forEach((el) => new window.Function('event', el.getAttribute('onclick'))({ stopPropagation() {} }));
    expect(window.__pwned).toBeUndefined();
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((id) => expect(id).toBe(EVIL_ID));
  }

  test('installed connector card', () => {
    const window = load();
    check(window, window.renderConnectorCard({ id: EVIL_ID, name: HOSTILE, description: HOSTILE, vendor: HOSTILE, logo_url: 'x.png', status: 'connected', category: 'crm' }));
  });

  test('catalog connector card', () => {
    const window = load();
    check(window, window.renderAvailableConnectorCard({ id: EVIL_ID, name: HOSTILE, description: HOSTILE, vendor: HOSTILE, logo_url: 'x.png', status: 'active', category: 'crm' }, []));
  });
});
