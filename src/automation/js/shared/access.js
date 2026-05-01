import { ADMIN_ROLE_NAMES } from '../constants.js';

function collectRoleNames(profile) {
  const names = [];
  if (profile.role_name) names.push(profile.role_name);
  if (profile.role) names.push(profile.role);
  if (Array.isArray(profile.roles)) {
    for (const role of profile.roles) {
      if (!role) continue;
      if (typeof role === 'string') {
        names.push(role);
        continue;
      }
      if (role.role_name) names.push(role.role_name);
      if (role.name) names.push(role.name);
    }
  }
  return names.map((name) => String(name || '').toLowerCase()).filter(Boolean);
}

export function hasAdminRole(context) {
  const profile = context?.state?.userProfile || {};
  const names = collectRoleNames(profile);
  if (!names.length) return false;
  const adminSet = new Set(ADMIN_ROLE_NAMES.map((name) => name.toLowerCase()));
  return names.some((name) => adminSet.has(name));
}
