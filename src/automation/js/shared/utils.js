export function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function readStoredUser() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch (_error) {
    return null;
  }
}

function validTimezone(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch (_error) {
    return '';
  }
}

export function getOrganizationTimezone(contextOrOptions = {}) {
  const state = contextOrOptions?.state || contextOrOptions || {};
  const profile = state.userProfile || {};
  const storedUser = readStoredUser() || {};
  const preferences = profile.preferences || storedUser.preferences || {};

  return validTimezone(
    contextOrOptions.timeZone
    || contextOrOptions.timezone
    || state.organizationTimezone
    || profile.organization_timezone
    || profile.organizationTimezone
    || profile.timezone
    || storedUser.organization_timezone
    || storedUser.organizationTimezone
    || storedUser.timezone
    || preferences?.general?.timezone
    || preferences?.timezone
  ) || 'UTC';
}

function getDateParts(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function formatDateTime(value, contextOrOptions = {}) {
  if (!value) return 'Never';
  const timeZone = getOrganizationTimezone(contextOrOptions);
  const parts = getDateParts(value, timeZone);
  if (!parts) return 'Never';
  const hour24 = parts.hour === '24' ? 0 : Number(parts.hour);
  const hour12 = hour24 % 12 || 12;
  const meridiem = hour24 >= 12 ? 'PM' : 'AM';
  return `${Number(parts.month)}/${Number(parts.day)}/${parts.year} ${hour12}:${parts.minute} ${meridiem}`;
}

export function formatDate(value, contextOrOptions = {}) {
  return formatDateTime(value, contextOrOptions);
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

export function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 Bytes';
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, i);
  return `${Math.round(scaled * 100) / 100} ${units[i]}`;
}

export function timeAgo(isoString) {
  if (!isoString) return 'Never';
  const then = new Date(isoString).getTime();
  if (!Number.isFinite(then)) return 'Never';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatDate(isoString);
}

export function formatLabel(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : ''))
    .join(' ')
    .trim();
}
