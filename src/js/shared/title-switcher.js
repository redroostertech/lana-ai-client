/* Title switcher: the one header title dropdown. On a page that has items
   like it (a matter, an admin page, a report, a dashboard) the shell title
   becomes a searchable Lex select of those items, and picking one opens it.
   Every page uses this component and css/title-switcher.css, so they look
   the same.

   TitleSwitcher.render({
     id: 'reportSwitcher', placeholder: 'Search reports...',
     options: [{ value, label, description?, group? }], value: currentValue,
     onPick: function (value) { ... }   // only for a different item
   });
   TitleSwitcher.restore();             // put the plain title back

   The switcher belongs to the page that drew it: the lex-app shell and its
   topbar stay across pages, so when the app moves to a different page
   (lex-page-ready for another path) the plain title comes back by itself.
   Labels go to lex-select as data, which escapes them. */

(function (global) {
  'use strict';

  var ownerPath = null;

  function pagePath(value) {
    return String(value || '').split(/[?#]/)[0].replace(/^\/+/, '');
  }

  function currentPath() {
    var state = global.history && global.history.state;
    return pagePath((state && state.path) || global.location.pathname);
  }

  function render(config) {
    var doc = global.document;
    var wrapper = doc.querySelector('lex-topbar .title-switcher');
    var heading = doc.querySelector('lex-topbar .lex-topbar-heading');
    if ((!wrapper && !heading) || !config || !config.options || !config.options.length) return null;

    if (!wrapper) {
      wrapper = doc.createElement('div');
      wrapper.className = 'title-switcher';
      heading.replaceWith(wrapper);
    }
    ownerPath = currentPath();

    var select = doc.createElement('lex-select');
    select.id = config.id;
    select.setAttribute('name', config.id);
    select.setAttribute('placeholder', config.placeholder || '');
    select.setAttribute('searchable', '');
    wrapper.innerHTML = '';
    wrapper.appendChild(select);
    select.options = config.options;
    select.value = config.value || '';
    select.addEventListener('lex-change', function (event) {
      var value = event.detail && event.detail.value;
      if (value && value !== config.value && typeof config.onPick === 'function') config.onPick(value);
    });
    return select;
  }

  function restore() {
    var doc = global.document;
    var topbar = doc.querySelector('lex-topbar');
    var wrapper = topbar && topbar.querySelector('.title-switcher');
    ownerPath = null;
    if (!wrapper) return;
    var h1 = doc.createElement('h1');
    h1.className = 'lex-topbar-heading';
    h1.textContent = topbar.heading || '';
    wrapper.replaceWith(h1);
  }

  if (global.document && global.document.addEventListener) {
    global.document.addEventListener('lex-page-ready', function (event) {
      var next = pagePath(event.detail && event.detail.path);
      if (ownerPath !== null && next !== ownerPath) restore();
    });
  }

  global.TitleSwitcher = { render: render, restore: restore };
})(window);
