'use strict';

const SCREEN_DICTION_APP_ID = 'screen-diction';
const SUPPORTED_PLATFORMS = Object.freeze(['darwin', 'win32', 'linux']);

function appId(item) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return '';
  return String(item.id || item.app_id || item.slug || item.key || '').trim();
}

function capabilitySupportsPlatform(item, platform) {
  if (!item || typeof item !== 'object' || item.route?.type !== 'capability') return false;
  const platforms = item.route.meta?.platforms;
  if (!Array.isArray(platforms) || platforms.length === 0) return true;
  return platforms.includes(platform);
}

function isCapabilityEnabled(server, capabilityId, platform = process.platform) {
  if (!server || !Array.isArray(server.enabledApps) || !SUPPORTED_PLATFORMS.includes(platform)) return false;
  return server.enabledApps.some((item) => (
    appId(item) === capabilityId && capabilitySupportsPlatform(item, platform)
  ));
}

function isScreenDictionEnabled(server, platform = process.platform) {
  return isCapabilityEnabled(server, SCREEN_DICTION_APP_ID, platform);
}

module.exports = {
  SCREEN_DICTION_APP_ID,
  SUPPORTED_PLATFORMS,
  appId,
  capabilitySupportsPlatform,
  isCapabilityEnabled,
  isScreenDictionEnabled
};
