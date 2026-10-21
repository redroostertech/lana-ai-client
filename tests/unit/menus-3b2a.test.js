/**
 * Wave 3b part 2A of the UI standard (docs/TABLE-STANDARD.md section 11):
 * hand-built kebab, status and action menus are lex-dropdown-btn, and the
 * contact role picker is a lex-select.
 *
 * MatterDocumentsView and ContactSearchModal run for real in jsdom with the
 * real components; the page menus are checked over their markup and scripts.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const windows = [];
afterAll(() => windows.forEach((w) => w.close()));

function boot(bodyHtml = '') {
  const dom = new JSDOM(`<!doctype html><body>${bodyHtml}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  windows.push(window);
  window.console.log = () => {};
  ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/lex.forms.js',
    'js/lex/components/foundation/lex-modal.js',
    'js/lex/components/form/lex-dropdown-btn.js',
    'js/lex/components/form/lex-select.js'].forEach((rel) => window.eval(read(rel)));
  return window;
}

const tick = (window, ms = 20) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

function optionsOf(el) {
  return JSON.parse(el.getAttribute('options'));
}

describe('MatterDocumentsView kebab menus are lex-dropdown-btn', () => {
  const readyFile = {
    id: 'doc-1',
    filename: 'Engagement letter.docx',
    content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 2048,
    created_at: '2026-10-20T12:00:00.000Z',
    status: 'completed',
    processing_status: 'completed'
  };

  function mount(opts) {
    const window = boot('<div id="root"></div>');
    window.eval(read('js/components/matter-documents-view.js'));
    const root = window.document.getElementById('root');
    const onFileOpen = jest.fn();
    window.MatterDocumentsView.mount(root, Object.assign({
      matterId: 'MATT-1',
      files: [readyFile],
      api: {},
      enableSearch: false,
      enableDocStudio: false,
      enableRename: true,
      onFileOpen
    }, opts || {}));
    return { window, root, onFileOpen };
  }

  test('each file row carries an icon-only, end-aligned menu with the file id', () => {
    const { root } = mount();
    const menus = root.querySelectorAll('lex-dropdown-btn.mdv-kebab-menu');
    expect(menus.length).toBe(1);
    const menu = menus[0];
    expect(menu.getAttribute('data-doc-id')).toBe('doc-1');
    expect(menu.hasAttribute('icon-only')).toBe(true);
    expect(menu.getAttribute('align')).toBe('end');
    expect(menu.getAttribute('aria-label')).toBe('File actions');
    const items = optionsOf(menu);
    expect(items.map((i) => i.value || (i.divider && '|'))).toEqual(['open', 'download', 'rename', '|', 'delete']);
    expect(items.find((i) => i.value === 'delete').danger).toBe(true);
    expect(root.querySelector('.mdv-menu, .mdv-kebab')).toBeNull();
  });

  test('read-only files get no rename or delete', () => {
    const { root } = mount({ files: [Object.assign({}, readyFile, { read_only: true })] });
    const values = optionsOf(root.querySelector('.mdv-kebab-menu')).map((i) => i.value);
    expect(values).toEqual(['open', 'download']);
  });

  test('choosing an item runs the same action (Open calls onFileOpen)', async () => {
    const { window, root, onFileOpen } = mount();
    const menu = root.querySelector('.mdv-kebab-menu');
    click(window, menu.querySelector('.lex-ddbtn-trigger'));
    await tick(window);
    const open = menu.querySelector('.lex-ddbtn-item[data-value="open"]');
    expect(open).not.toBeNull();
    click(window, open);
    expect(onFileOpen).toHaveBeenCalledWith('doc-1');
  });

  test('a click inside the menu does not reach the row delegation', async () => {
    const { window, root, onFileOpen } = mount();
    const menu = root.querySelector('.mdv-kebab-menu');
    click(window, menu.querySelector('.lex-ddbtn-trigger'));
    await tick(window);
    expect(onFileOpen).not.toHaveBeenCalled();
    expect(menu.querySelector('.lex-ddbtn-dropdown--open')).not.toBeNull();
  });
});

describe('ContactSearchModal role picker is a lex-select', () => {
  async function openWithResults() {
    const window = boot();
    window.api = {
      get: jest.fn(async (url) => {
        if (url.indexOf('/contacts/roles') !== -1) {
          return { roles: [{ role_key: 'client', role_label: 'Client' }, { role_key: 'opposing_counsel', role_label: 'Opposing counsel' }] };
        }
        return { contacts: [{ id: 'c-1', display_name: 'Ada Lovelace', contact_type: 'person' }] };
      }),
      post: jest.fn(async () => ({}))
    };
    window.eval(read('js/contact-search-modal.js'));
    await window.ContactSearchModal.open('MATTER-1');
    await window.ContactSearchModal.performSearch('ada');
    await tick(window);
    return window;
  }

  test('each result renders a lex-select of the roles, defaulting to client', async () => {
    const window = await openWithResults();
    const select = window.document.querySelector('lex-select[data-role-select][data-contact-id="c-1"]');
    expect(select).not.toBeNull();
    expect(select.value).toBe('client');
    expect(optionsOf(select)).toEqual([
      { value: 'client', label: 'Client' },
      { value: 'opposing_counsel', label: 'Opposing counsel' }
    ]);
    expect(window.document.querySelector('[id^="role-dropdown-"]')).toBeNull();
  });

  test('the chosen role is the one linked', async () => {
    const window = await openWithResults();
    const select = window.document.querySelector('lex-select[data-role-select]');
    select.dispatchEvent(new window.CustomEvent('lex-change', { bubbles: true, detail: { value: 'opposing_counsel' } }));
    await window.ContactSearchModal.linkContact('c-1');
    expect(window.api.post).toHaveBeenCalledWith('/api/v1/matters/MATTER-1/contacts/link', { contact_id: 'c-1', role: 'opposing_counsel' });
  });
});

describe('page menus use lex-dropdown-btn', () => {
  const pageLoadsDropdown = (html) => expect(html).toMatch(/<script src="js\/lex\/components\/form\/lex-dropdown-btn\.js"><\/script>/);

  test('folder: banner, Actions and Create menus share the create items; no context menu', () => {
    const html = read('folder.html');
    const js = read('js/folder.js');
    pageLoadsDropdown(html);
    ['folderMoreBtn', 'folderActionsBtn', 'emptyCreateBtn'].forEach((id) => {
      const tag = html.match(new RegExp(`<lex-dropdown-btn id="${id}"[^>]*>`, 's'));
      expect(tag).not.toBeNull();
      expect(tag[0]).toContain('data-folder-actions-menu');
      const options = JSON.parse(tag[0].match(/options="([^"]*)"/)[1].split('&quot;').join('"'));
      expect(options.filter((o) => o.value).map((o) => o.value)).toEqual(['upload', 'doc-studio', 'new-folder']);
    });
    expect(html).not.toContain('id="contextMenu"');
    expect(js).not.toMatch(/showContextMenu|contextMenuAction_|showFolderMenu/);
    expect(js).toMatch(/trackDocListener\('lex-select', handleFolderMenuSelect\)/);
    expect(js).toMatch(/<lex-dropdown-btn class="' \+ className \+ '" data-folder-menu/);
  });

  test('drive: folder menus replace the Folder Options modal', () => {
    const html = read('drive.html');
    const js = read('js/drive.js');
    pageLoadsDropdown(html);
    expect(html).not.toContain('id="matterActionsModal"');
    expect(js).not.toMatch(/showMatterActionsModal|matterActionsModal/);
    expect(js).toMatch(/trackDocListener\('lex-select', handleMatterMenuSelect\)/);
    expect((js.match(/matterMenuHtml\(/g) || []).length).toBeGreaterThanOrEqual(4); // definition + 3 renders
  });

  test('dashboard: status pill and drawer Actions are lex-dropdown-btn', () => {
    const html = read('dashboard.html');
    const js = read('js/dashboard/dashboard.js');
    pageLoadsDropdown(html);
    expect(js).toMatch(/<lex-dropdown-btn class="cc-task-status-pill" data-task-status-pill="1"/);
    expect(js).toMatch(/<lex-dropdown-btn class="cc-task-header-actions" data-task-actions-menu/);
    expect(js).not.toMatch(/ccTaskStatusMenu|data-task-actions-toggle|cc-task-actions-menu/);
  });

  test('my tasks: New Task and task Actions menus are lex-dropdown-btn', () => {
    const html = read('my-tasks.html');
    const js = read('js/pages/my-tasks.js');
    pageLoadsDropdown(html);
    expect(html).toMatch(/<lex-dropdown-btn id="myTasksNewBtn"/);
    expect(html).not.toContain('myTasksNewMenu');
    expect(js).toMatch(/newBtn\.addEventListener\('lex-select'/);
    expect(js).toMatch(/<lex-dropdown-btn data-task-actions-menu/);
    expect(js).not.toMatch(/my-task-actions-menu|toggleNewMenu|newMenuOpen/);
  });

  test('workspaces: matter options menu replaces #matterOptionsDropdown', () => {
    const html = read('workspaces.html');
    const js = read('js/workspace.js');
    pageLoadsDropdown(html);
    expect(html).not.toContain('matterOptionsDropdown');
    expect(js).not.toMatch(/showMatterOptions|matterOptionsDropdown/);
    expect(js).toMatch(/trackDocListener\('lex-select', handleMatterOptionsSelect\)/);
  });

  test('router descriptors load lex-dropdown-btn for SPA entry', () => {
    const pages = read('js/lex/lex-router.pages.js');
    ['workspace-details.html', 'drive.html', 'folder.html'].forEach((page) => {
      const start = pages.indexOf(`'${page}': {`);
      const block = pages.slice(start, pages.indexOf('\n    },', start));
      expect(block).toContain('js/lex/components/form/lex-dropdown-btn.js');
    });
  });
});
