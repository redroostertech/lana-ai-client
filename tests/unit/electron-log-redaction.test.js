'use strict';

const { redactUrlForLog } = require('../../electron-log-redaction');

describe('electron log redaction', () => {
  test('redacts query values and hash fragments', () => {
    const redacted = redactUrlForLog('file:///Applications/Lana/vpn-setup.html?server=secret-api-key&token=abc#private');

    expect(redacted).toBe('file:///Applications/Lana/vpn-setup.html?server=%5Bredacted%5D&token=%5Bredacted%5D#[redacted]');
    expect(redacted).not.toContain('secret-api-key');
    expect(redacted).not.toContain('abc');
    expect(redacted).not.toContain('private');
  });

  test('redacts malformed URL suffixes without throwing', () => {
    const redacted = redactUrlForLog('/vpn-setup.html?server=secret-api-key#private');

    expect(redacted).toBe('/vpn-setup.html[redacted]');
    expect(redacted).not.toContain('secret-api-key');
    expect(redacted).not.toContain('private');
  });
});
