'use strict';

// Delegated actions for markup built as strings (src/js/shared/dom-actions.js).

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../src/js/shared/dom-actions.js'), 'utf8');

function load() {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { runScripts: 'outside-only' });
  dom.window.eval(SOURCE);
  return { window: dom.window, A: dom.window.LanaDomActions, host: dom.window.document.getElementById('host') };
}

const PAYLOAD = `O'Brien "Trust" <b>&</b> </button><img src=x onerror="window.__pwned=1">`;

test('arguments travel as data: quotes, tags and handlers in ids and names never become markup or code', () => {
  const { window, A, host } = load();
  const calls = [];
  A.register({ viewMatter: (...args) => calls.push(args) });
  host.innerHTML = '<button id="b"' + A.on('click', 'viewMatter', [PAYLOAD, 7, true, null]) + '>x</button>';
  expect(host.querySelectorAll('img, b').length).toBe(0);
  expect(host.querySelectorAll('[onerror],[onclick]').length).toBe(0);
  window.document.getElementById('b').click();
  expect(calls).toEqual([[PAYLOAD, 7, true, null]]);
  expect(window.__pwned).toBeUndefined();
});

test('only registered actions run; an unknown or injected name does nothing', () => {
  const { window, A, host } = load();
  window.dangerous = jest.fn();
  const warn = jest.spyOn(window.console, 'warn').mockImplementation(() => {});
  host.innerHTML = '<button id="b" data-on-click="dangerous" data-args-click="[1]">x</button>'
    + '<button id="c" data-on-click="constructor">y</button>';
  window.document.getElementById('b').click();
  window.document.getElementById('c').click();
  expect(window.dangerous).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalled();
  expect(() => A.register('a b', () => {})).toThrow();
  expect(() => A.on('click', 'x()', [])).toThrow();
  expect(() => A.on('on click', 'x', [])).toThrow();
});

test('stop stops at the element, before ancestors (listeners and actions), as the inline attribute did', () => {
  const { window, A, host } = load();
  const order = [];
  A.register({ row: () => order.push('row'), pin: () => order.push('pin') });
  host.innerHTML = '<div id="row"' + A.on('click', 'row', []) + '><button id="pin"' + A.on('click', 'pin', [], { stop: true }) + '>p</button>'
    + '<span id="menu"' + A.on('click', null, [], { stop: true }) + '>m</span><i id="plain">i</i></div>';
  const rowEl = window.document.getElementById('row');
  rowEl.addEventListener('click', () => order.push('row-listener'));
  window.document.getElementById('pin').click();
  window.document.getElementById('menu').click();
  expect(order).toEqual(['pin']);
  window.document.getElementById('plain').click();
  // Both of the row's handlers run; between an action and another listener on
  // the same element the order may differ from the inline attribute's.
  expect(order.slice(1).sort()).toEqual(['row', 'row-listener']);
});

test('special arguments: the event, the element, its value and checked state', () => {
  const { window, A, host } = load();
  const seen = [];
  A.register({ field: (key, value, checked, el, event) => seen.push([key, value, checked, el.id, event.type]) });
  host.innerHTML = '<input id="f" type="checkbox" value="v1"' + A.on('change', 'field', ['k', A.VALUE, A.CHECKED, A.ELEMENT, A.EVENT]) + '>';
  const input = window.document.getElementById('f');
  input.checked = true;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  expect(seen).toEqual([['k', 'v1', true, 'f', 'change']]);
  // A literal user string shaped like a token stays a string.
  A.register('echo', (...args) => seen.push(args));
  host.innerHTML = '<b id="t"' + A.on('click', 'echo', ['{"$lanaArg":"event"}', '$event']) + '>t</b>';
  window.document.getElementById('t').click();
  expect(seen[1]).toEqual(['{"$lanaArg":"event"}', '$event']);
});

test('prevent, non-bubbling events, programmatic clicks right after render, and one listener per element', () => {
  const { window, A, host } = load();
  const calls = [];
  A.register({ submit: () => calls.push('submit'), focus: () => calls.push('focus'), go: () => calls.push('go') });
  host.innerHTML = '<form id="f"' + A.on('submit', 'submit', [], { prevent: true }) + '></form><input id="i"' + A.on('focus', 'focus', []) + '>'
    + '<button id="g"' + A.on('click', 'go', []) + '>g</button>';
  const event = new window.Event('submit', { bubbles: true, cancelable: true });
  window.document.getElementById('f').dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  window.document.getElementById('i').dispatchEvent(new window.FocusEvent('focus'));
  const g = window.document.getElementById('g');
  g.click();
  g.click();
  expect(calls).toEqual(['submit', 'focus', 'go', 'go']);
});

test('set() writes the same attributes onto a built element', () => {
  const { window, A } = load();
  const calls = [];
  A.register('pick', (id) => calls.push(id));
  const el = window.document.createElement('button');
  A.set(el, 'click', 'pick', [PAYLOAD]);
  window.document.body.appendChild(el);
  el.click();
  expect(calls).toEqual([PAYLOAD]);
});

test('registerGlobals calls the page global by name when the event fires, with its owner as this', () => {
  const { window, A, host } = load();
  A.registerGlobals(['viewMatter', 'conflictDetection.removeParty']);
  const calls = [];
  host.innerHTML = '<b id="a"' + A.on('click', 'viewMatter', ['M1']) + '>a</b><b id="b"' + A.on('click', 'conflictDetection.removeParty', [2]) + '>b</b>';
  window.viewMatter = (id) => calls.push(['view', id]);
  window.conflictDetection = { parties: 'P', removeParty(i) { calls.push(['remove', i, this.parties]); } };
  window.document.getElementById('a').click();
  window.document.getElementById('b').click();
  expect(calls).toEqual([['view', 'M1'], ['remove', 2, 'P']]);
});
