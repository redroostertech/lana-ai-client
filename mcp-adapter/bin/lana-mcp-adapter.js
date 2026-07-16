#!/usr/bin/env node
'use strict';
require('../src/cli').main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`lana-mcp-adapter: ${error && error.code ? error.code : 'INTERNAL_ERROR'}\n`);
  process.exitCode = 1;
});
