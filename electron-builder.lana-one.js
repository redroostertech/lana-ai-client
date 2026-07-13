/**
 * electron-builder.lana-one.js — LANA One edition packaging config.
 *
 * Reuses the stock client config (electron-builder.client.json) as the single
 * source of truth and overrides ONLY edition identity: a distinct appId,
 * productName, output dir, artifact names, url scheme, and the baked edition
 * flag (extraMetadata.lanaEdition). electron-main.js reads that baked flag so
 * IS_LANA_ONE is true in the packaged app without any runtime env var.
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
  mac: { ...base.mac, artifactName: 'LanaOne--${version}-${arch}.${ext}' },
  win: { ...base.win, artifactName: 'LanaOne--${version}.${ext}' },
  linux: { ...base.linux, artifactName: 'LanaOne--${version}.${ext}' },
  nsis: { ...base.nsis, shortcutName: 'LANA One', artifactName: 'LanaOne--${version}-setup.${ext}' },
  dmg: { ...base.dmg, title: 'LANA One ${version}' },
};
