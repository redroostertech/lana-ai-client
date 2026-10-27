'use strict';

/**
 * UI standard wave 3a: lex-modal footers live in the component's footer
 * (footer-content), not inside the modal body, and page code uses the
 * modal/drawer public API instead of reaching into their internals.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const { document, DOMParser } = new JSDOM('').window;

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// Parse a page (template contents included) and return the lex-modal by id.
function modalFrom(rel, id) {
  const doc = new DOMParser().parseFromString(read(rel), 'text/html');
  let modal = doc.getElementById(id);
  if (!modal) {
    for (const tpl of doc.querySelectorAll('template')) {
      modal = tpl.content.getElementById ? tpl.content.getElementById(id) : tpl.content.querySelector('#' + id);
      if (modal) break;
    }
  }
  return modal;
}

function footerOf(modal) {
  const holder = document.createElement('div');
  holder.innerHTML = modal.getAttribute('footer-content') || '';
  return holder;
}

describe('lex-modal footers are in footer-content, not the body', () => {
  const cases = [
    ['data-connectors.html', 'connectorDetailsModal', ['detailsActionBtn']],
    ['data-connectors.html', 'importConnectorModal', ['importConnectorBtn', 'importConnectorBtnLabel']],
    ['my-tasks.html', 'myTaskCloseoutModal', ['myTaskCloseoutSkipBtn', 'myTaskCloseoutSaveBtn']],
    ['my-tasks.html', 'myTaskCreateModal', ['myTaskCancelBtn', 'myTaskSaveBtn']],
    ['my-tasks.html', 'myTaskPlanCreateModal', ['myTaskPlanCancelBtn', 'myTaskPlanSaveBtn']],
    ['admin/user-details.html', 'userModal', ['userModalCancelBtn', 'userModalSaveBtn']],
    ['admin/user-details.html', 'resetPasswordModal', ['resetPasswordCancelBtn', 'resetPasswordSubmitBtn']],
  ];

  test.each(cases)('%s #%s keeps its button ids in the footer', (page, id, ids) => {
    const modal = modalFrom(page, id);
    expect(modal).toBeTruthy();
    const footer = footerOf(modal);
    ids.forEach((buttonId) => {
      expect(footer.querySelector('#' + buttonId)).toBeTruthy();
      expect(modal.querySelector('#' + buttonId)).toBeNull();
    });
    // Moved out of the lex-form, a footer submit button must name its form
    // (lex-form handles <lex-btn type="submit" form="id"> from outside).
    footer.querySelectorAll('[type="submit"]').forEach((btn) => {
      const formId = btn.getAttribute('form');
      expect(formId).toBeTruthy();
      expect(modal.querySelector('lex-form#' + formId)).toBeTruthy();
    });
  });

  test('connector actions/accounts modals close from the footer', () => {
    ['connectorActionsModal', 'connectorAccountsModal'].forEach((id) => {
      const footer = footerOf(modalFrom('data-connectors.html', id));
      expect(footer.querySelector('lex-btn[onclick]')).toBeTruthy();
    });
  });

  test('task details actions render through header-actions, not header DOM pokes', () => {
    const modal = modalFrom('my-tasks.html', 'myTaskDetailsModal');
    const holder = document.createElement('div');
    holder.innerHTML = modal.getAttribute('header-actions') || '';
    expect(holder.querySelector('[data-task-actions-wrap]')).toBeTruthy();
    const js = read('js/pages/my-tasks.js');
    expect(js).not.toMatch(/\.lex-modal-(header|close|title)/);
  });

  test('footer Save buttons submit their forms through validate()', () => {
    const tasks = read('js/pages/my-tasks.js');
    expect(tasks).toContain("bindFooterSubmit(el('myTaskSaveBtn'), createForm, submitNewTask)");
    expect(tasks).toContain("bindFooterSubmit(el('myTaskPlanSaveBtn'), planForm, submitNewTaskPlan)");
    const users = read('js/admin/admin-user-details.js');
    expect(users).not.toContain('_bindFooterSubmit');
    const page = read('admin/user-details.html');
    expect(footerOf(modalFrom('admin/user-details.html', 'userModal')).querySelector('#userModalSaveBtn[type="submit"][form="userForm"]')).toBeTruthy();
    expect(footerOf(modalFrom('admin/user-details.html', 'resetPasswordModal')).querySelector('#resetPasswordSubmitBtn[type="submit"][form="resetPasswordForm"]')).toBeTruthy();
    expect(page).toContain('<lex-form id="resetPasswordForm">');
  });
});

describe('no pokes into lex-modal / lex-drawer internals', () => {
  test('connector modals set their title through the heading property', () => {
    const js = read('js/data_connectors.js');
    expect(js).not.toContain('.lex-modal-title');
    expect(js).toContain('detailsModal.heading =');
    expect(js).toContain('modal.heading = connectorName');
    expect(js).not.toContain("document.getElementById('purgeDataCheckbox')");
  });

  test('pickers use lex-modal backButton instead of injecting header chrome', () => {
    ['js/user-picker-modal.js', 'js/matter-picker-modal.js'].forEach((rel) => {
      const js = read(rel);
      expect(js).toContain('backButton');
      expect(js).toContain("'lex-back'");
      expect(js).not.toMatch(/querySelector\('\.lex-modal-header'\)/);
      expect(js).not.toContain('_ensurePickerChrome');
    });
  });

  test('metric catalog and data visualization scope drawer queries to the drawer element', () => {
    ['js/admin/metric-catalog.js', 'js/admin/data-visualization.js'].forEach((rel) => {
      const js = read(rel);
      expect(js).not.toMatch(/document\.querySelector\('[^']*lex-drawer/);
    });
  });

  test('settings MFA modals put actions in footerContent and query within the modal', () => {
    const js = read('js/settings-v2.js');
    expect(js).not.toContain("document.querySelector('lex-modal[open]')");
    expect(js).toContain("modal.querySelector('#sv2-mfa-verify-btn')");
    expect(js).toContain("modal.querySelector('#sv2-mfa-disable-confirm-btn')");
  });

  test('brainchild preview writes into its own content root', () => {
    const js = read('brainchild/app.js');
    expect(js).not.toContain('.lex-modal-body');
    expect(js).toContain('data-bc-preview-root');
  });
});

describe('my tasks delete confirms through Lex.Modal.confirmAsync', () => {
  test('no native confirm; cancel returns before deleting', () => {
    const js = read('js/pages/my-tasks.js');
    expect(js).not.toMatch(/window\.confirm\(/);
    const at = js.indexOf("Lex.Modal.confirmAsync('Delete Task'");
    expect(at).toBeGreaterThan(-1);
    const after = js.slice(at, at + 400);
    expect(after.indexOf('if (!confirmDelete) return;')).toBeLessThan(after.indexOf('api.deleteTask'));
  });
});
