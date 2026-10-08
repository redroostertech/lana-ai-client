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

const OUTFILES = [
  'src/js/tiptap-bundle-built.js',
  'public_html/js/tiptap-bundle-built.js',
];

module.exports = { baseConfig, OUTFILES };

if (require.main === module) {
  Promise.all(OUTFILES.map((outfile) => esbuild.build({ ...baseConfig, outfile }))).then(() => {
    console.log('✓ Tiptap bundles created successfully');
  }).catch(() => process.exit(1));
}
