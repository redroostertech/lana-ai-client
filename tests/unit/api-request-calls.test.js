'use strict';

/**
 * api.request is (method, endpoint, data, options) (src/js/api.js). Pages that called it
 * fetch-style, api.request('/api/x', { method, body }), sent the path as the method and built
 * "<server>undefined" (admin/integrations.html on 2026-11-19). Every call names the method first.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

function files(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files(full, out);
    else if (/\.(js|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// The first argument of every api.request(...) call: balanced, so nested calls stay whole.
function requestCalls(text) {
  const calls = [];
  for (const match of text.matchAll(/\bapi\.request\(/g)) {
    let depth = 0;
    let quote = null;
    const args = [];
    let start = match.index + match[0].length;
    for (let i = start; i < text.length; i += 1) {
      const c = text[i];
      if (quote) {
        if (c === '\\') { i += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) { args.push(text.slice(start, i).trim()); break; }
        depth -= 1;
      } else if (c === ',' && depth === 0) { args.push(text.slice(start, i).trim()); start = i + 1; }
    }
    calls.push({ args, line: text.slice(0, match.index).split('\n').length });
  }
  return calls;
}

const METHOD = /^(['"`])(GET|POST|PUT|PATCH|DELETE|HEAD)\1$/;
// Variables that hold a method in the code that forwards one.
const METHOD_VARIABLES = new Set(['method']);

function problemsIn(text) {
  return requestCalls(text).filter(({ args }) => {
    const [first = '', second = ''] = args;
    if (!METHOD.test(first) && !METHOD_VARIABLES.has(first)) return true;
    // fetch-style options as the endpoint or data
    return /^\{[\s\S]*\b(method|body)\s*:/.test(second);
  }).map(({ args, line }) => `${line}: api.request(${args.join(', ').slice(0, 60)})`);
}

test('the scan catches path-first and fetch-style calls, literal or not', () => {
  expect(problemsIn("api.request('/api/x')")).toHaveLength(1);
  expect(problemsIn('api.request(url)')).toHaveLength(1);
  expect(problemsIn("api.request(url, { method: 'GET' })")).toHaveLength(1);
  expect(problemsIn("window.api.request(`/api/${id}`, { body: x })")).toHaveLength(1);
  expect(problemsIn("api.request('GET', url)")).toEqual([]);
  expect(problemsIn("api.request(method, endpoint, data)")).toEqual([]);
  expect(problemsIn("api.request('POST', '/api/x', { name: 'a', body: 'text' })")).toEqual([]);
});

test('no page calls api.request without an HTTP method first', () => {
  const offenders = [];
  for (const file of files(SRC)) {
    for (const problem of problemsIn(fs.readFileSync(file, 'utf8'))) offenders.push(`${path.relative(SRC, file)}:${problem}`);
  }
  expect(offenders).toEqual([]);
});

test('the integrations page asks for its data with GET and saves with the method first', () => {
  const page = fs.readFileSync(path.join(SRC, 'admin', 'integrations.html'), 'utf8');
  expect(page).toMatch(/api\.request\('GET', '\/api\/integrations'\)/);
  expect(page).toMatch(/api\.request\('GET', '\/api\/integrations\/activity'\)/);
  expect(page).toMatch(/api\.request\('POST', `\/api\/integrations\/\$\{integrationId\}\/test`\)/);
  expect(page).toMatch(/api\.request\('PUT', `\/api\/integrations\/\$\{integrationId\}\/config`, config\)/);
  expect(page).toMatch(/api\.request\('POST', '\/api\/integrations', data\)/);
});
