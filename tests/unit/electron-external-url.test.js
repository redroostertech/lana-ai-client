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

// mail links: attachments, cc and bcc are dropped before the mail app sees them (nothing in
// the app uses them; a page could otherwise attach a local file or copy someone in).
describe('sanitizeExternalUrl', () => {
  const { sanitizeExternalUrl } = require('../../src/electron-external-url');

  test('drops attach, attachment, cc and bcc from mailto, keeping the rest as written', () => {
    expect(sanitizeExternalUrl('mailto:a@b.test?subject=Hello%20there&attach=/etc/passwd&CC=x@y.test&bcc=z@y.test&body=Hi'))
      .toBe('mailto:a@b.test?subject=Hello%20there&body=Hi');
    expect(sanitizeExternalUrl('mailto:a@b.test?Attachment=file:///Users/x/.ssh/id_rsa')).toBe('mailto:a@b.test');
    expect(sanitizeExternalUrl('mailto:support@lana.ai')).toBe('mailto:support@lana.ai');
  });

  test('CR and LF are stripped from mail fields, raw or percent-encoded in any case', () => {
    expect(sanitizeExternalUrl('mailto:a@b.test?subject=Hi%0D%0ABcc:%20x@evil.test&body=one%0atwo%0Dthree'))
      .toBe('mailto:a@b.test?subject=HiBcc:%20x@evil.test&body=onetwothree');
    expect(sanitizeExternalUrl('mailto:a@b.test?subject=a%0d%0Ab')).toBe('mailto:a@b.test?subject=ab');
    expect(sanitizeExternalUrl('mailto:a@b.test%0D%0Abcc:x@evil.test')).toBe('mailto:a@b.testbcc:x@evil.test');
  });

  test('nested encodings that rebuild a line break after stripping are refused', () => {
    expect(sanitizeExternalUrl('mailto:a@b.test?subject=Hi%%0D0DBcc:x@evil.test')).toBeNull();
    expect(sanitizeExternalUrl('mailto:a@b.test?subject=Hi%0%0AABcc:x@evil.test')).toBeNull();
    expect(sanitizeExternalUrl('mailto:a@b.test?subject=Hi%%0d0dBcc:x@evil.test')).toBeNull();
  });

  test('web and vault links pass unchanged; refused URLs are null', () => {
    expect(sanitizeExternalUrl('https://lanaai.io/a?cc=1')).toBe('https://lanaai.io/a?cc=1');
    expect(sanitizeExternalUrl('brainchild://vault/a.md')).toBe('brainchild://vault/a.md');
    expect(sanitizeExternalUrl('foo://bar')).toBe(null);
    expect(sanitizeExternalUrl('')).toBe(null);
  });
});

test('the opener opens the cleaned link', async () => {
  const { createExternalOpener } = require('../../electron-external-open');
  const { isAllowedExternalUrl, sanitizeExternalUrl } = require('../../src/electron-external-url');
  const shell = { openExternal: jest.fn(async () => {}) };
  const mainFrame = { url: 'lana-app://app/public_html/app.html', parent: null };
  const opener = createExternalOpener({ shell, isAllowed: isAllowedExternalUrl, sanitize: sanitizeExternalUrl, gestures: { recent: () => true }, confirm: async () => true });
  await opener.open('mailto:a@b.test?attach=/etc/passwd', { contents: { id: 1, mainFrame, focusedFrame: mainFrame } });
  expect(shell.openExternal).toHaveBeenCalledWith('mailto:a@b.test');
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'electron-main.js'), 'utf8');
  expect(main).toMatch(/createExternalOpener\(\{ shell, isAllowed: isAllowedExternalUrl, sanitize: sanitizeExternalUrl,/);
});
