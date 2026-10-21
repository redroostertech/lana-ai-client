/**
 * Wave 3b part 2A of the UI standard (docs/TABLE-STANDARD.md section 11):
 * the Skills page, the matter-skills page and the workspace-details skill
 * builder/import overlays are lex-modals. Footers sit in data-slot="footer"
 * with the ids the scripts bind; the full-screen Skill Builders ignore Escape
 * and the backdrop so a stray key cannot drop a draft.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function block(html, id, tag) {
  const start = html.indexOf(`<${tag} id="${id}"`);
  if (start < 0) return null;
  const end = html.indexOf(`</${tag}>`, start);
  return html.slice(start, end + `</${tag}>`.length);
}

const windows = [];
afterAll(() => windows.forEach((w) => w.close()));

const tick = (window, ms = 0) => new Promise((resolve) => window.setTimeout(resolve, ms));

function lexWindow(bodyHtml) {
  const dom = new JSDOM('<!doctype html><body>' + bodyHtml + '</body>', {
    url: 'http://localhost/skills.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.LanaTime = { nowMs: () => 1700000000000 };
  window.eval(read('js/lex/lex.core.js'));
  window.eval(read('js/lex/lex.icons.js'));
  window.eval(read('js/lex/components/foundation/lex-modal.js'));
  window.eval(read('js/lex/components/foundation/lex-btn.js'));
  windows.push(window);
  return window;
}

function escape(window) {
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('skills.html modals', () => {
  const html = read('skills.html');
  const ids = ['learn-more-modal', 'skill-details-modal', 'matter-selector-modal', 'createSkillModal', 'skill-import-modal'];

  test.each(ids)('%s is a lex-modal', (id) => {
    expect(block(html, id, 'lex-modal')).not.toBeNull();
    expect(html).not.toMatch(new RegExp(`<div id="${id}"`));
  });

  test('no hand-built overlay markup remains', () => {
    expect(html).not.toMatch(/modal-overlay|modal-close|class="modal[ "]|fixed inset-0 bg-white/);
  });

  test('footer buttons keep their ids, in the footer slot', () => {
    ['learn-more-close-btn', 'modal-cancel-btn', 'modal-install-btn', 'matter-modal-cancel-btn',
      'matter-modal-install-btn', 'cancelSkillBuilderBtn', 'saveSkillBtn',
      'skill-import-cancel-btn', 'skill-import-confirm-btn'].forEach((id) => {
      expect(html).toMatch(new RegExp(`data-slot="footer" id="${id}"`));
    });
  });

  test('the Skill Builder is a full-screen flush lex-modal that ignores Escape and the backdrop', () => {
    const builder = block(html, 'createSkillModal', 'lex-modal');
    expect(builder).toMatch(/<lex-modal id="createSkillModal" heading="Skill Builder" size="full" flush close-on-escape="false" close-on-overlay="false"/);
    expect(builder).toMatch(/<div data-slot="footer" class="mr-auto[^"]*"[^>]*>\s*<span id="workflow-step-count">/);
    expect(builder).not.toContain('closeSkillBuilderBtn');
  });

  test('lex-btn loads after lex-modal', () => {
    expect(html.indexOf('foundation/lex-modal.js')).toBeGreaterThan(-1);
    expect(html.indexOf('foundation/lex-btn.js')).toBeGreaterThan(html.indexOf('foundation/lex-modal.js'));
  });
});

describe('skills.js drives the lex-modals', () => {
  const js = read('js/skills.js');

  test('no class toggling or JS-built fixed overlays', () => {
    expect(js).not.toMatch(/position:fixed;inset:0/);
    expect(js).not.toMatch(/\.modal-close|\.modal-overlay|modal-overlay/);
    expect(js).not.toMatch(/(learn-more-modal|skill-import-modal|createSkillModal)'\);\s*if \(modal\) modal\.classList/);
  });

  test('attach and override editors open through Lex.Modal.open with footer-slot buttons', () => {
    expect(js).toMatch(/heading: 'Edit Config Overrides'/);
    expect(js).toMatch(/heading: 'Attach Skill to Matter'/);
    expect(js).toMatch(/data-slot="footer" id="ld-overrides-save"/);
    expect(js).toMatch(/data-slot="footer" id="ld-attach-confirm" variant="primary" disabled/);
  });

  function bootSkillsPage() {
    const page = read('skills.html');
    const template = page.slice(page.indexOf('<template id="page-content">'), page.lastIndexOf('</template>'));
    const content = template.slice(template.indexOf('>') + 1);
    const window = lexWindow('<div id="page">' + content + '</div>');
    window.api = {
      get: jest.fn(() => Promise.resolve({ skills: [], data: [] })),
      post: jest.fn(() => Promise.resolve({})),
      patch: jest.fn(() => Promise.resolve({}))
    };
    window.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) }));
    window.showToast = jest.fn();
    try {
      window.eval(read('js/skills.js'));
    } catch (e) {
      // Page widgets (lex-table, lex-select, ...) are not loaded here; the
      // modal wiring runs before any of them is used.
    }
    return window;
  }

  test('Learn more, import and builder open and close through the open property', async () => {
    const window = bootSkillsPage();
    const doc = window.document;
    await tick(window);

    const learnMore = doc.getElementById('learn-more-modal');
    doc.getElementById('learnMoreBtn').click();
    expect(learnMore.open).toBe(true);
    await tick(window);
    learnMore.querySelector('[data-action="close"]').click();
    expect(learnMore.open).toBeFalsy();

    const importModal = doc.getElementById('skill-import-modal');
    doc.getElementById('import-skill-btn').click();
    expect(importModal.open).toBe(true);
    await tick(window);
    expect(importModal.querySelector('.lex-modal-footer #skill-import-confirm-btn')).not.toBeNull();
    escape(window);
    expect(importModal.open).toBeFalsy();

    const builder = doc.getElementById('createSkillModal');
    doc.getElementById('create-skill-btn').click();
    expect(builder.open).toBe(true);
    await tick(window);
    expect(builder.querySelector('.lex-modal-footer #saveSkillBtn')).not.toBeNull();
    expect(builder.querySelector('.lex-modal-footer #workflow-step-count')).not.toBeNull();
    escape(window);
    expect(builder.open).toBe(true);
    doc.getElementById('skill_name').value = 'Draft';
    builder.querySelector('[data-action="close"]').click();
    expect(builder.open).toBeFalsy();

    doc.getElementById('create-skill-btn').click();
    expect(builder.open).toBe(true);
    expect(doc.getElementById('skill_name').value).toBe('');
    doc.getElementById('cancelSkillBuilderBtn').click();
    expect(builder.open).toBeFalsy();
  });
});

describe('matter-skills.html modals', () => {
  const html = read('matter-skills.html');

  test.each(['configure-modal', 'execute-modal', 'history-modal', 'add-skill-modal'])('%s is a lex-modal', (id) => {
    expect(block(html, id, 'lex-modal')).not.toBeNull();
  });

  test('no hand-built overlay markup remains; footers keep their ids', () => {
    expect(html).not.toMatch(/modal-overlay|modal-close|class="modal[ "]/);
    ['configure-cancel-btn', 'configure-save-btn', 'execute-cancel-btn', 'execute-run-btn',
      'history-close-btn', 'add-skill-cancel-btn'].forEach((id) => {
      expect(html).toMatch(new RegExp(`data-slot="footer" id="${id}"`));
    });
    expect(html).toContain('foundation/lex-modal.js');
  });
});

describe('workspace-details skill builder and import modals', () => {
  const html = read('workspace-details.html');

  test('both are lex-modals; the builder ignores Escape and the backdrop', () => {
    const builder = block(html, 'createSkillModal', 'lex-modal');
    expect(builder).toMatch(/size="full" flush close-on-escape="false" close-on-overlay="false"/);
    // workspace-details puts modal footers in footer-content (wave 3a rule).
    expect(builder).toMatch(/footer-content='[^']*<span id="workflow-step-count">0<\/span>[^']*onclick="closeCreateSkillModal\(\)"[^']*onclick="saveSkill\(\)"/);
    const importModal = block(html, 'importSkillModal', 'lex-modal');
    expect(importModal).toMatch(/footer-content='[^']*id="import-skill-btn" onclick="submitImportSkill\(\)"[^']*disabled>Import Skill/);
    expect(html).not.toMatch(/<div id="(createSkillModal|importSkillModal)"/);
  });

  function bootWorkspaceModals() {
    const builder = block(html, 'createSkillModal', 'lex-modal');
    const importModal = block(html, 'importSkillModal', 'lex-modal');
    const window = lexWindow(builder + importModal);
    window.eval(read('js/lex/lex.forms.js'));
    window.eval(read('js/lex/components/form/lex-select.js'));
    window.eval(read('js/shared/event-catalog.js'));
    window.eval(read('js/matter-skills.js'));
    return window;
  }

  test('header close runs the same cleanup as Cancel', async () => {
    const window = bootWorkspaceModals();
    const doc = window.document;
    const builder = doc.getElementById('createSkillModal');
    builder.open = true;
    await tick(window);
    expect(builder.querySelector('.lex-modal-footer #workflow-step-count')).not.toBeNull();
    escape(window);
    expect(builder.open).toBe(true);

    doc.getElementById('skill_name').value = 'Draft';
    window.addWorkflowStep();
    await tick(window);
    expect(doc.querySelectorAll('#workflow-steps-container .workflow-step').length).toBe(1);
    builder.querySelector('[data-action="close"]').click();
    expect(builder.open).toBeFalsy();
    expect(doc.getElementById('skill_name').value).toBe('');
    expect(doc.querySelectorAll('#workflow-steps-container .workflow-step').length).toBe(0);

    const importModal = doc.getElementById('importSkillModal');
    importModal.open = true;
    await tick(window);
    doc.getElementById('import-skill-btn').disabled = false;
    escape(window);
    expect(importModal.open).toBeFalsy();
    expect(doc.getElementById('import-skill-btn').disabled).toBe(true);
  });

  test('close helpers still hide a page that carries the legacy fixed-overlay markup', () => {
    const window = lexWindow('<div id="createSkillModal" class="fixed inset-0 flex"></div><div id="importSkillModal" class="fixed inset-0 flex"><button id="import-skill-btn"></button><input id="skill-file-input"><div id="skill-upload-prompt"></div><div id="skill-file-info"></div><div id="skill-preview"></div></div>');
    window.eval(read('js/matter-skills.js'));
    window.closeCreateSkillModal();
    window.closeImportSkillModal();
    ['createSkillModal', 'importSkillModal'].forEach((id) => {
      const el = window.document.getElementById(id);
      expect(el.classList.contains('hidden')).toBe(true);
      expect(el.classList.contains('flex')).toBe(false);
    });
  });
});
