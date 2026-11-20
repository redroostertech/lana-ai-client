/* Title switcher: on a detail page (one dashboard, one report) the shell
   title becomes a searchable Lex select of the items like it, and picking
   one opens that item. Styles: css/detail-page.css (.detail-title-switcher).

   TitleSwitcher.render({
     id: 'reportSwitcher', placeholder: 'Search reports...',
     options: [{ value, label, description? }], value: currentValue,
     onPick: function (value) { ... }   // only for a different item
   });

   Labels go to lex-select as data, which escapes them. */

(function (global) {
  'use strict';

  function render(config) {
    var doc = global.document;
    var wrapper = doc.querySelector('lex-topbar .detail-title-switcher');
    var heading = doc.querySelector('lex-topbar .lex-topbar-heading');
    if ((!wrapper && !heading) || !config || !config.options || !config.options.length) return null;

    if (!wrapper) {
      wrapper = doc.createElement('div');
      wrapper.className = 'detail-title-switcher';
      heading.replaceWith(wrapper);
    }

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

  global.TitleSwitcher = { render: render };
})(window);
