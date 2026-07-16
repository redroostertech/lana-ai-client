'use strict';

const crypto = require('crypto');

function selectionHash(text) {
  if (!text) return null;
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 24);
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  return {
    x: Math.round(Number(bounds.x) || 0),
    y: Math.round(Number(bounds.y) || 0),
    width: Math.round(Number(bounds.width) || 0),
    height: Math.round(Number(bounds.height) || 0)
  };
}

function createFingerprint(context = {}) {
  const focused = context.focusedElement || {};
  return {
    platform: String(context.platform || process.platform),
    processId: Number.isInteger(context.processId) ? context.processId : null,
    bundleId: context.bundleId ? String(context.bundleId) : null,
    processName: String(context.processName || context.activeApplication || ''),
    windowTitle: String(context.windowTitle || ''),
    role: String(focused.role || ''),
    name: String(focused.name || ''),
    bounds: normalizeBounds(focused.bounds),
    selectionHash: selectionHash(context.selectedText)
  };
}

function fingerprintsMatch(expected, actual, options = {}) {
  if (!expected || !actual) return false;
  if (expected.processId && actual.processId && expected.processId !== actual.processId) return false;
  if (expected.bundleId && actual.bundleId && expected.bundleId !== actual.bundleId) return false;
  if (expected.processName !== actual.processName) return false;
  if (expected.role !== actual.role || expected.name !== actual.name) return false;
  if (options.requireSelection && expected.selectionHash !== actual.selectionHash) return false;
  const a = expected.bounds;
  const b = actual.bounds;
  if (a && b) {
    const tolerance = Number(options.boundsTolerance ?? 4);
    if (['x', 'y', 'width', 'height'].some((key) => Math.abs(a[key] - b[key]) > tolerance)) return false;
  }
  if (expected.windowTitle && actual.windowTitle && expected.windowTitle !== actual.windowTitle) {
    const stableApplication = Boolean(
      (expected.processId && actual.processId && expected.processId === actual.processId)
      || (expected.bundleId && actual.bundleId && expected.bundleId === actual.bundleId)
    );
    if (!options.allowDynamicWindowTitle || !stableApplication || !a || !b) return false;
  }
  return true;
}

module.exports = { selectionHash, normalizeBounds, createFingerprint, fingerprintsMatch };
