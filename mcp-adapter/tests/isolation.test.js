const fs = require('fs');
const path = require('path');
const { connectLocal } = require('../src/relay-client');
const { buildToolList } = require('../src/server');

describe('isolated stdio adapter', () => {
  it('registers exactly seven tools through the fixed catalog', () => {
    const listed = buildToolList();
    expect(listed.map((tool) => tool.name).sort()).toEqual(['lana.context.current', 'lana.document.list', 'lana.document.search', 'lana.matter.get', 'lana.matter.list', 'lana.status.get', 'lana.task.list']);
    expect(listed.every((tool) => tool.inputSchema.additionalProperties === false && tool.outputSchema.additionalProperties === false)).toBe(true);
  });

  it('contains no backend URL, backend SDK, direct MCP route, HTTP, DNS, or generic tool escape', () => {
    const root = path.join(__dirname, '..', 'src');
    const source = fs.readdirSync(root).filter((name) => name.endsWith('.js')).map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n')
      .replaceAll('https://json-schema.org/draft/2020-12/schema', 'JSON_SCHEMA_URI');
    for (const forbidden of ['http://', 'https://', "'/mcp'", '"/mcp"', 'axios', 'undici', "require('dns')", "require('http')", "require('https')", 'call_api', 'raw_request', 'run_command', 'query_database']) expect(source).not.toContain(forbidden);
  });

  it('uses only a path-based local socket connection', () => {
    const net = require('net'); const spy = jest.spyOn(net, 'createConnection').mockImplementation(() => ({ once: jest.fn(), destroy: jest.fn() }));
    connectLocal('/private/runtime/lana.sock', 1).catch(() => {});
    expect(spy).toHaveBeenCalledWith({ path: '/private/runtime/lana.sock' }); spy.mockRestore();
  });
});
