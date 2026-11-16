'use strict';

// Chat answers (Lex.ChatFormat) and AI text blocks (text.block.js) are model
// output, and a prompt-injected document can make the model echo markup.
// Both go into innerHTML in a window that can read the login token, so raw
// HTML must render as text and markdown links must pass LanaSafeUrl.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.resolve(__dirname, '../../src');
const SafeUrl = require(path.join(SRC, 'js/shared/safe-url.js'));
const SAFE_HTML_SRC = fs.readFileSync(path.join(SRC, 'js/shared/safe-html.js'), 'utf8');

function load(rel, setup) {
  const dom = new JSDOM('<!doctype html><body><div id="out"></div></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.LanaSafeUrl = SafeUrl;
  window.eval(SAFE_HTML_SRC);
  setup(window);
  window.eval(fs.readFileSync(path.join(SRC, rel), 'utf8'));
  return window;
}

function render(window, html) {
  const out = window.document.getElementById('out');
  out.innerHTML = html;
  return out;
}

describe('Lex.ChatFormat.format', () => {
  const window = load('js/lex/chat/lex-chat.format.js', (w) => { w.Lex = {}; });
  const format = (text) => render(window, window.Lex.ChatFormat.format(text));

  test('raw model HTML renders as text, not elements', () => {
    const out = format('Here <img src=x onerror="top.lanaAuthToken.get()"> and <script>1</script> <iframe srcdoc="x"></iframe>');
    expect(out.querySelector('img, script, iframe')).toBeNull();
    expect(out.textContent).toContain('<img src=x onerror="top.lanaAuthToken.get()">');
  });

  test('raw HTML inside tables, lists, quotes and bold is text too', () => {
    const out = format('| a | b |\n|---|---|\n| <img src=x onerror=1> | ok |\n\n- <svg onload=1>\n\n> <a href="javascript:1">q</a>\n\n**<b onclick=1>x</b>**');
    expect(out.querySelector('img, svg, [onclick], a[href^="javascript"]')).toBeNull();
    expect(out.querySelector('table')).not.toBeNull();
    expect(out.querySelector('blockquote')).not.toBeNull();
  });

  test('a javascript: or lookalike markdown link stays plain text', () => {
    ['[click](javascript:top.lanaAuthToken.get)', '[x](https :/../../e.html)', '[d](data:text/html,hi)', '[f](file:///etc/hosts)']
      .forEach((md) => expect(format(md).querySelector('a')).toBeNull());
  });

  test('http(s) and mailto links still render, written as the parsed href', () => {
    const out = format('See [docs](https://a.example/x?y=1&z=2) or [mail](mailto:a@b.example).');
    const links = Array.from(out.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['https://a.example/x?y=1&z=2', 'mailto:a@b.example']);
  });

  test('code still shows "<" literally, once', () => {
    const out = format('Use `a<b` here\n\n```html\n<b>code</b>\n```');
    const codes = Array.from(out.querySelectorAll('code')).map((c) => c.textContent);
    expect(codes).toEqual(['a<b', '<b>code</b>']);
  });

  test('PDF citations and markdown headings keep working', () => {
    const out = format('# Title\n\nSee [Will.pdf:3] and [Will.pdf, page 2](https://x.example/storage/download/abc).');
    expect(out.querySelector('h1').textContent).toBe('Title');
    const buttons = out.querySelectorAll('button.lex-chat-citation-link');
    expect(buttons.length).toBe(2);
    expect(buttons[1].getAttribute('data-document-id')).toBe('abc');
  });

  // Attribute values built from model text or backend citations must not
  // break out of their quotes (autofocus + onfocus fires without a click).
  const HANDLERS = '[onfocus],[autofocus],[onmouseover],[onclick],[onerror],[onload]';

  test('a [file.pdf] citation cannot break out of data-filename or title', () => {
    const out = format('See [x" autofocus onfocus="top.lanaAuthToken.get()" y=".pdf:3] now');
    expect(out.querySelector(HANDLERS)).toBeNull();
    const button = out.querySelector('button.lex-chat-citation-link');
    expect(button.getAttribute('data-filename')).toBe('x" autofocus onfocus="top.lanaAuthToken.get()" y=".pdf');
  });

  test('a markdown PDF citation link cannot break out of its button attributes', () => {
    const out = format('[x" onfocus="top.lanaAuthToken.get()" autofocus y=".pdf, page 2](https://x.example/storage/download/abc)');
    expect(out.querySelector(HANDLERS)).toBeNull();
    expect(out.querySelector('button').getAttribute('data-filename')).toBe('x" onfocus="top.lanaAuthToken.get()" autofocus y=".pdf');
  });

  test('a mailto link with quotes cannot add attributes, and the quote is percent-encoded', () => {
    const out = format('[m](mailto:a"onmouseover="top.lanaAuthToken.get()"@b.example)');
    expect(out.querySelector(HANDLERS)).toBeNull();
    const link = out.querySelector('a');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).not.toContain('"');
    expect(link.getAttribute('href')).toContain('%22');
  });

  test('backend citation filenames cannot break out in (extracts N) links', () => {
    const html = window.Lex.ChatFormat.format('As shown (extracts 1)', [{ document_id: 'd"1', filename: 'x" onmouseover="top.lanaAuthToken.get()', page_number: 2 }]);
    const out = render(window, html);
    expect(out.querySelector('[onmouseover]')).toBeNull();
    const link = out.querySelector('a.lex-chat-citation-link');
    expect(link.getAttribute('data-filename')).toBe('x" onmouseover="top.lanaAuthToken.get()');
    expect(link.getAttribute('data-document-id')).toBe('d"1');
  });

  test('escapeHtml escapes quotes for attribute use', () => {
    expect(window.Lex.ChatFormat.escapeHtml(`<a href="x" title='y'>&`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
  });

  test('simple formatting HTML from the model survives, without attributes', () => {
    const out = format('H<sub>2</sub>O and x<sup>2</sup>, <u onclick="top.t()">under</u>, press <kbd>Ctrl</kbd>, <em>e</em> <strong>s</strong> <b>b</b> <i>i</i>\n\n| a | b |\n|---|---|\n| one<br>two | ok |\n\n<details><summary>More</summary>Hidden</details>');
    ['sub', 'sup', 'u', 'kbd', 'em', 'strong', 'td br', 'details summary'].forEach((sel) => expect(out.querySelector(sel)).not.toBeNull());
    expect(out.querySelector(HANDLERS)).toBeNull();
  });

  test('anything outside the small allowlist still renders as text, and plain "<" stays correct', () => {
    const out = format('if x<y and y>z then <img src=x onerror="top.t()"> <span style="x">s</span>');
    expect(out.querySelector('img, span[style]')).toBeNull();
    expect(out.textContent).toContain('if x<y and y>z then <img src=x onerror="top.t()">');
  });

  test('model formatting tags carry no class, data-* or other attributes', () => {
    const out = format('<b class="lex-chat-citation-link fixed inset-0 z-50" data-document-id="OTHER" data-page="1">x</b> <code class="lex-chat-citation-link" data-filename="a.pdf">c</code> <u title="t">u</u>');
    ['b', 'code', 'u'].forEach((tag) => {
      const el = out.querySelector(tag);
      expect(el).not.toBeNull();
      expect(el.attributes.length).toBe(0);
    });
    expect(out.querySelector('.lex-chat-citation-link, [data-document-id], .fixed')).toBeNull();
  });

  test('a code block inside a model tag attribute cannot be spliced in after sanitizing', () => {
    const out = format('<b title="```\nx" onmouseover="top.lanaAuthToken.get()\n```">t</b> and [x```\n"><img src=x onerror="top.t()">\n```.pdf:2] \uE001' + '0\uE002');
    expect(out.querySelector('[onmouseover], [onerror], img')).toBeNull();
    out.querySelectorAll('b').forEach((b) => expect(b.attributes.length).toBe(0));
    out.querySelectorAll('[data-filename],[title]').forEach((el) => {
      expect(el.getAttribute('data-filename') || '').not.toMatch(/[\uE000-\uF8FF]|<img/);
    });
  });

  test('backend citation links are built before the sanitizer and carry no inline handler', () => {
    const html = window.Lex.ChatFormat.format('See (extracts 1)', [{ document_id: 'd1', filename: 'Will.pdf', page_number: 3 }]);
    const out = render(window, html);
    const link = out.querySelector('a.lex-chat-citation-link');
    expect(link).not.toBeNull();
    expect(link.getAttribute('onclick')).toBeNull();
    expect(link.getAttribute('data-citation-num')).toBe('1');
    expect(link.getAttribute('data-document-id')).toBe('d1');
  });

  test('an (extracts N) pattern inside a model tag attribute cannot splice a citation link in', () => {
    const html = window.Lex.ChatFormat.format('<b title="(extracts 1)">x</b>', [{ document_id: 'd1', filename: 'Will.pdf', page_number: 1 }]);
    const out = render(window, html);
    out.querySelectorAll('b').forEach((b) => expect(b.attributes.length).toBe(0));
    expect(out.querySelector('b.lex-chat-citation-link, [onclick]')).toBeNull();
  });

  test('markdown links allow the same safe app paths as text blocks', () => {
    const out = format('[notes](workspace-details.html?id=1#notes) [top](#summary) [bad](../../x.html) [enc](javascript%3Aalert(1))');
    const hrefs = Array.from(out.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['workspace-details.html?id=1#notes', '#summary']);
  });

  test('app-path and #anchor links stay in the window; only http(s) and mailto open a new tab', () => {
    const out = format('[notes](workspace-details.html?id=1) [top](#summary) [web](https://a.example) [mail](mailto:a@b.example)');
    const links = Array.from(out.querySelectorAll('a')).map((a) => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]);
    expect(links).toEqual([
      ['workspace-details.html?id=1', null, null],
      ['#summary', null, null],
      ['https://a.example/', '_blank', 'noopener noreferrer'],
      ['mailto:a@b.example', '_blank', 'noopener noreferrer']
    ]);
  });

  // Behaviour, not just attributes: render a chat answer inside an SPA
  // route (lex-router) and click its links.
  function routedChat(descriptors) {
    const { VirtualConsole } = require('jsdom');
    const virtualConsole = new VirtualConsole();
    const navigationErrors = [];
    virtualConsole.on('jsdomError', (err) => {
      const text = String((err && err.message) || err);
      if (/navigation/i.test(text)) navigationErrors.push(text);
    });
    const dom = new JSDOM('<!doctype html><body><div id="content"></div><h2 id="summary">Summary</h2></body>', {
      url: 'file:///Applications/LANA.app/Contents/Resources/app/public_html/app.html',
      runScripts: 'outside-only',
      virtualConsole
    });
    const w = dom.window;
    w.LanaSafeUrl = SafeUrl;
    w.eval(SAFE_HTML_SRC);
    w.Lex = {};
    w.eval(fs.readFileSync(path.join(SRC, 'js/lex/chat/lex-chat.format.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(SRC, 'js/lex/lex-router.js'), 'utf8'));
    w.LexRouter.setPageDescriptors(descriptors || {});
    w.LexRouter.start('/standalone-start.html');
    navigationErrors.length = 0;
    return { w, navigationErrors, content: w.document.getElementById('content') };
  }

  function click(w, el) {
    const event = new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    el.dispatchEvent(event);
    return event;
  }

  test('clicking a model #anchor link inside a routed page jumps in place and never navigates away', async () => {
    const { w, navigationErrors, content } = routedChat();
    content.innerHTML = w.Lex.ChatFormat.format('See [the summary](#summary).');
    const link = content.querySelector('a');
    expect(link.getAttribute('href')).toBe('#summary');
    click(w, link);
    // A native fragment navigation adds a history entry whose state is null.
    w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigationErrors).toEqual([]);
    expect(w.location.pathname).toBe('/Applications/LANA.app/Contents/Resources/app/public_html/app.html');
    // Real back/forward entries (state.path) are still routed.
    w.dispatchEvent(new w.PopStateEvent('popstate', { state: { path: '/another-standalone.html' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigationErrors.length).toBe(1);
  });

  test('clicking a model app-path link is routed in the window, not opened as a popup', () => {
    const { w, content } = routedChat({ 'workspace-details.html': { title: 'Matter', scripts: [] } });
    const go = jest.fn();
    w.Lex.Nav = { go };
    let opened = 0;
    w.open = () => { opened += 1; return null; };
    content.innerHTML = w.Lex.ChatFormat.format('Open [the matter](workspace-details.html?id=1).');
    const event = click(w, content.querySelector('a'));
    expect(event.defaultPrevented).toBe(true);
    expect(go).toHaveBeenCalledWith('workspace-details.html?id=1');
    expect(opened).toBe(0);
  });

  test('without LanaSafeHtml, even the allowed formatting tags fail closed to text', () => {
    const bare = load('js/lex/chat/lex-chat.format.js', (w) => { w.Lex = {}; delete w.LanaSafeHtml; });
    const out = render(bare, bare.Lex.ChatFormat.format('x<sup>2</sup> [b](https://a.example)'));
    expect(out.querySelector('sup')).toBeNull();
    expect(out.textContent).toContain('x<sup>2</sup>');
  });

  test('without LanaSafeUrl, links fail closed to text', () => {
    const bare = load('js/lex/chat/lex-chat.format.js', (w) => { w.Lex = {}; });
    delete bare.LanaSafeUrl;
    expect(render(bare, bare.Lex.ChatFormat.format('[a](https://a.example)')).querySelector('a')).toBeNull();
  });
});

describe('text.block.js (AI text blocks)', () => {
  let renderer;
  const window = load('js/lex/blocks/text.block.js', (w) => {
    w.Lex = { SchemaRegistry: { register: (_name, _schema, fn) => { renderer = fn; } } };
  });
  const renderBlock = (content) => {
    const out = window.document.getElementById('out');
    renderer(out, { type: 'text', content });
    return out;
  };

  test('raw HTML renders as text', () => {
    const out = renderBlock('Hi <img src=x onerror="top.lanaAuthToken.get()"> **bold <i>x</i>**');
    expect(out.querySelector('img, i')).toBeNull();
    expect(out.querySelector('strong')).not.toBeNull();
    expect(out.textContent).toContain('<img src=x onerror="top.lanaAuthToken.get()">');
  });

  test('only http(s), mailto and app-path links render, with rel noopener', () => {
    const out = renderBlock('[a](https://a.example) [b](javascript:alert(1)) [c](matters.html?id=1) [d](../../x.html) [e](https :/../x)');
    const links = Array.from(out.querySelectorAll('a')).map((a) => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]);
    // App paths stay in the window (lex-router handles them); only http(s)
    // and mailto open a new tab.
    expect(links).toEqual([['https://a.example/', '_blank', 'noopener noreferrer'], ['matters.html?id=1', null, null]]);
    expect(out.textContent).toContain('b');
  });

  test('code keeps "<" literally, once', () => {
    const out = renderBlock('`a<b`\n\n```\n<b>c</b>\n```');
    expect(Array.from(out.querySelectorAll('code')).map((c) => c.textContent)).toEqual(['a<b', '<b>c</b>']);
  });
});

describe('LanaSafeHtml.renderMarkdown (doc generation, insights, reporting, metadata)', () => {
  const MARKED_SRC = fs.readFileSync(path.join(SRC, 'js/vendor/marked.min.js'), 'utf8');
  const window = load('js/shared/safe-html.js', (w) => { w.eval(MARKED_SRC); });

  test('model markdown keeps its formatting and loses script, handlers and bad links', () => {
    const md = '# Will draft\n\n**Bold** and [ok](https://a.example) and [bad](javascript:top.lanaAuthToken.get()) <img src=x onerror="top.t()"> <iframe srcdoc="x"></iframe>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- item';
    const out = render(window, window.LanaSafeHtml.renderMarkdown(md));
    expect(out.querySelector('h1').textContent).toBe('Will draft');
    expect(out.querySelector('strong')).not.toBeNull();
    expect(out.querySelector('table td')).not.toBeNull();
    expect(out.querySelector('li')).not.toBeNull();
    expect(out.querySelector('iframe, script, [onerror], img')).toBeNull();
    expect(out.textContent).toContain('<img src=x onerror="top.t()">');
    const links = Array.from(out.querySelectorAll('a')).map((a) => [a.getAttribute('href'), a.getAttribute('target')]);
    expect(links).toEqual([['https://a.example/', '_blank']]);
    expect(out.textContent).toContain('bad');
  });

  test('inline rendering is sanitized too', () => {
    const out = render(window, window.LanaSafeHtml.renderMarkdown('a *b* <img src=x onerror=1>', { inline: true }));
    expect(out.querySelector('em')).not.toBeNull();
    expect(out.querySelector('[onerror], img')).toBeNull();
    expect(out.textContent).toContain('<img src=x onerror=1>');
  });

  test('without marked it escapes and keeps line breaks', () => {
    const bare = load('js/shared/safe-html.js', () => {});
    const out = render(bare, bare.LanaSafeHtml.renderMarkdown('a <img src=x onerror=1>\nb'));
    expect(out.querySelector('img')).toBeNull();
    expect(out.querySelectorAll('br').length).toBe(1);
    expect(out.textContent).toContain('<img src=x onerror=1>');
  });
});

describe('renderMarkdown line breaks match each caller', () => {
  const MARKED_SRC = fs.readFileSync(path.join(SRC, 'js/vendor/marked.min.js'), 'utf8');
  const window = load('js/shared/safe-html.js', (w) => { w.eval(MARKED_SRC); });

  test('breaks: true turns single newlines into <br>, block and inline', () => {
    expect(render(window, window.LanaSafeHtml.renderMarkdown('one\ntwo', { breaks: true })).querySelectorAll('br').length).toBe(1);
    expect(render(window, window.LanaSafeHtml.renderMarkdown('one\ntwo', { inline: true, breaks: true })).querySelectorAll('br').length).toBe(1);
  });

  test('without breaks a single newline stays a soft break (the default for other callers)', () => {
    expect(render(window, window.LanaSafeHtml.renderMarkdown('one\ntwo')).querySelectorAll('br').length).toBe(0);
  });

  test('breaks keeps the same hardening', () => {
    const out = render(window, window.LanaSafeHtml.renderMarkdown('a\n![x](https://t.example/p.png)\n<img src=x onerror=1>', { breaks: true }));
    expect(out.querySelector('img, [onerror]')).toBeNull();
  });
});
