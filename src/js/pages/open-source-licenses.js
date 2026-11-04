/* open-source-licenses.js - the Open-source licenses page (Help > Open-source licenses).

   Lists every third-party library, font and runtime the LANA AI client ships, with its
   license, copyright and full license text. The data is generated at build time
   (js/pages/open-source-licenses.data.js from scripts/licenses/generate.js) and the
   shaping lives in js/pages/open-source-licenses.model.js.

   Rules (LEX-COMPONENT-RULES.md):
     - IIFE wrapper, no top-level const/class
     - Text goes in through textContent only (no innerHTML with data)
     - NO regex, string methods only
*/

(function () {
  'use strict';

  var _query = '';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function itemCard(notices, item) {
    var Model = window.OpenSourceLicensesModel;
    var card = document.createElement('lex-card');
    card.setAttribute('variant', 'flat');
    card.setAttribute('padding', 'compact');
    card.setAttribute('heading', item.name);
    card.setAttribute('subtitle', Model.subtitleFor(item));
    card.setAttribute('expandable', '');
    card.className = 'oss-item';

    var body = el('div', 'oss-item-body');
    [item.attribution, item.modified, item.copyright, item.notes].forEach(function (line, index) {
      if (line) body.appendChild(el('p', index < 2 ? 'oss-item-line' : 'oss-item-meta', line));
    });
    if (item.shippedAs) body.appendChild(el('p', 'oss-item-meta', 'Shipped as ' + item.shippedAs));
    var link = el('a', 'oss-item-link', item.source);
    link.href = item.source;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    body.appendChild(link);
    Model.textsFor(notices, item).forEach(function (text) {
      body.appendChild(el('p', 'oss-text-title', text.title));
      body.appendChild(el('pre', 'oss-text', text.body));
    });
    card.appendChild(body);
    return card;
  }

  function render() {
    var list = document.getElementById('ossSections');
    var empty = document.getElementById('ossEmpty');
    var count = document.getElementById('ossCount');
    var notices = window.LanaOpenSourceNotices;
    var Model = window.OpenSourceLicensesModel;
    if (!list || !notices || !Model) return;

    var sections = Model.filterSections(notices, _query);
    list.textContent = '';
    sections.forEach(function (section) {
      var group = document.createElement('lex-card');
      group.setAttribute('heading', section.title + ' (' + section.items.length + ')');
      group.setAttribute('subtitle', section.detail);
      group.className = 'oss-section';
      var items = el('div', 'oss-items');
      section.items.forEach(function (item) { items.appendChild(itemCard(notices, item)); });
      group.appendChild(items);
      list.appendChild(group);
    });
    if (empty) empty.classList.toggle('hidden', sections.length !== 0);
    if (count) count.textContent = Model.totalCount(sections) + ' components. Version ' + notices.version + '.';
  }

  function init() {
    var content = document.getElementById('ossPage');
    if (!content) return;
    _query = '';
    var filter = document.getElementById('ossFilter');
    if (filter && !filter.dataset.ossBound) {
      filter.dataset.ossBound = '1';
      filter.addEventListener('lex-input', function (event) {
        _query = (event.detail && event.detail.value) || '';
        render();
      });
    }
    render();
  }

  if (window.LexRouter && typeof LexRouter.registerPageInit === 'function') {
    LexRouter.registerPageInit('open-source-licenses.html', init);
  }
  init();
})();
