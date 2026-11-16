/**
 * Surfaces that look the same in both themes read the fixed tokens from lex-tokens.css:
 * QR codes on white, the editor page as paper, banners and cards that are dark by design.
 */
const fs = require('fs');
const path = require('path');

describe('fixed surfaces use the tokens', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');
  test('QR codes stay on white, the editor page is paper, banners stay dark', () => {
    ['css/mfa-setup.css', 'css/briefs-handoff.css', 'css/briefs-phones.css'].forEach((rel) => expect(read(rel)).toContain('var(--lex-qr-bg'));
    expect(read('css/file-editor.css')).toMatch(/\.office-doc-page \{[^}]*var\(--lex-paper-bg\)[^}]*var\(--lex-paper-text\)/);
    expect(read('js/lex/components/foundation/lex-banner.js')).toContain('var(--lex-hero-bg');
    expect(read('js/lex/components/foundation/lex-card.js')).toContain('var(--lex-hero-bg)');
  });
});
