/**
 * Wave 3a of the UI standard (docs/TABLE-STANDARD.md section 11): lex-modal
 * footers belong in the component's footer (footer-content or the built-in
 * confirm/cancel buttons), never as a hand-built row inside the body, and
 * lex-modal has no `subtitle`. Side panels are lex-drawer, not lex-modal.
 *
 * Static checks over the workspace, folder and drive pages.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const PAGES = ['workspace-details.html', 'workspaces.html', 'folder.html', 'drive.html'];

// Attribute values may contain `>` (footer-content holds markup), so match
// quoted values explicitly.
const OPEN_TAG = /<lex-modal((?:\s+[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*>/g;

function modals(html) {
  const out = [];
  let match;
  OPEN_TAG.lastIndex = 0;
  while ((match = OPEN_TAG.exec(html))) {
    const attrs = match[1];
    const bodyStart = match.index + match[0].length;
    const bodyEnd = html.indexOf('</lex-modal>', bodyStart);
    const id = (/\sid="([^"]+)"/.exec(attrs) || [])[1] || '(no id)';
    out.push({ id, attrs, body: html.slice(bodyStart, bodyEnd) });
  }
  return out;
}

describe.each(PAGES)('%s lex-modal usage', (page) => {
  // Drop comments: "MODALS - using <lex-modal> web component" is not a modal.
  const html = fs.readFileSync(path.join(SRC, page), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const list = modals(html);

  test('parses at least one modal', () => {
    expect(list.length).toBeGreaterThan(0);
  });

  test('no lex-modal sets subtitle', () => {
    const offenders = list.filter((m) => /\ssubtitle=/.test(m.attrs)).map((m) => m.id);
    expect(offenders).toEqual([]);
  });

  test('no footer buttons or slot="footer" inside a modal body', () => {
    const offenders = list.filter((m) =>
      /<lex-btn[^>]*type="submit"/.test(m.body) || /slot="footer"/.test(m.body)
    ).map((m) => m.id);
    expect(offenders).toEqual([]);
  });

  test('every footer submit targets a form that exists in the modal body', () => {
    list.forEach((m) => {
      // Footer submits are <lex-btn type="submit" form="id">: the native
      // form owner gives click-to-submit and Enter-to-submit, so there is no
      // requestSubmit() helper and no hidden submit button in the form.
      const re = /<lex-btn[^>]*type="submit" form="([\w-]+)"/g;
      let match;
      while ((match = re.exec(m.attrs))) {
        expect(m.body).toContain(`<form id="${match[1]}"`);
      }
      expect(m.attrs).not.toMatch(/requestSubmit\(\)/);
      expect(m.body).not.toMatch(/<button type="submit" hidden/);
    });
  });
});

describe('workspace-details side panels', () => {
  const html = fs.readFileSync(path.join(SRC, 'workspace-details.html'), 'utf8');

  test.each(['sharedWithDrawer', 'contactsDrawer', 'linkedMattersDrawer', 'customFieldsDrawer'])(
    '%s is a lex-drawer',
    (id) => {
      expect(html).toMatch(new RegExp(`<lex-drawer id="${id}"`));
      expect(html).not.toMatch(new RegExp(`<lex-modal id="${id}"`));
    }
  );

  test('footer ids the page script binds still exist', () => {
    [
      'taskSubmitBtn', 'taskDeleteBtn', 'taskDeleteConfirm', 'taskPlanSubmitBtn', 'contactSubmitBtn',
      'editContactSubmitBtn', 'cancelDocStudioDocumentBtn', 'generateDocStudioDocumentBtn',
      'openDocStudioDocumentTabBtn', 'closeDocStudioDocumentViewerBtn', 'cancelDetailMatterBtn',
      'docGenArtifactInfo', 'docxTemplateCancelBtn', 'docxTemplateGenerateBtn', 'tsSubmitBtn',
    ].forEach((id) => expect(html).toContain(`id="${id}"`));
  });
});

describe('workspace-details.js and drive.js use Lex.Modal, not browser dialogs', () => {
  const wd = fs.readFileSync(path.join(SRC, 'js/workspace-details.js'), 'utf8');
  const drive = fs.readFileSync(path.join(SRC, 'js/drive.js'), 'utf8');

  test('no window.confirm/alert/prompt', () => {
    [wd, drive].forEach((src) => {
      expect(src).not.toMatch(/window\.(confirm|alert|prompt)\s*\(/);
    });
  });

  test('legal review and signature requests go through the promise API', () => {
    expect(wd).toContain("await Lex.Modal.confirmAsync('Request Legal Review'");
    expect(wd).toContain("await Lex.Modal.prompt('Request Signatures'");
  });

  test('footer submit buttons are looked up by id, not inside the form', () => {
    expect(wd).toContain("document.getElementById('contactSubmitBtn')");
    expect(wd).toContain("document.getElementById('editContactSubmitBtn')");
    expect(wd).toContain("document.getElementById('taskPlanSubmitBtn')");
    expect(wd).not.toMatch(/event\.target\.querySelector\('(lex-btn|button)\[type="submit"\]'\)/);
  });
});
