'use strict';

/**
 * The actions markup names (js/shared/dom-actions.js), written the way the old
 * inline handlers read, for assertions: "openConnectorManage('src-1')",
 * "showConnectorDetails('src-1', event)". One line per action.
 */
const { JSDOM } = require('jsdom');

const SPECIAL = { event: 'event', element: 'this', value: 'this.value', checked: 'this.checked' };

function formatArg(arg) {
  if (arg && typeof arg === 'object' && typeof arg.$lanaArg === 'string') return SPECIAL[arg.$lanaArg] || '?';
  if (typeof arg === 'string') return `'${arg}'`;
  return JSON.stringify(arg);
}

function actionCalls(html) {
  const { document } = new JSDOM('<!doctype html><body></body>').window;
  document.body.innerHTML = html;
  const lines = [];
  document.body.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const m = /^data-on-([a-z]+)$/.exec(attr.name);
      if (!m) return;
      const raw = el.getAttribute(`data-args-${m[1]}`);
      const args = raw ? JSON.parse(raw) : [];
      lines.push(`${attr.value}(${args.map(formatArg).join(', ')})`);
    });
  });
  return lines.join('\n');
}

module.exports = { actionCalls };
