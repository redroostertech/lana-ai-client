'use strict';

const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
}

describe('Lex app sign-out login path', () => {
  test('resolves login path from nested Lex app pages', () => {
    const app = read('src/js/lex/components/layout/lex-app.js');
    const signOutStart = app.indexOf('_performSignOut()');
    const signOutEnd = app.indexOf('// -----------------------------------------------------------------------', signOutStart);

    expect(app).toContain('function resolveLoginHref()');
    expect(app).toContain("return '../login.html';");
    expect(signOutStart).toBeGreaterThan(-1);
    expect(signOutEnd).toBeGreaterThan(signOutStart);
    expect(app.slice(signOutStart, signOutEnd)).toContain('var loginHref = resolveLoginHref();');
    expect(app.slice(signOutStart, signOutEnd)).not.toContain("window.location.href = 'login.html'");
  });
});
