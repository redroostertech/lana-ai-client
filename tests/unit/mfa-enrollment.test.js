'use strict';

// js/shared/mfa-enrollment.js: the setup and verify steps Settings and the
// required-enrollment page (mfa-setup.html) share.

const Enrollment = require('../../src/js/shared/mfa-enrollment.js');

const QR = 'data:image/png;base64,iVBORw0KGgo=';

test('the setup answer is shaped for the screen', () => {
  expect(Enrollment.readSetup({ status: 'success', secret: 'JBSWY3DPEHPK3PXP', qr_code: QR, backup_codes: ['A1B2C3D4', '', 5, 'E5F6G7H8'], provisioning_uri: 'otpauth://totp/x' })).toEqual({
    qrCode: QR, secret: 'JBSWY3DPEHPK3PXP', backupCodes: ['A1B2C3D4', 'E5F6G7H8'], provisioningUri: 'otpauth://totp/x'
  });
});

test('a QR code that is not an inline image is never shown', () => {
  expect(Enrollment.readSetup({ qr_code: 'https://evil.test/qr.png' }).qrCode).toBe(null);
  expect(Enrollment.readSetup({ qr_code: 'javascript:alert(1)' }).qrCode).toBe(null);
  expect(Enrollment.readSetup(null)).toEqual({ qrCode: null, secret: '', backupCodes: [], provisioningUri: null });
});

test('codes: six digits, spaces and dashes ignored', () => {
  expect(Enrollment.codeError('')).toBe(Enrollment.MESSAGES.codeMissing);
  expect(Enrollment.codeError('12345')).toBe(Enrollment.MESSAGES.codeShape);
  expect(Enrollment.codeError('12a456')).toBe(Enrollment.MESSAGES.codeShape);
  expect(Enrollment.codeError('123 456')).toBe(null);
  expect(Enrollment.normalizeCode(' 123-456 ')).toBe('123456');
});

test('the secret reads in groups of four', () => {
  expect(Enrollment.groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
});

test('verify sends the cleaned code and reports a wrong one plainly', async () => {
  const api = { verifyMfa: jest.fn(async () => ({ status: 'success' })) };
  await expect(Enrollment.verify(api, '123 456')).resolves.toEqual({ ok: true });
  expect(api.verifyMfa).toHaveBeenCalledWith('123456');

  api.verifyMfa.mockRejectedValueOnce(Object.assign(new Error('Invalid MFA code'), { status: 401, code: 'INVALID_CODE' }));
  await expect(Enrollment.verify(api, '000000')).resolves.toEqual({ ok: false, message: Enrollment.MESSAGES.wrongCode });

  api.verifyMfa.mockClear();
  await expect(Enrollment.verify(api, '12')).resolves.toEqual({ ok: false, message: Enrollment.MESSAGES.codeShape });
  expect(api.verifyMfa).not.toHaveBeenCalled();
});

test('start reads the setup through the api client', async () => {
  const api = { setupMfa: jest.fn(async () => ({ secret: 'S', qr_code: QR, backup_codes: ['C1'] })) };
  await expect(Enrollment.start(api)).resolves.toMatchObject({ secret: 'S', qrCode: QR, backupCodes: ['C1'] });
});

test('backup codes copy one per line', () => {
  expect(Enrollment.backupCodesText(['A', 'B'])).toBe('A\nB');
  expect(Enrollment.backupCodesText(null)).toBe('');
});
