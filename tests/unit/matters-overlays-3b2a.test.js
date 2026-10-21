/**
 * Wave 3b part 2A of the UI standard (docs/TABLE-STANDARD.md section 11) on
 * matters.html: every hand-built `fixed inset-0` modal is a lex-modal (or
 * Lex.Modal.open for the JS-built ones), the matter details slide-over is a
 * lex-drawer, the kebab menus are lex-dropdown-btn, the header account menu is
 * the shared placeholder, and the legacy notification panel markup is gone
 * (js/notifications.js mounts its lex-drawer).
 *
 * Static checks over the page markup and its inline scripts, plus jsdom runs
 * of converted markup against the real lex components.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const html = read('matters.html');

// Static markup only (no scripts run).
const staticDoc = new JSDOM(html).window.document;

const MODALS = [
  'matterModal', 'workspaceMatterModal', 'taskModal', 'contactModal', 'contactDetailModal',
  'editContactModal', 'createLinkModal', 'documentMetadataModal', 'mattersInfoModal',
  'unlinkConfirmModal', 'manageShareModal', 'manualConnectModal', 'editCustomFieldsModal',
  'createSkillModal', 'importSkillModal'
];

describe('matters.html overlays are lex components', () => {
  test('no hand-built fixed overlays remain', () => {
    expect(html).not.toMatch(/fixed inset-0/);
    expect(html).not.toMatch(/id="drawerOverlay"/);
  });

  test('markup stays balanced: every overlay sits where the old one did, inside #app-content', () => {
    const app = staticDoc.getElementById('app-content');
    [...MODALS, 'matterDrawer'].forEach((id) => {
      expect(staticDoc.getElementById(id).parentElement).toBe(app);
    });
  });

  test.each(MODALS)('%s is a lex-modal', (id) => {
    const el = staticDoc.getElementById(id);
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('LEX-MODAL');
    expect(el.getAttribute('heading')).toBeTruthy();
  });

  test('form modals submit through <lex-btn type="submit" form> in the footer slot', () => {
    const pairs = {
      matterModal: 'matterForm',
      workspaceMatterModal: 'workspaceMatterForm',
      taskModal: 'taskForm',
      contactModal: 'contactForm',
      editContactModal: 'editContactForm',
      createLinkModal: 'createLinkForm'
    };
    Object.entries(pairs).forEach(([modalId, formId]) => {
      const modal = staticDoc.getElementById(modalId);
      const form = staticDoc.getElementById(formId);
      expect(form.tagName).toBe('FORM');
      expect(modal.contains(form)).toBe(true);
      const submit = modal.querySelector(`lex-btn[data-slot="footer"][type="submit"][form="${formId}"]`);
      expect(submit).not.toBeNull();
      // The form itself has no submit button left inside it.
      expect(form.querySelector('button[type="submit"]')).toBeNull();
    });
    // Native submit handlers stay on the forms.
    expect(staticDoc.getElementById('taskForm').getAttribute('onsubmit')).toBe('saveTask(event)');
    expect(staticDoc.getElementById('createLinkForm').getAttribute('onsubmit')).toBe('createLink(event)');
  });

  test('footer buttons keep the ids the scripts bind', () => {
    ['cancelMatterBtn', 'cancelWorkspaceMatterBtn', 'createLinkBtn', 'cancelMetadataUpload',
      'confirmMetadataUpload', 'confirmUnlinkButton', 'saveShareButton', 'import-skill-btn'].forEach((id) => {
      const el = staticDoc.getElementById(id);
      expect(el).not.toBeNull();
      expect(el.tagName).toBe('LEX-BTN');
      expect(el.getAttribute('data-slot')).toBe('footer');
    });
    expect(staticDoc.getElementById('createLinkBtn').hasAttribute('disabled')).toBe(true);
    // No custom close buttons; the component owns close.
    ['closeMatterModal', 'closeWorkspaceMatterModal', 'closeMetadataModal', 'closeDrawer',
      'matterModalTitle', 'taskModalTitle'].forEach((id) => {
      expect(staticDoc.getElementById(id)).toBeNull();
    });
  });

  test('skill builder is a full-screen flush lex-modal that ignores Escape and backdrop', () => {
    const builder = staticDoc.getElementById('createSkillModal');
    expect(builder.getAttribute('size')).toBe('full');
    expect(builder.hasAttribute('flush')).toBe(true);
    expect(builder.getAttribute('close-on-escape')).toBe('false');
    expect(builder.getAttribute('close-on-overlay')).toBe('false');
    expect(builder.querySelector('[data-slot="footer"] #workflow-step-count')).not.toBeNull();
  });

  test('matter details slide-over is a lex-drawer with a lex-dropdown-btn kebab', () => {
    const drawer = staticDoc.getElementById('matterDrawer');
    expect(drawer.tagName).toBe('LEX-DRAWER');
    const actions = drawer.querySelector('[data-slot="header-actions"]');
    expect(actions).not.toBeNull();
    const menu = actions.querySelector('lex-dropdown-btn#drawerOptionsMenu');
    expect(menu.hasAttribute('icon-only')).toBe(true);
    expect(menu.getAttribute('align')).toBe('end');
    const options = JSON.parse(menu.getAttribute('options'));
    expect(options.map((o) => o.value)).toEqual(['edit', 'delete']);
    expect(options[1].variant).toBe('danger');
    expect(actions.querySelector('#refreshMatterBtn')).not.toBeNull();
    ['tabDetails', 'tabContentDetails', 'tabContentConnectedData', 'drawerStatusBadge'].forEach((id) => {
      expect(drawer.querySelector('#' + id)).not.toBeNull();
    });
    expect(staticDoc.getElementById('drawerOptionsDropdown')).toBeNull();
    expect(html).toMatch(/window\.closeDrawer = function\(\) \{\s*const drawer = document\.getElementById\('matterDrawer'\);\s*if \(drawer\) drawer\.open = false;/);
  });

  test('grid card options are a lex-dropdown-btn handled through lex-select', () => {
    expect(html).toMatch(/<lex-dropdown-btn id="matter-card-options-\$\{escapedMatterId\}" class="matter-card-options" data-matter-id="\$\{escapedMatterId\}"/);
    expect(html).not.toMatch(/toggleMatterCardOptions|closeMatterCardOptions/);
    expect(html).toMatch(/closest\('lex-dropdown-btn\.matter-card-options'\)/);
  });

  test('JS-built modals use Lex.Modal.open', () => {
    expect(html).toMatch(/Lex\.Modal\.open\(\{ heading: title \|\| 'Task', content, size: 'lg', hideActions: true \}\);\s*modal\.id = 'taskReadonlyModal';/);
    expect(html).toMatch(/Lex\.Modal\.open\(\{ heading: 'Decline Match', content, size: 'md', hideActions: true \}\);\s*modal\.id = 'declineMatchModal';/);
    expect(html).not.toMatch(/insertAdjacentHTML\('beforeend', modalHtml\)/);
  });

  test('scripts open and close modals through the open property, not hidden classes', () => {
    MODALS.filter((id) => !/Skill/.test(id)).forEach((id) => {
      expect(html).not.toMatch(new RegExp(`getElementById\\('${id}'\\)\\.classList`));
    });
    expect(html).not.toMatch(/\bmodal\.classList\.(add|remove)\('(hidden|flex)'\)/);
    expect(html).not.toMatch(/metadataModal\.classList/);
    expect(html).toMatch(/modal\.heading = 'Edit Matter';/);
    expect(html).toMatch(/modal\.heading = 'Edit Task';/);
    expect(html).toMatch(/modal\.heading = 'Add Matter to Workspace';/);
    // lex-close (close button, backdrop, Escape) runs the page close functions.
    expect(html).toMatch(/\['taskModal', 'closeTaskModal'\]/);
    expect(html).toMatch(/\['editCustomFieldsModal', 'closeEditCustomFieldsModal'\]/);
    expect(html).toMatch(/metadataModal\.addEventListener\('lex-close', closeMetadataModalFn\)/);
    expect(html).toMatch(/workspaceMatterModal\.addEventListener\('lex-close'/);
  });

  test('buttons in lex-btn footers use loading/label instead of rewriting innerHTML', () => {
    expect(html).not.toMatch(/confirmMetadataUpload\.innerHTML|saveButton\.innerHTML|submitBtn\.textContent/);
    expect(html).toMatch(/confirmMetadataUpload\.loading = true;/);
    expect(html).toMatch(/saveButton\.loading = true;/);
    expect(html).toMatch(/submitBtn\.label = 'Creating\.\.\.';/);
  });
});

describe('matters.html header and notifications', () => {
  test('header account menu is the shared placeholder', () => {
    expect(html).toMatch(/<div class="relative" id="userMenu" data-header-user-menu data-settings-href="settings-v2\.html" data-login-href="login\.html"><\/div>/);
    expect(html).toMatch(/<script src="js\/shared\/header-user-menu\.js"><\/script>/);
    expect(html).not.toContain('id="userDropdown"');
    expect(html).not.toContain('id="logoutBtn"');
    expect(html).not.toMatch(/userDropdown\.classList\.toggle/);
  });

  test('legacy notification panel markup is gone; lex-drawer is loaded for it', () => {
    expect(html).not.toContain('id="notificationPanel"');
    expect(html).not.toContain('id="notificationOverlay"');
    expect(html).toMatch(/NotificationPanel\.init\(\)/);
  });

  test('lex-modal and lex-drawer load before lex-btn; lex-dropdown-btn after lex.core', () => {
    const at = (src) => html.indexOf(`<script src="${src}"></script>`);
    const core = at('js/lex/lex.core.js');
    const modal = at('js/lex/components/foundation/lex-modal.js');
    const drawer = at('js/lex/components/foundation/lex-drawer.js');
    const btn = at('js/lex/components/foundation/lex-btn.js');
    const dd = at('js/lex/components/form/lex-dropdown-btn.js');
    [core, modal, drawer, btn, dd].forEach((i) => expect(i).toBeGreaterThan(-1));
    expect(modal).toBeLessThan(btn);
    expect(drawer).toBeLessThan(btn);
    expect(dd).toBeGreaterThan(core);
  });
});

describe('converted matters.html markup with the real lex components', () => {
  function boot(bodyHtml) {
    const dom = new JSDOM('<!doctype html><body>' + bodyHtml + '</body>', {
      url: 'http://localhost/matters.html', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const { window } = dom;
    window.eval(read('js/lex/lex.core.js'));
    window.eval(read('js/lex/lex.icons.js'));
    window.eval(read('js/lex/components/foundation/lex-modal.js'));
    window.eval(read('js/lex/components/foundation/lex-drawer.js'));
    window.eval(read('js/lex/components/foundation/lex-btn.js'));
    window.eval(read('js/lex/components/form/lex-dropdown-btn.js'));
    return window;
  }
  const tick = (window, ms) => new Promise((r) => window.setTimeout(r, ms == null ? 20 : ms));

  test('task modal: footer submit button submits the form; Escape emits lex-close', async () => {
    const window = boot(staticDoc.getElementById('taskModal').outerHTML);
    const modal = window.document.getElementById('taskModal');
    const form = window.document.getElementById('taskForm');
    const onSubmit = jest.fn((e) => e.preventDefault());
    form.removeAttribute('onsubmit');
    form.addEventListener('submit', onSubmit);
    window.document.getElementById('taskTitle').value = 'Call client';
    modal.open = true;
    await tick(window);

    const footer = modal.querySelector('.lex-modal-footer');
    const submit = footer.querySelector('lex-btn[type="submit"]');
    expect(submit).not.toBeNull();
    expect(submit.querySelectorAll('button').length).toBe(1);
    submit.querySelector('button').click();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    const onClose = jest.fn();
    modal.addEventListener('lex-close', onClose);
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(window);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modal.open).toBeFalsy();
  });

  test('matter drawer: header kebab emits lex-select with edit/delete', async () => {
    const window = boot(staticDoc.getElementById('matterDrawer').outerHTML);
    const drawer = window.document.getElementById('matterDrawer');
    drawer.open = true;
    await tick(window);
    const menu = window.document.getElementById('drawerOptionsMenu');
    expect(menu).not.toBeNull();
    const seen = [];
    menu.addEventListener('lex-select', (e) => seen.push(e.detail.value));
    menu.querySelector('[data-action="toggle"]').click();
    await tick(window);
    const items = menu.querySelectorAll('.lex-ddbtn-item');
    expect(items.length).toBe(2);
    items[1].click();
    expect(seen).toEqual(['delete']);
    expect(window.document.getElementById('tabContentDetails')).not.toBeNull();
  });
});
