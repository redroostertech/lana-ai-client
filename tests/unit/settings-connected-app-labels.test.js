const fs = require('fs');
const path = require('path');

describe('settings Connected Apps labels', () => {
  test('includes the desktop bridge app labels used by consent storage', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/js/settings-v2.js'),
      'utf8'
    );

    expect(source).toContain("'lana-companion': 'PAC'");
    expect(source).toContain("'lana-brain': 'Lana Brain'");
    expect(source).toContain("'lana-extension': 'LANA Chrome extension'");
  });
});
