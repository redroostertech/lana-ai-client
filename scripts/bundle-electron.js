#!/usr/bin/env node
/**
 * Bundle Electron main process files with esbuild
 * This creates standalone bundles that don't require node_modules at runtime
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'electron-dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Files to bundle
const entryPoints = [
  'electron-main.js',
  'electron-preload.js',
  'electron-discovery.js',
  'electron-storage.js',
  'electron-updater-custom.js',
  'electron-logger.js'
];

async function bundle() {
  console.log('Bundling Electron files...');

  for (const entry of entryPoints) {
    const inputPath = path.join(rootDir, entry);
    const outputPath = path.join(distDir, entry);

    if (!fs.existsSync(inputPath)) {
      console.log(`  Skipping ${entry} (not found)`);
      continue;
    }

    try {
      await esbuild.build({
        entryPoints: [inputPath],
        bundle: true,
        platform: 'node',
        target: 'node20',
        outfile: outputPath,
        external: ['electron', 'electron-store'], // Keep electron external
        minify: false,
        sourcemap: false,
      });
      console.log(`  Bundled: ${entry}`);
    } catch (error) {
      console.error(`  Error bundling ${entry}:`, error.message);
      process.exit(1);
    }
  }

  // Copy package.json with only essential fields
  const pkg = require(path.join(rootDir, 'package.json'));
  const minPkg = {
    name: pkg.name,
    version: pkg.version,
    main: 'electron-main.js',
    author: pkg.author,
    description: pkg.description,
    dependencies: {
      'electron-store': pkg.dependencies['electron-store']
    }
  };
  fs.writeFileSync(
    path.join(distDir, 'package.json'),
    JSON.stringify(minPkg, null, 2)
  );
  console.log('  Created: package.json');

  console.log('Done! Bundled files are in electron-dist/');
}

bundle().catch(console.error);
