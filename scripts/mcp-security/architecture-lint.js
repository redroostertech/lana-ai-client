#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const findFiles = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
  const relative = path.join(directory, entry.name);
  return entry.isDirectory() ? findFiles(relative) : entry.name.endsWith('.js') ? [relative] : [];
});
function forbid(file, pattern, message) { if (pattern.test(read(file))) failures.push(`${file}: ${message}`); }

forbid('electron-preload.js', /\b(?:invoke|send):\s*\(channel\b/, 'generic preload IPC is prohibited');
forbid('electron-main.js', /session-tracker:initialize|getToken:\s*async|companionBridge\.start/, 'raw renderer-token bridge is prohibited');
forbid('electron-bridge.js', /createServer|listen\(|access[_-]?token|refresh[_-]?token/i, 'legacy localhost credential bridge is prohibited');
forbid('src/js/api.js', /localStorage\.(?:getItem|setItem)\(['"]token['"]|Authorization['"]?\s*[:=].*this\.token/, 'renderer backend credential custody is prohibited');

const adapterSource = findFiles('mcp-adapter/src').map((file) => `${file}\n${read(file)}`).join('\n')
  .replaceAll('https://json-schema.org/draft/2020-12/schema', 'JSON_SCHEMA_URI');
for (const [pattern, message] of [
  [/https?:\/\//, 'backend or web URL'], [/require\(['"](?:http|https|dns|dgram|undici|axios)['"]\)/, 'outbound network module'],
  [/["']\/mcp["']/, 'direct backend MCP route'], [/child_process|\bspawn\(|\bexec\(/, 'process execution'],
  [/\b(?:call_api|raw_request|run_command|query_database|graphql|fetch_url)\b/i, 'generic capability escape']
]) if (pattern.test(adapterSource)) failures.push(`mcp-adapter/src: ${message} is prohibited`);

const { tools } = require(path.join(root, 'src/shared/mcp-contracts/catalog'));
const approved = ['lana.status.get', 'lana.context.current', 'lana.matter.list', 'lana.matter.get', 'lana.document.list', 'lana.document.search', 'lana.task.list'].sort();
if (JSON.stringify(Object.keys(tools).sort()) !== JSON.stringify(approved)) failures.push('capability catalog does not exactly match the approved Phase 1 disposition');
if (Object.values(tools).some((tool) => tool.sideEffects !== 'none')) failures.push('a mutating capability is reachable');

if (failures.length) {
  process.stderr.write(`MCP architecture gate failed (${failures.length}):\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('MCP architecture gate passed\n');
