/**
 * Picking a Settings section updates the URL hash without a new history
 * entry, and keeps the entry's state: the app router stores the route in
 * history.state.path, and Back needs it.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SCRIPT = fs.readFileSync(path.join(__dirname, '../../src/js/pages/settings-v2-nav.js'), 'utf8');

test('a section click keeps the router state on the current entry', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="sv2-tab-profile" data-section="profile"></button><div id="sv2-panel-profile"></div>
    <button id="sv2-tab-general" data-section="general"></button><div id="sv2-panel-general"></div>
  </body>`, { url: 'http://localhost/app.html', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.history.replaceState({ path: '/settings-v2.html' }, '');
  const length = w.history.length;
  w.eval(SCRIPT);
  await new Promise((resolve) => setTimeout(resolve, 20)); // boot runs on DOMContentLoaded
  w.document.getElementById('sv2-tab-general').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  expect(w.location.hash).toBe('#general');
  expect(w.history.state).toEqual({ path: '/settings-v2.html' });
  expect(w.history.length).toBe(length);
  expect(w.document.getElementById('sv2-panel-general').classList.contains('is-active')).toBe(true);
});
