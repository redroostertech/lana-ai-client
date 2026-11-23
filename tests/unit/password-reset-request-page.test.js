const fs = require('fs');
const path = require('path');

// The server never returns a reset token (it emails the owner or asks a firm
// admin), so the forgot-password page must not read one or offer an
// in-page password form keyed on it.
describe('forgot-password page', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/password-reset-request.html'), 'utf8');

  test('never reads a reset token from the response', () => {
    expect(html).not.toMatch(/reset_token|resetToken/);
  });

  test('has no in-page admin password form', () => {
    expect(html).not.toMatch(/adminResetForm|adminPasswordResetForm|newPassword/);
  });

  test('still requests the reset and shows one confirmation', () => {
    expect(html).toMatch(/api\.requestPasswordReset\(email\)/);
    expect(html).toMatch(/id="successMessage"/);
  });
});
