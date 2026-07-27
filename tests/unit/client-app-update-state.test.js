/**
 * client-app-update-state.js — view-state mapper for the admin Updates page's
 * Client App card. Pure function; no DOM, no Electron.
 */
const { fromCheckResult } = require('../../src/js/admin/client-app-update-state');

describe('ClientAppUpdateState.fromCheckResult', () => {
  test('hides the card when the Electron updates IPC is absent (browser tab)', () => {
    const s = fromCheckResult({ supported: false });
    expect(s.visible).toBe(false);
    expect(s.canInstall).toBe(false);
  });

  test('shows a neutral not-checked state before the first check', () => {
    const s = fromCheckResult({ supported: true, currentVersion: '4.1.0' });
    expect(s.visible).toBe(true);
    expect(s.checked).toBe(false);
    expect(s.statusLabel).toBe('Not checked');
    expect(s.canInstall).toBe(false);
  });

  test('surfaces a failed check without enabling install', () => {
    const s = fromCheckResult({
      supported: true,
      currentVersion: '4.1.0',
      result: { success: false, error: 'network down' }
    });
    expect(s.statusLabel).toBe('Check failed');
    expect(s.badgeColor).toBe('red');
    expect(s.hint).toBe('network down');
    expect(s.canInstall).toBe(false);
  });

  test('reports up to date and mirrors the current version as latest', () => {
    const s = fromCheckResult({
      supported: true,
      currentVersion: '4.1.0',
      result: { success: true, updateInfo: { updateAvailable: false } }
    });
    expect(s.statusLabel).toBe('Up to date');
    expect(s.badgeColor).toBe('green');
    expect(s.latestVersion).toBe('4.1.0');
    expect(s.canInstall).toBe(false);
  });

  test('enables install for an optional update', () => {
    const s = fromCheckResult({
      supported: true,
      currentVersion: '4.1.0',
      result: {
        success: true,
        updateInfo: { updateAvailable: true, updateRequired: false, version: '4.2.0', releaseNotes: 'notes' }
      }
    });
    expect(s.statusLabel).toBe('Update available');
    expect(s.badgeColor).toBe('yellow');
    expect(s.latestVersion).toBe('4.2.0');
    expect(s.releaseNotes).toBe('notes');
    expect(s.canInstall).toBe(true);
    expect(s.mandatory).toBe(false);
  });

  test('marks a forced update as required', () => {
    const s = fromCheckResult({
      supported: true,
      currentVersion: '4.1.0',
      result: {
        success: true,
        updateInfo: { updateAvailable: true, updateRequired: true, version: '4.2.0' }
      }
    });
    expect(s.statusLabel).toBe('Update required');
    expect(s.badgeColor).toBe('red');
    expect(s.mandatory).toBe(true);
    expect(s.canInstall).toBe(true);
  });

  test('treats a success result with no updateInfo as no update', () => {
    const s = fromCheckResult({
      supported: true,
      currentVersion: '4.1.0',
      result: { success: true }
    });
    expect(s.statusLabel).toBe('Up to date');
    expect(s.canInstall).toBe(false);
  });
});
