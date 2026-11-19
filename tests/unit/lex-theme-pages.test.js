/**
 * Every HTML page that uses the shared theme loads js/lex/lex.theme.js in <head>, before
 * its stylesheets, at a path that exists: every page with the sidebar, and every page
 * that asks for the theme on <html> (data-lex-theme="auto").
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'vendor' || entry.name === 'node_modules' ? [] : htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

const pages = htmlFiles(SRC).map((file) => ({ file, rel: path.relative(SRC, file), html: fs.readFileSync(file, 'utf8') }));
const themed = pages.filter((p) => /lex-sidebar\.js|data-lex-theme="auto"|lex\.theme\.js/.test(p.html));

test('there are pages to check', () => {
  expect(themed.length).toBeGreaterThan(60);
});

test.each(themed.map((p) => [p.rel, p]))('%s loads lex.theme.js in <head>, before the stylesheets, at a real path', (_rel, page) => {
  const head = page.html.slice(0, page.html.indexOf('</head>'));
  const tag = head.match(/<script src="([^"]*js\/lex\/lex\.theme\.js)"><\/script>/);
  expect(tag).not.toBeNull();
  expect(fs.existsSync(path.resolve(path.dirname(page.file), tag[1]))).toBe(true);
  const firstSheet = head.search(/<link[^>]+rel="stylesheet"/);
  if (firstSheet >= 0) expect(head.indexOf(tag[0])).toBeLessThan(firstSheet);
});

test('the pages without lex-tokens.css and the separate windows load the theme script too', () => {
  ['auth_error.html', 'error.html', 'logged_out.html', 'session_expired.html', 'skills-marketplace.html', 'update-dialog.html',
    'screen-voice/overlay/index.html', 'briefs/index.html', 'briefs/dashboard.html'].forEach((rel) => {
    expect(themed.map((p) => p.rel)).toContain(rel);
  });
});

test('only pages already dark-ready ask for the theme on <html> (the batches add the rest)', () => {
  const marked = pages.filter((p) => /<html[^>]*data-lex-theme="auto"/.test(p.html)).map((p) => p.rel).sort();
  expect(marked).toEqual(['accept-invite.html', 'activate.html', 'calendar.html', 'data-connectors.html', 'firm-handbook.html', 'first-launch.html', 'mfa-setup.html', 'settings-v2.html', 'shared-link.html']);
});

test('the app-link pages are themed on <html> and no longer read prefers-color-scheme themselves', () => {
  ['accept-invite.html', 'activate.html', 'shared-link.html', 'mfa-setup.html', 'first-launch.html'].forEach((name) => {
    expect(fs.readFileSync(path.join(SRC, name), 'utf8')).toContain('<html lang="en" data-lex-theme="auto">');
  });
  expect(fs.readFileSync(path.join(SRC, 'js/shared/app-link-page-kit.js'), 'utf8')).not.toContain('prefers-color-scheme');
  expect(fs.readFileSync(path.join(SRC, 'js/first-launch.js'), 'utf8')).not.toContain('prefers-color-scheme');
});

test('the Data Connectors search and sort bar uses a surface token, not a fixed white', () => {
  const js = fs.readFileSync(path.join(SRC, 'js/shared/connector-table.js'), 'utf8');
  expect(js).toContain('class="connector-table-toolbar');
  expect(js).not.toMatch(/connector-table-toolbar[^"]*bg-white/);
  expect(fs.readFileSync(path.join(SRC, 'css/connector-table.css'), 'utf8')).toMatch(/\.connector-table-toolbar\s*\{[^}]*background:\s*var\(--lex-bg-elevated\)/);
});
