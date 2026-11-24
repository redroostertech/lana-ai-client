'use strict';

/**
 * The app name Electron uses for the userData folder
 * (~/Library/Application Support/<name> on macOS).
 *
 * People's data lives under "Lana AI". The installed app is named "LANA AI"
 * (electron-builder productName), and electron-builder strips productName from
 * the packed package.json, so the name falls back to "Lana AI" rather than
 * Electron's default (the package name). Changing this moves everyone's data.
 */

const USER_DATA_APP_NAME = 'Lana AI';

function resolveAppName(packageJson) {
  return (packageJson && packageJson.productName) || USER_DATA_APP_NAME;
}

module.exports = { resolveAppName, USER_DATA_APP_NAME };
