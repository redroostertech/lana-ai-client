'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { tools, defs } = require('../../src/shared/mcp-contracts/catalog');

function createServer({ relayClient }) {
  const server = new Server({ name: 'lana-desktop-relay', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: buildToolList() }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const name = request.params.name;
      if (!Object.prototype.hasOwnProperty.call(tools, name)) return { isError: true, content: [{ type: 'text', text: 'CAPABILITY_UNAVAILABLE' }] };
      const response = await relayClient.invoke({ capability: name, version: '1.0', arguments: request.params.arguments || {} }, { signal: extra && extra.signal });
      return { structuredContent: response.result, content: [{ type: 'text', text: JSON.stringify(response.result) }] };
  });
  return server;
}

function buildToolList() {
  return Object.entries(tools).map(([name, tool]) => ({
    name, title: tool.title, description: tool.description,
    inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: defs, ...tool.inputSchema },
    outputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: defs, ...tool.outputSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }));
}

async function serve(dependencies) {
  const server = createServer(dependencies); const transport = new StdioServerTransport();
  await server.connect(transport); return server;
}
module.exports = { createServer, serve, buildToolList };
