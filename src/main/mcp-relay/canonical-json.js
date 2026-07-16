'use strict';

function canonicalJson(value) {
  return serialize(value, new Set());
}

function serialize(value, ancestors) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object' || typeof value.toJSON === 'function') throw new TypeError('Canonical JSON supports plain JSON values only');
  if (ancestors.has(value)) throw new TypeError('Canonical JSON rejects cycles');
  ancestors.add(value);
  let output;
  if (Array.isArray(value)) {
    output = `[${value.map((item) => serialize(item, ancestors)).join(',')}]`;
  } else {
    if (Object.prototype.toString.call(value) !== '[object Object]') throw new TypeError('Canonical JSON supports plain objects only');
    const keys = Object.keys(value).sort();
    if (keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new TypeError('Prototype keys are forbidden');
    output = `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key], ancestors)}`).join(',')}}`;
  }
  ancestors.delete(value);
  return output;
}

module.exports = { canonicalJson };
