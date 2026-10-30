'use strict';

// Thin MCP server calls on window.Connectors (src/js/connectors.js): the
// routes under /api/v1/integrations/mcp-servers, and { success, data }
// unwrapped to data.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/src/data-connectors.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(read('js/time-utils.js'));
  const calls = [];
  const answer = (method) => (url, body) => {
    calls.push([method, url, body]);
    return Promise.resolve({ success: true, data: { method, url } });
  };
  window.api = { get: answer('GET'), post: answer('POST'), patch: answer('PATCH'), delete: answer('DELETE'), isDemoMode: () => false };
  window.eval(read('js/connectors.js'));
  return { window, calls, dom };
}

test('each MCP call hits its route and returns data', async () => {
  const { window, calls, dom } = boot();
  const C = window.Connectors;
  const id = '11111111-2222-4333-8444-555555555555';
  await C.mcpDiscover('https://mcp.example.com/mcp');
  await C.mcpCreateServer({ name: 'R', url: 'https://mcp.example.com/mcp', auth_mode: 'none' });
  await C.mcpGetServer(id);
  await C.mcpAuthorize(id, 'electron');
  await C.mcpAuthorize(id, 'web');
  await C.mcpCompleteOAuth('code', 's');
  await C.mcpTestServer(id);
  await C.mcpSetTool(id, 'research_search', { enabled: true, expected_hash: 'h' });
  const removed = await C.mcpDeleteServer(id);
  expect(removed).toEqual({ method: 'DELETE', url: '/api/v1/integrations/mcp-servers/' + id });
  expect(calls).toEqual([
    ['POST', '/api/v1/integrations/mcp-servers/discover', { url: 'https://mcp.example.com/mcp' }],
    ['POST', '/api/v1/integrations/mcp-servers', { name: 'R', url: 'https://mcp.example.com/mcp', auth_mode: 'none' }],
    ['GET', '/api/v1/integrations/mcp-servers/' + id, undefined],
    ['GET', '/api/v1/integrations/mcp-servers/' + id + '/authorize?flow=electron', undefined],
    ['GET', '/api/v1/integrations/mcp-servers/' + id + '/authorize?flow=web', undefined],
    ['POST', '/api/v1/integrations/mcp-servers/oauth/complete', { code: 'code', state: 's' }],
    ['POST', '/api/v1/integrations/mcp-servers/' + id + '/test', {}],
    ['PATCH', '/api/v1/integrations/mcp-servers/' + id + '/tools/research_search', { enabled: true, expected_hash: 'h' }],
    ['DELETE', '/api/v1/integrations/mcp-servers/' + id, undefined]
  ]);
  dom.window.close();
});

test('the list is always an array', async () => {
  const { window, dom } = boot();
  window.api.get = () => Promise.resolve({ success: true, data: [{ id: 'a' }] });
  expect(await window.Connectors.mcpListServers()).toEqual([{ id: 'a' }]);
  window.api.get = () => Promise.resolve({ success: true, data: null });
  expect(await window.Connectors.mcpListServers()).toEqual([]);
  dom.window.close();
});
