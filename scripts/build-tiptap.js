const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/js/tiptap-bundle.js'],
  bundle: true,
  outfile: 'src/js/tiptap-bundle-built.js',
  format: 'iife',
  globalName: 'TiptapBundle',
  platform: 'browser',
  minify: false,
  sourcemap: true,
}).then(() => {
  console.log('✓ Tiptap bundle created successfully');
}).catch(() => process.exit(1));
