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

  test('footer Save buttons re-emit lex-submit on the form', () => {
    for (const [file, ids] of [
      ['js/admin/admin-users.js', ['userModalSaveBtn']],
      ['js/admin/task-plans.js', ['taskPlanSaveBtn', 'taskPlanItemSaveBtn']],
      ['js/admin/roles.js', ['saveRoleBtn']],
    ]) {
      const js = read(file);
      expect(js).toContain("new CustomEvent('lex-submit'");
      for (const id of ids) expect(js).toContain(id);
      expect(js).toMatch(/_requestFormSubmit\((form|itemForm)\)/);
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
