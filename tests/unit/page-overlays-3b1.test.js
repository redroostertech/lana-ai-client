/**
 * Wave 3b of the UI standard (docs/TABLE-STANDARD.md section 11): simple
 * fixed-overlay modals on these pages are lex-modal, with footers in
 * data-slot="footer" and form submits through <lex-btn type="submit" form>.
 * Drawer icon rows live in the drawer header (data-slot="header-actions").
 *
 * Static checks over the page markup and the scripts that open the modals.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function block(html, id, tag) {
  const start = html.indexOf(`<${tag} id="${id}"`);
  if (start < 0) return null;
  const end = html.indexOf(`</${tag}>`, start);
  return html.slice(start, end);
}

function expectNoHandBuiltOverlay(html, id) {
  expect(html).not.toMatch(new RegExp(`<div id="${id}"[^>]*fixed inset-0`));
  expect(html).not.toMatch(new RegExp(`<div id="${id}" class="modal`));
}

describe('index.html activity heatmap info modal', () => {
  const html = read('index.html');

  test('is a lex-modal with its footer in the footer slot', () => {
    const body = block(html, 'activityHeatmapInfoModal', 'lex-modal');
    expect(body).not.toBeNull();
    expect(body).toMatch(/heading="Understanding the Activity Overview"/);
    expect(body).toMatch(/<lex-btn data-slot="footer"[^>]*closeActivityHeatmapInfoModal\(\)/);
    expectNoHandBuiltOverlay(html, 'activityHeatmapInfoModal');
  });

  test('page script opens and closes it through the open property', () => {
    expect(html).toMatch(/activityHeatmapInfoModal\.open = true/);
    expect(html).toMatch(/window\.closeActivityHeatmapInfoModal = function\(\) \{\s*const modal = document\.getElementById\('activityHeatmapInfoModal'\);\s*if \(modal\) modal\.open = false;/);
  });
});

describe('skills-marketplace.html modals', () => {
  const html = read('skills-marketplace.html');
  const js = read('js/skills-marketplace.js');
  const ids = ['skill-details-modal', 'matter-selector-modal', 'skill-import-modal'];

  test.each(ids)('%s is a lex-modal', (id) => {
    expect(block(html, id, 'lex-modal')).not.toBeNull();
    expectNoHandBuiltOverlay(html, id);
  });

  test('footer buttons keep the ids the script binds, in the footer slot', () => {
    ['modal-cancel-btn', 'modal-install-btn', 'matter-modal-cancel-btn', 'matter-modal-install-btn',
      'skill-import-cancel-btn', 'skill-import-confirm-btn'].forEach((id) => {
      expect(html).toMatch(new RegExp(`data-slot="footer" id="${id}"`));
    });
    expect(html).not.toMatch(/modal-overlay|modal-close/);
  });

  test('page loads lex-modal', () => {
    expect(html).toContain('js/lex/lex.core.js');
    expect(html).toContain('js/lex/components/foundation/lex-modal.js');
  });

  test('script toggles open and resets state on lex-close', () => {
    expect(js).not.toMatch(/Modal\.classList\.(add|remove)\('hidden'\)/);
    expect(js).not.toMatch(/modal\.classList\.(add|remove)\('hidden'\)/);
    expect(js).toMatch(/addEventListener\('lex-close', closeAllModals\)/);
    expect(js).toMatch(/skillDetailsModal\.open = false/);
  });
});

describe('admin/dashboard.html create modals', () => {
  const html = read('admin/dashboard.html');

  test.each([
    ['createUserModal', 'createUserForm'],
    ['createOrgModal', 'createOrgForm'],
    ['createMatterModal', 'createMatterForm'],
  ])('%s is a lex-modal submitting %s from its footer', (id, formId) => {
    const body = block(html, id, 'lex-modal');
    expect(body).not.toBeNull();
    expect(body).toContain(`<form id="${formId}"`);
    expect(body).toMatch(new RegExp(`<lex-btn data-slot="footer"[^>]*type="submit" form="${formId}"`));
    expect(body).not.toMatch(/<button type="submit"/);
    expectNoHandBuiltOverlay(html, id);
  });

  test('openModal/closeModal use the open property and the page loads lex-modal and lex-btn', () => {
    expect(html).toMatch(/function openModal\(id\) \{\s*document\.getElementById\(id\)\.open = true;/);
    expect(html).toMatch(/function closeModal\(id\) \{\s*document\.getElementById\(id\)\.open = false;/);
    expect(html).toContain('js/lex/components/foundation/lex-modal.js');
    expect(html).toContain('js/lex/components/foundation/lex-btn.js');
  });
});

describe('admin/integrations.html modals', () => {
  const html = read('admin/integrations.html');

  test.each([
    ['configModal', 'configForm'],
    ['addIntegrationModal', 'addIntegrationForm'],
  ])('%s is a lex-modal submitting %s from its footer', (id, formId) => {
    const body = block(html, id, 'lex-modal');
    expect(body).not.toBeNull();
    expect(body).toMatch(new RegExp(`<lex-btn data-slot="footer"[^>]*type="submit" form="${formId}"`));
    expectNoHandBuiltOverlay(html, id);
  });

  test('config title goes through the modal heading', () => {
    expect(html).not.toContain('configModalTitle');
    expect(html).toMatch(/getElementById\('configModal'\)\.heading = config\.title/);
    expect(html).toContain('js/lex/components/foundation/lex-modal.js');
  });
});

describe('workspace-details.html drawer header actions', () => {
  const html = read('workspace-details.html');

  test.each([
    ['sharedWithDrawer', 'openManageShareModal'],
    ['contactsDrawer', 'openAddContactModal'],
    ['linkedMattersDrawer', 'openCreateLinkModal'],
    ['customFieldsDrawer', 'openEditCustomFieldsModal'],
  ])('%s puts its icon row in data-slot="header-actions"', (id, handler) => {
    const body = block(html, id, 'lex-drawer');
    expect(body).not.toBeNull();
    const slot = body.indexOf('data-slot="header-actions"');
    expect(slot).toBeGreaterThan(-1);
    expect(body.indexOf(handler)).toBeGreaterThan(slot);
    expect(body).not.toContain('justify-end mb-4');
  });

  test('custom fields edit button keeps its id', () => {
    expect(html).toContain('id="drawerCustomFieldsEditBtn"');
  });
});
