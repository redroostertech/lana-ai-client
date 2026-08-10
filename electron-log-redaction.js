'use strict';

function redactUrlForLog(rawUrl) {
  if (!rawUrl) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.search) {
      for (const key of Array.from(parsed.searchParams.keys())) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    if (parsed.hash) {
      parsed.hash = '#[redacted]';
    }
    return parsed.toString();
  } catch (error) {
    const value = String(rawUrl);
    const queryIndex = value.indexOf('?');
    const hashIndex = value.indexOf('#');
    const cutIndex = queryIndex === -1
      ? hashIndex
      : (hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex));
    if (cutIndex === -1) return value;
    return value.slice(0, cutIndex) + '[redacted]';
  }
}

module.exports = { redactUrlForLog };
