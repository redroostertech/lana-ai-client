/**
 * The installed app is called "LANA AI" everywhere a person sees it: the app
 * in Applications or Program Files, the Start menu and desktop shortcut, the
 * disk image window, and the release email. The app's data folder keeps its
 * name (package.json productName, electron-main.js app.setName), so updating
 * never strands anyone's sign-in, models or Briefs.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('the installer names the app LANA AI', () => {
  const builder = read('electron-builder.client.json');
  expect(builder.productName).toBe('LANA AI');
  expect(builder.nsis.shortcutName).toBe('LANA AI');
  expect(builder.dmg.title).toBe('LANA AI ${version}');
});

test('control: the data folder name is unchanged, so an update keeps everyone\'s data', () => {
  expect(read('package.json').productName).toBe('Lana AI');
  expect(read('electron-builder.client.json').extraMetadata.productName).toBeUndefined();
});

test('the release email names the app LANA AI', () => {
  const src = fs.readFileSync(path.join(ROOT, 'cli/lib/utils/email.js'), 'utf8');
  expect(src).not.toMatch(/Lana AI Client/);
  expect(src).toMatch(/LANA AI \$\{tag\} is available/);
});

test('a Mac install from the disk image says to remove the old Lana AI Client (the new app does not replace it: a different name)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'cli/lib/utils/email-html.js'), 'utf8');
  expect(html).toMatch(/drag LANA AI into Applications\. If you still have Lana AI Client there, move it to the Trash\./);
  expect(html).not.toMatch(/Replace the old copy when it asks/);
});
