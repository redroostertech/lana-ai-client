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

function capabilityItems(server) {
  if (!server || !Array.isArray(server.enabledApps)) return [];
  return server.enabledApps.filter((item) => (
    item && typeof item === 'object' && item.route?.type === 'capability' && appId(item)
  ));
}

function capabilityIsRequired(item) {
  return item?.route?.meta?.required === true;
}

function capabilityDefaultEnabled(item) {
  return item?.route?.meta?.default_enabled !== false;
}

function boundedHints(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.keys(value).slice(0, 20).forEach((rawKey) => {
    const key = String(rawKey).slice(0, 80);
    const hint = value[rawKey];
    if (!key) return;
    if (typeof hint === 'string') {
      result[key] = hint.slice(0, 500);
    } else if (Array.isArray(hint)) {
      result[key] = hint.filter((item) => typeof item === 'string').slice(0, 10)
        .map((item) => item.slice(0, 500));
    } else if (hint && typeof hint === 'object') {
      const group = {};
      Object.keys(hint).slice(0, 10).forEach((rawGroupKey) => {
        if (typeof hint[rawGroupKey] === 'string') {
          group[String(rawGroupKey).slice(0, 80)] = hint[rawGroupKey].slice(0, 500);
        }
      });
      if (Object.keys(group).length) result[key] = group;
    }
  });
  return result;
}

function isCapabilityActive(server, capabilityId, preferences = {}, platform = process.platform) {
  const item = capabilityItems(server).find((candidate) => appId(candidate) === capabilityId);
  if (!item || !SUPPORTED_PLATFORMS.includes(platform) || !capabilitySupportsPlatform(item, platform)) return false;
  if (capabilityIsRequired(item)) return true;
  if (typeof preferences[capabilityId] === 'boolean') return preferences[capabilityId];
  return capabilityDefaultEnabled(item);
}

function capabilityViewModels(server, preferences = {}, platform = process.platform) {
  return capabilityItems(server).map((item) => {
    const id = appId(item);
    const available = SUPPORTED_PLATFORMS.includes(platform) && capabilitySupportsPlatform(item, platform);
    return {
      id,
      label: String(item.label || id).slice(0, 120),
      description: String(item.description || '').slice(0, 500),
      required: capabilityIsRequired(item),
      defaultEnabled: capabilityDefaultEnabled(item),
      active: available && isCapabilityActive(server, id, preferences, platform),
      available,
      platforms: Array.isArray(item.route.meta?.platforms) ? item.route.meta.platforms.slice(0, 3) : [],
      hints: boundedHints(item.route.meta?.hints)
    };
  });
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
  capabilityItems,
  capabilityIsRequired,
  capabilityDefaultEnabled,
  boundedHints,
  isCapabilityActive,
  capabilityViewModels,
  isCapabilityEnabled,
  isScreenDictionEnabled
};
