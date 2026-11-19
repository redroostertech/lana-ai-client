'use strict';

/**
 * Help, FAQ and article pages read the live help center (js/config.js HELP_CENTER_API) and show
 * an offline message when it cannot be reached. No local mock content is used any more.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the pages use the configured help center on the allowed origin, and no mock data', () => {
  const config = read('src/js/config.js');
  const match = /HELP_CENTER_API:\s*'([^']+)'/.exec(config);
  expect(match).not.toBeNull();
  const { HELP_CENTER_ORIGIN } = require('../../electron-discovery');
  expect(new URL(match[1]).origin).toBe(HELP_CENTER_ORIGIN);
  for (const file of ['src/js/help.js', 'src/js/faq.js', 'src/js/article.js']) {
    const source = read(file);
    expect({ file, mock: /mock-data\/|loadMock/.test(source) }).toEqual({ file, mock: false });
    expect({ file, hardcoded: /https?:\/\/[^'"`\s]*redroostertec\.com/.test(source) }).toEqual({ file, hardcoded: false });
    expect(source).toMatch(/LanaConfig\.HELP_CENTER_API/);
  }
  for (const file of ['src/mock-data/help-data.json', 'src/mock-data/faq-data.json']) {
    expect({ file, exists: fs.existsSync(path.join(ROOT, file)) }).toEqual({ file, exists: false });
  }
});

function element(id) {
  const classes = new Set(['hidden']);
  return {
    id, textContent: '', innerHTML: '', value: '', dataset: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle() {} },
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelectorAll: () => [],
    querySelector: (selector) => element(`${id} ${selector}`),
    setAttribute() {}, appendChild() {}, style: {}
  };
}

function loadPage(file, fetchImpl, search = '') {
  const elements = new Map();
  const document = {
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    createElement: () => element('x')
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document,
    fetch: fetchImpl,
    api: { token: 't', user: null },
    LanaConfig: { HELP_CENTER_API: 'https://www.redroostertec.com/lana-ai/v1' },
    Lex: { Utils: { formatDateLong: () => '' }, escapeHtml: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) },
    LanaSafeUrl: require('../../src/js/shared/safe-url.js'),
    LanaTime: { formatDate: () => '', formatDateTime: () => '', timeAgo: () => '' },
    location: { search, reload() {}, hash: '' },
    URLSearchParams,
    setTimeout, clearTimeout,
    Promise, JSON, URL
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read(file), sandbox, { filename: file });
  return { el: (id) => document.getElementById(id), sandbox };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test.each([
  ['src/js/help.js', 'helpError', '', 'https://www.redroostertec.com/lana-ai/v1/help'],
  ['src/js/faq.js', 'faqError', '', 'https://www.redroostertec.com/lana-ai/v1/faq'],
  ['src/js/article.js', 'articleError', '?id=quick-start&section=getting-started', 'https://www.redroostertec.com/lana-ai/v1/help']
])('%s: offline shows the help center message, with no mock fallback', async (file, errorId, search, expectedUrl) => {
  const urls = [];
  const page = loadPage(file, async (url) => { urls.push(String(url)); throw new TypeError('Failed to fetch'); }, search);
  await flush(); await flush();
  expect(urls).toEqual([expectedUrl]);
  expect(page.el(errorId).classList.contains('hidden')).toBe(false);
});

// Remote help center content is text: every field is escaped, and a link goes only to an
// https: address or a relative app path (js/shared/safe-url.js); anything else is plain text.
const EVIL = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
const hostileHelp = {
  sections: [{ id: 's"1', title: EVIL, description: EVIL, icon: EVIL, articles: [
    { id: 'a"1', title: EVIL, summary: EVIL, readTime: EVIL, content: '## ' + EVIL + '\n\n' + EVIL, tags: [EVIL], relatedArticles: ['a2'] },
    { id: 'a2', title: EVIL, summary: EVIL, readTime: 1, content: 'x' }
  ] }],
  quick_links: [
    { title: EVIL, description: EVIL, href: 'javascript:alert(1)', icon: 'mail' },
    { title: 'Docs', description: 'ok', href: 'https://lanaai.io/docs', icon: 'code', external: true },
    { title: 'Contact', description: 'ok', href: '#contact-support', icon: 'mail' },
    { title: 'Plain', description: 'ok', href: 'http://insecure.example/x', icon: 'mail' },
    { title: 'Quote', description: 'ok', href: 'https://lanaai.io/" onmouseover="alert(1)', icon: 'mail' }
  ]
};
const hostileFaq = { categories: [{ id: 'c"1', title: EVIL, description: EVIL, icon: EVIL, faqs: [{ id: 'f"1', question: EVIL, answer: EVIL + '\n\n' + EVIL, tags: [EVIL] }] }], popularFaqs: ['f"1'] };

function answering(map) {
  return async (url) => {
    const key = Object.keys(map).find((k) => String(url).endsWith(k));
    return { ok: true, status: 200, json: async () => map[key] };
  };
}

// No new element or attribute from the content: no tags, and no attribute starting after a space.
function expectInert(html) {
  expect(html).not.toMatch(/<script|<img|<[^>]*\son[a-z]+=|javascript:/i);
}

describe('hostile help center content stays text', () => {
  test('help.js: quick links, sections and cards', async () => {
    const page = loadPage('src/js/help.js', answering({ '/help': hostileHelp, '/faq': hostileFaq }));
    await flush(); await flush();
    const links = page.el('quickLinks').innerHTML;
    expectInert(links);
    expect(links).toContain('&lt;script&gt;');
    expect(links).toContain('href="https://lanaai.io/docs"');
    expect(links).toContain('href="#contact-support"');
    // javascript: and http: are shown as plain text, not links; the quote stays inside the
    // (percent-encoded) https: address.
    expect((links.match(/<a /g) || []).length).toBe(3);
    expect(links).toContain('href="https://lanaai.io/%22%20onmouseover=%22alert(1)"');
    expectInert(page.el('helpSections').innerHTML);
  });

  test('faq.js: tabs, categories, questions, answers and tags', async () => {
    const page = loadPage('src/js/faq.js', answering({ '/faq': hostileFaq }));
    await flush(); await flush();
    expectInert(page.el('faqCategories').innerHTML);
    expectInert(page.el('popularFaqsList').innerHTML);
    expect(page.el('faqCategories').innerHTML).toContain('&lt;script&gt;');
  });

  test('article.js: tags, content and related articles', async () => {
    const page = loadPage('src/js/article.js', answering({ '/help': hostileHelp }), '?id=a%221&section=s%221');
    await flush(); await flush();
    for (const id of ['articleTags', 'articleContent', 'relatedArticlesList']) expectInert(page.el(id).innerHTML);
    expect(page.el('articleContent').innerHTML).toContain('<h2>');
    expect(page.el('relatedArticlesList').innerHTML).toContain('article.html?section=s%221&amp;id=a2');
  });
});

describe('every value in the help pages\' markup is escaped or a number', () => {
  const { scanTemplates, classify } = require('./helpers/template-interpolation-scan');

  test('the scanner catches unescaped values and passes escaped ones', () => {
    const bad = scanTemplates('x.innerHTML = `<b data-id="${item.id}">${esc(item.title)} ${item.n || 0}</b>`;');
    expect(bad.map((p) => [p.expr, classify(p.expr)])).toEqual([['item.id', 'unsafe'], ['esc(item.title)', 'safe'], ['item.n || 0', 'unsafe']]);
    // Templates without markup (log lines, URLs) are not markup.
    expect(scanTemplates('console.log(`vote ${id}`);')).toEqual([]);
  });

  test.each(['src/js/help.js', 'src/js/faq.js', 'src/js/article.js'])('%s', (file) => {
    const unsafe = scanTemplates(read(file)).filter((part) => classify(part.expr) === 'unsafe').map((part) => `${part.line}: ${part.expr}`);
    expect(unsafe).toEqual([]);
  });
});

describe('hostile FAQ related questions and counts', () => {
  const related = {
    categories: [{ id: 'c1', title: 'C', description: 'd', icon: 'info', faqs: [
      { id: 'f1', question: 'Q1', answer: 'A1', helpful: '<img src=x onerror=alert(1)>', notHelpful: '" data-on-click="danger', relatedFaqs: ['x" data-on-click="someAction'] },
      { id: 'x" data-on-click="someAction', question: '<img src=x onerror=alert(1)>', answer: 'A2', relatedFaqs: [] }
    ] }],
    popularFaqs: []
  };

  test('related ids and questions are escaped, and counts are numbers', async () => {
    const page = loadPage('src/js/faq.js', answering({ '/faq': related }));
    await flush(); await flush();
    const html = page.el('faqCategories').innerHTML;
    expectInert(html);
    // The id stays inside its attribute: no data-on-click attribute is created.
    // A real attribute would follow a closing quote; the escaped one follows &quot;.
    expect(html).not.toMatch(/"\s+data-on-click=/);
    expect(html).toContain('data-faq-id="x&quot; data-on-click=&quot;someAction"');
    expect(html).toContain('0 helpful');
    expect(html).toContain('0 not helpful');
  });
});

describe('the help center gets no LANA credentials', () => {
  // www.redroostertec.com's help, FAQ, feedback and contact endpoints take no auth
  // (RedRoosterTech-Web routes/lana-ai.js); the firm's bearer token must never go there.
  test.each(['src/js/help.js', 'src/js/faq.js', 'src/js/article.js'])('%s sends no Authorization header or token', async (file) => {
    const source = read(file);
    expect(source).not.toMatch(/Authorization|api\.token|credentials:\s*'include'/);
    const requests = [];
    const page = loadPage(file, async (url, init) => { requests.push({ url: String(url), init: init || {} }); throw new TypeError('offline'); }, '?id=a&section=s');
    await flush(); await flush();
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      const headers = request.init.headers || {};
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
      expect(request.init.credentials || 'omit').toBe('omit');
    }
    expect(page).toBeTruthy();
  });

  test('FAQ feedback sends what the help center expects: { helpful: true|false }', () => {
    const faq = read('src/js/faq.js');
    expect(faq).toMatch(/body: JSON\.stringify\(\{ helpful: vote === 'helpful' \}\)/);
  });
});

test('article.js offline shows Try again, which reloads; "not found" does not', async () => {
  const reloads = [];
  const offline = loadPage('src/js/article.js', async () => { throw new TypeError('offline'); }, '?id=a&section=s');
  offline.sandbox.location.reload = () => reloads.push(1);
  await flush(); await flush();
  const retry = offline.el('retryLoadArticle');
  expect(retry.classList.contains('hidden')).toBe(false);
  retry.listeners.click();
  expect(reloads).toHaveLength(1);
  const missing = loadPage('src/js/article.js', answering({ '/help': hostileHelp }), '?id=nope&section=nope');
  await flush(); await flush();
  expect(missing.el('retryLoadArticle').classList.contains('hidden')).toBe(true);
  expect(read('src/article.html')).toMatch(/id="retryLoadArticle"[^>]*class="hidden/);
});

test('the help pages log no personal data (the contact form, its answers)', () => {
  // Any console call that passes a value other than an error or a status names it here.
  const PERSONAL = /\b(formData|name|email|message|subject|organization|result|errorData|user)\b/;
  const offenders = [];
  for (const file of ['src/js/help.js', 'src/js/faq.js', 'src/js/article.js']) {
    const lines = read(file).split('\n');
    lines.forEach((line, index) => {
      const call = /console\.(log|info|warn|error|debug)\(([\s\S]*)\)/.exec(line);
      if (!call) return;
      // The message text itself may say "email"; only the values passed after it count.
      const values = call[2].replace(/^(['"`])(?:(?!\1)[^\\]|\\.)*\1\s*,?/, '');
      if (PERSONAL.test(values)) offenders.push(`${file}:${index + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});

test('the article page has no "Was this helpful" control or call (the help center has no such endpoint)', () => {
  expect(read('src/article.html')).not.toMatch(/helpfulYes|helpfulNo|feedbackMessage|Was this article helpful/);
  expect(read('src/js/article.js')).not.toMatch(/\/feedback|recordFeedback|helpfulYes/);
});
