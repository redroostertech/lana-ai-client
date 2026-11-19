'use strict';

// Every page gets the strict script policy (nonce + handler hashes, no
// 'unsafe-inline'). That holds only while no page runs script that builds
// inline event handlers in markup strings (onclick="fn('${id}')"): those
// cannot be hashed. Markup built in script names actions through
// js/shared/dom-actions.js instead, which each such page must load first.

const { INLINE_HANDLER_DEBT_PAGES, buildContentSecurityPolicy } = require('../../electron-csp');
const { listPages, pagesNeedingInlineHandlers, pagesMissingDomActions } = require('./helpers/inline-handler-scan');

test('no page needs unsafe-inline: the debt list is empty and stays empty', () => {
  expect(INLINE_HANDLER_DEBT_PAGES).toEqual([]);
  // A script that builds onclick="..." markup again fails here, naming the page and script.
  expect(pagesNeedingInlineHandlers()).toEqual({});
});

test('every page gets a script policy without unsafe-inline', () => {
  for (const page of listPages()) {
    const policy = buildContentSecurityPolicy({ page, nonce: 'Tm9uY2U0', handlerHashes: [], origins: {} });
    expect({ page, inline: /script-src[^;]*'unsafe-inline'/.test(policy) }).toEqual({ page, inline: false });
  }
});

test('pages whose script names actions load js/shared/dom-actions.js before that script', () => {
  expect(pagesMissingDomActions()).toEqual({});
});

test('every action a file names is registered by that same file', () => {
  const fs = require('fs');
  const path = require('path');
  const { SRC } = require('./helpers/inline-handler-scan');
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|html)$/.test(entry.name)) files.push(full);
    }
  })(SRC);
  const missing = [];
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    const used = new Set([...code.matchAll(/LanaDomActions\.(?:on|set)\(\s*(?:[^,]+,\s*)?'[a-z]+',\s*'([^']+)'/g)].map((m) => m[1]));
    if (!used.size) continue;
    const registered = new Set([
      ...[...code.matchAll(/LanaDomActions\.register\(\s*'([^']+)'/g)].map((m) => m[1]),
      ...[...code.matchAll(/LanaDomActions\.register\(\{([\s\S]*?)\}\)/g)].flatMap((m) => [...m[1].matchAll(/([A-Za-z_$][\w$]*)\s*[:(,]/g)].map((k) => k[1])),
      ...[...code.matchAll(/LanaDomActions\.registerGlobals\(\[([\s\S]*?)\]\)/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((k) => k[1]))
    ]);
    for (const name of used) {
      if (!registered.has(name) || /^(event|this|window|document)\./.test(name)) missing.push(`${path.relative(SRC, file)}: ${name}`);
    }
  }
  expect(missing).toEqual([]);
});
