/**
 * electron-builder.lana-one.js — LANA One edition packaging config.
 *
 * Reuses the stock client config (electron-builder.client.json) as the single
 * source of truth and overrides ONLY edition identity: a distinct appId,
 * productName, output dir, artifact names, url scheme, and the baked edition
 * flag (extraMetadata.lanaEdition). electron-main.js reads that baked flag so
 * IS_LANA_ONE is true in the packaged app without any runtime env var.
 *
 * PHASE B (docs/specs/LANA_ONE_PACKAGING_PLAN.md) additionally bundles the
 * whole sovereign native stack -- a relocated Postgres tree, MinIO,
 * llama-server, the embedding GGUF, and the docling/unstructured Python
 * venvs -- via `extraResources`. Run scripts/stage-sovereign-resources.sh
 * BEFORE building to populate build/sovereign-resources/; electron-builder
 * copies that tree verbatim into the packaged app's Contents/Resources,
 * where supervisor/bootstrap.js's resolveBundledPaths() (rooted at
 * process.resourcesPath) expects to find it. `extraResources` entries are
 * never placed inside app.asar (they live as plain files in
 * Contents/Resources), so no `asarUnpack` entries are needed for them --
 * they are already real on-disk, non-asar paths by construction. asar
 * itself stays on (keeps the JS/HTML payload compact); this edition adds no
 * asarUnpack because nothing IN the asar-eligible `files` set needs a
 * dlopen-able on-disk path (native node_modules like bcrypt/sharp are an
 * existing, separate concern inherited unchanged from electron-builder.client.json).
 *
 * Build with:  electron-builder --mac -c electron-builder.lana-one.js
 * The org build is unaffected — it still uses electron-builder.client.json.
 */
const base = require('./electron-builder.client.json');

module.exports = {
  ...base,
  appId: 'com.redroostertech.lana-one',
  productName: 'LANA One',
  artifactName: 'LanaOne--${version}.${ext}',
  directories: { ...base.directories, output: 'dist-lana-one' },
  // extraMetadata is merged into the packaged app's package.json; lanaEdition is
  // what electron-main.js reads to enable the LANA One edition in the shipped app.
  extraMetadata: { ...base.extraMetadata, lanaEdition: 'lana-one' },
  protocols: [{ name: 'LANA One', schemes: ['lana-one'] }],
  asar: true,
  // The staged sovereign-stack tree (scripts/stage-sovereign-resources.sh)
  // lands flat under Contents/Resources -- Resources/postgres,
  // Resources/minio, Resources/llama-server, Resources/models,
  // Resources/python/{docling,unstructured} -- exactly what
  // supervisor/bootstrap.js's resolveBundledPaths({ resourcesPath }) reads
  // (resourcesPath == Contents/Resources at runtime). `to: '.'` is relative
  // to Resources/ itself (electron-builder's extraResources convention on
  // mac), so this is a direct, unprefixed copy, not nested under an extra
  // "sovereign-resources" folder.
  extraResources: [
    ...(base.extraResources || []),
    {
      from: 'build/sovereign-resources',
      to: '.',
      filter: ['**/*'],
    },
  ],
  // afterSign hook that Developer-ID-signs every Mach-O file dropped into
  // Contents/Resources by the extraResources entry above (postgres/minio/
  // llama-server binaries + all vendored dylibs + every docling/unstructured
  // Python C-extension .so) before electron-builder's own notarize step
  // runs -- required because mac.hardenedRuntime:true rejects an unsigned
  // dylib load at runtime, and electron-builder's default signing pass only
  // knows about the app bundle + recognized native node_modules, not
  // arbitrary extraResources content. Authored/owned separately; referenced
  // here only. No-ops safely (logs + returns) on non-darwin or when no
  // signing identity is available, so unsigned local/dev builds still work.
  afterSign: './scripts/afterpack-sign-resources.js',
  mac: { ...base.mac, artifactName: 'LanaOne--${version}-${arch}.${ext}' },
  win: { ...base.win, artifactName: 'LanaOne--${version}.${ext}' },
  linux: { ...base.linux, artifactName: 'LanaOne--${version}.${ext}' },
  nsis: { ...base.nsis, shortcutName: 'LANA One', artifactName: 'LanaOne--${version}-setup.${ext}' },
  dmg: { ...base.dmg, title: 'LANA One ${version}' },
};
