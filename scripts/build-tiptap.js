const esbuild = require('esbuild');

const baseConfig = {
  entryPoints: ['src/js/tiptap-bundle.js'],
  bundle: true,
  format: 'iife',
  globalName: 'TiptapBundle',
  platform: 'browser',
  minify: false,
  sourcemap: true,
};

Promise.all([
  esbuild.build({
    ...baseConfig,
    outfile: 'src/js/tiptap-bundle-built.js',
  }),
  esbuild.build({
    ...baseConfig,
    outfile: 'public_html/js/tiptap-bundle-built.js',
  }),
]).then(() => {
  console.log('✓ Tiptap bundles created successfully');
}).catch(() => process.exit(1));
