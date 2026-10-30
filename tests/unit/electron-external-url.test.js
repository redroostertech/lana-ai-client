const { isAllowedExternalUrl } = require('../../src/electron-external-url');

describe('Electron external URL allowlist', () => {
  test('allows web, mail and Brainchild vault links', () => {
    expect(isAllowedExternalUrl('https://dashboard.stripe.com/apikeys')).toBe(true);
    expect(isAllowedExternalUrl('http://127.0.0.1:7891')).toBe(true);
    expect(isAllowedExternalUrl('mailto:support@lanaai.io')).toBe(true);
    expect(isAllowedExternalUrl('brainchild://vault/' + encodeURI('Daily/2026-05-16 notes.md'))).toBe(true);
  });

  test('refuses schemes that launch other apps or run code', () => {
    [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'smb://attacker/share',
      'x-apple.systempreferences:com.apple.preference.security',
      'lana-ai://oauth/callback?code=1',
      'brainchild://elsewhere/note',
      'ms-msdt:/id PCWDiagnostic'
    ].forEach((url) => expect(isAllowedExternalUrl(url)).toBe(false));
  });

  test('refuses junk input', () => {
    [undefined, null, '', '   ', 42, {}, 'not a url', 'https://'].forEach((value) => {
      expect(isAllowedExternalUrl(value)).toBe(false);
    });
  });
});
