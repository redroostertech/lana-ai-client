'use strict';

/**
 * The userData folder name (electron-app-name.js): people's data lives in
 * ~/Library/Application Support/Lana AI, so whatever the packed package.json
 * holds, the app name resolves to "Lana AI", never the installed app's
 * "LANA AI" or the package name.
 */

const { resolveAppName } = require('../../electron-app-name');
const sourcePackageJson = require('../../package.json');
const builderConfig = require('../../electron-builder.client.json');

describe('userData folder name', () => {
  test('the packed package.json, with productName stripped by electron-builder, resolves to "Lana AI"', () => {
    const { productName, ...packed } = { ...sourcePackageJson, ...builderConfig.extraMetadata };
    expect(productName).toBe('Lana AI');
    expect(resolveAppName(packed)).toBe('Lana AI');
  });

  test('the source package.json resolves to "Lana AI"', () => {
    expect(resolveAppName(sourcePackageJson)).toBe('Lana AI');
  });

  test('a package.json with only a name or nothing at all resolves to "Lana AI"', () => {
    expect(resolveAppName({ name: 'lana-ai-client' })).toBe('Lana AI');
    expect(resolveAppName({ name: sourcePackageJson.name })).toBe('Lana AI');
    expect(resolveAppName({})).toBe('Lana AI');
    expect(resolveAppName(undefined)).toBe('Lana AI');
  });

  test('never the installed app name or a package name', () => {
    const { productName, ...packed } = sourcePackageJson;
    const resolved = resolveAppName(packed);
    expect(resolved).not.toBe(builderConfig.productName);
    expect(resolved).not.toBe('LANA AI');
    expect(resolved).not.toBe('lana-ai-client');
    expect(resolved).not.toBe(sourcePackageJson.name);
  });

  test('electron-main.js names the app through resolveAppName', () => {
    const fs = require('fs');
    const path = require('path');
    const main = fs.readFileSync(path.join(__dirname, '../../electron-main.js'), 'utf8');
    expect(main).toMatch(/app\.setName\(resolveAppName\(packageJson\)\)/);
  });
});
