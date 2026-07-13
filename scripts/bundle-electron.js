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
  'electron-splash-preload.js',
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
        // Bake the edition flag INTO the bundle. esbuild inlines require('./package.json')
        // at build time (freezing the source package.json, which has no lanaEdition), so
        // the packaged app can't read it at runtime -- electron-main.js reads this defined
        // constant instead. 'lana-one' for a LANA One build, '' otherwise.
        define: {
          'process.env.LANA_ONE_BAKED_EDITION': JSON.stringify(
            process.env.LANA_ONE_EDITION_BUILD === '1' ? 'lana-one' : ''
          ),
        },
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
  // The electron-builder `files` config copies THIS package.json into the app,
  // which overrides electron-builder's extraMetadata.lanaEdition. So when building
  // the LANA One edition, bake the edition flag here (electron-main.js reads
  // require('./package.json').lanaEdition to set IS_LANA_ONE in the packaged app).
  if (process.env.LANA_ONE_EDITION_BUILD === '1') {
    minPkg.lanaEdition = 'lana-one';
    console.log('  Baked lanaEdition=lana-one into electron-dist/package.json');
  }
  fs.writeFileSync(
    path.join(distDir, 'package.json'),
    JSON.stringify(minPkg, null, 2)
  );
  console.log('  Created: package.json');

  console.log('Done! Bundled files are in electron-dist/');
}

bundle().catch(console.error);
