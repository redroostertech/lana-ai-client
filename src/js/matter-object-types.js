/* Matter screen: which custom object types this matter uses (workspace-details.html).

   A type applies on a matter when the matter's makeup declares it or a
   person attached it here; each applied type is a tab. This drawer lists
   them, lets a person who may (the server says can_attach: matter owner or
   the configure makeup permission) add one from the firm's library or remove
   one they added, then asks the page to reload its tabs. The server checks
   every change again. View mapping: shared/custom-objects.js matterTypesView.
*/

(function () {
  'use strict';

  var shape = window.LanaCustomObjects;
  var client = new window.CustomObjectsAPIClient(window.api);
  var _matterId = null;
  var _onChanged = null;
  var _gen = 0;

  function el(id) { return document.getElementById(id); }

  function notice(message, isError) {
    var node = el('objectTypesNotice');
    node.textContent = message || '';
    node.hidden = !message;
    node.classList.toggle('matter-object-types__notice--error', Boolean(isError));
  }

  function row(entry, actionLabel, onAction) {
    var item = document.createElement('div');
    item.className = 'matter-object-types__row';
    var text = document.createElement('div');
    text.className = 'matter-object-types__text';
    var name = document.createElement('span');
    name.className = 'matter-object-types__name';
    name.textContent = entry.label;
    text.appendChild(name);
    if (entry.source) {
      var source = document.createElement('span');
      source.className = 'matter-object-types__source';
      source.textContent = entry.source;
      text.appendChild(source);
    }
    item.appendChild(text);
    if (onAction) {
      var button = document.createElement('lex-btn');
      button.setAttribute('variant', 'ghost');
      button.setAttribute('size', 'sm');
      button.textContent = actionLabel;
      button.addEventListener('click', onAction);
      item.appendChild(button);
    }
    return item;
  }

  async function change(work) {
    notice('');
    try {
      await work();
      await render();
      if (_onChanged) { await _onChanged(); }
    } catch (error) {
      notice(shape.errorText(error), true);
    }
  }

  async function render() {
    var gen = ++_gen;
    var answer = await client.matterTypes(_matterId, el('objectTypesSearch').value || '');
    if (gen !== _gen) { return; }
    var view = shape.matterTypesView(answer);
    var applied = el('objectTypesApplied');
    var available = el('objectTypesAvailable');
    applied.textContent = '';
    available.textContent = '';
    view.applied.forEach(function (entry) {
      applied.appendChild(row(entry, 'Remove', entry.canRemove ? function () {
        change(function () { return client.detach(_matterId, entry.id); });
      } : null));
    });
    view.available.forEach(function (entry) {
      available.appendChild(row(entry, 'Add', entry.canAdd ? function () {
        change(function () { return client.attach(_matterId, entry.id); });
      } : null));
    });
    el('objectTypesAppliedEmpty').hidden = view.applied.length > 0;
    el('objectTypesAvailableEmpty').hidden = view.available.length > 0;
    el('objectTypesReadOnly').hidden = view.canAttach;
  }

  var searchTimer = null;
  function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { render().catch(function (error) { notice(shape.errorText(error), true); }); }, 250);
  }

  /**
   * @param {{ matterId: string, onChanged: Function }} options
   */
  async function open(options) {
    _matterId = options.matterId;
    _onChanged = options.onChanged || null;
    var drawer = el('objectTypesDrawer');
    var search = el('objectTypesSearch');
    if (!search.dataset.wired) {
      search.dataset.wired = 'true';
      search.addEventListener('lex-input', onSearch);
    }
    search.value = '';
    notice('');
    drawer.open = true;
    try {
      await render();
    } catch (error) {
      notice(shape.errorText(error), true);
    }
  }

  window.LanaMatterObjectTypes = { open: open };
})();
