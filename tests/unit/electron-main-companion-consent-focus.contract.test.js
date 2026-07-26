const fs = require('fs');
const path = require('path');

describe('electron main companion consent foregrounding contract', () => {
  test('focuses the main window before sending companion consent IPC', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../electron-main.js'),
      'utf8'
    );

    expect(source).toContain('function focusMainWindowForCompanionConsent()');
    expect(source).toContain('mainWindow.restore()');
    expect(source).toContain('mainWindow.show()');
    expect(source).toContain('app.focus({ steal: true })');
    expect(source).toContain('mainWindow.moveTop()');
    expect(source).toMatch(/focusMainWindowForCompanionConsent\(\);\s*\n\s*mainWindow\.webContents\.send\('companion-bridge:request-consent'/);
  });
});
