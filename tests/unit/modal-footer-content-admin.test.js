/**
 * Wave 3a (docs/TABLE-STANDARD.md section 11): lex-modal footers live in the
 * component's footer (footer-content), not in the body under hide-actions.
 * Static checks for the admin, connector and file-viewer modals moved in
 * this wave, plus the page JS that submits lex-form from a footer button.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// The opening <lex-modal ...> tag, treating single-quoted attribute values
// (footer-content='<lex-btn ...>') as opaque so their ">" does not end it.
function modalOpenTag(html, id) {
  const tags = html.match(/<lex-modal\b(?:[^>']|'[^']*')*>/g) || [];
  return tags.find((tag) => tag.replace(/'[^']*'/g, '').includes(`id="${id}"`)) || '';
}

const CASES = [
  ['admin/users.html', 'userModal', ['userModalCancelBtn', 'userModalSaveBtn']],
  ['admin/task-plans.html', 'taskPlanModal', ['taskPlanCancelBtn', 'taskPlanSaveBtn']],
  ['admin/task-plans.html', 'taskPlanItemModal', ['taskPlanItemCancelBtn', 'taskPlanItemSaveBtn']],
  ['admin/roles.html', 'roleModal', ['cancelRoleBtn', 'saveRoleBtn']],
  ['integrations/data_connectors.html', 'connectorDetailsModal', ['detailsActionBtn']],
  ['integrations/data_connectors.html', 'importConnectorModal', ['importConnectorBtn']],
  ['file-viewer.html', 'fvDocxModal', ['fvDocxCancelBtn', 'fvDocxGenerateBtn']],
];

describe('lex-modal footers use footer-content', () => {
  test.each(CASES)('%s #%s keeps its buttons in the footer', (file, modalId, buttonIds) => {
    const html = read(file);
    const tag = modalOpenTag(html, modalId);
    expect(tag).toContain('footer-content=');
    expect(tag).not.toMatch(/\shide-actions[\s>=]/);
    for (const id of buttonIds) {
      expect(tag).toContain(`id="${id}"`);
      // Each id appears once on the page, inside the footer attribute only.
      expect(html.split(`id="${id}"`).length - 1).toBe(1);
    }
  });

  test('footer Save buttons submit their lex-form through the form attribute', () => {
    for (const [page, script, pairs] of [
      ['admin/users.html', 'js/admin/admin-users.js', [['userModalSaveBtn', 'userForm']]],
      ['admin/task-plans.html', 'js/admin/task-plans.js', [['taskPlanSaveBtn', 'taskPlanForm'], ['taskPlanItemSaveBtn', 'taskPlanItemForm']]],
      ['admin/roles.html', 'js/admin/roles.js', [['saveRoleBtn', 'roleForm']]],
    ]) {
      const html = read(page);
      for (const [btn, form] of pairs) {
        expect(html).toMatch(new RegExp(`<lex-btn id="${btn}"[^>]*type="submit"[^>]*form="${form}"`));
        expect(html).toContain(`<lex-form id="${form}"`);
      }
      const js = read(script);
      expect(js).not.toContain('_requestFormSubmit');
      expect(js).not.toContain("new CustomEvent('lex-submit'");
      expect(js).toContain("addEventListener('lex-submit'");
    }
  });

  test('Doc Studio create modal has no subtitle and submits from the footer', () => {
    const js = read('js/components/doc-studio-create-modal.js');
    expect(js).not.toMatch(/subtitle="/);
    expect(js).toContain("footer-content='");
    expect(js).toContain('form.requestSubmit()');
    expect(js).not.toContain('dscm-actions');
  });
});

describe('footer-content submit button reaches its lex-form (jsdom)', () => {
  const { JSDOM } = require('jsdom');
  const lex = ['js/lex/lex.core.js', 'js/lex/lex.forms.js', 'js/lex/components/foundation/lex-modal.js',
    'js/lex/components/form/lex-form.js', 'js/lex/components/form/lex-input.js',
    'js/lex/components/foundation/lex-btn.js'].map(read);

  test('roles.html roleModal: clicking Save emits lex-submit on #roleForm', async () => {
    const html = read('admin/roles.html');
    const end = html.indexOf('</lex-modal>', html.indexOf('id="roleModal"')) + '</lex-modal>'.length;
    const markup = html.slice(html.lastIndexOf('<lex-modal', html.indexOf('id="roleModal"')), end);
    const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    lex.forEach((code) => window.eval(code));
    const modal = window.document.getElementById('roleModal');
    modal.open = true;
    await new Promise((r) => window.setTimeout(r, 0));
    const events = [];
    window.document.getElementById('roleForm').addEventListener('lex-submit', (e) => events.push(e.detail));
    const save = window.document.getElementById('saveRoleBtn');
    expect(save).not.toBeNull();
    (save.querySelector('button') || save).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(events.length).toBe(1);
    expect(events[0]).toHaveProperty('values');
    await new Promise((r) => window.setTimeout(r, 0));
    window.close();
  });
});
