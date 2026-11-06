#!/usr/bin/env node
/**
 * Builds LANA Briefs (briefs/, TypeScript) into CommonJS bundles the client's main process
 * and preload can require, in development and in the packaged app:
 *
 * - briefs/dist/briefs-host.cjs: the main-process host (startBriefsHost);
 * - briefs/dist/briefs-transcription-worker.cjs: the meeting transcription worker thread;
 * - briefs/dist/briefs-preload.cjs: the window.lanaBriefs bridge for electron-preload.js.
 *
 * Native and runtime-loaded modules stay external and load from node_modules
 * (electron-builder.client.json ships them; sherpa-onnx is unpacked from asar).
 */
const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');
const host = path.join(root, 'briefs', 'packages', 'host', 'src');
const core = path.join(root, 'briefs', 'packages', 'core', 'src');
const out = path.join(root, 'briefs', 'dist');

const EXTERNAL = ['electron', 'sherpa-onnx-node', 'bonjour-service'];

// @lana/core and @lana/core/<area> resolve to the engine's sources, as in tsconfig and vitest.
const coreAlias = {
  name: 'lana-core-alias',
  setup(build) {
    build.onResolve({ filter: /^@lana\/core(\/.*)?$/ }, (args) => {
      const area = args.path.slice('@lana/core'.length).replace(/^\//, '');
      return { path: area ? path.join(core, area, 'index.ts') : path.join(core, 'index.ts') };
    });
  }
};

const entries = [
  { in: path.join(host, 'main', 'host.ts'), out: 'briefs-host.cjs' },
  { in: path.join(host, 'main', 'services', 'recording', 'transcriptionWorker.ts'), out: 'briefs-transcription-worker.cjs' },
  { in: path.join(host, 'preload', 'bridge.ts'), out: 'briefs-preload.cjs' }
];

// One-time developer tools, run by hand and never shipped (`--tools`): build/briefs-tools.
const tools = [
  { in: path.join(root, 'briefs', 'packages', 'tools', 'src', 'importStandaloneMain.ts'), out: path.join(root, 'build', 'briefs-tools', 'import-standalone.cjs') }
];

async function build() {
  if (process.argv.includes('--tools')) {
    for (const tool of tools) {
      await esbuild.build({ entryPoints: [tool.in], outfile: tool.out, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: EXTERNAL, plugins: [coreAlias], logLevel: 'warning' });
      console.log(`  Built ${path.relative(root, tool.out)}`);
    }
    return;
  }
  for (const entry of entries) {
    await esbuild.build({
      entryPoints: [entry.in],
      outfile: path.join(out, entry.out),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: EXTERNAL,
      plugins: [coreAlias],
      sourcemap: false,
      logLevel: 'warning'
    });
    console.log(`  Built briefs/dist/${entry.out}`);
  }
}

build().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
