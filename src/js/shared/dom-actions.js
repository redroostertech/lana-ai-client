/**
 * dom-actions.js: event handlers for markup that page scripts build as strings,
 * without inline on*="" attributes (the page CSP blocks those; see
 * docs/plans/harden-web.md).
 *
 * Markup names an action and its arguments in data attributes:
 *
 *   '<button' + LanaDomActions.on('click', 'viewMatter', [matter.matter_id], { stop: true }) + '>'
 *     -> <button data-on-click="viewMatter" data-args-click="[&quot;M1&quot;]" data-stop-click>
 *
 * and the page script registers the functions it may call:
 *
 *   LanaDomActions.register({ viewMatter, togglePin });
 *   LanaDomActions.registerGlobals(['viewMatter', 'conflictDetection.removeParty']);
 *
 * Only registered names run, so injected markup cannot name an arbitrary
 * global. Arguments are JSON, so an id or name is data, never code. Special
 * arguments: LanaDomActions.EVENT, ELEMENT, VALUE (element.value) and CHECKED
 * (element.checked).
 *
 * Each element gets a real listener of its own the first time an event of that
 * type passes the document (capture phase, so the listener still runs in this
 * same dispatch). Order and stopPropagation therefore behave as the inline
 * attribute did: stop: true stops the event at this element, before any
 * ancestor's listeners.
 *
 * Classic script (window.LanaDomActions); also requireable by Jest.
 */
(function (global) {
  'use strict';

  var TOKEN = '$lanaArg';
  var EVENT = Object.freeze({ $lanaArg: 'event' });
  var ELEMENT = Object.freeze({ $lanaArg: 'element' });
  var VALUE = Object.freeze({ $lanaArg: 'value' });
  var CHECKED = Object.freeze({ $lanaArg: 'checked' });
  var TYPES = ['click', 'dblclick', 'change', 'input', 'submit', 'keydown', 'keyup', 'keypress',
    'focus', 'blur', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
    'dragstart', 'dragend', 'dragover', 'dragenter', 'dragleave', 'drop', 'error', 'load'];
  var TYPE_PATTERN = /^[a-z]+$/;
  var NAME_PATTERN = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

  var actions = Object.create(null);
  var bound = typeof WeakMap === 'function' ? new WeakMap() : null;

  function escapeAttr(value) {
    return String(value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  /**
   * Register callable actions: register('name', fn) or register({ name: fn }).
   * A dotted name ('conflictDetection.removeParty') is just a key.
   */
  function register(name, fn) {
    if (name && typeof name === 'object') {
      Object.keys(name).forEach(function (key) { register(key, name[key]); });
      return;
    }
    if (!NAME_PATTERN.test(String(name)) || typeof fn !== 'function') {
      throw new Error('LanaDomActions.register: bad action ' + String(name));
    }
    actions[name] = fn;
  }

  function resolveGlobal(name) {
    var parts = String(name).split('.');
    var owner = global;
    for (var i = 0; i < parts.length - 1; i += 1) {
      owner = owner == null ? undefined : owner[parts[i]];
    }
    var fn = owner == null ? undefined : owner[parts[parts.length - 1]];
    return typeof fn === 'function' ? { owner: owner, fn: fn } : null;
  }

  /**
   * Register page globals by name ('viewMatter', 'conflictDetection.removeParty').
   * Each is looked up when the event fires, as an inline handler did, so a page
   * that defines or replaces the global later still works. Only these names run.
   */
  function registerGlobals(names) {
    (names || []).forEach(function (name) {
      register(name, function () {
        var target = resolveGlobal(name);
        if (!target) {
          if (global.console) global.console.warn('[LanaDomActions] ' + name + ' is not defined');
          return undefined;
        }
        return target.fn.apply(target.owner, arguments);
      });
    });
  }

  function has(name) {
    return Object.prototype.hasOwnProperty.call(actions, name);
  }

  /**
   * Attribute text (with a leading space) for one event on one element.
   * @param {string} type - event type without "on" ('click', 'change', 'drop')
   * @param {string|null} name - registered action, or null for stop/prevent only
   * @param {Array} [args]
   * @param {{ stop?: boolean, prevent?: boolean }} [options]
   */
  function on(type, name, args, options) {
    if (!TYPE_PATTERN.test(String(type))) throw new Error('LanaDomActions.on: bad event type');
    var out = '';
    if (name) {
      if (!NAME_PATTERN.test(String(name))) throw new Error('LanaDomActions.on: bad action name');
      out += ' data-on-' + type + '="' + escapeAttr(name) + '"';
      if (args && args.length) out += ' data-args-' + type + '="' + escapeAttr(JSON.stringify(args)) + '"';
    }
    if (options && options.stop) out += ' data-stop-' + type;
    if (options && options.prevent) out += ' data-prevent-' + type;
    return out;
  }

  /** Same as on(), for code that builds elements: sets the attributes on el. */
  function set(el, type, name, args, options) {
    var holder = global.document.createElement('div');
    holder.innerHTML = '<i' + on(type, name, args, options) + '></i>';
    var attrs = holder.firstChild.attributes;
    for (var i = 0; i < attrs.length; i += 1) el.setAttribute(attrs[i].name, attrs[i].value);
    return el;
  }

  function resolveArg(arg, el, event) {
    if (arg && typeof arg === 'object' && !Array.isArray(arg) && typeof arg[TOKEN] === 'string') {
      switch (arg[TOKEN]) {
        case 'event': return event;
        case 'element': return el;
        case 'value': return el.value;
        case 'checked': return el.checked;
        default: return undefined;
      }
    }
    return arg;
  }

  function run(el, type, event) {
    if (el.hasAttribute('data-stop-' + type)) event.stopPropagation();
    if (el.hasAttribute('data-prevent-' + type)) event.preventDefault();
    var name = el.getAttribute('data-on-' + type);
    if (!name) return undefined;
    if (!has(name)) {
      if (global.console) global.console.warn('[LanaDomActions] no action registered for', name);
      return undefined;
    }
    var args = [];
    var raw = el.getAttribute('data-args-' + type);
    if (raw) {
      try {
        args = JSON.parse(raw);
      } catch (_) {
        return undefined;
      }
      if (!Array.isArray(args)) return undefined;
    }
    return actions[name].apply(el, args.map(function (arg) { return resolveArg(arg, el, event); }));
  }

  function bindOne(el, type) {
    if (!bound) return;
    var types = bound.get(el);
    if (!types) { types = Object.create(null); bound.set(el, types); }
    if (types[type]) return;
    types[type] = true;
    el.addEventListener(type, function (event) { return run(el, type, event); });
  }

  /** Bind every element in the event's path that carries this type. */
  function bindPath(event) {
    var type = event.type;
    var node = event.target;
    while (node && node.nodeType === 1) {
      if (node.hasAttribute('data-on-' + type) || node.hasAttribute('data-stop-' + type) || node.hasAttribute('data-prevent-' + type)) {
        bindOne(node, type);
      }
      node = node.parentNode;
    }
  }

  /** Bind ahead of time (elements under root); not needed for normal use. */
  function bindAll(root) {
    var scope = root || global.document;
    TYPES.forEach(function (type) {
      var list = scope.querySelectorAll('[data-on-' + type + '],[data-stop-' + type + '],[data-prevent-' + type + ']');
      for (var i = 0; i < list.length; i += 1) bindOne(list[i], type);
    });
  }

  function install(doc) {
    if (!doc || doc.__lanaDomActionsInstalled) return;
    doc.__lanaDomActionsInstalled = true;
    TYPES.forEach(function (type) { doc.addEventListener(type, bindPath, true); });
  }

  var api = {
    EVENT: EVENT,
    ELEMENT: ELEMENT,
    VALUE: VALUE,
    CHECKED: CHECKED,
    register: register,
    registerGlobals: registerGlobals,
    has: has,
    on: on,
    set: set,
    bindAll: bindAll,
    install: install
  };

  if (global && global.document) install(global.document);
  if (global) global.LanaDomActions = global.LanaDomActions || api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
